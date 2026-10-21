// The stat catalog behind the records pages (/api/records/…): every stat a
// table can filter, sort or show, shared by the server (SQL whitelist) and
// the web app (stat picker, column picker, CSV headers).
//
// Keys are part of shareable URLs (`?filter=and-autoPointsAvg.gte.30-`), so
// they are stable forever: never rename or reuse one, only add. Score-stat
// keys follow FTC Scout's names (`totalPointsOpr`, `penaltyPointsCommittedTot`)
// so a filter written for one site reads the same on the other.

import type { ConfidenceTier } from "./api";

/** Which kind of record a stat describes. */
export type RecordScope = "teamEvent" | "teamSeason" | "match";
export const RECORD_SCOPES: readonly RecordScope[] = ["teamEvent", "teamSeason", "match"];

export type StatType = "number" | "text";

export type StatCategory = "Team" | "Event" | "Event Performance" | "Score Stats" | "Match Scores" | "Control Scout Exclusives";
/** Picker order. */
export const STAT_CATEGORIES: readonly StatCategory[] = ["Team", "Event", "Event Performance", "Score Stats", "Match Scores", "Control Scout Exclusives"];

/** Score-stat aggregates: TOT total, AVG average, OPR, MIN, MAX, DEV (population standard deviation). */
export type Aggregate = "Tot" | "Avg" | "Opr" | "Min" | "Max" | "Dev";
export const AGGREGATES: readonly Aggregate[] = ["Tot", "Avg", "Opr", "Min", "Max", "Dev"];
export const AGGREGATE_LABELS: Record<Aggregate, string> = { Tot: "TOT", Avg: "AVG", Opr: "OPR", Min: "MIN", Max: "MAX", Dev: "DEV" };

/**
 * Per-alliance score parts that every season stores. Score breakdowns finer
 * than this (leave/park, majors/minors) aren't in our database, so they
 * aren't offered — the catalog never lists a stat we can't compute.
 */
export const SCORE_STATS = [
  { base: "totalPoints", label: "Total Points", description: "Alliance score including penalty points received." },
  { base: "totalPointsNp", label: "Total Points NP", description: "Alliance score without penalty points." },
  { base: "autoPoints", label: "Auto Points", description: "Autonomous period points." },
  { base: "dcPoints", label: "DC Points", description: "Driver-controlled (TeleOp) points as FIRST reports them (from 2024 this includes the endgame)." },
  { base: "endgamePoints", label: "Endgame Points", description: "End-of-match points (park, ascent, base…), also counted in DC from 2024." },
  { base: "penaltyPointsCommitted", label: "Penalty Points", description: "Penalty points the alliance gave away (credited to the opponent)." },
  { base: "penaltyPointsByOpp", label: "Opp Penalty Points", description: "Penalty points the opponent gave away (credited to this alliance)." },
] as const;
export type ScoreStatBase = (typeof SCORE_STATS)[number]["base"];

export interface StatDef {
  /** Stable camelCase key used in URLs (filter, sort, fields). */
  key: string;
  /** Full label for the picker. */
  label: string;
  /** Compact column header. */
  short: string;
  category: StatCategory;
  type: StatType;
  /** Record kinds this stat exists for. */
  scopes: readonly RecordScope[];
  /** For score stats: the score part and aggregate. */
  base?: ScoreStatBase;
  aggregate?: Aggregate;
  /** Shown as a percentage (0–100). */
  percent?: boolean;
  /** Lower is better (rank, penalties): the UI can default its sort ascending. */
  lowerIsBetter?: boolean;
  description?: string;
}

const TEAM_SCOPES = ["teamEvent", "teamSeason"] as const;
const EVENT_SCOPES = ["teamEvent", "match"] as const;

const def = (d: StatDef) => d;

const SCORE_DEFS: StatDef[] = SCORE_STATS.flatMap((s) => AGGREGATES.map((a) => def({
  key: `${s.base}${a}`,
  label: `${s.label} ${AGGREGATE_LABELS[a]}`,
  short: `${s.label.replace(" Points", "")} ${AGGREGATE_LABELS[a]}`,
  category: "Score Stats",
  type: "number",
  scopes: TEAM_SCOPES,
  base: s.base,
  aggregate: a,
  lowerIsBetter: s.base === "penaltyPointsCommitted" && a !== "Dev" ? true : undefined,
  description: `${s.description} ${a === "Opr" ? "OPR (least squares over qualification matches; season records use the team's best event)." : a === "Dev" ? "Standard deviation per qualification match." : `${AGGREGATE_LABELS[a]} over the team's qualification matches.`}`,
})));

const MATCH_SIDE_DEFS: StatDef[] = (["red", "blue"] as const).flatMap((side) => SCORE_STATS.filter((s) => s.base !== "penaltyPointsByOpp").map((s) => def({
  key: `${side}${s.base[0].toUpperCase()}${s.base.slice(1)}`,
  label: `${side === "red" ? "Red" : "Blue"} ${s.label}`,
  short: `${side === "red" ? "Red" : "Blue"} ${s.label.replace(" Points", "")}`,
  category: "Match Scores",
  type: "number",
  scopes: ["match"],
  base: s.base,
  description: s.description,
})));

/** Every stat, in picker order. */
export const STAT_CATALOG: readonly StatDef[] = [
  // Team
  { key: "teamNumber", label: "Team Number", short: "Team", category: "Team", type: "number", scopes: TEAM_SCOPES },
  { key: "teamName", label: "Team Name", short: "Name", category: "Team", type: "text", scopes: TEAM_SCOPES },
  { key: "homeRegion", label: "Home Region", short: "Region", category: "Team", type: "text", scopes: TEAM_SCOPES, description: "FIRST region code of the team's home (USTX, GB…)." },
  { key: "rookieYear", label: "Rookie Year", short: "Rookie", category: "Team", type: "number", scopes: TEAM_SCOPES },
  { key: "school", label: "School / Organization", short: "School", category: "Team", type: "text", scopes: TEAM_SCOPES },
  // Event
  { key: "eventCode", label: "Event Code", short: "Event", category: "Event", type: "text", scopes: EVENT_SCOPES },
  { key: "eventName", label: "Event Name", short: "Event name", category: "Event", type: "text", scopes: EVENT_SCOPES },
  { key: "eventRegion", label: "Event Region", short: "Event region", category: "Event", type: "text", scopes: EVENT_SCOPES, description: "FIRST region code of the event (USTX, GB…)." },
  // Event performance (official rankings)
  { key: "rank", label: "Ranking", short: "Rank", category: "Event Performance", type: "number", scopes: ["teamEvent"], lowerIsBetter: true },
  { key: "rp", label: "Ranking Score", short: "RS", category: "Event Performance", type: "number", scopes: ["teamEvent"] },
  { key: "tb1", label: "Tie Breaker Points", short: "TBP", category: "Event Performance", type: "number", scopes: ["teamEvent"] },
  { key: "events", label: "Events Played", short: "Events", category: "Event Performance", type: "number", scopes: ["teamSeason"] },
  { key: "qualMatchesPlayed", label: "Matches Played", short: "Played", category: "Event Performance", type: "number", scopes: TEAM_SCOPES },
  { key: "wins", label: "Wins", short: "W", category: "Event Performance", type: "number", scopes: TEAM_SCOPES },
  { key: "losses", label: "Losses", short: "L", category: "Event Performance", type: "number", scopes: TEAM_SCOPES, lowerIsBetter: true },
  { key: "ties", label: "Ties", short: "T", category: "Event Performance", type: "number", scopes: TEAM_SCOPES },
  // Score stats × aggregates
  ...SCORE_DEFS,
  // Match scores
  ...MATCH_SIDE_DEFS,
  { key: "winningMargin", label: "Winning Margin", short: "Margin", category: "Match Scores", type: "number", scopes: ["match"], description: "Points between the two alliances (0 for a tie)." },
  { key: "highScore", label: "High Score", short: "High", category: "Match Scores", type: "number", scopes: ["match"], description: "The higher of the two alliance totals." },
  { key: "combinedScore", label: "Combined Score", short: "Combined", category: "Match Scores", type: "number", scopes: ["match"], description: "Both alliance totals added." },
  // Control Scout exclusives (from the engine's walk-forward ledger: every call made before the match, without hindsight)
  { key: "predictedWinPctAvg", label: "Predicted Win % (avg)", short: "Pred. win %", category: "Control Scout Exclusives", type: "number", scopes: TEAM_SCOPES, percent: true, description: "Average pre-match win probability of the team's alliance over its qualification matches (walk-forward: each call uses only matches played before it)." },
  { key: "predictedScoreAvg", label: "Predicted Score (avg)", short: "Pred. score", category: "Control Scout Exclusives", type: "number", scopes: TEAM_SCOPES, description: "Average pre-match predicted score of the team's alliance over its qualification matches (walk-forward)." },
  { key: "advancementOdds", label: "Advancement Odds", short: "Adv. odds", category: "Control Scout Exclusives", type: "number", scopes: ["teamEvent"], percent: true, description: "Simulated chance of advancing from this event: the latest Monte Carlo projection (10,000 simulations, re-run as results land; performance-based — awards can also advance teams), or, for events never projected, the forecast made the day before it started (no hindsight). Only for events that advance teams; empty for teams that had already advanced. A raw simulation share: show it with oddsPct so it never reads as a flat 0% or 100%." },
  { key: "redPredictedWinPct", label: "Red Predicted Win %", short: "Red pred. win %", category: "Control Scout Exclusives", type: "number", scopes: ["match"], percent: true, description: "Red alliance's pre-match win probability (walk-forward ledger)." },
];

export const STAT_BY_KEY: ReadonlyMap<string, StatDef> = new Map(STAT_CATALOG.map((s) => [s.key, s]));

/** The stats a record kind supports, in picker order. */
export const statsFor = (scope: RecordScope): StatDef[] => STAT_CATALOG.filter((s) => s.scopes.includes(scope));

export const statFor = (key: string, scope: RecordScope): StatDef | undefined => {
  const s = STAT_BY_KEY.get(key);
  return s && s.scopes.includes(scope) ? s : undefined;
};

/** Default sort per record kind. */
export const DEFAULT_SORT: Record<RecordScope, string> = { teamEvent: "totalPointsOpr", teamSeason: "totalPointsOpr", match: "highScore" };

/**
 * Event type options for the records `eventType` parameter: the Events page's
 * types, plus `Official` (every type the ratings count: no scrimmages,
 * off-season or non-competition events).
 */
export const RECORD_EVENT_TYPES = ["Official", "LeagueMeet", "LeagueTournament", "Qualifier", "SuperQualifier", "Championship", "FIRSTChampionship", "Premier", "Scrimmage", "OffSeason"] as const;
export type RecordEventType = (typeof RECORD_EVENT_TYPES)[number];

/** Rows per page: default and limits. CSV export streams up to EXPORT_MAX rows. */
export const RECORDS_PAGE_SIZE = 50;
export const RECORDS_MAX_PAGE_SIZE = 500;
export const RECORDS_EXPORT_MAX = 100_000;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** Stat values of one record, keyed by catalog key (null = no data). */
export type StatValues = Record<string, number | string | null>;

export interface TeamEventRecord {
  season: number;
  team: number;
  eventCode: string;
  eventName: string;
  eventType: string | null;
  eventStart: string | null;
  stats: StatValues;
}

export interface TeamSeasonRecord {
  season: number;
  team: number;
  stats: StatValues;
}

export interface MatchRecordRow {
  season: number;
  eventCode: string;
  eventName: string;
  eventType: string | null;
  eventStart: string | null;
  /** Same key as the match pages: "qual:0:12". */
  key: string;
  level: "qual" | "playoff";
  label: string;
  time: string | null;
  red: number[];
  blue: number[];
  stats: StatValues;
  /**
   * The confidence tier recorded with the replayed call behind `stats.redPredictedWinPct` (the
   * walk-forward ledger's own tier, never worked out again from the probability). Sent only when that
   * stat was asked for; null when the ledger has no tier for the call, and then the percentage isn't shown.
   */
  predictionTier?: ConfidenceTier | null;
}

/** A FIRST region code used by a season's records, with the place most of its events are in. */
export interface RecordRegion { code: string; country: string | null; state: string | null; events: number }

export interface RecordsResponse<Row> {
  season: number;
  scope: RecordScope;
  /** The filter as parsed and re-serialised (canonical form), or null. */
  filter: string | null;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
  /** Matching rows across all pages. */
  total: number;
  /** Stat keys present in each row's `stats`. */
  columns: string[];
  rows: Row[];
}
