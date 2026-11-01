// Scouting alliances (docs/alliances.md): any number of workspaces link for one event. While linked they share a union
// of entries and assignments and one consensus; when the event ends they split again. Tables scout_alliances (the
// alliance: its event, creator, invite code, status) and scout_alliance_members (every workspace in it).
//
// Consent, every member:
//   create   an admin of workspace A, for an event that hasn't ended: a pending alliance with A as its creator, and an
//            invite code (only its sha256 is kept; the code is shown once). A says now whether to keep copies at the end.
//   join     an admin of another workspace, with the code (the invite link carries it): it's in, and the alliance is
//            active. It says whether to keep copies. The code works for anyone until it expires (7 days, or the
//            event's end) or the creator makes a new one; at most MAX_ALLIANCE_MEMBERS workspaces.
//   invite   the creator's admin: a new code (the old one stops working).
//   leave    an admin of any member: it's out. Fewer than two left: the alliance ends ("unlinked"). The creator
//            leaving passes the creator's part to the workspace that joined next.
//   remove   the creator's admin: another member is out, as if it had left, but keeps no copies of the others'.
//   end      the creator's admin: a pending alliance is cancelled, an active one ends for everyone ("unlinked").
//   A workspace is in at most one pending or active alliance per event. One the creator removed can't join it again.
//
// Permissions ("linked for event X", on top of membership exactly as workspaceAccess checks it today):
//   - Every route needs membership of the workspace in the URL (the reader's own); managing needs its admin.
//   - The shared reads (entries, assignments, coverage, consensus, another member's pick list) also need that
//     workspace to be in an active alliance, and read only its season and event. An ended alliance, or one the
//     workspace left, answers 410 ALLIANCE_ENDED; one it was never in is 404. A member whose scouting or
//     alliances are switched off is left out of every read; with nobody else left to read, 403 feature_disabled.
//   - Nothing here writes entries, assignments or pick lists. Each stays in its own workspace, editable as it
//     always was (the author, and that workspace's members and admins); another member's admin has no edit rights
//     because they aren't a member of the other workspace.
//
// When it ends for a workspace (the event's last day is over everywhere: allianceEndsAt; the creator ends it; it
// leaves or is removed), each workspace keeps its own entries. Copies go between every two workspaces that both
// agreed to keep them: each gets a copy of the other's live entries at the event, new rows in its own workspace
// (id cp-<hash> of the original, so a retry never doubles them) with the original author and answers, a version in
// their history, published to its streams. Photos stay with the original. A removed workspace gets none (the others
// still keep its entries). What's copied is saved in the same write that ends it (scout_alliance_copy_queue), so a
// copy is the entries as they were then. Ending is settled before any write to a member's entries, lazily by every
// alliance route, and by a sweep (server/index.ts); a copy that failed part way is retried by the next sweep.
//
// The owner's scoutingAlliances switch (src/shared/flags.ts; per workspace): off for a workspace, every alliance route
// of it answers 403 feature_disabled, nobody joins alliances it created, nothing is read across to or from it, and
// copies to or from it wait until it's back on. Alliances themselves are kept and still end with their event.
import { createHash, randomInt } from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { InStatement } from "@libsql/client";
import { all, get, run, writeBatch } from "../db.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { featureDisabled, isEnabledFor } from "../flags.js";
import {
  ALLIANCE_ENDED, allianceEndsAt, INVITE_ALPHABET, INVITE_CODE_LENGTH, INVITE_TTL_MS, MAX_ALLIANCE_MEMBERS, normalInviteCode,
  type Alliance, type AllianceAnswer, type AllianceConsensusResponse, type AllianceCoverage, type AllianceEndReason, type AllianceEntry, type AllianceInviteResponse,
  type AlliancePicklistResponse, type AllianceShared, type AlliancesResponse, type CoverageSide, type TeamCoverage,
} from "../../src/shared/alliances.js";
import { normalEventCode, type EventTeamOption } from "../../src/shared/assignments.js";
import { CONSENSUS_MAX_TEAMS } from "../../src/shared/consensus.js";
import { parseWorkspaceTemplateId, type ScoutField } from "../../src/shared/scoutTemplate.js";
import { accessError, lastSeq, readLiveEntries, requireWorkspaceAdmin, storedEntryFields, workspaceAccess, workspacePaused } from "./entries.js";
import { eventTeams, listAssignments, listMatchAssignments } from "./assignments.js";
import { consensusForScope, fieldReader, notACopyWithin, parseTeams } from "./consensus.js";
import { readPickList } from "./picklist.js";
import { onBeforeEntriesWrite, publishEntries, serialized } from "./bus.js";
import { versionStatements } from "./history.js";

let now = () => Date.now();
/** Tests: a fake clock. */
export function setAllianceClock(fn: (() => number) | null) { now = fn ?? (() => Date.now()); }

/** The alliance itself. inviter_ws/inviter_name: its creator (migration 67); the invitee_* columns aren't read. */
interface Row {
  id: number; season: number; event_code: string; ends_on: string;
  inviter_ws: string; inviter_name: string;
  code_hash: string | null; invite_expires_at: number | null; status: "pending" | "active" | "ended"; ended_reason: AllianceEndReason | null;
  created_at: number; ended_at: number | null; copies_wanted: number; copies_made: number;
}
/** A workspace in an alliance (still in while left_at is null). */
interface Member {
  ws: string; name: string; keeps: boolean; joined_at: number; left_at: number | null; left_reason: "left" | "removed" | null;
}
const LIVE = "('pending', 'active')";
const num = (v: unknown) => (v == null ? null : Number(v));
const toRow = (r: any): Row => ({
  ...r, id: Number(r.id), season: Number(r.season), invite_expires_at: num(r.invite_expires_at), created_at: Number(r.created_at),
  ended_at: num(r.ended_at), copies_wanted: Number(r.copies_wanted), copies_made: Number(r.copies_made),
});
const toMember = (r: any): Member => ({
  ws: String(r.ws), name: String(r.name ?? ""), keeps: Number(r.keeps) === 1, joined_at: Number(r.joined_at),
  left_at: num(r.left_at), left_reason: r.left_reason ?? null,
});
const isIn = (m: Member) => m.left_at == null;
const hashCode = (code: string) => createHash("sha256").update(`scout-alliance:${code}`).digest("hex");
const codeWorks = (r: Row) => !!r.code_hash && r.invite_expires_at != null && r.invite_expires_at > now();

/** Every workspace that was ever in these alliances, in the order they joined. */
async function membersOf(ids: number[]): Promise<Map<number, Member[]>> {
  const out = new Map<number, Member[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await all<any>(
    `SELECT * FROM scout_alliance_members WHERE alliance_id IN (${ids.map(() => "?").join(", ")}) ORDER BY joined_at, ws`, ids);
  for (const r of rows) out.get(Number(r.alliance_id))?.push(toMember(r));
  return out;
}
const membersOne = async (id: number) => (await membersOf([id])).get(id) ?? [];

/** The alliance as `workspaceId`'s members read it (it was in it at some point). */
function view(r: Row, members: Member[], workspaceId: string, eventName: string | null): Alliance {
  const me = members.find((m) => m.ws === workspaceId)!;
  const gone = !isIn(me);
  const out = (m: Member) => ({ workspaceId: m.ws, name: m.name, keepsCopies: m.keeps, creator: isIn(m) && m.ws === r.inviter_ws, joinedAt: m.joined_at });
  return {
    id: r.id, season: r.season, eventCode: r.event_code, eventName, endsOn: r.ends_on,
    status: gone ? "ended" : r.status, endedReason: gone ? me.left_reason : r.ended_reason,
    you: out(me), members: members.filter(isIn).map(out),
    createdAt: r.created_at, endedAt: gone ? me.left_at : r.ended_at,
    inviteExpiresAt: !gone && r.status !== "ended" && r.inviter_ws === workspaceId && codeWorks(r) ? r.invite_expires_at : null,
    copiesKept: !gone && r.copies_made === 1,
  };
}

async function eventInfo(season: number, code: string): Promise<{ name: string; end: string | null } | null> {
  const e = await get<{ name: string; end: string | null }>("SELECT name, end FROM events WHERE season = ? AND UPPER(code) = ?", [season, code]);
  return e ? { name: String(e.name), end: e.end ? String(e.end) : null } : null;
}
const eventName = async (r: Row) => (await eventInfo(r.season, r.event_code))?.name ?? null;
const viewOf = async (r: Row, workspaceId: string) => view(r, await membersOne(r.id), workspaceId, await eventName(r));

async function rowById(id: number): Promise<Row | null> {
  const r = await get<any>("SELECT * FROM scout_alliances WHERE id = ?", [id]);
  return r ? toRow(r) : null;
}

/** The pending or active alliance this workspace is in at this event, if any. */
async function liveLinkAt(workspaceId: string, season: number, eventCode: string): Promise<Row | null> {
  const r = await get<any>(
    `SELECT a.* FROM scout_alliances a JOIN scout_alliance_members m ON m.alliance_id = a.id
      WHERE a.season = ? AND a.event_code = ? AND a.status IN ${LIVE} AND m.ws = ? AND m.left_at IS NULL LIMIT 1`,
    [season, eventCode, workspaceId]);
  return r ? toRow(r) : null;
}

// ---------------------------------------------------------------------------
// Ending: the event is over, the creator ends it, a member leaves or is removed, an invite is never used
// ---------------------------------------------------------------------------

/** Every two workspaces that both agreed, `from` to `to` (a workspace never to itself). */
function copyPairs(from: Member[], to: Member[]): [Member, Member][] {
  return from.flatMap((f) => to.filter((t) => t.ws !== f.ws && f.keeps && t.keeps).map((t) => [f, t] as [Member, Member]));
}

/**
 * One alliance's changes run one at a time (ending, leaving, removal, joining), each reading the alliance and its
 * members again inside: a member list read before another change finished is never acted on.
 */
const locked = <T>(id: number, fn: () => Promise<T>) => serialized(`alliance:${id}`, fn);

/** Is `ws` in the alliance now, and its creator? Checked inside the lock by the creator's routes. */
const isCreator = (r: Row, members: Member[], ws: string) => r.inviter_ws === ws && members.some((m) => m.ws === ws && isIn(m));

/**
 * End an alliance for everyone (only from the status it's in now, so two callers can't both end it). `by`: the
 * workspace asking, which must still be its creator. `reason`: why, from the alliance as it is now (null: don't end it). An active one saves what each two workspaces still in it that
 * both agreed to keep copies get, in the same write: each one's live entries at the event as they are now
 * (scout_alliance_copy_queue), so a retry later never copies anything added after the end. Then the copies are made.
 * True if this call ended it.
 */
async function endLink(id: number, reason: (r: Row) => AllianceEndReason | null, by?: string): Promise<boolean> {
  const ended = await locked(id, async () => {
    const r = await rowById(id);
    if (!r || r.status === "ended") return null;
    const members = await membersOne(id);
    if (by != null && !isCreator(r, members, by)) return null;
    const t = now();
    const why = reason(r);
    if (!why) return null; // not due after all (someone joined meanwhile)
    const inNow = members.filter(isIn);
    const pairs = r.status === "active" ? copyPairs(inNow, inNow) : [];
    const guard = { sql: "EXISTS (SELECT 1 FROM scout_alliances a WHERE a.id = ? AND a.status = 'ended' AND a.ended_at = ?)", args: [r.id, t] };
    await writeBatch([
      { sql: "UPDATE scout_alliances SET status = 'ended', ended_reason = ?, ended_at = ?, code_hash = NULL, copies_wanted = ? WHERE id = ? AND status = ?", args: [why, t, pairs.length ? 1 : 0, r.id, r.status] },
      ...pairs.map(([f, to]) => queueCopies(r, f.ws, to.ws, t, guard)),
    ]);
    const after = await rowById(r.id);
    if (!after || after.status !== "ended" || after.ended_at !== t || after.ended_reason !== why) return null; // someone else ended it
    return pairs.length ? after : undefined;
  });
  if (ended === null) return false;
  if (ended) await makeCopies(ended);
  return true;
}

/**
 * A member is out: it left, or the creator removed it (`by`: the workspace removing it, which must still be its
 * creator). Copies between it and every member still in that both agreed (a removed one gets none), as at the end.
 * Fewer than two left: the alliance ends for everyone in the same write. The creator leaving passes the creator's
 * part to the workspace that joined next. True if this call took it out.
 */
async function leaveLink(id: number, ws: string, why: "left" | "removed", by?: string): Promise<boolean> {
  const done = await locked(id, async () => {
    const r = await rowById(id);
    if (!r || r.status === "ended") return null;
    const members = await membersOne(id);
    if (by != null && (by === ws || !isCreator(r, members, by))) return null;
    const t = now();
    const inNow = members.filter(isIn);
    const leaver = inNow.find((m) => m.ws === ws);
    if (!leaver) return null;
    const rest = inNow.filter((m) => m.ws !== ws);
    const ends = rest.length < 2;
    const pairs = r.status === "active" ? [...copyPairs([leaver], rest), ...(why === "left" ? copyPairs(rest, [leaver]) : [])] : [];
    const guard = { sql: "EXISTS (SELECT 1 FROM scout_alliance_members m WHERE m.alliance_id = ? AND m.ws = ? AND m.left_at = ?)", args: [r.id, ws, t] };
    const next = rest[0];
    await writeBatch([
      {
        sql: `UPDATE scout_alliance_members SET left_at = ?, left_reason = ? WHERE alliance_id = ? AND ws = ? AND left_at IS NULL
                AND EXISTS (SELECT 1 FROM scout_alliances a WHERE a.id = ? AND a.status = ?)`,
        args: [t, why, r.id, ws, r.id, r.status],
      },
      // The new creator makes its own code: the old one was the leaver's to hand out.
      ...(r.inviter_ws === ws && next ? [{ sql: "UPDATE scout_alliances SET inviter_ws = ?, inviter_name = ?, code_hash = NULL WHERE id = ? AND inviter_ws = ?", args: [next.ws, next.name, r.id, ws] }] : []),
      ...(ends ? [{
        sql: `UPDATE scout_alliances SET status = 'ended', ended_reason = ?, ended_at = ?, code_hash = NULL, copies_wanted = ? WHERE id = ? AND status = ?
                AND EXISTS (SELECT 1 FROM scout_alliance_members m WHERE m.alliance_id = ? AND m.ws = ? AND m.left_at = ?)`,
        args: [r.status === "pending" ? "cancelled" : "unlinked", t, pairs.length ? 1 : 0, r.id, r.status, r.id, ws, t],
      }] : []),
      // Removed: nothing still queued for it (from an earlier leave, waiting on a switched-off workspace) is ever made.
      ...(why === "removed" ? [{
        sql: "DELETE FROM scout_alliance_copy_queue WHERE alliance_id = ? AND to_ws = ? AND EXISTS (SELECT 1 FROM scout_alliance_members m WHERE m.alliance_id = ? AND m.ws = ? AND m.left_at = ?)",
        args: [r.id, ws, r.id, ws, t],
      }] : []),
      ...pairs.map(([f, to]) => queueCopies(r, f.ws, to.ws, t, guard)),
    ]);
    const me = (await membersOne(r.id)).find((m) => m.ws === ws);
    if (me?.left_at !== t) return null; // it was out already, or the alliance ended meanwhile
    return pairs.length ? (await rowById(r.id))! : undefined;
  });
  if (done === null) return false;
  if (done) await makeCopies(done);
  return true;
}

/**
 * Queue `from`'s live entries at the event for `to`, as they are now (runs in the ending's own write, and only if
 * `guard` says that write took effect). Each keeps where it first came from: an entry that's itself a copy names its
 * origin, and one that came from `to` in the first place (a copy from an earlier link) is never sent back. `to` must be
 * in the alliance still, or be leaving in this very write (left_at = `t`), and never one the creator removed.
 */
function queueCopies(r: Row, from: string, to: string, t: number, guard: { sql: string; args: (string | number)[] }): InStatement {
  return {
    sql: `INSERT OR IGNORE INTO scout_alliance_copy_queue
            (alliance_id, to_ws, from_ws, origin_ws, origin_uuid, season, team, event_code, match_label, kind, data, notes, updated_at,
             author_account_id, author_name, editor_account_id, editor_name, template_id, template_version)
          SELECT ?, ?, ?, COALESCE(c.origin_ws, ws.cp_workspace_id), COALESCE(c.origin_uuid, w.uuid), w.season, w.team, w.event_code, w.match_label,
             w.kind, w.data, w.notes, w.updated_at, w.author_account_id, w.author_name, w.editor_account_id, w.editor_name,
             CASE WHEN c.origin_ws IS NULL THEN w.template_id END, CASE WHEN c.origin_ws IS NULL THEN w.template_version END
            FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id
            LEFT JOIN scout_alliance_copies c ON c.to_ws = ws.cp_workspace_id AND c.copy_uuid = w.uuid
           WHERE ws.cp_workspace_id = ? AND w.season = ? AND UPPER(w.event_code) = ? AND w.deleted = 0
             AND COALESCE(c.origin_ws, '') <> ?
             AND EXISTS (SELECT 1 FROM scout_alliance_members rm WHERE rm.alliance_id = ? AND rm.ws = ? AND rm.left_reason IS NOT 'removed'
                           AND (rm.left_at IS NULL OR rm.left_at = ?))
             AND ${guard.sql}`,
    args: [r.id, to, from, from, r.season, r.event_code, to, r.id, to, t, ...guard.args],
  };
}

/**
 * Make the copies this alliance queued (each once, whatever retries). Copying is a read across workspaces: while
 * alliances, or workspace scouting itself, are off for the receiving or the sending workspace it waits (the sweep
 * makes it once both are back on). Once the alliance has ended and nothing is left queued, its copies are made.
 */
async function makeCopies(r: Row): Promise<void> {
  const on = new Map<string, Promise<boolean>>();
  const isOn = (ws: string) => {
    if (!on.has(ws)) on.set(ws, (async () => (await isEnabledFor("scoutingAlliances", ws)) && (await isEnabledFor("workspaceScouting", ws)))());
    return on.get(ws)!;
  };
  const members = await membersOne(r.id);
  const queued = await all<any>("SELECT * FROM scout_alliance_copy_queue WHERE alliance_id = ? ORDER BY to_ws", [r.id]);
  const byTo = new Map<string, any[]>();
  for (const e of queued) byTo.set(String(e.to_ws), [...(byTo.get(String(e.to_ws)) ?? []), e]);
  for (const [to, rows] of byTo) {
    // A removed workspace never gets copies (its queue is cleared when it's removed; this covers a row queued meanwhile).
    if (members.some((m) => m.ws === to && m.left_reason === "removed")) {
      await run("DELETE FROM scout_alliance_copy_queue WHERE alliance_id = ? AND to_ws = ?", [r.id, to]);
      continue;
    }
    if (!(await isOn(to))) continue;
    const ready: any[] = [];
    for (const e of rows) {
      // Queued before migration 67 (no from_ws): it came from one of the alliance's workspaces, so all of them must be on.
      const from = e.from_ws ? [String(e.from_ws)] : members.map((m) => m.ws);
      if ((await Promise.all(from.map(isOn))).every(Boolean)) ready.push(e);
    }
    if (ready.length) await copyQueued(r, to, members.find((m) => m.ws === to)?.name ?? "", ready);
  }
  if (r.status === "ended" && r.copies_wanted === 1) {
    const left = await get<{ n: number }>("SELECT COUNT(*) n FROM scout_alliance_copy_queue WHERE alliance_id = ?", [r.id]);
    if (!Number(left?.n)) await run("UPDATE scout_alliances SET copies_made = 1 WHERE id = ?", [r.id]);
  }
}

/**
 * A copy's id in the receiving workspace, from the entry it first came from (not the link): a workspace holds at
 * most one copy of any entry, however often the two link again.
 */
export const copyUuid = (originWorkspace: string, originUuid: string) =>
  `cp-${createHash("sha256").update(`${originWorkspace}\n${originUuid}`).digest("hex").slice(0, 40)}`;

const WS = "(SELECT id FROM workspaces WHERE cp_workspace_id = ?)";

async function copyQueued(r: Row, to: string, toName: string, rows: any[]): Promise<void> {
  await serialized(to, async () => {
    const before = await lastSeq(to);
    const at = new Date(now()).toISOString();
    const uuids: string[] = [];
    const stmts: InStatement[] = [
      { sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [to, toName, at, at] },
    ];
    for (const e of rows) {
      const uuid = copyUuid(String(e.origin_ws), String(e.origin_uuid));
      uuids.push(uuid);
      // A template of another workspace isn't readable here: the copy reads with the built-in fields (as consensus would).
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
      }, ...versionStatements(to, uuid, before, { restored: false, fromVersion: null }), {
        sql: "INSERT OR IGNORE INTO scout_alliance_copies (to_ws, copy_uuid, origin_ws, origin_uuid, alliance_id) VALUES (?, ?, ?, ?, ?)",
        args: [to, uuid, e.origin_ws, e.origin_uuid, r.id],
      }, {
        sql: "DELETE FROM scout_alliance_copy_queue WHERE alliance_id = ? AND to_ws = ? AND origin_ws = ? AND origin_uuid = ?",
        args: [r.id, to, e.origin_ws, e.origin_uuid],
      });
    }
    await writeBatch(stmts);
    const written = [...(await readLiveEntries(to, uuids)).values()].filter((e) => e.seq > before).sort((a, b) => a.seq - b.seq);
    publishEntries(to, written);
  });
}

/** Why an alliance ends now, or null: a pending one past its code's life or its event, an active one past its event. */
function due(r: Row, t: number): AllianceEndReason | null {
  const over = allianceEndsAt(r.ends_on) <= t;
  if (r.status === "pending" && (over || (r.invite_expires_at != null && r.invite_expires_at <= t))) return "expired";
  return r.status === "active" && over ? "event_over" : null;
}

/**
 * End every alliance that's due: pending ones past their code's life or their event, active ones whose event is
 * over. Then retry copies that didn't finish (only what was queued when it ended). Cheap when nothing is due; run by
 * every alliance route and by the sweep.
 */
export async function settleAlliances(): Promise<number> {
  const t = now();
  let ended = 0;
  for (const raw of await all<any>(`SELECT * FROM scout_alliances WHERE status IN ${LIVE}`)) {
    const r = toRow(raw);
    if (due(r, t)) ended += Number(await endLink(r.id, (x) => due(x, now())));
  }
  for (const raw of await all<any>(
    `SELECT * FROM scout_alliances WHERE id IN (SELECT alliance_id FROM scout_alliance_copy_queue)
        OR (status = 'ended' AND copies_wanted = 1 AND copies_made = 0)`)) {
    await makeCopies(toRow(raw)).catch((e) => console.warn(`[alliances] copies for alliance ${raw.id}: ${(e as Error).message}`));
  }
  return ended;
}

/**
 * End this workspace's alliances that are due, before anything is written to its entries (bus.ts onBeforeEntriesWrite):
 * the copies an alliance keeps are then always the entries as they were at its deadline, never an edit made after it.
 * One indexed query when nothing is due.
 */
export async function settleWorkspace(workspaceId: string): Promise<void> {
  const t = now();
  const rows = await all<any>(
    `SELECT a.* FROM scout_alliances a JOIN scout_alliance_members m ON m.alliance_id = a.id
      WHERE m.ws = ? AND m.left_at IS NULL AND a.status = 'active'`, [workspaceId]);
  for (const raw of rows) {
    const r = toRow(raw);
    if (due(r, t)) await endLink(r.id, (x) => due(x, now()));
  }
}
onBeforeEntriesWrite(settleWorkspace);

// ---------------------------------------------------------------------------
// Linked for event X: the permission check for the shared reads
// ---------------------------------------------------------------------------

export type AllianceAccess =
  | { ok: true; membership: Membership; row: Row; members: Member[]; others: Member[] }
  | { ok: false; status: number; error: string; code?: string };

/**
 * May this user read what `workspaceId` shares through alliance `allianceId`? They must be a member of
 * `workspaceId` (workspaceAccess, as every workspace read), and it must be in the alliance, which must be active.
 * `members`: every workspace in it now; `others`: all but this one.
 */
export async function allianceAccess(user: User, workspaceId: string, allianceId: number): Promise<AllianceAccess> {
  const access = await workspaceAccess(user, workspaceId);
  if (!access.ok) return { ok: false, status: access.status, ...accessError(access) };
  await settleAlliances();
  const row = await rowById(allianceId);
  const everyone = row ? await membersOne(row.id) : [];
  const me = everyone.find((m) => m.ws === workspaceId);
  if (!row || !me) return { ok: false, status: 404, error: NO_SUCH };
  if (!isIn(me)) return { ok: false, status: 410, error: me.left_reason === "removed" ? "This workspace was removed from this alliance." : "This workspace left this alliance.", code: ALLIANCE_ENDED };
  if (row.status !== "active") {
    return { ok: false, status: 410, error: row.status === "pending" ? "Nobody has joined this alliance yet." : "This alliance has ended.", code: ALLIANCE_ENDED };
  }
  const members = everyone.filter(isIn);
  return { ok: true, membership: access.membership, row, members, others: members.filter((m) => m.ws !== workspaceId) };
}

// ---------------------------------------------------------------------------
// The shared reads
// ---------------------------------------------------------------------------

/** Every member's live entries at the event, each observation once (a copy is skipped while its original is live here). */
async function unionEntries(spaces: string[], season: number, eventCode: string): Promise<AllianceEntry[]> {
  const list = spaces.map(() => "?").join(", ");
  const rows = await all<any>(
    `SELECT ws.cp_workspace_id, w.* FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id
      WHERE ws.cp_workspace_id IN (${list}) AND w.season = ? AND UPPER(w.event_code) = ? AND w.deleted = 0
        AND ${notACopyWithin("w", "ws.cp_workspace_id", spaces.length)}
      ORDER BY w.updated_at DESC`,
    [...spaces, season, eventCode, ...spaces, ...spaces]);
  // Each entry's answers under its own questions: the template it was made with, of its own workspace.
  const readers = new Map(spaces.map((w) => [w, fieldReader(w)]));
  return Promise.all(rows.map(async (r) => {
    const e = storedEntryFields(r);
    const workspaceId = String(r.cp_workspace_id);
    const fields = await readers.get(workspaceId)!(e.season, e.kind, r.template_id ?? null, r.template_version == null ? 0 : Number(r.template_version));
    return {
      uuid: e.uuid, workspaceId, team: e.team, kind: e.kind, matchLabel: e.matchLabel,
      notes: e.notes, answers: answersOf(fields, e.data), updatedAt: e.updatedAt,
      authorAccountId: Number(r.author_account_id), authorDisplayName: String(r.author_name ?? ""),
    };
  }));
}

/** The answered questions of an entry, in the template's order, as text ("Yes", "3", "Left, Center"). */
export function answersOf(fields: ScoutField[], data: Record<string, unknown>): AllianceAnswer[] {
  const out: AllianceAnswer[] = [];
  for (const f of fields) {
    const v = data[f.id];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const text = typeof v === "boolean" ? (v ? "Yes" : "No") : Array.isArray(v) ? v.map(String).join(", ")
      : f.type === "rating" && typeof v === "number" ? `${v} / ${f.max ?? 5}` : String(v);
    out.push({ label: f.label, text: text.slice(0, 500) });
  }
  return out;
}

/** Who contributed what (shown, never policed), one per member in its order. Every team on the event's list appears, scouted or not. */
export function coverageOf(members: { workspaceId: string; name: string }[], entries: AllianceEntry[], teams: EventTeamOption[]): AllianceCoverage {
  const side = (s: { workspaceId: string; name: string }): CoverageSide => {
    const mine = entries.filter((e) => e.workspaceId === s.workspaceId);
    const match = mine.filter((e) => e.kind === "match");
    return {
      ...s, entries: mine.length, matchEntries: match.length, pitEntries: mine.length - match.length,
      teams: new Set(mine.map((e) => e.team)).size,
      matches: new Set(match.map((e) => e.matchLabel?.trim().toUpperCase()).filter(Boolean)).size,
      scouts: new Set(mine.map((e) => e.authorAccountId)).size,
    };
  };
  const byTeam = new Map<number, TeamCoverage>(teams.map((t) => [t.team, { team: t.team, name: t.name, total: 0, byMember: {} }]));
  for (const e of entries) {
    const t = byTeam.get(e.team) ?? { team: e.team, name: null, total: 0, byMember: {} };
    t.total++;
    t.byMember[e.workspaceId] = (t.byMember[e.workspaceId] ?? 0) + 1;
    byTeam.set(e.team, t);
  }
  const list = [...byTeam.values()].sort((a, b) => b.total - a.total || a.team - b.team);
  return { members: members.map(side), teams: list };
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
const allianceIdOf = (req: Request, res: Response): number | null => {
  const id = Number(req.params.allianceId);
  if (!Number.isSafeInteger(id) || id < 1) { res.status(400).json({ error: "allianceId required" }); return null; }
  return id;
};
const NO_SUCH = "No such alliance for this workspace.";
const BAD_CODE = "No open invite with that code. It may have expired or been replaced.";
const ALREADY = "This workspace is already in an alliance (or has an invite out) for this event.";
const FULL = `This alliance is full (${MAX_ALLIANCE_MEMBERS} teams).`;

/**
 * Scouting alliances switched off by the owner (the scoutingAlliances flag: the workspace's override, else the global
 * switch): 403 feature_disabled. Off means no new links and no reads across workspaces through existing ones.
 */
async function alliancesOff(res: Response, workspaceId: string): Promise<boolean> {
  if (await isEnabledFor("scoutingAlliances", workspaceId)) return false;
  featureDisabled(res, "scoutingAlliances");
  return true;
}

/** Gate the admin routes on the flag (after requireWorkspaceAdmin, which checked the id and membership). */
const requireAlliances = (req: Request, res: Response, next: NextFunction) => {
  alliancesOff(res, req.params.workspaceId).then((off) => { if (!off) next(); }, next);
};

/**
 * The shared-read guard: signed in, a good id, scouting on, in an active alliance for the event. `readable`: the other
 * members whose scouting and alliances are on (the rest are left out of every read); none of them: 403 feature_disabled.
 */
async function shared(req: Request, res: Response): Promise<(Extract<AllianceAccess, { ok: true }> & { readable: Member[] }) | null> {
  res.set("Cache-Control", "private, no-store");
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Sign in first." }); return null; }
  const workspaceId = req.params.workspaceId;
  if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return null; }
  const id = allianceIdOf(req, res);
  if (id == null) return null;
  if (await workspacePaused(res, workspaceId) || await alliancesOff(res, workspaceId)) return null;
  const a = await allianceAccess(user, workspaceId, id);
  if (!a.ok) { res.status(a.status).json(a.code ? { error: a.error, code: a.code } : { error: a.error }); return null; }
  // A member that switched its scouting off shares nothing (its own members can't read it either); one with alliances
  // switched off reads nothing across and shares nothing.
  const readable: Member[] = [];
  let refused: "workspaceScouting" | "scoutingAlliances" | null = null;
  for (const m of a.others) {
    if (!(await isEnabledFor("workspaceScouting", m.ws))) refused ??= "workspaceScouting";
    else if (!(await isEnabledFor("scoutingAlliances", m.ws))) refused ??= "scoutingAlliances";
    else readable.push(m);
  }
  if (!readable.length && refused) { featureDisabled(res, refused); return null; }
  return { ...a, readable };
}

export function alliancesRouter(): Router {
  const r = express.Router();

  // Every alliance this workspace is or was in (live ones first, then the last ended or left ones). Any member.
  r.get("/workspaces/:workspaceId/alliances", h(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (await workspacePaused(res, workspaceId) || await alliancesOff(res, workspaceId)) return;
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
    await settleAlliances();
    const season = req.query.season === undefined ? null : Number(req.query.season);
    if (season != null && !isSeason(season)) { res.status(400).json({ error: "season must be a year" }); return; }
    const rows = (await all<any>(
      `SELECT a.* FROM scout_alliances a JOIN scout_alliance_members m ON m.alliance_id = a.id
        WHERE m.ws = ?${season != null ? " AND a.season = ?" : ""}
        ORDER BY CASE WHEN m.left_at IS NOT NULL THEN 2 WHEN a.status = 'active' THEN 0 WHEN a.status = 'pending' THEN 1 ELSE 2 END,
          COALESCE(m.left_at, a.ended_at, a.created_at) DESC LIMIT 20`,
      [workspaceId, ...(season != null ? [season] : [])])).map(toRow);
    const members = await membersOf(rows.map((x) => x.id));
    const alliances = await Promise.all(rows.map(async (x) => view(x, members.get(x.id) ?? [], workspaceId, await eventName(x))));
    const body: AlliancesResponse = { alliances, canManage: access.membership.role === "admin" && !access.orphaned };
    return body;
  }));

  // Start one: an admin, for an event of this season that hasn't ended. This workspace is its creator; the code comes back once.
  r.post("/workspaces/:workspaceId/alliances", jsonOnly, requireWorkspaceAdmin(), requireAlliances, h(async (req, res) => {
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
      if (await liveLinkAt(m.workspaceId, season, eventCode)) { res.status(409).json({ error: ALREADY }); return; }
      const code = newCode();
      const t = now();
      await writeBatch([{
        sql: `INSERT INTO scout_alliances (season, event_code, ends_on, inviter_ws, inviter_name, inviter_keeps, invited_by_account_id, code_hash, invite_expires_at, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        args: [season, eventCode, endsOn, m.workspaceId, m.workspaceName, keepCopies ? 1 : 0, m.accountId, hashCode(code), Math.min(t + INVITE_TTL_MS, allianceEndsAt(endsOn)), t],
      }, {
        sql: `INSERT INTO scout_alliance_members (alliance_id, ws, name, keeps, joined_by_account_id, joined_at)
              SELECT id, ?, ?, ?, ?, ? FROM scout_alliances WHERE code_hash = ?`,
        args: [m.workspaceId, m.workspaceName, keepCopies ? 1 : 0, m.accountId, t, hashCode(code)],
      }]);
      const row = toRow(await get<any>("SELECT * FROM scout_alliances WHERE code_hash = ?", [hashCode(code)]));
      res.status(201);
      const body: AllianceInviteResponse = { alliance: await viewOf(row, m.workspaceId), code };
      return body;
    });
  }));

  // Join: an admin of another workspace, with the code.
  r.post("/workspaces/:workspaceId/alliances/accept", jsonOnly, requireWorkspaceAdmin(), requireAlliances, h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const m = res.locals.membership as Membership;
    const { code: raw, keepCopies } = req.body ?? {};
    const code = normalInviteCode(raw);
    if (!code) { res.status(400).json({ error: "That isn't an invite code (10 letters and numbers)." }); return; }
    if (typeof keepCopies !== "boolean") { res.status(400).json({ error: "keepCopies must be true or false" }); return; }
    await settleAlliances();
    const found = await get<any>(`SELECT * FROM scout_alliances WHERE code_hash = ? AND status IN ${LIVE}`, [hashCode(code)]);
    if (!found || !codeWorks(toRow(found))) { res.status(404).json({ error: BAD_CODE }); return; }
    const inv = toRow(found);
    // Switched off for the workspace that made the code: nobody joins through it.
    if (await alliancesOff(res, inv.inviter_ws)) return;
    // The event's lock (one live alliance per workspace there), then the alliance's (its members, against leaving or ending).
    return serialized(`alliance:${inv.season}:${inv.event_code}`, () => locked(inv.id, async () => {
      const before = await membersOne(inv.id);
      const was = before.find((x) => x.ws === m.workspaceId);
      if (was && isIn(was)) { res.status(400).json({ error: "This workspace is already in this alliance: send the code to another team's admin." }); return; }
      if (was?.left_reason === "removed") { res.status(403).json({ error: "This workspace was removed from this alliance, so it can't join again." }); return; }
      if (await liveLinkAt(m.workspaceId, inv.season, inv.event_code)) { res.status(409).json({ error: ALREADY }); return; }
      if (before.filter(isIn).length >= MAX_ALLIANCE_MEMBERS) { res.status(409).json({ error: FULL }); return; }
      const t = now();
      const stillOpen = `EXISTS (SELECT 1 FROM scout_alliances a WHERE a.id = ? AND a.code_hash = ? AND a.status IN ${LIVE})`;
      await writeBatch([{
        // A workspace that left earlier comes back in on its old row.
        sql: `INSERT INTO scout_alliance_members (alliance_id, ws, name, keeps, joined_by_account_id, joined_at)
              SELECT ?, ?, ?, ?, ?, ? WHERE ${stillOpen}
              ON CONFLICT(alliance_id, ws) DO UPDATE SET name = excluded.name, keeps = excluded.keeps, joined_by_account_id = excluded.joined_by_account_id,
                joined_at = excluded.joined_at, left_at = NULL, left_reason = NULL
              WHERE scout_alliance_members.left_reason IS NOT 'removed'`,
        args: [inv.id, m.workspaceId, m.workspaceName, keepCopies ? 1 : 0, m.accountId, t, inv.id, hashCode(code)],
      }, {
        sql: `UPDATE scout_alliances SET status = 'active', accepted_at = COALESCE(accepted_at, ?) WHERE id = ? AND code_hash = ? AND status IN ${LIVE}`,
        args: [t, inv.id, hashCode(code)],
      }]);
      const me = (await membersOne(inv.id)).find((x) => x.ws === m.workspaceId);
      if (!me || !isIn(me) || me.joined_at !== t) { res.status(404).json({ error: BAD_CODE }); return; }
      return { alliance: await viewOf((await rowById(inv.id))!, m.workspaceId) };
    }));
  }));

  /** The alliance in the URL, for an admin route: 404 unless this workspace is in it now; with `creator`, it must be its creator. */
  async function managed(req: Request, res: Response, creator: boolean): Promise<{ m: Membership; row: Row } | null> {
    res.set("Cache-Control", "no-store");
    const m = res.locals.membership as Membership;
    const id = allianceIdOf(req, res);
    if (id == null) return null;
    await settleAlliances();
    const row = await rowById(id);
    const me = row ? (await membersOne(row.id)).find((x) => x.ws === m.workspaceId) : undefined;
    if (!row || !me) { res.status(404).json({ error: NO_SUCH }); return null; }
    if (row.status === "ended" || !isIn(me)) {
      res.status(409).json({ error: isIn(me) ? "This alliance has already ended." : "This workspace isn't in this alliance any more.", code: ALLIANCE_ENDED });
      return null;
    }
    if (creator && row.inviter_ws !== m.workspaceId) { res.status(403).json({ error: "Only the team that started this alliance can do that." }); return null; }
    return { m, row };
  }

  // A new invite code: the creator. The old code stops working.
  r.post("/workspaces/:workspaceId/alliances/:allianceId/invite", requireWorkspaceAdmin(), requireAlliances, h(async (req, res) => {
    const x = await managed(req, res, true);
    if (!x) return;
    const { m, row } = x;
    if ((await membersOne(row.id)).filter(isIn).length >= MAX_ALLIANCE_MEMBERS) { res.status(409).json({ error: FULL }); return; }
    const code = newCode();
    const changed = await run(
      `UPDATE scout_alliances SET code_hash = ?, invite_expires_at = ? WHERE id = ? AND inviter_ws = ? AND status IN ${LIVE}`,
      [hashCode(code), Math.min(now() + INVITE_TTL_MS, allianceEndsAt(row.ends_on)), row.id, m.workspaceId]);
    if (!changed) { res.status(409).json({ error: "This alliance has already ended.", code: ALLIANCE_ENDED }); return; }
    const body: AllianceInviteResponse = { alliance: await viewOf((await rowById(row.id))!, m.workspaceId), code };
    return body;
  }));

  // End for everyone: the creator. Pending: cancelled. Active: unlinked now (copies as agreed).
  r.post("/workspaces/:workspaceId/alliances/:allianceId/end", requireWorkspaceAdmin(), requireAlliances, h(async (req, res) => {
    const x = await managed(req, res, true);
    if (!x) return;
    const { m, row } = x;
    if (!(await endLink(row.id, (x) => (x.status === "pending" ? "cancelled" : "unlinked"), m.workspaceId))) {
      res.status(409).json({ error: "This alliance has already ended, or this workspace no longer started it.", code: ALLIANCE_ENDED }); return;
    }
    return { alliance: await viewOf((await rowById(row.id))!, m.workspaceId) };
  }));

  // Leave: an admin of any member. The others carry on while at least two are left.
  r.post("/workspaces/:workspaceId/alliances/:allianceId/leave", requireWorkspaceAdmin(), requireAlliances, h(async (req, res) => {
    const x = await managed(req, res, false);
    if (!x) return;
    const { m, row } = x;
    const done = await leaveLink(row.id, m.workspaceId, "left");
    if (!done) { res.status(409).json({ error: "This workspace isn't in this alliance any more.", code: ALLIANCE_ENDED }); return; }
    return { alliance: await viewOf((await rowById(row.id))!, m.workspaceId) };
  }));

  // Remove another member: the creator. It's out as if it had left, but keeps no copies of the others' entries.
  r.post("/workspaces/:workspaceId/alliances/:allianceId/members/:memberId/remove", requireWorkspaceAdmin(), requireAlliances, h(async (req, res) => {
    const x = await managed(req, res, true);
    if (!x) return;
    const { m, row } = x;
    const target = req.params.memberId;
    if (target === m.workspaceId) { res.status(400).json({ error: "To take this workspace out, leave the alliance instead." }); return; }
    if (!(await membersOne(row.id)).some((y) => y.ws === target && isIn(y))) { res.status(404).json({ error: "That team isn't in this alliance." }); return; }
    // Checked again inside the alliance's lock: the caller must still be its creator when the removal runs.
    const done = await leaveLink(row.id, target, "removed", m.workspaceId);
    if (!done) { res.status(409).json({ error: "That team isn't in this alliance any more, or this workspace no longer started it." }); return; }
    return { alliance: await viewOf((await rowById(row.id))!, m.workspaceId) };
  }));

  // The union: every member's entries and assignments at the event, and who contributed what.
  r.get("/workspaces/:workspaceId/alliances/:allianceId/shared", h(async (req, res) => {
    const a = await shared(req, res);
    if (!a) return;
    const { row, membership: m } = a;
    const read = a.members.filter((x) => x.ws === m.workspaceId || a.readable.includes(x));
    const spaces = read.map((x) => x.ws);
    const scope = { season: row.season, eventCode: row.event_code };
    const [entries, teams, teamAssignments, matchAssignments] = await Promise.all([
      unionEntries(spaces, row.season, row.event_code),
      eventTeams(row.season, row.event_code),
      Promise.all(spaces.map((ws) => listAssignments(ws, scope))),
      Promise.all(spaces.map((ws) => listMatchAssignments(ws, scope))),
    ]);
    const body: AllianceShared = {
      alliance: await viewOf(row, m.workspaceId), entries,
      assignments: teamAssignments.flat(), matchAssignments: matchAssignments.flat(),
      coverage: coverageOf(read.map((x) => ({ workspaceId: x.ws, name: x.name })), entries, teams),
    };
    return body;
  }));

  // One consensus over every member's entries at the event (the same answer for every member).
  r.get("/workspaces/:workspaceId/alliances/:allianceId/consensus", h(async (req, res) => {
    const a = await shared(req, res);
    if (!a) return;
    const teams = parseTeams(req.query.teams);
    if (!teams) { res.status(400).json({ error: `teams: 1 to ${CONSENSUS_MAX_TEAMS} team numbers, comma separated` }); return; }
    const body: AllianceConsensusResponse = {
      allianceId: a.row.id, season: a.row.season, eventCode: a.row.event_code,
      teams: await consensusForScope({ workspaces: [a.membership.workspaceId, ...a.readable.map((x) => x.ws)], eventCode: a.row.event_code, oneEach: true }, a.row.season, teams),
    };
    return body;
  }));

  // Another member's pick list (?workspace=; without it, the first other member's), to read: only the teams on the event's team list.
  r.get("/workspaces/:workspaceId/alliances/:allianceId/picklist", h(async (req, res) => {
    const a = await shared(req, res);
    if (!a) return;
    const asked = typeof req.query.workspace === "string" ? req.query.workspace : null;
    const of = asked ? a.readable.find((x) => x.ws === asked) : a.readable[0];
    if (!of) { res.status(404).json({ error: "That team isn't in this alliance." }); return; }
    const [list, teams] = await Promise.all([readPickList(of.ws, a.row.season), eventTeams(a.row.season, a.row.event_code)]);
    // Only teams known to be at the event: with no team list yet, none (never the member's whole season).
    const at = new Set(teams.map((t) => t.team));
    const body: AlliancePicklistResponse = { allianceId: a.row.id, workspaceId: of.ws, name: of.name, teamsKnown: at.size > 0, list: { ...list, picks: list.picks.filter((p) => at.has(p.team)) } };
    return body;
  }));

  return r;
}
