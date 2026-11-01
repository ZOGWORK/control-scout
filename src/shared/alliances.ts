// Scouting alliances (docs/alliances.md): any number of workspaces linked for one event share a union of entries and
// assignments and one consensus, then split again when the event ends. Shared between the server
// (server/scout/alliances.ts) and the Scout page.
import type { Assignment, MatchAssignment } from "./assignments";
import type { TeamConsensus } from "./consensus";
import type { PickList } from "./picklist";

/** pending: started, nobody has joined yet. active: two or more workspaces in it. ended: over (for everyone, or for the reader's workspace). */
export type AllianceStatus = "pending" | "active" | "ended";
/**
 * event_over, unlinked (its creator ended it, or too few were left), cancelled (ended before anyone joined), expired
 * (nobody joined before the code ran out); for one workspace only: left (it left), removed (the creator removed it).
 */
export type AllianceEndReason = "event_over" | "unlinked" | "cancelled" | "expired" | "left" | "removed";

/** At most this many workspaces in one alliance (each gets its own colour on the Scout page). */
export const MAX_ALLIANCE_MEMBERS = 8;

export interface AllianceMember {
  workspaceId: string;
  name: string;
  /** Agreed, when it joined, to keep a copy of the others' entries when the link ends (copies go only between workspaces that both agreed). */
  keepsCopies: boolean;
  /** Started the alliance (or took it over when its creator left): invites and removes. */
  creator: boolean;
  /** ms */
  joinedAt: number;
}

/** One alliance as one member workspace's people read it: `you` is the reader's workspace. */
export interface Alliance {
  id: number;
  season: number;
  eventCode: string;
  eventName: string | null;
  /** The event's last day (YYYY-MM-DD): the link ends after it. */
  endsOn: string;
  /** For the reader's workspace: ended once it left or was removed, even while the others carry on. */
  status: AllianceStatus;
  endedReason: AllianceEndReason | null;
  you: AllianceMember;
  /** Every workspace in it now (the reader's too, unless it left), in the order they joined. */
  members: AllianceMember[];
  /** ms */
  createdAt: number;
  endedAt: number | null;
  /** The creator only, while its invite code works: when it stops (ms). */
  inviteExpiresAt: number | null;
  /** Copies were agreed and have been made (the link ended). */
  copiesKept: boolean;
}

/** GET /api/scout/workspaces/:id/alliances */
export interface AlliancesResponse { alliances: Alliance[]; canManage: boolean }
/** POST /api/scout/workspaces/:id/alliances, and …/:allianceId/invite: the code is shown once (only its hash is kept). */
export interface AllianceInviteResponse { alliance: Alliance; code: string }

export interface AllianceAnswer { label: string; text: string }

/** A live entry at the event, from any member. Read-only here: each stays its author's to edit, in its own workspace. */
export interface AllianceEntry {
  uuid: string;
  /** The member workspace it belongs to. */
  workspaceId: string;
  team: number;
  kind: "match" | "pit";
  matchLabel: string | null;
  notes: string;
  /** The answered questions, labelled by the template the entry was made with (its own workspace's). */
  answers: AllianceAnswer[];
  updatedAt: number;
  authorAccountId: number;
  authorDisplayName: string;
}

export interface CoverageSide {
  workspaceId: string;
  name: string;
  entries: number;
  matchEntries: number;
  pitEntries: number;
  /** Distinct teams with at least one entry from this member. */
  teams: number;
  /** Distinct match labels with at least one match entry from this member. */
  matches: number;
  /** Distinct authors. */
  scouts: number;
}

/** Entries per member for one team (workspace id -> count; a member with none is left out). */
export interface TeamCoverage { team: number; name: string | null; total: number; byMember: Record<string, number> }

/** Who contributed what. Shown, never enforced: a member that adds nothing still reads everything. */
export interface AllianceCoverage {
  /** One per member read here, in the alliance's member order. */
  members: CoverageSide[];
  /** Every team at the event (its team list), plus any team scouted there that isn't on it; most scouted first. */
  teams: TeamCoverage[];
}

/** GET /api/scout/workspaces/:id/alliances/:allianceId/shared */
export interface AllianceShared {
  alliance: Alliance;
  entries: AllianceEntry[];
  /** Every member's, each with its own workspaceId. */
  assignments: Assignment[];
  matchAssignments: MatchAssignment[];
  coverage: AllianceCoverage;
}

/** GET /api/scout/workspaces/:id/alliances/:allianceId/consensus?teams=…: one consensus over every member's entries at the event. */
export interface AllianceConsensusResponse { allianceId: number; season: number; eventCode: string; teams: TeamConsensus[] }

/** GET /api/scout/workspaces/:id/alliances/:allianceId/picklist?workspace=…: another member's pick list, to read (only the teams on the event's team list). */
export interface AlliancePicklistResponse {
  allianceId: number; workspaceId: string; name: string;
  /** The event has a team list: without one no picks are sent (never the member's whole season). */
  teamsKnown: boolean;
  list: PickList;
}

/** Invite codes: 10 letters and digits that can't be misread, shown as XXXXX-XXXXX. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 10;
/** "abcde fghjk", "ABCDE-FGHJK" -> "ABCDEFGHJK"; null when it can't be a code. */
export function normalInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, "");
  if (c.length !== INVITE_CODE_LENGTH) return null;
  return [...c].every((ch) => INVITE_ALPHABET.includes(ch)) ? c : null;
}
export const formatInviteCode = (c: string) => `${c.slice(0, 5)}-${c.slice(5)}`;

/** How long an invite code works (it also stops when the event ends). */
export const INVITE_TTL_MS = 7 * 24 * 3600_000;
/**
 * When a link for an event ending on `endsOn` (YYYY-MM-DD, the venue's date) ends: a day and a half after that
 * date starts in UTC, so the last day is over in every timezone an FTC event runs in.
 */
export const allianceEndsAt = (endsOn: string) => Date.parse(`${endsOn}T00:00:00Z`) + 36 * 3600_000;

export const ALLIANCE_ENDED = "alliance_ended";
