// Scouting alliances (docs/alliances.md): two workspaces linked for one event share a union of entries and
// assignments and one consensus, then split again when the event ends. Shared between the server
// (server/scout/alliances.ts) and the Scout page.
import type { Assignment, MatchAssignment } from "./assignments";
import type { TeamConsensus } from "./consensus";
import type { PickList } from "./picklist";

/** pending: invited, not accepted yet. active: linked. ended: over (the event ended, unlinked, or never accepted). */
export type AllianceStatus = "pending" | "active" | "ended";
export type AllianceEndReason = "event_over" | "unlinked" | "cancelled" | "expired";

export interface AllianceSide {
  workspaceId: string;
  name: string;
  /** Agreed, at link time, that each side keeps a copy of the other's entries when the link ends. Null: hasn't answered (not accepted yet). */
  keepsCopies: boolean | null;
}

/** One link as one side's member reads it: `you` is the reader's workspace. */
export interface Alliance {
  id: number;
  season: number;
  eventCode: string;
  eventName: string | null;
  /** The event's last day (YYYY-MM-DD): the link ends after it. */
  endsOn: string;
  status: AllianceStatus;
  endedReason: AllianceEndReason | null;
  you: AllianceSide;
  /** Null while pending: nobody has accepted yet. */
  partner: AllianceSide | null;
  invitedByYou: boolean;
  /** ms */
  createdAt: number;
  acceptedAt: number | null;
  endedAt: number | null;
  /** Pending only: the invite code stops working after this (ms). */
  inviteExpiresAt: number | null;
  /** Both sides agreed to keep copies: true once the copies were made (the link ended). */
  copiesKept: boolean;
}

/** GET /api/scout/workspaces/:id/alliances */
export interface AlliancesResponse { alliances: Alliance[]; canManage: boolean }
/** POST /api/scout/workspaces/:id/alliances: the code is shown once (only its hash is kept). */
export interface AllianceInviteResponse { alliance: Alliance; code: string }

export type AllianceSideKey = "you" | "partner";

/** A live entry at the event, from either side. Read-only here: each stays its author's to edit, in its own workspace. */
export interface AllianceEntry {
  uuid: string;
  side: AllianceSideKey;
  workspaceId: string;
  team: number;
  kind: "match" | "pit";
  matchLabel: string | null;
  notes: string;
  data: Record<string, unknown>;
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
  /** Distinct teams with at least one entry from this side. */
  teams: number;
  /** Distinct match labels with at least one match entry from this side. */
  matches: number;
  /** Distinct authors. */
  scouts: number;
}

export interface TeamCoverage { team: number; name: string | null; you: number; partner: number }

/** Who contributed what. Shown, never enforced: a side that adds nothing still reads everything. */
export interface AllianceCoverage {
  you: CoverageSide;
  partner: CoverageSide;
  /** Every team at the event (its team list), plus any team scouted there that isn't on it; most scouted first. */
  teams: TeamCoverage[];
}

/** GET /api/scout/workspaces/:id/alliances/:allianceId/shared */
export interface AllianceShared {
  alliance: Alliance;
  entries: AllianceEntry[];
  assignments: (Assignment & { side: AllianceSideKey })[];
  matchAssignments: (MatchAssignment & { side: AllianceSideKey })[];
  coverage: AllianceCoverage;
}

/** GET /api/scout/workspaces/:id/alliances/:allianceId/consensus?teams=…: one consensus over both sides' entries at the event. */
export interface AllianceConsensusResponse { allianceId: number; season: number; eventCode: string; teams: TeamConsensus[] }

/** GET /api/scout/workspaces/:id/alliances/:allianceId/picklist: the partner's pick list, to read (the teams at the event). */
export interface AlliancePicklistResponse { allianceId: number; partnerName: string; list: PickList }

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
