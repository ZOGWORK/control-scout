// Scouting assignments (Task 10; docs/assignments.md): at an event the workspace's admin deals out who
// scouts which team. Stored in workspace_assignments (migration 19), one row per member, team and event.
//
// Permissions (Control Point's roles; Scout has none of its own):
//   create   admins only. Every team × every assignee in one request (many teams → one member, or one team →
//            several members). A team someone else already holds at that event is a warning in the answer,
//            never a refusal; the same member, team and event twice is not made again (returned as existing).
//   done     the assignee, or an admin
//   reopen   admins only
//   delete   admins only
//   read     every member: the whole workspace's list, so badges show who holds which team
// Every route: 401 signed out, 503 while workspace scouting is paused, 400 a bad id, 403 not a member (or,
// where it's admin only, not an admin).
//
// Assignees: members of the workspace in Scout's membership cache (workspace_members). Only members who have
// signed in to Scout are in it; Control Point's full member list isn't asked for here.
// Teams: the event's teams in the synced event data (event_teams, else FIRST's pre-event registrations:
// data/registrations.ts ROSTER). An event with no team list yet can't be
// assigned (there's nothing to pick from).
// Progress: the assignee's entries for that team at that event (this season, not deleted), counted on read.
//
// Each change is logged in the activity feed (assignment.created / .completed / .reopened / .deleted, subject
// assignment:<id>; the inbox notifies the assignee unless they did it themselves) and published to the
// workspace's live streams (`event: assignment`, stream.ts).
//
// Match scouting (the Scout redesign; workspace_match_assignments, migration 46): a member watches a slot, an
// alliance or all four teams for a run of quals ("Priya: Red 1, Q1–Q30"). Admins create, edit and delete; every
// member reads. Same 401/503/400/403 as above. The assignee must be a cached member and the event a synced one;
// the range is quals only, either end open. Another assignment watching the same slot in the same matches is a
// warning in the answer (overlaps), never a refusal. Logged as assignment.match_created / _updated / _deleted
// (subject match-assignment:<id>; the inbox tells the assignee, both of them when an edit moves it to someone else)
// and streamed as `event: match-assignment`.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, db, get } from "../db.js";
import { ROSTER } from "../data/registrations.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import {
  MAX_BULK, matchAssignmentsOverlap, matchRangeLabel, normalEventCode, qualNumber, type AssignableMember, type Assignment, type AssignmentStatus, type CreateAssignmentsResult,
  type DuplicateWarning, type EventTeamOption, type MatchAssignment, type MatchAssignmentResult,
} from "../../src/shared/assignments.js";
import { parseWatching, watchingLabel, type Watching } from "../../src/shared/scoutMatch.js";
import { publishAssignments, publishMatchAssignments, serialized } from "./bus.js";
import { accessError, isWrite, requireWorkspaceAdmin, workspaceAccess, workspacePaused, writerName } from "./entries.js";
import { logActivity, type ActivityActor } from "./activityLog.js";

const CP_PROVIDER = "control-point";

const toAssignment = (workspaceId: string, r: any, progress = 0): Assignment => ({
  id: Number(r.id), workspaceId, season: Number(r.season), eventCode: String(r.event_code), team: Number(r.team),
  assigneeAccountId: Number(r.assignee_account_id), assigneeName: String(r.assignee_name ?? ""),
  createdByAccountId: Number(r.created_by_account_id), createdByName: String(r.created_by_name ?? ""),
  createdAt: Number(r.created_at), status: r.status === "done" ? "done" : "open",
  doneAt: r.done_at == null ? null : Number(r.done_at), doneByAccountId: r.done_by == null ? null : Number(r.done_by),
  doneByName: r.done_by_name == null ? null : String(r.done_by_name),
  version: Number(r.version ?? 1), progress,
});

const progressKey = (season: number, eventCode: string, team: number, accountId: number) => `${season}:${eventCode}:${team}:${accountId}`;

/** Rows as the API sends them, each with its assignee's entry count for that team and event. */
async function withProgress(workspaceId: string, rows: any[]): Promise<Assignment[]> {
  if (!rows.length) return [];
  const seasons = [...new Set(rows.map((r) => Number(r.season)))];
  const counts = await all<{ season: number; event_code: string; team: number; author_account_id: number; n: number }>(
    `SELECT e.season, UPPER(e.event_code) event_code, e.team, e.author_account_id, COUNT(*) n FROM workspace_scout_entries e
       JOIN workspaces w ON w.id = e.workspace_id
      WHERE w.cp_workspace_id = ? AND e.deleted = 0 AND e.event_code IS NOT NULL AND e.season IN (${seasons.map(() => "?").join(", ")})
      GROUP BY e.season, UPPER(e.event_code), e.team, e.author_account_id`,
    [workspaceId, ...seasons]);
  const by = new Map(counts.map((c) => [progressKey(Number(c.season), String(c.event_code), Number(c.team), Number(c.author_account_id)), Number(c.n)]));
  return rows.map((r) => toAssignment(workspaceId, r, by.get(progressKey(Number(r.season), String(r.event_code), Number(r.team), Number(r.assignee_account_id))) ?? 0));
}

export interface ListFilter { season?: number; eventCode?: string; assigneeAccountId?: number; teams?: number[] }

/**
 * A workspace's assignments (filtered), oldest first: all of them, never a silent first page (a workspace's
 * list is people dealing out teams by hand: hundreds per season at most). Reading never creates anything.
 */
export async function listAssignments(workspaceId: string, f: ListFilter = {}): Promise<Assignment[]> {
  const where: string[] = ["w.cp_workspace_id = ?"];
  const args: (string | number)[] = [workspaceId];
  if (f.season != null) { where.push("a.season = ?"); args.push(f.season); }
  if (f.eventCode != null) { where.push("a.event_code = ?"); args.push(f.eventCode); }
  if (f.assigneeAccountId != null) { where.push("a.assignee_account_id = ?"); args.push(f.assigneeAccountId); }
  if (f.teams?.length) { where.push(`a.team IN (${f.teams.map(() => "?").join(", ")})`); args.push(...f.teams); }
  const rows = await all<any>(`SELECT a.* FROM workspace_assignments a JOIN workspaces w ON w.id = a.workspace_id WHERE ${where.join(" AND ")} ORDER BY a.id`, args);
  return withProgress(workspaceId, rows);
}

async function byIds(workspaceId: string, ids: number[]): Promise<Assignment[]> {
  if (!ids.length) return [];
  const rows = await all<any>(
    `SELECT a.* FROM workspace_assignments a JOIN workspaces w ON w.id = a.workspace_id WHERE w.cp_workspace_id = ? AND a.id IN (${ids.map(() => "?").join(", ")}) ORDER BY a.id`,
    [workspaceId, ...ids]);
  return withProgress(workspaceId, rows);
}

/** How a member is named: their Scout profile's name, else the part of their email before the @ (as on entries). */
const nameOf = (displayName: unknown, email: unknown, accountId: number) =>
  ((typeof displayName === "string" && displayName.trim()) || (typeof email === "string" && email.split("@")[0]) || `Member ${accountId}`).slice(0, 60);

/** Members who can be assigned: the workspace's cached members (only those who've signed in to Scout). */
export async function assignableMembers(workspaceId: string): Promise<AssignableMember[]> {
  const rows = await all<{ account_id: number; role: string; display_name: string | null; email: string | null }>(
    `SELECT m.account_id, m.role, u.display_name, u.email FROM workspace_members m
       LEFT JOIN users u ON u.id = (SELECT MIN(i.user_id) FROM identities i WHERE i.provider = ? AND i.subject = CAST(m.account_id AS TEXT))
      WHERE m.cp_workspace_id = ?`, [CP_PROVIDER, workspaceId]);
  return rows.map((r) => ({ accountId: Number(r.account_id), name: nameOf(r.display_name, r.email, Number(r.account_id)), role: (r.role === "admin" ? "admin" : "member") as AssignableMember["role"] }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The event's teams from the synced event data (empty: unknown event, or no team list yet). */
export async function eventTeams(season: number, eventCode: string): Promise<EventTeamOption[]> {
  const rows = await all<{ team: number; name: string | null }>(
    `SELECT et.team, t.name FROM ${ROSTER} et LEFT JOIN teams t ON t.number = et.team WHERE et.season = ? AND UPPER(et.code) = ? ORDER BY et.team`, [season, eventCode]);
  return rows.map((r) => ({ team: Number(r.team), name: r.name ?? null }));
}

export type CreateOutcome = { ok: true; result: CreateAssignmentsResult } | { ok: false; status: 400; error: string };

const intList = (v: unknown): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = v.map(Number);
  return out.every((n) => Number.isSafeInteger(n) && n > 0) ? [...new Set(out)] : null;
};

/** Create every team × assignee pair (admin already checked). */
export async function createAssignments(user: User, m: Membership, body: unknown): Promise<CreateOutcome> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const season = Number(b.season);
  if (!Number.isSafeInteger(season) || season < 2000 || season > 2100) return { ok: false, status: 400, error: "season must be a season year" };
  const eventCode = normalEventCode(b.eventCode);
  if (!eventCode) return { ok: false, status: 400, error: "eventCode must be an event code" };
  const teams = intList(b.teams), assignees = intList(b.assigneeAccountIds);
  if (!teams?.length) return { ok: false, status: 400, error: "Pick at least one team." };
  if (!assignees?.length) return { ok: false, status: 400, error: "Pick at least one member." };
  if (teams.length * assignees.length > MAX_BULK) return { ok: false, status: 400, error: `At most ${MAX_BULK} assignments at once.` };
  const known = await eventTeams(season, eventCode);
  if (!known.length) return { ok: false, status: 400, error: `There's no team list for ${eventCode} in ${season} yet.` };
  const knownSet = new Set(known.map((t) => t.team));
  const stray = teams.filter((t) => !knownSet.has(t));
  if (stray.length) return { ok: false, status: 400, error: `Not at ${eventCode}: ${stray.join(", ")}.` };
  const members = new Map((await assignableMembers(m.workspaceId)).map((x) => [x.accountId, x]));
  const strangers = assignees.filter((a) => !members.has(a));
  if (strangers.length) return { ok: false, status: 400, error: "Every assignee must be a member of this workspace who has signed in to Scout." };

  const actor: ActivityActor = { accountId: m.accountId, name: writerName(user) };
  // One change to a workspace's assignments at a time, so the duplicate check and the write see the same list.
  const outcome = await serialized(`assignments:${m.workspaceId}`, async () => {
    const now = Date.now(), iso = new Date(now).toISOString();
    await db().execute({ sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [m.workspaceId, m.workspaceName, iso, iso] });
    const res = await db().batch(teams.flatMap((team) => assignees.map((a) => ({
      sql: `INSERT INTO workspace_assignments (workspace_id, season, event_code, team, assignee_account_id, assignee_name, created_by_account_id, created_by_name, created_at, status)
            VALUES ((SELECT id FROM workspaces WHERE cp_workspace_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, 'open')
            ON CONFLICT (workspace_id, season, event_code, team, assignee_account_id) DO NOTHING RETURNING id`,
      args: [m.workspaceId, season, eventCode, team, a, members.get(a)!.name, m.accountId, actor.name, now],
    }))), "write");
    const createdIds = res.flatMap((r) => r.rows.map((x) => Number(x.id)));
    // What this request made (by the ids the inserts returned), and every holder of the requested teams at the event.
    const created = await byIds(m.workspaceId, createdIds);
    const atEvent = await listAssignments(m.workspaceId, { season, eventCode, teams });
    return { createdIds, created, atEvent };
  });
  const created = outcome.created;
  const existing = outcome.atEvent.filter((a) => !outcome.createdIds.includes(a.id) && teams.includes(a.team) && assignees.includes(a.assigneeAccountId));
  const duplicates: DuplicateWarning[] = [];
  for (const team of teams) {
    const holders = outcome.atEvent.filter((a) => a.team === team);
    if (holders.length > 1) duplicates.push({ team, assignees: holders.map((h) => ({ accountId: h.assigneeAccountId, name: h.assigneeName })) });
  }
  if (created.length) {
    publishAssignments(m.workspaceId, { action: "created", assignments: created });
    // The feed and the inbox: one line per assignee, naming every team they got (subject: their first new assignment).
    for (const a of assignees) {
      const mine = created.filter((c) => c.assigneeAccountId === a);
      if (!mine.length) continue;
      await logActivity(m.workspaceId, actor, "assignment.created", `assignment:${mine[0].id}`, {
        assigneeAccountId: a, assigneeName: mine[0].assigneeName, team: mine[0].team, season, eventCode,
        ...(mine.length > 1 ? { teams: mine.map((c) => c.team), assignmentIds: mine.map((c) => c.id) } : { assignmentId: mine[0].id }),
      });
    }
  }
  return { ok: true, result: { created, existing, duplicates } };
}

export type ChangeOutcome = { ok: true; assignment: Assignment; changed: boolean } | { ok: false; status: 400 | 403 | 404; error: string };

/** Mark done (the assignee or an admin) or reopen (admins only). Marking it as it already is changes nothing. */
export async function setAssignmentStatus(user: User, m: Membership, id: number, body: unknown): Promise<ChangeOutcome> {
  const status = (body && typeof body === "object" ? (body as Record<string, unknown>).status : undefined) as AssignmentStatus | undefined;
  if (status !== "open" && status !== "done") return { ok: false, status: 400, error: "status must be open or done" };
  const actor: ActivityActor = { accountId: m.accountId, name: writerName(user) };
  return serialized(`assignments:${m.workspaceId}`, async () => {
    const [cur] = await byIds(m.workspaceId, [id]);
    if (!cur) return { ok: false as const, status: 404 as const, error: "That assignment was deleted." };
    const admin = m.role === "admin";
    if (status === "done" && !admin && cur.assigneeAccountId !== m.accountId) return { ok: false as const, status: 403 as const, error: "Only the assignee or a workspace admin can mark this done." };
    if (status === "open" && !admin) return { ok: false as const, status: 403 as const, error: "Only a workspace admin can reopen an assignment." };
    if (cur.status === status) return { ok: true as const, assignment: cur, changed: false };
    const now = Date.now();
    await db().execute(status === "done"
      ? { sql: "UPDATE workspace_assignments SET status = 'done', done_at = ?, done_by = ?, done_by_name = ?, version = version + 1 WHERE id = ?", args: [now, m.accountId, actor.name, id] }
      : { sql: "UPDATE workspace_assignments SET status = 'open', done_at = NULL, done_by = NULL, done_by_name = NULL, version = version + 1 WHERE id = ?", args: [id] });
    const [after] = await byIds(m.workspaceId, [id]);
    publishAssignments(m.workspaceId, { action: "updated", assignments: [after] });
    await logActivity(m.workspaceId, actor, status === "done" ? "assignment.completed" : "assignment.reopened", `assignment:${id}`, details(after));
    return { ok: true as const, assignment: after, changed: true };
  });
}

/** Delete one (admin already checked). */
export async function deleteAssignment(user: User, m: Membership, id: number): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  const actor: ActivityActor = { accountId: m.accountId, name: writerName(user) };
  return serialized(`assignments:${m.workspaceId}`, async () => {
    const [cur] = await byIds(m.workspaceId, [id]);
    if (!cur) return { ok: false as const, status: 404 as const, error: "That assignment was already deleted." };
    await db().execute({ sql: "DELETE FROM workspace_assignments WHERE id = ?", args: [id] });
    publishAssignments(m.workspaceId, { action: "deleted", assignments: [cur] });
    await logActivity(m.workspaceId, actor, "assignment.deleted", `assignment:${id}`, details(cur));
    return { ok: true as const };
  });
}

const details = (a: Assignment) => ({ assignmentId: a.id, assigneeAccountId: a.assigneeAccountId, assigneeName: a.assigneeName, team: a.team, season: a.season, eventCode: a.eventCode });

// --- Match scouting ------------------------------------------------------------------------------

const toMatchAssignment = (workspaceId: string, r: any): MatchAssignment => {
  let watching: Watching = { kind: "all" };
  try { watching = parseWatching(JSON.parse(String(r.watching))) ?? watching; } catch { /* written by us: always JSON */ }
  return {
    id: Number(r.id), workspaceId, season: Number(r.season), eventCode: String(r.event_code), watching,
    fromMatch: r.from_match == null ? null : String(r.from_match), toMatch: r.to_match == null ? null : String(r.to_match),
    assigneeAccountId: Number(r.assignee_account_id), assigneeName: String(r.assignee_name ?? ""),
    createdByAccountId: Number(r.created_by_account_id), createdByName: String(r.created_by_name ?? ""),
    createdAt: Number(r.created_at), updatedAt: Number(r.updated_at), version: Number(r.version ?? 1),
  };
};

/** A workspace's match assignments (filtered), oldest first, all of them. */
export async function listMatchAssignments(workspaceId: string, f: Pick<ListFilter, "season" | "eventCode" | "assigneeAccountId"> = {}): Promise<MatchAssignment[]> {
  const where: string[] = ["w.cp_workspace_id = ?"];
  const args: (string | number)[] = [workspaceId];
  if (f.season != null) { where.push("a.season = ?"); args.push(f.season); }
  if (f.eventCode != null) { where.push("a.event_code = ?"); args.push(f.eventCode); }
  if (f.assigneeAccountId != null) { where.push("a.assignee_account_id = ?"); args.push(f.assigneeAccountId); }
  const rows = await all<any>(`SELECT a.* FROM workspace_match_assignments a JOIN workspaces w ON w.id = a.workspace_id WHERE ${where.join(" AND ")} ORDER BY a.id`, args);
  return rows.map((r) => toMatchAssignment(workspaceId, r));
}

async function matchAssignmentById(workspaceId: string, id: number): Promise<MatchAssignment | null> {
  const r = await get<any>("SELECT a.* FROM workspace_match_assignments a JOIN workspaces w ON w.id = a.workspace_id WHERE w.cp_workspace_id = ? AND a.id = ?", [workspaceId, id]);
  return r ? toMatchAssignment(workspaceId, r) : null;
}

/** A range end: absent, null or "" is open; otherwise a qual label in any spelling, stored as "Q12". undefined: not a qual. */
const rangeEnd = (v: unknown): string | null | undefined => {
  if (v == null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const n = qualNumber(String(v));
  return n != null && n >= 1 && n <= 999 ? `Q${n}` : undefined;
};

type MatchBody = { season: number; eventCode: string; watching: Watching; fromMatch: string | null; toMatch: string | null; assignee: AssignableMember };

/** Check a POST / PATCH body: every field, as the assignment should be. */
async function readMatchBody(m: Membership, body: unknown): Promise<{ ok: true; v: MatchBody } | { ok: false; status: 400; error: string }> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const bad = (error: string) => ({ ok: false as const, status: 400 as const, error });
  const season = Number(b.season);
  if (!Number.isSafeInteger(season) || season < 2000 || season > 2100) return bad("season must be a season year");
  const eventCode = normalEventCode(b.eventCode);
  if (!eventCode) return bad("eventCode must be an event code");
  const watching = parseWatching(b.watching);
  if (!watching) return bad("Pick a slot, an alliance or all four teams.");
  const fromMatch = rangeEnd(b.fromMatch), toMatch = rangeEnd(b.toMatch);
  if (fromMatch === undefined || toMatch === undefined) return bad("Matches are qualification numbers, like Q1 or 30.");
  if (fromMatch && toMatch && qualNumber(fromMatch)! > qualNumber(toMatch)!) return bad(`${fromMatch} comes after ${toMatch}.`);
  const accountId = Number(b.assigneeAccountId);
  if (!Number.isSafeInteger(accountId) || accountId <= 0) return bad("Pick a member.");
  if (!(await get("SELECT 1 FROM events WHERE season = ? AND UPPER(code) = ?", [season, eventCode]))) return bad(`There's no event ${eventCode} in ${season}.`);
  const assignee = (await assignableMembers(m.workspaceId)).find((x) => x.accountId === accountId);
  if (!assignee) return bad("The assignee must be a member of this workspace who has signed in to Scout.");
  return { ok: true, v: { season, eventCode, watching, fromMatch, toMatch, assignee } };
}

export type MatchOutcome = { ok: true; result: MatchAssignmentResult } | { ok: false; status: 400 | 404; error: string };

const matchDetails = (a: MatchAssignment) => ({
  matchAssignmentId: a.id, assigneeAccountId: a.assigneeAccountId, assigneeName: a.assigneeName, season: a.season, eventCode: a.eventCode,
  watching: watchingLabel(a.watching), range: matchRangeLabel(a.fromMatch, a.toMatch),
});

const overlapsOf = async (workspaceId: string, a: MatchAssignment) =>
  (await listMatchAssignments(workspaceId, { season: a.season, eventCode: a.eventCode })).filter((o) => o.id !== a.id && matchAssignmentsOverlap(a, o));

/** Create one (admin already checked). */
export async function createMatchAssignment(user: User, m: Membership, body: unknown): Promise<MatchOutcome> {
  const read = await readMatchBody(m, body);
  if (!read.ok) return read;
  const v = read.v;
  const actor: ActivityActor = { accountId: m.accountId, name: writerName(user) };
  const a = await serialized(`assignments:${m.workspaceId}`, async () => {
    const now = Date.now(), iso = new Date(now).toISOString();
    await db().execute({ sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [m.workspaceId, m.workspaceName, iso, iso] });
    const r = await db().execute({
      sql: `INSERT INTO workspace_match_assignments (workspace_id, season, event_code, watching, from_match, to_match, assignee_account_id, assignee_name, created_by_account_id, created_by_name, created_at, updated_at)
            VALUES ((SELECT id FROM workspaces WHERE cp_workspace_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      args: [m.workspaceId, v.season, v.eventCode, JSON.stringify(v.watching), v.fromMatch, v.toMatch, v.assignee.accountId, v.assignee.name, m.accountId, actor.name, now, now],
    });
    return (await matchAssignmentById(m.workspaceId, Number(r.rows[0].id)))!;
  });
  publishMatchAssignments(m.workspaceId, { action: "created", matchAssignments: [a] });
  await logActivity(m.workspaceId, actor, "assignment.match_created", `match-assignment:${a.id}`, matchDetails(a));
  return { ok: true, result: { matchAssignment: a, overlaps: await overlapsOf(m.workspaceId, a) } };
}

/** Edit one: who, what and which matches (admin already checked). The same values again change nothing. */
export async function updateMatchAssignment(user: User, m: Membership, id: number, body: unknown): Promise<MatchOutcome> {
  const read = await readMatchBody(m, body);
  if (!read.ok) return read;
  const v = read.v;
  const actor: ActivityActor = { accountId: m.accountId, name: writerName(user) };
  const out = await serialized(`assignments:${m.workspaceId}`, async () => {
    const cur = await matchAssignmentById(m.workspaceId, id);
    if (!cur) return null;
    const same = cur.season === v.season && cur.eventCode === v.eventCode && JSON.stringify(cur.watching) === JSON.stringify(v.watching)
      && cur.fromMatch === v.fromMatch && cur.toMatch === v.toMatch && cur.assigneeAccountId === v.assignee.accountId;
    if (same) return { before: cur, after: cur, changed: false };
    await db().execute({
      sql: `UPDATE workspace_match_assignments SET season = ?, event_code = ?, watching = ?, from_match = ?, to_match = ?, assignee_account_id = ?, assignee_name = ?,
              updated_at = ?, version = version + 1 WHERE id = ?`,
      args: [v.season, v.eventCode, JSON.stringify(v.watching), v.fromMatch, v.toMatch, v.assignee.accountId, v.assignee.name, Date.now(), id],
    });
    return { before: cur, after: (await matchAssignmentById(m.workspaceId, id))!, changed: true };
  });
  if (!out) return { ok: false, status: 404, error: "That assignment was deleted." };
  if (out.changed) {
    publishMatchAssignments(m.workspaceId, { action: "updated", matchAssignments: [out.after] });
    // Moved to someone else: both hear about it.
    const moved = out.before.assigneeAccountId !== out.after.assigneeAccountId;
    await logActivity(m.workspaceId, actor, "assignment.match_updated", `match-assignment:${id}`, {
      ...matchDetails(out.after), ...(moved ? { assigneeAccountIds: [out.before.assigneeAccountId, out.after.assigneeAccountId], previousAssigneeName: out.before.assigneeName } : {}),
    });
  }
  return { ok: true, result: { matchAssignment: out.after, overlaps: await overlapsOf(m.workspaceId, out.after) } };
}

/** Delete one (admin already checked). */
export async function deleteMatchAssignment(user: User, m: Membership, id: number): Promise<{ ok: true } | { ok: false; status: 404; error: string }> {
  const actor: ActivityActor = { accountId: m.accountId, name: writerName(user) };
  return serialized(`assignments:${m.workspaceId}`, async () => {
    const cur = await matchAssignmentById(m.workspaceId, id);
    if (!cur) return { ok: false as const, status: 404 as const, error: "That assignment was already deleted." };
    await db().execute({ sql: "DELETE FROM workspace_match_assignments WHERE id = ?", args: [id] });
    publishMatchAssignments(m.workspaceId, { action: "deleted", matchAssignments: [cur] });
    await logActivity(m.workspaceId, actor, "assignment.match_deleted", `match-assignment:${id}`, matchDetails(cur));
    return { ok: true as const };
  });
}

// --- Routes -------------------------------------------------------------------------------------

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};
const noStore = (_req: Request, res: Response, next: NextFunction) => { res.set("Cache-Control", "no-store"); next(); };

/** Any member: the membership on res.locals (as requireWorkspaceAdmin does for admins). */
function requireWorkspaceMember() {
  return (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const user = await currentUser(req);
      if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
      if (await workspacePaused(res)) return;
      const workspaceId = req.params.workspaceId;
      if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
      const access = await workspaceAccess(user, workspaceId, { write: isWrite(req) });
      if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
      res.locals.user = user;
      res.locals.membership = access.membership;
      next();
    })().catch(next);
  };
}

/** ?season=&event=&assignee=me|<accountId>, or null once a 400 is sent. */
function readFilter(req: Request, res: Response, m: Membership): ListFilter | null {
  const f: ListFilter = {};
  if (req.query.season !== undefined) {
    const s = Number(req.query.season);
    if (!Number.isSafeInteger(s)) { res.status(400).json({ error: "season must be a season year" }); return null; }
    f.season = s;
  }
  if (req.query.event !== undefined && req.query.event !== "") {
    const e = normalEventCode(req.query.event);
    if (!e) { res.status(400).json({ error: "event must be an event code" }); return null; }
    f.eventCode = e;
  }
  if (req.query.assignee !== undefined) {
    const a = req.query.assignee === "me" ? m.accountId : Number(req.query.assignee);
    if (!Number.isSafeInteger(a) || a <= 0) { res.status(400).json({ error: "assignee must be me or an account id" }); return null; }
    f.assigneeAccountId = a;
  }
  return f;
}

const assignmentId = (raw: unknown): number | null => {
  const n = Number(raw);
  return typeof raw === "string" && /^\d{1,15}$/.test(raw) && Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * /api/scout/workspaces/:workspaceId/assignments
 *   GET    ?season=&event=&assignee=me|<accountId>   any member. {assignments}
 *   GET    /options?season=&event=                    admins. {members, teams}: who can be assigned, and the event's teams
 *   POST   {season, eventCode, teams[], assigneeAccountIds[]}   admins, JSON. 201 {created, existing, duplicates}
 *   PATCH  /:id {status: "done" | "open"}             done: the assignee or an admin; open: admins. {assignment, changed}
 *   DELETE /:id                                       admins. {deleted: id}
 *   GET    /matches?season=&event=&assignee=me|<accountId>   any member. {matchAssignments}
 *   POST   /matches {season, eventCode, watching, fromMatch, toMatch, assigneeAccountId}   admins, JSON. 201 {matchAssignment, overlaps}
 *   PATCH  /matches/:id (the same body: the assignment as it should be)   admins, JSON. {matchAssignment, overlaps}
 *   DELETE /matches/:id                               admins. {deleted: id}
 */
export function assignmentsRouter(): Router {
  const r = express.Router();
  const base = "/workspaces/:workspaceId/assignments";
  r.get(base, noStore, requireWorkspaceMember(), h(async (req, res) => {
    const m = res.locals.membership as Membership;
    const f = readFilter(req, res, m);
    if (!f) return;
    return { assignments: await listAssignments(m.workspaceId, f) };
  }));
  r.get(`${base}/matches`, noStore, requireWorkspaceMember(), h(async (req, res) => {
    const m = res.locals.membership as Membership;
    const f = readFilter(req, res, m);
    if (!f) return;
    return { matchAssignments: await listMatchAssignments(m.workspaceId, f) };
  }));
  r.post(`${base}/matches`, noStore, jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    const out = await createMatchAssignment(res.locals.user as User, res.locals.membership as Membership, req.body);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    res.status(201).json(out.result);
  }));
  r.patch(`${base}/matches/:id`, noStore, jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    const id = assignmentId(req.params.id);
    if (id == null) { res.status(400).json({ error: "Bad assignment id" }); return; }
    const out = await updateMatchAssignment(res.locals.user as User, res.locals.membership as Membership, id, req.body);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return out.result;
  }));
  r.delete(`${base}/matches/:id`, noStore, requireWorkspaceAdmin(), h(async (req, res) => {
    const id = assignmentId(req.params.id);
    if (id == null) { res.status(400).json({ error: "Bad assignment id" }); return; }
    const out = await deleteMatchAssignment(res.locals.user as User, res.locals.membership as Membership, id);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return { deleted: id };
  }));
  r.get(`${base}/options`, noStore, requireWorkspaceAdmin(), h(async (req, res) => {
    const m = res.locals.membership as Membership;
    const season = Number(req.query.season);
    const eventCode = normalEventCode(req.query.event);
    const teams = Number.isSafeInteger(season) && eventCode ? await eventTeams(season, eventCode) : [];
    return { members: await assignableMembers(m.workspaceId), teams };
  }));
  r.post(base, noStore, jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    const out = await createAssignments(res.locals.user as User, res.locals.membership as Membership, req.body);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    res.status(201).json(out.result);
  }));
  r.patch(`${base}/:id`, noStore, jsonOnly, requireWorkspaceMember(), h(async (req, res) => {
    const id = assignmentId(req.params.id);
    if (id == null) { res.status(400).json({ error: "Bad assignment id" }); return; }
    const out = await setAssignmentStatus(res.locals.user as User, res.locals.membership as Membership, id, req.body);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return { assignment: out.assignment, changed: out.changed };
  }));
  r.delete(`${base}/:id`, noStore, requireWorkspaceAdmin(), h(async (req, res) => {
    const id = assignmentId(req.params.id);
    if (id == null) { res.status(400).json({ error: "Bad assignment id" }); return; }
    const out = await deleteAssignment(res.locals.user as User, res.locals.membership as Membership, id);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return { deleted: id };
  }));
  return r;
}
