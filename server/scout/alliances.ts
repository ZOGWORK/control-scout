// Scouting alliances (docs/alliances.md): two workspaces link for one event. While linked they share a union of
// entries and assignments and one consensus; when the event ends they split again. Table scout_alliances.
//
// Consent, both sides:
//   invite   an admin of workspace A, for an event that hasn't ended: a pending link and a one-time code (only its
//            sha256 is kept; the code is shown once). A says now whether to keep copies at the end.
//   accept   an admin of workspace B, with the code (B ≠ A): the link is active. B says whether to keep copies.
//   end      an admin of either side: a pending invite is cancelled, an active link ends ("unlinked").
//   A workspace has at most one pending or active link per event.
//
// Permissions ("linked for event X", on top of membership exactly as workspaceAccess checks it today):
//   - Every route needs membership of the workspace in the URL (the reader's own); managing needs its admin.
//   - The shared reads (entries, assignments, coverage, consensus, the partner's pick list) also need an active
//     link between that workspace and the partner, and read only the link's season and event. An ended link
//     answers 410 ALLIANCE_ENDED; a link the workspace isn't part of is 404; while the partner's scouting is
//     switched off, 403 feature_disabled.
//   - Nothing here writes entries, assignments or pick lists. Each stays in its own workspace, editable as it
//     always was (the author, and that workspace's members and admins); a partner admin has no edit rights
//     because they aren't a member of the other workspace.
//
// When the link ends (the event's last day is over everywhere: allianceEndsAt, or an admin unlinks), each
// workspace keeps its own entries. If both sides agreed to keep copies when linking, each also gets a copy of
// the other side's live entries at the event: new rows in its own workspace (id al<link>-<hash>, so a retry
// never doubles them) with the original author and answers, a version in their history, published to its
// streams. Photos stay with the original. Ending is settled lazily (every alliance route) and by a sweep
// (server/index.ts); a copy that failed part way is retried by the next sweep.
import { createHash, randomInt } from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { InStatement } from "@libsql/client";
import { all, get, run, writeBatch } from "../db.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { featureDisabled, isEnabledFor } from "../flags.js";
import {
  ALLIANCE_ENDED, allianceEndsAt, INVITE_ALPHABET, INVITE_CODE_LENGTH, INVITE_TTL_MS, normalInviteCode,
  type Alliance, type AllianceConsensusResponse, type AllianceCoverage, type AllianceEndReason, type AllianceEntry, type AllianceInviteResponse,
  type AlliancePicklistResponse, type AllianceShared, type AllianceSideKey, type AlliancesResponse, type CoverageSide, type TeamCoverage,
} from "../../src/shared/alliances.js";
import { normalEventCode, type EventTeamOption } from "../../src/shared/assignments.js";
import { CONSENSUS_MAX_TEAMS } from "../../src/shared/consensus.js";
import { parseWorkspaceTemplateId } from "../../src/shared/scoutTemplate.js";
import { accessError, lastSeq, readLiveEntries, requireWorkspaceAdmin, storedEntryFields, workspaceAccess, workspacePaused } from "./entries.js";
import { eventTeams, listAssignments, listMatchAssignments } from "./assignments.js";
import { consensusForScope, parseTeams } from "./consensus.js";
import { readPickList } from "./picklist.js";
import { publishEntries, serialized } from "./bus.js";
import { versionStatements } from "./history.js";

let now = () => Date.now();
/** Tests: a fake clock. */
export function setAllianceClock(fn: (() => number) | null) { now = fn ?? (() => Date.now()); }

interface Row {
  id: number; season: number; event_code: string; ends_on: string;
  inviter_ws: string; inviter_name: string; inviter_keeps: number; invited_by_account_id: number;
  invitee_ws: string | null; invitee_name: string | null; invitee_keeps: number | null; accepted_by_account_id: number | null;
  invite_expires_at: number | null; status: "pending" | "active" | "ended"; ended_reason: AllianceEndReason | null;
  created_at: number; accepted_at: number | null; ended_at: number | null; copies_made: number;
}
const LIVE = "('pending', 'active')";
const num = (v: unknown) => (v == null ? null : Number(v));
const toRow = (r: any): Row => ({
  ...r, id: Number(r.id), season: Number(r.season), inviter_keeps: Number(r.inviter_keeps), invited_by_account_id: Number(r.invited_by_account_id),
  invitee_keeps: num(r.invitee_keeps), accepted_by_account_id: num(r.accepted_by_account_id), invite_expires_at: num(r.invite_expires_at),
  created_at: Number(r.created_at), accepted_at: num(r.accepted_at), ended_at: num(r.ended_at), copies_made: Number(r.copies_made),
});
const bothKeep = (r: Row) => r.inviter_keeps === 1 && r.invitee_keeps === 1;
const hashCode = (code: string) => createHash("sha256").update(`scout-alliance:${code}`).digest("hex");

/** The link as `workspaceId`'s members read it. */
function view(r: Row, workspaceId: string, eventName: string | null): Alliance {
  const inviter = { workspaceId: r.inviter_ws, name: r.inviter_name, keepsCopies: r.inviter_keeps === 1 };
  const invitee = r.invitee_ws ? { workspaceId: r.invitee_ws, name: r.invitee_name ?? "", keepsCopies: r.invitee_keeps == null ? null : r.invitee_keeps === 1 } : null;
  const mine = r.inviter_ws === workspaceId;
  return {
    id: r.id, season: r.season, eventCode: r.event_code, eventName, endsOn: r.ends_on, status: r.status, endedReason: r.ended_reason,
    you: mine ? inviter : invitee!, partner: mine ? invitee : inviter, invitedByYou: mine,
    createdAt: r.created_at, acceptedAt: r.accepted_at, endedAt: r.ended_at,
    inviteExpiresAt: r.status === "pending" ? r.invite_expires_at : null, copiesKept: r.copies_made === 1,
  };
}

async function eventInfo(season: number, code: string): Promise<{ name: string; end: string | null } | null> {
  const e = await get<{ name: string; end: string | null }>("SELECT name, end FROM events WHERE season = ? AND UPPER(code) = ?", [season, code]);
  return e ? { name: String(e.name), end: e.end ? String(e.end) : null } : null;
}
const eventName = async (r: Row) => (await eventInfo(r.season, r.event_code))?.name ?? null;

async function rowById(id: number): Promise<Row | null> {
  const r = await get<any>("SELECT * FROM scout_alliances WHERE id = ?", [id]);
  return r ? toRow(r) : null;
}

/** The workspace's pending or active link at this event, if any (either side). */
async function liveLinkAt(workspaceId: string, season: number, eventCode: string): Promise<Row | null> {
  const r = await get<any>(
    `SELECT * FROM scout_alliances WHERE season = ? AND event_code = ? AND status IN ${LIVE} AND (inviter_ws = ? OR invitee_ws = ?) LIMIT 1`,
    [season, eventCode, workspaceId, workspaceId]);
  return r ? toRow(r) : null;
}

// ---------------------------------------------------------------------------
// Ending: the event is over, an admin unlinks, or an invite is never accepted
// ---------------------------------------------------------------------------

/**
 * End a link (only from the status it's in, so two callers can't both end it). An active one that both sides
 * agreed to keep copies of has them made. True if this call ended it.
 */
async function endLink(r: Row, reason: AllianceEndReason): Promise<boolean> {
  const changed = await run(
    "UPDATE scout_alliances SET status = 'ended', ended_reason = ?, ended_at = ?, code_hash = NULL WHERE id = ? AND status = ?",
    [reason, now(), r.id, r.status]);
  if (!changed) return false;
  if (r.status === "active" && bothKeep(r)) await keepCopies(r);
  return true;
}

/** Make each side's copy of the other's entries (idempotent), then mark the link's copies made. */
async function keepCopies(r: Row): Promise<void> {
  if (!r.invitee_ws) return;
  await copyEntries(r, r.inviter_ws, r.invitee_ws, r.invitee_name ?? "");
  await copyEntries(r, r.invitee_ws, r.inviter_ws, r.inviter_name);
  await run("UPDATE scout_alliances SET copies_made = 1 WHERE id = ?", [r.id]);
}

/** A copy's id in the receiving workspace: the same for the same link and entry, so a retry adds nothing twice. */
const copyPrefix = (allianceId: number) => `al${allianceId}-`;
export const copyUuid = (allianceId: number, fromWorkspace: string, uuid: string) =>
  `${copyPrefix(allianceId)}${createHash("sha256").update(`${fromWorkspace}\n${uuid}`).digest("hex").slice(0, 32)}`;

const WS = "(SELECT id FROM workspaces WHERE cp_workspace_id = ?)";

async function copyEntries(r: Row, from: string, to: string, toName: string): Promise<void> {
  const rows = await all<any>(
    `SELECT w.* FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id
      WHERE ws.cp_workspace_id = ? AND w.season = ? AND UPPER(w.event_code) = ? AND w.deleted = 0
        AND w.uuid NOT LIKE ? ORDER BY w.seq`,
    // Never this link's own copies (the other direction's, made just before): they'd come back as copies of copies.
    [from, r.season, r.event_code, `${copyPrefix(r.id)}%`]);
  if (!rows.length) return;
  await serialized(to, async () => {
    const before = await lastSeq(to);
    const at = new Date(now()).toISOString();
    const uuids: string[] = [];
    const stmts: InStatement[] = [
      { sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [to, toName, at, at] },
    ];
    for (const e of rows) {
      const uuid = copyUuid(r.id, from, String(e.uuid));
      uuids.push(uuid);
      // A template of the other workspace isn't readable here: the copy reads with the built-in fields (as consensus would).
      const ownTemplate = !parseWorkspaceTemplateId(e.template_id ?? null);
      stmts.push({
        sql: `INSERT INTO workspace_scout_entries
                (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted,
                 author_account_id, author_name, editor_account_id, editor_name, template_id, template_version, seq)
              VALUES (${WS}, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?,
                (SELECT COALESCE(MAX(s.seq), 0) + 1 FROM workspace_scout_entries s WHERE s.workspace_id = ${WS}))
              ON CONFLICT(workspace_id, uuid) DO NOTHING`,
        args: [to, uuid, e.season, e.team, e.event_code, e.match_label, e.kind, e.data, e.notes ?? "", e.updated_at,
          e.author_account_id, e.author_name ?? "", e.editor_account_id, e.editor_name ?? "",
          ownTemplate ? e.template_id ?? null : null, ownTemplate ? e.template_version ?? null : null, to],
      }, ...versionStatements(to, uuid, before, { restored: false, fromVersion: null }));
    }
    await writeBatch(stmts);
    const written = [...(await readLiveEntries(to, uuids)).values()].filter((e) => e.seq > before).sort((a, b) => a.seq - b.seq);
    publishEntries(to, written);
  });
}

/**
 * End every link that's due: invites past their code's life or their event, links whose event is over. Then
 * retry copies that didn't finish. Cheap when nothing is due; run by every alliance route and by the sweep.
 */
export async function settleAlliances(): Promise<number> {
  const t = now();
  let ended = 0;
  for (const raw of await all<any>(`SELECT * FROM scout_alliances WHERE status IN ${LIVE}`)) {
    const r = toRow(raw);
    const over = allianceEndsAt(r.ends_on) <= t;
    if (r.status === "pending" && (over || (r.invite_expires_at != null && r.invite_expires_at <= t))) ended += Number(await endLink(r, "expired"));
    else if (r.status === "active" && over) ended += Number(await endLink(r, "event_over"));
  }
  for (const raw of await all<any>("SELECT * FROM scout_alliances WHERE status = 'ended' AND copies_made = 0 AND accepted_at IS NOT NULL AND inviter_keeps = 1 AND invitee_keeps = 1")) {
    await keepCopies(toRow(raw)).catch((e) => console.warn(`[alliances] copies for link ${raw.id}: ${(e as Error).message}`));
  }
  return ended;
}

// ---------------------------------------------------------------------------
// Linked for event X: the permission check for the shared reads
// ---------------------------------------------------------------------------

export type AllianceAccess =
  | { ok: true; membership: Membership; row: Row; side: "inviter" | "invitee"; partnerWs: string; partnerName: string }
  | { ok: false; status: number; error: string; code?: string };

/**
 * May this user read what `workspaceId` shares through link `allianceId`? They must be a member of
 * `workspaceId` (workspaceAccess, as every workspace read), the link must include it and be active.
 */
export async function allianceAccess(user: User, workspaceId: string, allianceId: number): Promise<AllianceAccess> {
  const access = await workspaceAccess(user, workspaceId);
  if (!access.ok) return { ok: false, status: access.status, ...accessError(access) };
  await settleAlliances();
  const row = await rowById(allianceId);
  if (!row || (row.inviter_ws !== workspaceId && row.invitee_ws !== workspaceId)) return { ok: false, status: 404, error: "No such alliance for this workspace." };
  if (row.status !== "active" || !row.invitee_ws) {
    return { ok: false, status: 410, error: row.status === "pending" ? "This alliance hasn't been accepted yet." : "This alliance has ended.", code: ALLIANCE_ENDED };
  }
  const side = row.inviter_ws === workspaceId ? "inviter" : "invitee";
  return {
    ok: true, membership: access.membership, row, side,
    partnerWs: side === "inviter" ? row.invitee_ws : row.inviter_ws,
    partnerName: side === "inviter" ? row.invitee_name ?? "" : row.inviter_name,
  };
}

// ---------------------------------------------------------------------------
// The shared reads
// ---------------------------------------------------------------------------

/** Both sides' live entries at the link's event. */
async function unionEntries(you: string, partner: string, season: number, eventCode: string): Promise<AllianceEntry[]> {
  const rows = await all<any>(
    `SELECT ws.cp_workspace_id, w.* FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id
      WHERE ws.cp_workspace_id IN (?, ?) AND w.season = ? AND UPPER(w.event_code) = ? AND w.deleted = 0
      ORDER BY w.updated_at DESC`,
    [you, partner, season, eventCode]);
  return rows.map((r) => {
    const e = storedEntryFields(r);
    const workspaceId = String(r.cp_workspace_id);
    return {
      uuid: e.uuid, side: (workspaceId === you ? "you" : "partner") as AllianceSideKey, workspaceId, team: e.team, kind: e.kind, matchLabel: e.matchLabel,
      notes: e.notes, data: e.data, updatedAt: e.updatedAt, authorAccountId: Number(r.author_account_id), authorDisplayName: String(r.author_name ?? ""),
    };
  });
}

/** Who contributed what (shown, never policed). Every team on the event's list appears, scouted or not. */
export function coverageOf(you: { workspaceId: string; name: string }, partner: { workspaceId: string; name: string },
  entries: AllianceEntry[], teams: EventTeamOption[]): AllianceCoverage {
  const side = (key: AllianceSideKey, s: { workspaceId: string; name: string }): CoverageSide => {
    const mine = entries.filter((e) => e.side === key);
    const match = mine.filter((e) => e.kind === "match");
    return {
      ...s, entries: mine.length, matchEntries: match.length, pitEntries: mine.length - match.length,
      teams: new Set(mine.map((e) => e.team)).size,
      matches: new Set(match.map((e) => e.matchLabel?.trim().toUpperCase()).filter(Boolean)).size,
      scouts: new Set(mine.map((e) => e.authorAccountId)).size,
    };
  };
  const byTeam = new Map<number, TeamCoverage>(teams.map((t) => [t.team, { team: t.team, name: t.name, you: 0, partner: 0 }]));
  for (const e of entries) {
    const t = byTeam.get(e.team) ?? { team: e.team, name: null, you: 0, partner: 0 };
    t[e.side]++;
    byTeam.set(e.team, t);
  }
  const list = [...byTeam.values()].sort((a, b) => b.you + b.partner - (a.you + a.partner) || a.team - b.team);
  return { you: side("you", you), partner: side("partner", partner), teams: list };
}

// ---------------------------------------------------------------------------
// Routes: /api/scout/workspaces/:workspaceId/alliances…
// ---------------------------------------------------------------------------

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};
const isSeason = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 2000 && v <= 2100;
const newCode = () => Array.from({ length: INVITE_CODE_LENGTH }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join("");

/** The shared-read guard: signed in, a good id, scouting on for both sides, linked for the event. */
async function shared(req: Request, res: Response): Promise<Extract<AllianceAccess, { ok: true }> | null> {
  res.set("Cache-Control", "private, no-store");
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Sign in first." }); return null; }
  const workspaceId = req.params.workspaceId;
  if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return null; }
  const id = Number(req.params.allianceId);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "allianceId required" }); return null; }
  if (await workspacePaused(res, workspaceId)) return null;
  const a = await allianceAccess(user, workspaceId, id);
  if (!a.ok) { res.status(a.status).json(a.code ? { error: a.error, code: a.code } : { error: a.error }); return null; }
  // The partner switched its scouting off: what it shares is off too (its members can't read it either).
  if (!(await isEnabledFor("workspaceScouting", a.partnerWs))) { featureDisabled(res, "workspaceScouting"); return null; }
  return a;
}

export function alliancesRouter(): Router {
  const r = express.Router();

  // Every link of this workspace (live ones first, then the last ended ones). Any member.
  r.get("/workspaces/:workspaceId/alliances", h(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (await workspacePaused(res, workspaceId)) return;
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
    await settleAlliances();
    const season = req.query.season === undefined ? null : Number(req.query.season);
    if (season != null && !isSeason(season)) { res.status(400).json({ error: "season must be a year" }); return; }
    const rows = (await all<any>(
      `SELECT * FROM scout_alliances WHERE (inviter_ws = ? OR invitee_ws = ?)${season != null ? " AND season = ?" : ""}
        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, COALESCE(ended_at, created_at) DESC LIMIT 20`,
      [workspaceId, workspaceId, ...(season != null ? [season] : [])])).map(toRow);
    const alliances = await Promise.all(rows.map(async (x) => view(x, workspaceId, await eventName(x))));
    const body: AlliancesResponse = { alliances, canManage: access.membership.role === "admin" && !access.orphaned };
    return body;
  }));

  // Invite: an admin, for an event of this season that hasn't ended. The code comes back once.
  r.post("/workspaces/:workspaceId/alliances", jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const m = res.locals.membership as Membership;
    const { season, eventCode: rawCode, keepCopies } = req.body ?? {};
    const eventCode = normalEventCode(rawCode);
    if (!isSeason(season) || !eventCode) { res.status(400).json({ error: "season and eventCode required" }); return; }
    if (typeof keepCopies !== "boolean") { res.status(400).json({ error: "keepCopies must be true or false" }); return; }
    const ev = await eventInfo(season, eventCode);
    if (!ev) { res.status(404).json({ error: "No such event this season." }); return; }
    if (!ev.end) { res.status(400).json({ error: "This event has no dates yet, so a link couldn't end on time." }); return; }
    const endsOn = ev.end;
    if (allianceEndsAt(endsOn) <= now()) { res.status(400).json({ error: "This event is over." }); return; }
    await settleAlliances();
    return serialized(`alliance:${season}:${eventCode}`, async () => {
      if (await liveLinkAt(m.workspaceId, season, eventCode)) { res.status(409).json({ error: "This workspace already has an alliance (or an invite) for this event." }); return; }
      const code = newCode();
      const t = now();
      await run(
        `INSERT INTO scout_alliances (season, event_code, ends_on, inviter_ws, inviter_name, inviter_keeps, invited_by_account_id, code_hash, invite_expires_at, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [season, eventCode, endsOn, m.workspaceId, m.workspaceName, keepCopies ? 1 : 0, m.accountId, hashCode(code), Math.min(t + INVITE_TTL_MS, allianceEndsAt(endsOn)), t]);
      const row = toRow(await get<any>("SELECT * FROM scout_alliances WHERE code_hash = ?", [hashCode(code)]));
      res.status(201);
      const body: AllianceInviteResponse = { alliance: view(row, m.workspaceId, ev.name), code };
      return body;
    });
  }));

  // Accept: an admin of the other workspace, with the code.
  r.post("/workspaces/:workspaceId/alliances/accept", jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const m = res.locals.membership as Membership;
    const { code: raw, keepCopies } = req.body ?? {};
    const code = normalInviteCode(raw);
    if (!code) { res.status(400).json({ error: "That isn't an invite code (10 letters and numbers)." }); return; }
    if (typeof keepCopies !== "boolean") { res.status(400).json({ error: "keepCopies must be true or false" }); return; }
    await settleAlliances();
    const found = await get<any>("SELECT * FROM scout_alliances WHERE code_hash = ? AND status = 'pending'", [hashCode(code)]);
    if (!found) { res.status(404).json({ error: "No open invite with that code. It may have expired or been used." }); return; }
    const inv = toRow(found);
    if (inv.inviter_ws === m.workspaceId) { res.status(400).json({ error: "That's this workspace's own invite: send it to the other team's admin." }); return; }
    return serialized(`alliance:${inv.season}:${inv.event_code}`, async () => {
      if (await liveLinkAt(m.workspaceId, inv.season, inv.event_code)) { res.status(409).json({ error: "This workspace already has an alliance (or an invite) for this event." }); return; }
      const changed = await run(
        `UPDATE scout_alliances SET status = 'active', invitee_ws = ?, invitee_name = ?, invitee_keeps = ?, accepted_by_account_id = ?, accepted_at = ?, code_hash = NULL
          WHERE id = ? AND status = 'pending'`,
        [m.workspaceId, m.workspaceName, keepCopies ? 1 : 0, m.accountId, now(), inv.id]);
      if (!changed) { res.status(404).json({ error: "No open invite with that code. It may have expired or been used." }); return; }
      const row = (await rowById(inv.id))!;
      return { alliance: view(row, m.workspaceId, await eventName(row)) };
    });
  }));

  // End: an admin of either side. Pending: the invite is cancelled. Active: unlinked now (copies as agreed).
  r.post("/workspaces/:workspaceId/alliances/:allianceId/end", requireWorkspaceAdmin(), h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const m = res.locals.membership as Membership;
    const id = Number(req.params.allianceId);
    if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "allianceId required" }); return; }
    await settleAlliances();
    const row = await rowById(id);
    if (!row || (row.inviter_ws !== m.workspaceId && row.invitee_ws !== m.workspaceId)) { res.status(404).json({ error: "No such alliance for this workspace." }); return; }
    if (row.status === "ended" || !(await endLink(row, row.status === "pending" ? "cancelled" : "unlinked"))) {
      res.status(409).json({ error: "This alliance has already ended.", code: ALLIANCE_ENDED }); return;
    }
    const after = (await rowById(id))!;
    return { alliance: view(after, m.workspaceId, await eventName(after)) };
  }));

  // The union: both sides' entries and assignments at the event, and who contributed what.
  r.get("/workspaces/:workspaceId/alliances/:allianceId/shared", h(async (req, res) => {
    const a = await shared(req, res);
    if (!a) return;
    const { row, membership: m } = a;
    const you = m.workspaceId;
    const [entries, teams, ownA, partnerA, ownM, partnerM] = await Promise.all([
      unionEntries(you, a.partnerWs, row.season, row.event_code),
      eventTeams(row.season, row.event_code),
      listAssignments(you, { season: row.season, eventCode: row.event_code }),
      listAssignments(a.partnerWs, { season: row.season, eventCode: row.event_code }),
      listMatchAssignments(you, { season: row.season, eventCode: row.event_code }),
      listMatchAssignments(a.partnerWs, { season: row.season, eventCode: row.event_code }),
    ]);
    const alliance = view(row, you, await eventName(row));
    const body: AllianceShared = {
      alliance, entries,
      assignments: [...ownA.map((x) => ({ ...x, side: "you" as const })), ...partnerA.map((x) => ({ ...x, side: "partner" as const }))],
      matchAssignments: [...ownM.map((x) => ({ ...x, side: "you" as const })), ...partnerM.map((x) => ({ ...x, side: "partner" as const }))],
      coverage: coverageOf({ workspaceId: you, name: alliance.you.name }, { workspaceId: a.partnerWs, name: a.partnerName }, entries, teams),
    };
    return body;
  }));

  // One consensus over both sides' entries at the event (the same answer for both sides).
  r.get("/workspaces/:workspaceId/alliances/:allianceId/consensus", h(async (req, res) => {
    const a = await shared(req, res);
    if (!a) return;
    const teams = parseTeams(req.query.teams);
    if (!teams) { res.status(400).json({ error: `teams: 1 to ${CONSENSUS_MAX_TEAMS} team numbers, comma separated` }); return; }
    const body: AllianceConsensusResponse = {
      allianceId: a.row.id, season: a.row.season, eventCode: a.row.event_code,
      teams: await consensusForScope({ workspaces: [a.membership.workspaceId, a.partnerWs], eventCode: a.row.event_code }, a.row.season, teams),
    };
    return body;
  }));

  // The partner's pick list, to read: only the teams at the event when the event has a team list.
  r.get("/workspaces/:workspaceId/alliances/:allianceId/picklist", h(async (req, res) => {
    const a = await shared(req, res);
    if (!a) return;
    const [list, teams] = await Promise.all([readPickList(a.partnerWs, a.row.season), eventTeams(a.row.season, a.row.event_code)]);
    const at = new Set(teams.map((t) => t.team));
    const picks = at.size ? list.picks.filter((p) => at.has(p.team)) : list.picks;
    const body: AlliancePicklistResponse = { allianceId: a.row.id, partnerName: a.partnerName, list: { ...list, picks } };
    return body;
  }));

  return r;
}
