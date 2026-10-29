// The owner portal's API (/api/owner/*): response shapes shared by the server and the /owner page.
import type { Flag } from "./flags.js";
import type { BlurbAuthor } from "./powerRankings.js";
import type { TierCalibration } from "./ownerPredictions.js";

export interface OwnerOverview {
  accounts: { total: number; active30d: number; new7d: number };
  /** Accounts tied to a Control Point account. */
  controlPointLinked: number;
  /** null: workspaces haven't shipped on this server (no table yet). */
  workspaces: number | null;
  /** Scout spaces left read-only because their Control Point workspace was deleted or has no admin (Task 19). null: not on this database yet. */
  orphanedWorkspaces: number | null;
  scoutEntries: { personal: number; workspace: number | null };
  storage: { databaseBytes: number | null; databaseLocal: boolean; packsBytes: number | null; packFiles: number };
  inbox: { openFeedback: number; errorReports: number; unfiledErrors: number };
  health: {
    release: string | null; engineVersion: string; startedAt: string; uptimeSeconds: number;
    dataAsOf: string | null; statsAt: string | null; packsAt: string | null;
    /** Who holds the data writer lease right now (a sync, the live lane, an owner job). */
    writer: { what: string; until: string } | null;
    /** The live ledger's headline, as the public track record shows it (live once there are enough live calls,
     *  else the replay, said as such). Null while the track record can't be built. */
    ledger: { kind: "live" | "backtest"; season: number; accuracy: number; n: number } | null;
    /** The offline pack manifest (packs/latest.json); null when no pack was built on this server. */
    packManifest: { version: string; builtAt: string; dataAsOf: string | null; engineVersion: string } | null;
    /** Error reports seen in the last 24 hours / 7 days, and server errors (5xx) today (UTC) / the last 7 days. */
    errors: { reports24h: number; reports7d: number; server5xxToday: number; server5xx7d: number };
  };
}

export interface RouteStats { route: string; count: number; errors: number; avgMs: number; p50Ms: number | null; p95Ms: number | null; maxMs: number }
export interface OwnerUsage {
  days: number; from: string; to: string;
  daily: { day: string; requests: number; sync: number; errors: number }[];
  totals: { requests: number; sync: number; errors: number };
  busiest: RouteStats[];
  slowest: RouteStats[];
  live: { total: number; byKind: Record<string, number>; peak: number; peakAt: string | null };
  /** Page views from visitors who opted into usage statistics (analytics_daily), per day. */
  pageViews: { day: string; views: number }[];
}

export type LedgerKind = "live" | "backtest";
export interface DriftAlert {
  week: string; n: number; brier: number; baselineBrier: number; accuracy: number; baselineAccuracy: number;
  /** What tripped it. */
  reasons: ("brier" | "accuracy")[];
}
export interface PredictionHealth {
  kind: LedgerKind;
  season: number | null;
  /** Seasons with scored predictions of each kind (for the pickers). */
  available: { kind: LedgerKind; season: number; n: number }[];
  summary: { n: number; accuracy: number; brier: number; baselineBrier: number; logLoss: number } | null;
  /** 10 probability bins (red's win chance): mean predicted vs how often red won. */
  reliability: { lo: number; hi: number; n: number; predicted: number; actual: number }[];
  /** The same calls by confidence tier (provisional, moderate, confident: the tier shown with every call). */
  byTier: TierCalibration[];
  /** Week by week: how sure the favourite was on average (expected) vs how often it won (actual). */
  weekly: { week: string; n: number; expected: number; actual: number; brier: number }[];
  /** The latest window of calls vs the whole season. */
  rolling: { n: number; brier: number; accuracy: number; drifting: boolean } | null;
  alerts: DriftAlert[];
  thresholds: { brier: number; accuracy: number; minWeek: number; rollingWindow: number };
}

export interface FlagRow { name: Flag; enabled: boolean; updatedAt: string | null; updatedBy: string | null }

export type FeedbackStatus = "open" | "resolved" | "archived";
export interface FeedbackMessage {
  id: number; createdAt: string; topic: string; name: string | null; email: string; message: string;
  emailed: boolean; status: FeedbackStatus; statusAt: string | null;
}
/** One page, newest first; `more`: older messages follow (ask with ?before=<the last id>). */
export interface FeedbackList { messages: FeedbackMessage[]; counts: Record<FeedbackStatus, number>; more: boolean }

export type OpName = "resync" | "packs" | "caches";
export interface OpJob {
  op: OpName; state: "running" | "done" | "failed";
  startedAt: string; finishedAt: string | null; by: string;
  /** The latest progress line, or how it ended. */
  message: string | null;
}
export interface OpsStatus {
  jobs: Partial<Record<OpName, OpJob>>;
  writer: { what: string; until: string } | null;
  /** A data cycle this server process is running (the schedule's or an owner's). */
  cycle: { reason: string; since: string } | null;
  /** Ops this host can't run, and why (e.g. packs turned off). */
  unavailable: Partial<Record<OpName, string>>;
}

export interface AuditEntry {
  id: number; at: string; actor: string; action: string; details: Record<string, unknown> | null; result: string | null;
  /** For a change: the value it replaced and the value it set. Null for an action that starts something (a data job). */
  change: { from: unknown; to: unknown } | null;
}

/** One daily check of the current power-rankings week (server/powerRankings/refresh.ts). */
export interface OwnerPowerRankingsRefresh {
  /** "YYYY-MM-DD" (New York). */
  day: string;
  /** running: under way now; unchanged: only the Updated date moved; updated: changed entries were rewritten. */
  status: "running" | "unchanged" | "updated" | "failed";
  at: string;
  /** Teams whose shown facts changed; of their blurbs, how many Bruno rewrote, came from the template, or were your edits (kept). */
  changed: number;
  bruno: number;
  template: number;
  kept: number;
  note: string | null;
}

/** One automatically published power-rankings week, as the owner portal's Power rankings panel lists it. */
export interface OwnerPowerRankingsWeek {
  season: number;
  week: string;
  /** "YYYY-MM-DD" (New York) it went out. */
  published: string;
  /** "YYYY-MM-DD" (New York) of its last daily check; null when never checked. */
  updated: string | null;
  /** Its daily checks, newest first (the last 14). */
  refreshes: OwnerPowerRankingsRefresh[];
  /** pending: being written right now. */
  status: "pending" | "published" | "hidden";
  generatedAt: string;
  editedAt: string | null;
  /** The week's version: sent back with an edit, which is refused if the week changed since. */
  rev: string;
  /** A hand-written file covers this week, so the site shows that instead. */
  overridden: boolean;
  intro: string;
  introSource: BlurbAuthor;
  /** The week its movement was counted against. */
  comparedWith: string | null;
  entries: { rank: number; team: number; name: string | null; text: string; source: BlurbAuthor; rejected: string[] | null }[];
}

/** GET /api/owner/power-rankings. */
export interface OwnerPowerRankings {
  /** The autoPowerRankings switch. */
  enabled: boolean;
  /** Control Point (Bruno) is configured on this server; without it every blurb is the data-only template. */
  controlPoint: boolean;
  /** The next scheduled run (Friday 00:00 America/New_York), ISO. */
  nextRun: string;
  /** The daily refresh of the current week: its switch (dailyPowerRankings) and next check (00:00 America/New_York), ISO. */
  daily: { enabled: boolean; nextRun: string };
  /** The week the public page leads with now (the newest published, hand-written or automatic): its dates, whether
   *  it was generated, and whether it's this week's (false: the next one is due). Null before the first week. */
  current: { season: number; week: string; title: string; published: string; updated: string | null; generated: boolean; thisWeek: boolean } | null;
  /** Newest first. */
  weeks: OwnerPowerRankingsWeek[];
}

/** GET /api/owner/users: one account in the list. */
export interface OwnerUser {
  id: number; email: string | null; displayName: string | null; createdAt: string; lastSeen: string | null;
  /** Sign-in methods (email, google, control-point). */
  providers: string[];
  personalEntries: number;
  /** Control Point workspaces it belongs to; null before workspaces exist on this server. */
  workspaces: number | null;
}

/** GET /api/owner/users/:id */
export interface OwnerUserDetail {
  id: number; email: string | null; displayName: string | null; createdAt: string; lastSeen: string | null;
  signIns: string[];
  controlPointAccount: number | null;
  /** How many devices are signed in right now (unexpired sessions). A count only: no browser or device strings
   *  (the console shows account administration's minimum). */
  sessions: number;
  /** Personal data synced to the account: which keys, last changed (ms). */
  saved: { key: string; updatedAt: number }[];
  personalEntries: { count: number; lastUpdated: number | null };
  workspaces: { id: string; name: string; role: string; orphaned: boolean; authoredEntries: number | null }[];
}

/** GET /api/owner/workspaces: one Scout space. */
export interface OwnerWorkspace {
  id: string; name: string; createdAt: string;
  members: number | null; entries: number | null;
  /** ms */
  lastEntryAt: number | null;
  orphaned: { at: string; reason: string | null } | null;
}
