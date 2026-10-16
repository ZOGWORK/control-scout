// Scouting assignments (Task 10; docs/assignments.md): who in a workspace scouts which team at an
// event. Shared by the server (server/scout/assignments.ts) and the app (src/lib/assignments.ts).
//
// Permissions (enforced on the server):
//   create   workspace admins only (one team → several members, or many teams → one member, in one request)
//   done     the assignee, or an admin
//   reopen   admins only
//   delete   admins only
//   read     every member (the whole workspace's list: badges keep two people off the same team)

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
