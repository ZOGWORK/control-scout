// Match video contributors (docs/contributors.md), shared by the server and the app: the visibility tiers, the
// words every surface uses, the report reasons, the application's agreements, and which video a match plays.
//
// Three tiers, decided on the server for each viewer:
//   public  a verified contributor's link: everyone, signed in or not
//   team    an unverified contributor's link for one of their teams (Control Point membership or the owner's
//           roster, never the self-set My team): that team's signed-in members, and the contributor
//   self    the contributor alone (a link that has lost its team or its public trust)
// A viewer who may not see a link gets nothing about it: no video id, no thumbnail, no count, no credit.
import type { SearchVideoItem } from "./api.js";

export type VideoTier = "public" | "team" | "self";
export type ContributorStatus = "none" | "pending" | "verified" | "revoked" | "rejected";
export type ContributorSource = "invite" | "application" | "direct";

/** A contributor's link as a viewer entitled to it gets it: the credit is the actual name, never the username or email. */
export interface ContributorVideo {
  id: number;
  videoId: string;
  /** Second to start from (a t= in the pasted link). */
  t: number;
  tier: VideoTier;
  /** The team a team-only link is for (also on a public one: the team it falls back to). */
  team: number | null;
  /** "Parthiv": the contributor's actual name as it is now. */
  name: string;
  /** Verified now (the badge). Never true on a team or self link. */
  verified: boolean;
  /** The contributor's profile (/contributors/<username>). */
  profile: string | null;
  likes: number;
  /** This viewer likes it (signed in only). */
  liked: boolean;
  /** This viewer added it (Edit / Remove instead of Report). */
  mine: boolean;
  /** The owner chose it over FIRST's own video of the match. */
  overFirst?: boolean;
}

/** One match's contributor video for a viewer, by the match's key ("qual:0:6"). */
export type ContributorVideoMap = Record<string, ContributorVideo>;

/** How much of an event a viewer can watch: played matches, and those with a video this viewer can see. */
export interface EventCoverage { played: number; withVideo: number }

export interface EventContributorVideos {
  matches: ContributorVideoMap;
  coverage: EventCoverage;
}

// --- Words ------------------------------------------------------------------------------------------------

export const tierLabel = (v: Pick<ContributorVideo, "tier" | "team">, teamName?: string | null): string =>
  v.tier === "public" ? "Public — everyone can see this"
    : v.tier === "team" ? `Team only — ${teamName ? `${teamName} (${v.team})` : `team ${v.team}`}`
      : "Only you can see this";

/** Said of an event with a recording to watch but no match placed in it (its timing can't be checked yet). */
export const RECORDING_ONLY_TEXT = "Full recording only — no match clips in it yet";

/** Said of an event whose linked recording YouTube won't play (private, removed): there is one, it just can't be watched. */
export const UNPLAYABLE_TEXT = "This event's recording won't play (private or removed) — stats only";

/** The event page's coverage line ("No recording …" is the same words the search page uses for an event with none).
 *  `recorded`: the event has a recording to watch (the page's player), so none of its matches having a clip never reads
 *  as no recording at all. */
export function coverageText(c: EventCoverage, recorded = false, unplayable = false): string {
  if (!c.played || !c.withVideo) return recorded && c.played ? RECORDING_ONLY_TEXT : unplayable ? UNPLAYABLE_TEXT : "No recording for this event — stats only.";
  if (c.withVideo >= c.played) return "Every match has video";
  return `Partially recorded — ${c.withVideo} of ${c.played} matches have video`;
}

export const PENDING_TEXT = "Review Pending — check back within 1 or 2 business days";
export const NOT_APPROVED_TEXT = "Not approved this time — you can re-apply after 7 days";
export const DISCOVERY_NOTE = "Team only hides this video on Control Scout. It stays an ordinary YouTube link: anyone who has the link itself can still watch it on YouTube.";

// --- Limits -----------------------------------------------------------------------------------------------

export const INVITE_DAYS = 14;
export const REJECT_COOLDOWN_DAYS = 7;
export const APPLICATIONS_PER_30_DAYS = 3;
export const LINKS_PER_DAY = 20;
export const LINKS_PER_MATCH_PER_DAY = 5;
/** Over this a link looks like a full stream, not one match (a warning, never a refusal). */
export const LONG_VIDEO_S = 600;
export const TEXT_MAX = 500;
export const WHY_MIN = 20;
/** Open reports on one link that flag it for priority review. It still stays up: nothing hides on reports. */
export const REPORT_FLAG_AT = 5;

// --- Reports (the scouting commons' shape: fixed reasons, an optional note, one open per reporter) ---------

export const VIDEO_REPORT_REASONS = ["wrong_match", "wrong_event", "not_a_match_video", "poor_quality", "noisy_audio", "other"] as const;
export type VideoReportReason = (typeof VIDEO_REPORT_REASONS)[number];
export const VIDEO_REPORT_REASON_LABEL: Record<VideoReportReason, string> = {
  wrong_match: "Wrong match — this isn't the match shown",
  wrong_event: "Wrong event",
  not_a_match_video: "Not a match video at all",
  poor_quality: "Unclear / bad quality",
  noisy_audio: "Noisy audio",
  other: "Something else",
};
export const isVideoReportReason = (v: unknown): v is VideoReportReason => typeof v === "string" && (VIDEO_REPORT_REASONS as readonly string[]).includes(v);

// --- The application ("Get Verified") -------------------------------------------------------------------

export const APPLICANT_ROLES = ["student", "mentor", "parent", "volunteer", "other"] as const;
export type ApplicantRole = (typeof APPLICANT_ROLES)[number];
export const APPLICANT_ROLE_LABEL: Record<ApplicantRole, string> = { student: "Student", mentor: "Mentor", parent: "Parent", volunteer: "Volunteer", other: "Other" };

export const RECORDED_CHOICES = ["recorded_myself", "have_permission"] as const;
export type RecordedChoice = (typeof RECORDED_CHOICES)[number];
export const RECORDED_LABEL: Record<RecordedChoice, string> = { recorded_myself: "I recorded this myself", have_permission: "My team gives me permission to share it" };

/** All five, each ticked by hand: an application with any unticked never exists. */
export const AGREEMENTS = [
  ["own", "I will only add videos I recorded myself, or that my team gives me permission to share."],
  ["correct", "I will only link the correct match and the correct event."],
  ["noSpam", "I will not add misleading, spam, or non-FTC videos."],
  ["removable", "I understand my links can be removed, and my verification can be revoked, if I break these rules."],
  ["publicName", "I understand my actual name will show publicly on videos I add."],
] as const;
export type AgreementKey = (typeof AGREEMENTS)[number][0];

export interface ApplicationInput {
  teamNumber: number | null;
  teamName: string;
  role: ApplicantRole | "";
  roleOther: string;
  events: string;
  channelUrl: string;
  sampleUrl: string;
  recorded: RecordedChoice | "";
  why: string;
  extra: string;
  agreements: Partial<Record<AgreementKey, boolean>>;
}

/** The form's fields, for errors keyed to the field that failed. */
export type ApplicationField = "teamNumber" | "teamName" | "role" | "roleOther" | "events" | "channelUrl" | "sampleUrl" | "recorded" | "why" | "extra" | "agreements";

// --- The contributor's own status --------------------------------------------------------------------------

export interface MembershipTeam { number: number; name: string | null; sources: ("controlPoint" | "roster")[] }

export interface MyContributorStatus {
  status: ContributorStatus;
  source: ContributorSource | null;
  /** The teams the server counts this account on (Control Point workspaces and the owner's roster). */
  teams: MembershipTeam[];
  /** A pending request: when it was sent, and how (an invite claim or an application). */
  pending: { since: string; source: ContributorSource } | null;
  /** After a rejection: the reason the owner chose to share (null: none given), and when they may apply again. */
  rejected: { reason: string | null; reapplyAfter: string | null } | null;
  /** The account has both a username and an actual name (publishing needs both). */
  ready: boolean;
  /** "Video by …" as their videos will show it, when they have a name. */
  credit: string | null;
}

// --- A contributor's profile (/contributors/<username>) ----------------------------------------------------------

export interface ProfileVideo extends ContributorVideo { season: number; code: string; key: string; label: string; event: string; red: number | null; blue: number | null; href: string }
export interface ContributorProfile {
  name: string; username: string; verified: boolean; status: "verified" | "team" | "none";
  teams: { number: number; name: string | null }[];
  videos: ProfileVideo[];
  /** Likes on the videos THIS viewer can see (two viewers may see different totals). */
  likes: number;
  pending: boolean;
}


/** An invite link's state, as /verify-video reads it. */
export type InviteState = "valid" | "claimed" | "expired" | "revoked" | "invalid";
export interface InviteRead { state: InviteState; mine?: boolean; expiresAt?: string }

// --- Which video a match plays (one place, for every surface) -------------------------------------------------

/**
 * The video a match plays for a viewer, first that exists: FIRST's own video, a contributor's link this viewer may
 * see (public before team: the server sends the one that wins), the match's second in the event's recording, the
 * recording from its start. The viewer's own saved links stay in their own panel. `overFirst`: the owner chose this
 * contributor video over FIRST's for the match.
 */
export function pickMatchVideo<F, C extends { overFirst?: boolean; tier?: VideoTier }, R>(first: F | null | undefined, contributor: C | null | undefined, recording: R | null | undefined):
  { kind: "first"; video: F } | { kind: "contributor"; video: C } | { kind: "recording"; video: R } | null {
  // A link only its contributor can see is their own, like a personal link: after the recording.
  const own = contributor?.tier === "self";
  if (contributor && contributor.overFirst && !own) return { kind: "contributor", video: contributor };
  if (first) return { kind: "first", video: first };
  if (contributor && !own) return { kind: "contributor", video: contributor };
  if (recording) return { kind: "recording", video: recording };
  if (contributor) return { kind: "contributor", video: contributor };
  return null;
}

/** A contributor video as a search answer's video item (the same player, the credit carried along). */
export function contributorItem(v: ContributorVideo, match: string): SearchVideoItem {
  return { videoId: v.videoId, t: v.t, kind: "contributor", match, contributor: { id: v.id, name: v.name, verified: v.verified, profile: v.profile, likes: v.likes, liked: v.liked, mine: v.mine, tier: v.tier } };
}
