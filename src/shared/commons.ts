// The scouting commons (docs/scouting-commons.md): pit entries a workspace shares with every signed-in Scout user
// at an event, credited to the workspace. Shared by the server (server/scout/commons.ts) and the web app.
import type { TeamConsensus } from "./consensus";
import type { ScoutField } from "./scoutTemplate";

/** Where a commons entry came from: the workspace's own name, never a person's. `id` is opaque (not Control Point's id). */
export interface CommonsSource { id: number; name: string }

/** A photo on a commons entry: viewed through /api/scout/commons/photos/:id, with the workspace photo's caps and expiry. */
export interface CommonsPhoto { id: string; createdAt: number; expired: boolean }

export interface CommonsEntry {
  /** `${source.id}:${uuid}`: stable, and what a report names. */
  id: string;
  source: CommonsSource;
  season: number; eventCode: string; team: number;
  data: Record<string, unknown>;
  notes: string;
  /** The pit fields of the template the entry was made with (its workspace's, else the built-in), to read `data` with. */
  fields: ScoutField[];
  /** When the entry was last edited (the scout's clock): how old the pit claim is. */
  scoutedAt: number;
  /** When the workspace shared it. */
  publishedAt: number;
  photos: CommonsPhoto[];
}

/** An event the commons is switched on for, as the read names it. */
/** `timezone`: the event's IANA zone (null: unknown), so "before this event" means before its first day where it is held. */
export interface CommonsEvent { code: string; name: string; start: string | null; end: string | null; timezone: string | null }

/** GET /api/scout/commons?season=&team=[&event=]. */
export interface CommonsAnswer {
  season: number; team: number;
  /** The events read: the one asked for, or every event of the season the commons is on for. */
  events: CommonsEvent[];
  /** Newest scouted first. Never the reader's own workspaces' entries (those show as their own scouting). */
  entries: CommonsEntry[];
  /**
   * The entries rolled up like a workspace's consensus (src/shared/consensus.ts), pit fields only. A separate,
   * labelled layer: a page shows the reader's own workspace's take first. Each source workspace counts as one
   * scout (`scouts` is how many workspaces shared).
   */
  layer: TeamConsensus;
  /** Entries left out because they came from one of the reader's own workspaces. */
  ownHidden: number;
  /** Source workspaces this reader muted (their entries left out here), to unmute from the page. */
  muted: CommonsSource[];
}

/** removed: taken down by the owner (only the owner restores it). */
export type CommonsStatus = "published" | "withdrawn" | "removed";

/** One of the workspace's own entries as shared, for its members. */
export interface CommonsShare { uuid: string; status: CommonsStatus; publishedAt: number; eventCode: string; team: number; removedReason: string | null }

/** GET /api/scout/workspaces/:id/commons (members). */
export interface WorkspaceCommons {
  workspaceId: string;
  /** The admins' opt-in. Off (the default): nothing of this workspace is shared, whatever an entry says. */
  optedIn: boolean;
  updatedAt: string | null; updatedBy: string | null;
  /** The owner suspended the workspace from the commons: nothing it shared shows, and it can't share. Null: not suspended. */
  suspended: { at: string; reason: string } | null;
  shares: CommonsShare[];
}

/** Why a publish was refused (the 4xx body's `code`). */
export type CommonsRefusal = "not_opted_in" | "not_pit" | "no_event" | "event_off" | "no_entry" | "forbidden" | "removed" | "suspended";

export const COMMONS_REFUSAL: Record<CommonsRefusal, string> = {
  not_opted_in: "Your workspace hasn't joined the scouting commons. An admin can switch it on in Settings.",
  not_pit: "Only pit entries can be shared. Match scouting always stays inside your workspace.",
  no_event: "Pick the event this pit entry is from first: the commons is per event.",
  event_off: "The scouting commons isn't open at this event.",
  no_entry: "That entry isn't on the server yet (or was deleted). Let it sync, then share it.",
  forbidden: "Only the entry's author or a workspace admin can share or unshare it.",
  removed: "This entry was taken down from the scouting commons by Control Scout, so it can't be shared again.",
  suspended: "Your workspace is suspended from the scouting commons, so nothing it shares is shown. Contact Control Scout if you think that's a mistake.",
};

/** Why a reader reports a shared entry. */
export const REPORT_REASONS = ["wrong", "outdated", "inappropriate", "other"] as const;
export type CommonsReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABEL: Record<CommonsReportReason, string> = {
  wrong: "Wrong about this robot",
  outdated: "Out of date: the robot changed",
  inappropriate: "Inappropriate or not scouting",
  other: "Something else",
};
export const isReportReason = (x: unknown): x is CommonsReportReason => typeof x === "string" && (REPORT_REASONS as readonly string[]).includes(x);
export const REPORT_NOTE_MAX = 500;

/** The owner console's report queue: one row per reported entry, its open reports gathered. */
export interface CommonsReportGroup {
  /** `${source.id}:${uuid}`, as CommonsEntry.id. */
  entryId: string;
  source: CommonsSource;
  season: number; eventCode: string; team: number;
  /** The entry as readers saw it (null: deleted since). */
  notes: string | null; scoutedAt: number | null;
  status: CommonsStatus | null;
  /** Its answers, with the pit fields to read them by, and its photos (none once deleted). */
  data: Record<string, unknown>; fields: ScoutField[]; photos: CommonsPhoto[];
  reports: { id: number; reason: CommonsReportReason; note: string; createdAt: string }[];
}

/** An entry the owner took down (GET /api/owner/commons/reports, `removed`). */
export interface CommonsRemoved { entryId: string; source: CommonsSource; season: number; eventCode: string; team: number; removedAt: string; removedBy: string; reason: string }

/** GET /api/owner/commons/reports, and every moderation action's answer. */
export interface CommonsModeration { reports: CommonsReportGroup[]; removed: CommonsRemoved[]; /** Older takedowns remain (GET /api/owner/commons/removed). */ removedMore: boolean }

/** The owner console's list of workspaces that have joined the commons. */
export interface CommonsWorkspaceRow { source: CommonsSource; optedIn: boolean; shared: number; removed: number; suspended: { at: string; by: string; reason: string } | null }
