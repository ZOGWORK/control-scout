// Scouting assignments (Task 10; docs/assignments.md): who in a workspace scouts which team at an
// event. Shared by the server (server/scout/assignments.ts) and the app (src/lib/assignments.ts).
//
// Permissions (enforced on the server):
//   create   workspace admins only (one team → several members, or many teams → one member, in one request)
//   done     the assignee, or an admin
//   reopen   admins only
//   delete   admins only
//   read     every member (the whole workspace's list: badges keep two people off the same team)
import { normalizeMatchLabel, parseWatching, SLOTS, type SlotId, type Watching } from "./scoutMatch.js";

export type AssignmentStatus = "open" | "done";

export interface Assignment {
  id: number;
  workspaceId: string;
  season: number;
  eventCode: string;
  team: number;
  assigneeAccountId: number;
  assigneeName: string;
  createdByAccountId: number;
  createdByName: string;
  /** ms */
  createdAt: number;
  status: AssignmentStatus;
  doneAt: number | null;
  doneByAccountId: number | null;
  doneByName: string | null;
  /** 1 when created, +1 on every status change: of two copies, the higher version is the newer. */
  version: number;
  /** Entries the assignee has made for this team at this event (this season, not deleted), as the server counts them. */
  progress: number;
}

/** A member who can be assigned: only members who have signed in to Scout are known to it (the membership cache). */
export interface AssignableMember { accountId: number; name: string; role: "admin" | "member" }
export interface EventTeamOption { team: number; name: string | null }

/** POST body: every team × every assignee. */
export interface CreateAssignmentsBody { season: number; eventCode: string; teams: number[]; assigneeAccountIds: number[] }

/** A team now held by more than one member at the event: a warning, never a refusal. */
export interface DuplicateWarning { team: number; assignees: { accountId: number; name: string }[] }

export interface CreateAssignmentsResult {
  created: Assignment[];
  /** Pairs already assigned (same member, team and event): nothing new made. */
  existing: Assignment[];
  duplicates: DuplicateWarning[];
}

/** The live stream's `event: assignment` (no id): what changed, as the list now has it. */
export interface AssignmentNotice { action: "created" | "updated" | "deleted"; assignments: Assignment[] }

/** At most this many assignments (teams × assignees) in one request. */
export const MAX_BULK = 200;

export const normalEventCode = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const c = s.trim().toUpperCase();
  return /^[A-Z0-9_-]{1,24}$/.test(c) ? c : null;
};

/** The key badges look assignments up by. */
export const assignmentKey = (season: number, eventCode: string | null | undefined, team: number) => `${season}:${(eventCode ?? "").toUpperCase()}:${team}`;

export const isAssignment = (x: unknown): x is Assignment => {
  const a = x as Assignment;
  return !!a && Number.isSafeInteger(a.id) && typeof a.workspaceId === "string" && Number.isSafeInteger(a.season) && typeof a.eventCode === "string"
    && Number.isSafeInteger(a.team) && Number.isSafeInteger(a.assigneeAccountId) && (a.status === "open" || a.status === "done");
};

// --- Match scouting (the Scout redesign) ---------------------------------------------------------
// A second kind: a member watches a slot, an alliance or all four teams for a run of qualification matches
// ("Priya: Red 1, Q1–Q30", "Marcus: Blue alliance, Q15 on"). Pit scouting keeps the team assignments above.
// Admins create, edit and delete them; every member reads the list. Done is worked out per match from the
// entries (src/lib/slotAssignments.ts), so these have no status of their own.

export interface MatchAssignment {
  id: number;
  workspaceId: string;
  season: number;
  eventCode: string;
  watching: Watching;
  /** First qual watched ("Q1"), or null from the first. */
  fromMatch: string | null;
  /** Last qual watched ("Q30"), or null to the end of quals. */
  toMatch: string | null;
  assigneeAccountId: number;
  assigneeName: string;
  createdByAccountId: number;
  createdByName: string;
  /** ms */
  createdAt: number;
  updatedAt: number;
  /** 1 when created, +1 on every edit: of two copies, the higher version is the newer. */
  version: number;
}

/** POST body, and PATCH (every field, as the assignment should now be). */
export interface MatchAssignmentBody {
  season: number; eventCode: string; watching: Watching; fromMatch: string | null; toMatch: string | null; assigneeAccountId: number;
}

/** POST / PATCH answer: the assignment, and others at the event that watch the same slots in the same matches (a warning, never a refusal). */
export interface MatchAssignmentResult { matchAssignment: MatchAssignment; overlaps: MatchAssignment[] }

/** The live stream's `event: match-assignment` (no id). */
export interface MatchAssignmentNotice { action: "created" | "updated" | "deleted"; matchAssignments: MatchAssignment[] }

/** A qual's number from any spelling ("q12", "Q 012" → 12); null for anything else (playoffs, practice, junk). */
export function qualNumber(label: string | null | undefined): number | null {
  const n = normalizeMatchLabel(label);
  const m = n ? /^Q(\d+)$/.exec(n) : null;
  return m ? Number(m[1]) : null;
}

/** "Q1–Q30", "Q15 on", "Up to Q40", "All quals". */
export function matchRangeLabel(from: string | null, to: string | null): string {
  if (from && to) return from === to ? from : `${from}–${to}`;
  if (from) return `${from} on`;
  if (to) return `Up to ${to}`;
  return "All quals";
}

/** Whether an assignment covers a match: quals only, from ≤ n ≤ to (open ends reach the first and last qual). */
export function coversMatch(a: Pick<MatchAssignment, "fromMatch" | "toMatch">, label: string | null | undefined): boolean {
  const n = qualNumber(label);
  if (n == null) return false;
  const from = qualNumber(a.fromMatch), to = qualNumber(a.toMatch);
  return (from == null || n >= from) && (to == null || n <= to);
}

/** The slots a watching value covers. */
export function slotsOf(w: Watching): SlotId[] {
  return w.kind === "all" ? [...SLOTS] : w.kind === "alliance" ? SLOTS.filter((s) => s.startsWith(w.side)) : [w.slot];
}

/** Two assignments at the same event that watch a common slot in a common match. */
export function matchAssignmentsOverlap(a: Pick<MatchAssignment, "season" | "eventCode" | "watching" | "fromMatch" | "toMatch">, b: Pick<MatchAssignment, "season" | "eventCode" | "watching" | "fromMatch" | "toMatch">): boolean {
  if (a.season !== b.season || a.eventCode !== b.eventCode) return false;
  const bs = slotsOf(b.watching);
  if (!slotsOf(a.watching).some((s) => bs.includes(s))) return false;
  const lo = (x: string | null) => qualNumber(x) ?? 1, hi = (x: string | null) => qualNumber(x) ?? Infinity;
  return lo(a.fromMatch) <= hi(b.toMatch) && lo(b.fromMatch) <= hi(a.toMatch);
}

export const isMatchAssignment = (x: unknown): x is MatchAssignment => {
  const a = x as MatchAssignment;
  return !!a && Number.isSafeInteger(a.id) && typeof a.workspaceId === "string" && Number.isSafeInteger(a.season) && typeof a.eventCode === "string"
    && Number.isSafeInteger(a.assigneeAccountId) && parseWatching(a.watching) != null
    && (a.fromMatch === null || typeof a.fromMatch === "string") && (a.toMatch === null || typeof a.toMatch === "string");
};
