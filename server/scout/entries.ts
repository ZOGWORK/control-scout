// Scout entries on the server: the personal set (scout_entries, keyed by the
// Scout user, unchanged) and the shared set of each Control Point workspace
// (workspace_scout_entries, keyed by workspace + uuid).
//
// Workspace rules:
// - Every read and write needs the signed-in user's linked Control Point
//   account to be a member of the workspace right now (the cached membership,
//   re-checked with Control Point once on a miss). Otherwise 403.
// - Newer updatedAt wins, on the server too: an older write never replaces a
//   newer row. Deletes are tombstones.
// - Authorship is stamped by the server, never taken from the client: the
//   first writer is the author; every accepted write records its editor.
// - The workspace mirror row is created by the first entry written, not before.
// - Pull is by cursor: `seq`, the server's per-workspace write order, not the
//   writers' clocks (an entry synced late with an old updatedAt would slip
//   behind a timestamp cursor).
// - Every accepted write is published to the workspace's live streams
//   (bus.ts, stream.ts), in seq order.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, get, writeBatch } from "../db.js";
import { controlPointEnabled, isWorkspaceId, linkedAccountId, workspaceMembership, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { publishEntries, serialized, type LiveEntry } from "./bus.js";

export interface ScoutEntryInput { uuid: string; season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit"; data: Record<string, unknown>; notes: string; updatedAt: number; deleted?: boolean }

export function cleanScoutEntry(x: any): ScoutEntryInput | null {
  if (!x || typeof x !== "object") return null;
  if (typeof x.uuid !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(x.uuid)) return null;
  const season = Number(x.season), team = Number(x.team), updatedAt = Number(x.updatedAt);
  if (!Number.isInteger(season) || season < 2000 || !Number.isInteger(team) || team < 1 || team > 999999 || !Number.isFinite(updatedAt)) return null;
  if (x.kind !== "match" && x.kind !== "pit") return null;
  const data = x.data && typeof x.data === "object" ? x.data : {};
  if (JSON.stringify(data).length > 20_000) return null;
  return {
    uuid: x.uuid, season, team, eventCode: typeof x.eventCode === "string" ? x.eventCode.slice(0, 24) : null, matchLabel: typeof x.matchLabel === "string" ? x.matchLabel.slice(0, 24) : null,
    kind: x.kind, data, notes: typeof x.notes === "string" ? x.notes.slice(0, 4000) : "", updatedAt, deleted: !!x.deleted,
  };
}

/** A shared entry as the API sends it (the client's ScoutEntry, plus who last edited it). */
export interface WorkspaceEntryOut extends ScoutEntryInput {
  workspaceId: string; deleted: boolean;
  authorAccountId: number; authorDisplayName: string;
  editorAccountId: number; editorDisplayName: string;
}

const workspaceRow = (workspaceId: string, r: any): WorkspaceEntryOut => ({
  uuid: r.uuid, workspaceId, season: Number(r.season), team: Number(r.team), eventCode: r.event_code, matchLabel: r.match_label, kind: r.kind,
  data: JSON.parse(r.data), notes: r.notes, updatedAt: Number(r.updated_at), deleted: !!r.deleted,
  authorAccountId: Number(r.author_account_id), authorDisplayName: r.author_name,
  editorAccountId: Number(r.editor_account_id), editorDisplayName: r.editor_name,
});
const liveRow = (workspaceId: string, r: any): LiveEntry => ({ ...workspaceRow(workspaceId, r), seq: Number(r.seq) });

/** How a writer is named on shared entries: their display name, else the part of their email before the @. */
export const writerName = (u: User) => (u.displayName?.trim() || u.email?.split("@")[0] || "Member").slice(0, 60);

export type Access = { ok: true; membership: Membership } | { ok: false; status: 403; error: string };

/** May this signed-in user read and write this workspace's entries right now? */
export async function workspaceAccess(user: User, workspaceId: string): Promise<Access> {
  const accountId = controlPointEnabled() ? await linkedAccountId(user.id) : null;
  if (accountId == null) return { ok: false, status: 403, error: "Workspace scouting needs an account linked with Control Point." };
  const membership = await workspaceMembership(accountId, workspaceId);
  if (!membership) return { ok: false, status: 403, error: "You're not a member of this workspace in Control Point." };
  return { ok: true, membership };
}

const UPSERT = `INSERT INTO workspace_scout_entries
    (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted, author_account_id, author_name, editor_account_id, editor_name, seq)
  VALUES ((SELECT id FROM workspaces WHERE cp_workspace_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    (SELECT COALESCE(MAX(s.seq), 0) + 1 FROM workspace_scout_entries s WHERE s.workspace_id = (SELECT id FROM workspaces WHERE cp_workspace_id = ?)))
  ON CONFLICT(workspace_id, uuid) DO UPDATE SET
    season = excluded.season, team = excluded.team, event_code = excluded.event_code, match_label = excluded.match_label, kind = excluded.kind,
    data = excluded.data, notes = excluded.notes, updated_at = excluded.updated_at, deleted = excluded.deleted,
    editor_account_id = excluded.editor_account_id, editor_name = excluded.editor_name, seq = excluded.seq
  WHERE excluded.updated_at > workspace_scout_entries.updated_at`;

export interface PushResult { uuid: string; ok: boolean; error?: string; entry?: WorkspaceEntryOut }

/**
 * Write a batch of entries into a workspace (membership already checked).
 * Each result carries the stored version, which is the sent one unless a newer
 * edit was already there, so the device can adopt the server's copy (and the
 * authorship the server stamped).
 */
export async function pushWorkspaceEntries(user: User, m: Membership, raw: unknown[]): Promise<PushResult[]> {
  const results: PushResult[] = [];
  const good: ScoutEntryInput[] = [];
  for (const x of raw) {
    const e = cleanScoutEntry(x);
    const space = (x as { workspaceId?: unknown } | null)?.workspaceId;
    if (!e) { results.push({ uuid: String((x as any)?.uuid ?? ""), ok: false, error: "invalid entry" }); continue; }
    if (space !== undefined && space !== m.workspaceId) { results.push({ uuid: e.uuid, ok: false, error: "wrong space" }); continue; }
    good.push(e);
    results.push({ uuid: e.uuid, ok: true });
  }
  if (!good.length) return results;
  // One write at a time per workspace, so the live streams get entries in seq order (bus.ts).
  const stored = await serialized(m.workspaceId, async () => {
    const before = await lastSeq(m.workspaceId);
    const rows = await writeWorkspaceEntries(user, m, good);
    // Written by this push: a new seq (an entry beaten by a newer edit, or resent unchanged, keeps its old one).
    publishEntries(m.workspaceId, [...rows.values()].filter((e) => e.seq > before).sort((a, b) => a.seq - b.seq));
    return rows;
  });
  for (const r of results) if (r.ok) { const e = stored.get(r.uuid); r.entry = e && withoutSeq(e); }
  return results;
}

const withoutSeq = ({ seq: _s, ...e }: LiveEntry): WorkspaceEntryOut => e;

/** Upsert the entries (newer updatedAt wins) and read back what's stored for each, with its seq. */
async function writeWorkspaceEntries(user: User, m: Membership, good: ScoutEntryInput[]): Promise<Map<string, LiveEntry>> {
  const now = new Date().toISOString(), name = writerName(user);
  await writeBatch([
    // Lazily: the workspace's first entry creates its mirror row.
    { sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [m.workspaceId, m.workspaceName, now, now] },
    ...good.map((e) => ({
      sql: UPSERT,
      args: [m.workspaceId, e.uuid, e.season, e.team, e.eventCode, e.matchLabel, e.kind, JSON.stringify(e.data), e.notes, e.updatedAt, e.deleted ? 1 : 0,
        m.accountId, name, m.accountId, name, m.workspaceId],
    })),
  ]);
  const uuids = good.map((e) => e.uuid);
  const rows = await all<any>(
    `SELECT w.* FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id WHERE ws.cp_workspace_id = ? AND w.uuid IN (${uuids.map(() => "?").join(", ")})`,
    [m.workspaceId, ...uuids]);
  return new Map(rows.map((r) => [String(r.uuid), liveRow(m.workspaceId, r)]));
}

/** The workspace's latest seq (0 before its first entry). */
async function lastSeq(workspaceId: string): Promise<number> {
  const r = await get<{ seq: number | null }>(
    "SELECT MAX(w.seq) seq FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id WHERE ws.cp_workspace_id = ?", [workspaceId]);
  return Number(r?.seq ?? 0);
}

export const PULL_LIMIT = 500;

/** Entries written to the workspace after `since` (a cursor from an earlier pull; 0 = everything), tombstones included, in write order. */
export async function pullWorkspaceEntries(workspaceId: string, since: number): Promise<{ entries: WorkspaceEntryOut[]; cursor: number; more: boolean }> {
  const page = await pullWorkspaceLive(workspaceId, since);
  return { ...page, entries: page.entries.map(withoutSeq) };
}

/** pullWorkspaceEntries with each entry's seq (the live stream's event ids). */
export async function pullWorkspaceLive(workspaceId: string, since: number): Promise<{ entries: LiveEntry[]; cursor: number; more: boolean }> {
  const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]);
  if (!ws) return { entries: [], cursor: since, more: false }; // nothing written yet (and reading never creates the row)
  const rows = await all<any>("SELECT * FROM workspace_scout_entries WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT ?", [ws.id, since, PULL_LIMIT]);
  return { entries: rows.map((r) => liveRow(workspaceId, r)), cursor: rows.length ? Number(rows.at(-1).seq) : since, more: rows.length === PULL_LIMIT };
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

/** /api/scout: the workspace pull. (The push is the existing /api/me/scout/sync, with a workspaceId.) */
export function scoutRouter(): Router {
  const r = express.Router();
  r.get("/sync", h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in to sync this across devices." }); return; }
    const workspaceId = req.query.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    const since = req.query.since === undefined ? 0 : Number(req.query.since);
    if (!Number.isSafeInteger(since) || since < 0) { res.status(400).json({ error: "since must be a cursor from an earlier pull" }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    res.set("Cache-Control", "no-store");
    return pullWorkspaceEntries(workspaceId, since);
  }));
  return r;
}
