// A workspace's shared pick list (Task 11; docs/picklist.md): one ordered list of FTC teams per
// workspace and season, separate from each member's personal shortlist, which any member can add to,
// remove from, reorder and annotate.
//
// - Reads and writes need the signed-in user's linked Control Point account to be a member of the
//   workspace right now (workspaceAccess, as entries): 403 otherwise, 401 signed out, 503 while
//   workspace scouting is paused in the owner portal. Writes are JSON only (CSRF).
// - Ordering (src/shared/picklist.ts): changes to one workspace's lists are applied one at a time, in the
//   order they arrive (serialized), each as an operation that names teams ("move 18360 to just before
//   7393"), never positions. Two members reordering at once both get their move, in arrival order; one
//   whose team or anchor was removed meanwhile is a 409 with the current list. After each change the list
//   is numbered 1..n and its version goes up by one.
// - Authorship is stamped here, never taken from the client: who added each team and when, who last wrote
//   its note and when (the note: last write wins, in arrival order).
// - Each change is published to the workspace's open streams (`event: picklist`, the whole list) and logged
//   in its activity feed as picklist.added / picklist.removed / picklist.moved / picklist.noted (subject
//   picklist:<season>). Rapid moves (or note edits) by one member coalesce into one item, as entry edits do.
//   Every picklist.* item also reaches the other members' inboxes, one unread line per workspace
//   (server/inbox/inbox.ts).
// - A removed team's row is kept (removed_at) so Undo ({op: "add", restore: true}) brings it back as it was:
//   who added it, its note and who wrote it. Adding it again any other way starts it afresh.
// - The workspace mirror row is created by the first change, not by a read.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { InStatement } from "@libsql/client";
import { all, db, get } from "../db.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { applyPickOp, cleanPickOp, type Pick, type PickList, type PickOp, type PickPerson } from "../../src/shared/picklist.js";
import { publishPicklist, serialized } from "./bus.js";
import { workspaceAccess, workspacePaused, writerName } from "./entries.js";
import { logActivity, type ActivityActor } from "./activityLog.js";

const isSeason = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 2000 && v <= 2100;

const person = (id: unknown, name: unknown): PickPerson => ({ accountId: id == null ? null : Number(id), name: String(name ?? "") });
const toPick = (r: any): Pick => ({
  team: Number(r.team), rank: Number(r.rank),
  addedBy: person(r.added_by_account_id, r.added_by_name), addedAt: Number(r.added_at),
  note: String(r.note ?? ""),
  noteBy: r.note_updated_at == null ? null : person(r.note_by_account_id, r.note_by_name),
  noteUpdatedAt: r.note_updated_at == null ? null : Number(r.note_updated_at),
});

/** The list as members read it (empty, version 0, when it never changed). Never writes. */
export async function readPickList(workspaceId: string, season: number): Promise<PickList> {
  const v = await get<{ version: number }>(
    `SELECT v.version FROM workspace_picklist_versions v JOIN workspaces w ON w.id = v.workspace_id WHERE w.cp_workspace_id = ? AND v.season = ?`, [workspaceId, season]);
  const rows = await all<any>(
    `SELECT p.* FROM workspace_picklist p JOIN workspaces w ON w.id = p.workspace_id WHERE w.cp_workspace_id = ? AND p.season = ? AND p.removed_at IS NULL ORDER BY p.rank, p.team`, [workspaceId, season]);
  return { workspaceId, season, version: Number(v?.version ?? 0), picks: rows.map(toPick) };
}

export type PickOpResult =
  | { ok: true; changed: boolean; list: PickList }
  | { ok: false; status: 400 | 409; error: string; list?: PickList };

const lock = (workspaceId: string) => `picklist:${workspaceId}`;

/** Teams the database knows (an unknown number would never show a row). */
async function knownTeams(teams: number[]): Promise<Set<number>> {
  if (!teams.length) return new Set();
  const rows = await all<{ number: number }>(`SELECT number FROM teams WHERE number IN (${teams.map(() => "?").join(",")})`, teams);
  return new Set(rows.map((r) => Number(r.number)));
}

/**
 * Apply one member's change (membership already checked). Runs after every earlier change to the
 * workspace's lists has finished, so the result is the same as applying them one by one in arrival order.
 */
export async function changePickList(user: User, m: Membership, season: number, op: PickOp): Promise<PickOpResult> {
  // Unknown teams are refused (one) or skipped (a copy) before the queue: the teams table isn't ours to lock.
  if (op.op === "add") {
    if (!(await knownTeams([op.team])).has(op.team)) return { ok: false, status: 400, error: `There's no team ${op.team}.` };
  } else if (op.op === "import") {
    const known = await knownTeams(op.teams);
    op = { op: "import", teams: op.teams.filter((t) => known.has(t)) };
    if (!op.teams.length) return { ok: false, status: 400, error: "None of those teams are known." };
  }
  const by: PickPerson = { accountId: m.accountId, name: writerName(user) };
  return serialized(lock(m.workspaceId), async () => {
    const cur = await readPickList(m.workspaceId, season);
    const now = Date.now();
    // Undo of a remove: the removed row, as it was.
    const previous = op.op === "add" && op.restore ? await removedPick(m.workspaceId, season, op.team) : null;
    const r = applyPickOp(cur.picks, op, by, now, previous);
    if (!r.ok) {
      return r.reason === "full"
        ? { ok: false as const, status: 409 as const, error: "The pick list is full (100 teams). Remove one first.", list: cur }
        : { ok: false as const, status: 409 as const, error: "That team was removed from the pick list meanwhile. Here's the list as it is now.", list: cur };
    }
    if (!r.changed) return { ok: true as const, changed: false, list: cur };
    await write(m, season, cur, r.picks, now);
    const list = await readPickList(m.workspaceId, season);
    publishPicklist(m.workspaceId, list);
    // In the activity feed (never throws), inside the queue so the feed's order is the list's.
    await logChange(m.workspaceId, by, season, op, r);
    return { ok: true as const, changed: true, list };
  });
}

/** A team's pick as it was when it was last removed from the list (null: never removed, or back on it). */
async function removedPick(workspaceId: string, season: number, team: number): Promise<Pick | null> {
  const r = await get<any>(
    `SELECT p.* FROM workspace_picklist p JOIN workspaces w ON w.id = p.workspace_id WHERE w.cp_workspace_id = ? AND p.season = ? AND p.team = ? AND p.removed_at IS NOT NULL`,
    [workspaceId, season, team]);
  return r ? toPick(r) : null;
}

/** Write what changed (rows added, removed, moved or re-noted) and bump the version, in one transaction. */
async function write(m: Membership, season: number, before: PickList, after: Pick[], now: number) {
  // Lazily: the first change creates the workspace's mirror row (when no entry, template or setting has yet).
  await db().execute({ sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [m.workspaceId, m.workspaceName, new Date(now).toISOString(), new Date(now).toISOString()] });
  const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [m.workspaceId]);
  if (!ws) throw new Error("workspace row missing after insert");
  const id = Number(ws.id);
  const old = new Map(before.picks.map((p) => [p.team, p]));
  const keep = new Set(after.map((p) => p.team));
  const stmts: InStatement[] = [];
  // A removed team's row stays (removed_at), so an Undo can bring back its note and who added it.
  for (const p of before.picks) if (!keep.has(p.team)) stmts.push({ sql: "UPDATE workspace_picklist SET removed_at = ? WHERE workspace_id = ? AND season = ? AND team = ?", args: [now, id, season, p.team] });
  for (const p of after) {
    const o = old.get(p.team);
    if (!o) {
      stmts.push({
        sql: `INSERT INTO workspace_picklist (workspace_id, season, team, rank, added_by_account_id, added_by_name, added_at, note, note_by_account_id, note_by_name, note_updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(workspace_id, season, team) DO UPDATE SET rank = excluded.rank, added_by_account_id = excluded.added_by_account_id,
                added_by_name = excluded.added_by_name, added_at = excluded.added_at, note = excluded.note, note_by_account_id = excluded.note_by_account_id,
                note_by_name = excluded.note_by_name, note_updated_at = excluded.note_updated_at, removed_at = NULL`,
        args: [id, season, p.team, p.rank, p.addedBy.accountId, p.addedBy.name.slice(0, 80), p.addedAt, p.note, p.noteBy?.accountId ?? null, p.noteBy?.name.slice(0, 80) ?? null, p.noteUpdatedAt],
      });
    } else if (o.rank !== p.rank || o.note !== p.note || o.noteUpdatedAt !== p.noteUpdatedAt) {
      stmts.push({
        sql: "UPDATE workspace_picklist SET rank = ?, note = ?, note_by_account_id = ?, note_by_name = ?, note_updated_at = ? WHERE workspace_id = ? AND season = ? AND team = ?",
        args: [p.rank, p.note, p.noteBy?.accountId ?? null, p.noteBy?.name.slice(0, 80) ?? null, p.noteUpdatedAt, id, season, p.team],
      });
    }
  }
  stmts.push({
    sql: `INSERT INTO workspace_picklist_versions (workspace_id, season, version, updated_at) VALUES (?, ?, 1, ?)
          ON CONFLICT(workspace_id, season) DO UPDATE SET version = version + 1, updated_at = excluded.updated_at`,
    args: [id, season, now],
  });
  await db().batch(stmts, "write");
}

const teamsOf = (d: Record<string, unknown>): number[] => (Array.isArray(d.teams) ? d.teams.map(Number).filter(Number.isSafeInteger) : typeof d.team === "number" ? [d.team] : []);
/** A coalesced item stands for every team its moves (or note edits) touched, the latest one first. */
const mergeTeams = (earlier: Record<string, unknown>, next: Record<string, unknown>) => ({
  ...next,
  teams: [...new Set([...teamsOf(next), ...teamsOf(earlier)])].slice(0, 20),
});

async function logChange(workspaceId: string, actor: ActivityActor, season: number, op: PickOp, r: Extract<ReturnType<typeof applyPickOp>, { ok: true }>) {
  const subject = `picklist:${season}`;
  switch (op.op) {
    case "add":
      await logActivity(workspaceId, actor, "picklist.added", subject, { season, team: op.team, rank: r.to, ...(op.restore ? { restored: true } : {}) });
      return;
    case "import": {
      const added = r.added ?? [];
      await logActivity(workspaceId, actor, "picklist.added", subject, { season, teams: added.slice(0, 20), count: added.length, from: "shortlist", ...(added.length === 1 ? { team: added[0] } : {}) });
      return;
    }
    case "remove":
      await logActivity(workspaceId, actor, "picklist.removed", subject, { season, team: op.team, rank: r.from });
      return;
    case "move":
      await logActivity(workspaceId, actor, "picklist.moved", subject, { season, team: op.team, from: r.from, to: r.to, teams: [op.team] }, { coalesce: true, merge: mergeTeams });
      return;
    case "note":
      await logActivity(workspaceId, actor, "picklist.noted", subject, { season, team: op.team, excerpt: op.note.slice(0, 120), teams: [op.team] }, { coalesce: true, merge: mergeTeams });
      return;
  }
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};

/** Signed in, workspace scouting on, a member of :workspaceId. Sets res.locals.user / membership. */
async function member(req: Request, res: Response): Promise<{ user: User; m: Membership } | null> {
  res.set("Cache-Control", "no-store");
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Sign in first." }); return null; }
  if (await workspacePaused(res)) return null;
  const workspaceId = req.params.workspaceId;
  if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return null; }
  const access = await workspaceAccess(user, workspaceId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return null; }
  return { user, m: access.membership };
}

/**
 * The one gate every pick list change passes (the POST route, whatever the op): a member, as for reads, plus
 * whatever a write needs on top. A rule that makes a workspace's lists read-only (e.g. an orphaned space)
 * belongs here, so it covers every op at once.
 */
export async function picklistWriter(req: Request, res: Response): Promise<{ user: User; m: Membership } | null> {
  return member(req, res);
}

/**
 * /api/scout/workspaces/:workspaceId/picklist
 *   GET  ?season=   any member. {list: {workspaceId, season, version, picks}}
 *   POST {season, op: "add", team, beforeTeam?, restore?}    add (at the end, or just before beforeTeam); restore: Undo of a remove
 *        {season, op: "remove", team}
 *        {season, op: "move", team, beforeTeam}     beforeTeam null: to the end
 *        {season, op: "note", team, note}           the shared note ("" clears it)
 *        {season, op: "import", teams: [...]}       copy teams (e.g. a member's shortlist) to the end, skipping ones already on it
 *        any member, JSON only. 200 {changed, list}; 409 {error, list} (a team it names is gone, or the list is full);
 *        400 a bad body or an unknown team.
 */
export function picklistRouter(): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/picklist", h(async (req, res) => {
    const season = Number(req.query.season);
    const who = await member(req, res);
    if (!who) return;
    if (!isSeason(season)) { res.status(400).json({ error: "season required" }); return; }
    return { list: await readPickList(who.m.workspaceId, season) };
  }));
  r.post("/workspaces/:workspaceId/picklist", jsonOnly, h(async (req, res) => {
    const who = await picklistWriter(req, res);
    if (!who) return;
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    if (!isSeason(body.season)) { res.status(400).json({ error: "season required" }); return; }
    const op = cleanPickOp(body);
    if ("error" in op) { res.status(400).json({ error: op.error }); return; }
    const out = await changePickList(who.user, who.m, body.season, op);
    if (!out.ok) { res.status(out.status).json({ error: out.error, list: out.list }); return; }
    return { changed: out.changed, list: out.list };
  }));
  return r;
}
