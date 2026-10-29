// The owner console's Data & sync and Packs & offline sections (/api/owner/data, /api/owner/packs):
// response shapes shared by the server and the /owner page. Both are read-only reports; the actions
// (re-sync, rebuild packs) are the confirm-gated data ops in shared/owner.ts.

/** One season's sync bookkeeping (the seasons table, the last sync run's report, and counts from the data). */
export interface SeasonSync {
  season: number; label: string; game: string;
  current: boolean;
  /** A finished season with every event fetched: the sync skips it. */
  frozen: boolean;
  /** The last sync run that reached this season, and the last one that fetched every event it planned. */
  lastSync: string | null; lastComplete: string | null;
  /** When FIRST's team list for the season was last read (weekly at most). */
  teamsAt: string | null;
  events: number;
  /** Events whose matches, rankings and awards have been fetched at least once. */
  eventsDetailed: number;
  /** Events whose detail came from the fallback source instead of FIRST. */
  fallbackEvents: number;
  matchesPlayed: number;
  /** What the last sync run did for this season (null: no run recorded since the report started). */
  lastRun: { listed: number; detailed: number; failed: number; fallback: number; teams: number } | null;
}

export type DataFlagId = "sync-failures" | "ended-no-matches" | "record-mismatch" | "season-below-events" | "sitemap-404";

/** One data-quality check: how many rows it found and the first few, for triage (nothing is changed from here). */
export interface DataFlag {
  id: DataFlagId;
  title: string;
  /** What the check looks for, and what to do about a hit. */
  description: string;
  count: number;
  /** Up to DATA_FLAG_EXAMPLES rows, the most recent or worst first. */
  examples: { label: string; detail: string | null; href: string | null }[];
  /** The check couldn't run (and why); count is 0 then. */
  error: string | null;
}

export const DATA_FLAG_EXAMPLES = 8;

export interface OwnerDataReport {
  /** When this report was computed (it's kept for a few minutes; ?fresh=1 computes it again). */
  computedAt: string;
  currentSeason: number;
  timestamps: { syncAt: string | null; statsAt: string | null; recordsAt: string | null; packsAt: string | null };
  seasons: SeasonSync[];
  flags: DataFlag[];
}

export interface PackFileRow {
  name: string; url: string; kind: "lite" | "full";
  /** The season of a full pack; null for the lite pack (every rated season, listed in `seasons`). */
  season: number | null;
  seasons: number[];
  bytes: number; sha256: string;
  /** Whether the file the manifest lists is on this server's disk. */
  onDisk: boolean;
}

export interface OwnerPacks {
  /** Packs can't be built on this host (CS_PACKS=off), and why; null when they can. */
  unavailable: string | null;
  /** The offline packs feature switch: off means every pack URL answers 503. */
  serving: boolean;
  manifest: { format: number; version: string; builtAt: string; engineVersion: string; dataAsOf: string | null } | null;
  files: PackFileRow[];
  totalBytes: number;
  /** Releases kept on disk (the newest few stay, so a device mid-download still finishes). */
  versionsOnDisk: string[];
  /** When the last build finished (kv packs:last). */
  lastBuildAt: string | null;
}
