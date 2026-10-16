// The owner portal's API (/api/owner/*): response shapes shared by the server and the /owner page.
import type { Flag } from "./flags.js";

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

export interface AuditEntry { id: number; at: string; actor: string; action: string; details: Record<string, unknown> | null; result: string | null }
