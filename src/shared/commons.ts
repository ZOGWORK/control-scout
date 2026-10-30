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
}

export type CommonsStatus = "published" | "withdrawn";

/** One of the workspace's own entries as shared, for its members. */
export interface CommonsShare { uuid: string; status: CommonsStatus; publishedAt: number; eventCode: string; team: number }

/** GET /api/scout/workspaces/:id/commons (members). */
export interface WorkspaceCommons {
  workspaceId: string;
  /** The admins' opt-in. Off (the default): nothing of this workspace is shared, whatever an entry says. */
  optedIn: boolean;
  updatedAt: string | null; updatedBy: string | null;
  shares: CommonsShare[];
}

/** Why a publish was refused (the 4xx body's `code`). */
export type CommonsRefusal = "not_opted_in" | "not_pit" | "no_event" | "event_off" | "no_entry" | "forbidden";

export const COMMONS_REFUSAL: Record<CommonsRefusal, string> = {
  not_opted_in: "Your workspace hasn't joined the scouting commons. An admin can switch it on in Settings.",
  not_pit: "Only pit entries can be shared. Match scouting always stays inside your workspace.",
  no_event: "Pick the event this pit entry is from first: the commons is per event.",
  event_off: "The scouting commons isn't open at this event.",
  no_entry: "That entry isn't on the server yet (or was deleted). Let it sync, then share it.",
  forbidden: "Only the entry's author or a workspace admin can share or unshare it.",
};
