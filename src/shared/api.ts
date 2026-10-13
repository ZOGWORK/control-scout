// API contract shared by the server and the web app (types only).
import type { ConfidenceTier, Factor, Forecast, Partners, TeamStrength } from "@control-scout/predict-engine";

export type { ConfidenceTier, Factor, Forecast, Partners, TeamStrength };

export interface SeasonMeta { season: number; game: string; label: string; frozen: boolean; lastSync: string | null }

export interface Meta {
  seasons: SeasonMeta[];
  currentSeason: number;
  engineVersion: string;
  dataAsOf: string | null;
  statsAt: string | null;
  auth: { email: boolean; google: boolean };
  firstConfigured: boolean;
}

export interface SearchHit {
  kind: "team" | "event" | "match";
  /** team: "4215"; event: "2025:USNJQ1"; match: "2025:USNJQ1:qual:0:12" */
  ref: string;
  title: string;
  subtitle: string;
  season: number | null;
}

export interface OprStat { value: number | null; rank: number | null; of: number | null }

export interface TeamInfo {
  number: number;
  name: string | null;
  fullName: string | null;
  school: string | null;
  sponsors: string[];
  city: string | null;
  state: string | null;
  country: string | null;
  rookieYear: number | null;
  website: string | null;
  homeRegion: string | null;
}

export interface TeamEventRow {
  season: number;
  code: string;
  name: string;
  type: string | null;
  start: string | null;
  end: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  rank: number | null;
  rp: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  qualPlayed: number | null;
  opr: { np: number | null; auto: number | null; teleop: number | null; endgame: number | null; pen: number | null };
  avg: { score: number | null; np: number | null; pen: number | null };
  awards: { type: string; placement: number; name: string | null }[];
  /** Alliance this team played on in playoffs (number, seat). */
  alliance: { number: number; seat: "captain" | "pick1" | "pick2" | "backup" } | null;
}

export interface TeamSeasonStats {
  opr: { np: OprStat; auto: OprStat; teleop: OprStat; endgame: OprStat; pen: number | null };
  rating: { np: number; auto: number; teleop: number; endgame: number; pen: number; sd: number; matches: number; rank: number | null } | null;
  record: { wins: number; losses: number; ties: number; matches: number; events: number };
  avg: { np: number | null; score: number | null; pen: number | null };
}

export interface TeamProfile {
  team: TeamInfo;
  season: number;
  /** Seasons this team has data for (newest first). */
  seasons: number[];
  stats: TeamSeasonStats | null;
  events: TeamEventRow[];
  /** Awards across all seasons we hold (newest first). */
  awardsAllTime: { season: number; code: string; event: string; type: string; placement: number; name: string | null }[];
}

export interface AllianceScore {
  teams: { number: number; surrogate: boolean; dq: boolean; onField: boolean }[];
  score: { total: number; np: number; auto: number; teleop: number; endgame: number; pen: number } | null;
}

export interface MatchPredictionView {
  /** P(red wins). */
  pRed: number;
  redMean: number;
  blueMean: number;
  tier: ConfidenceTier;
  /** live = logged before the match; backtest = walk-forward replay; now = computed from today's ratings (unplayed). */
  kind: "live" | "backtest" | "now";
  predictedAt: string | null;
  factors?: Factor[];
}

export interface MatchView {
  season: number;
  code: string;
  key: string; // level:series:number
  level: "qual" | "playoff";
  series: number;
  number: number;
  label: string;
  /** Event-local time as FIRST reports it (no zone) — for display. */
  time: string | null;
  /** The real instant (UTC ISO) when the event's time zone is known. */
  startsAt: string | null;
  played: boolean;
  red: AllianceScore;
  blue: AllianceScore;
  video: string | null;
  prediction: MatchPredictionView | null;
}

export interface EventSummary {
  season: number;
  code: string;
  name: string;
  type: string | null;
  typeLabel: string;
  divisionCode: string | null;
  region: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  venue: string | null;
  start: string | null;
  end: string | null;
  remote: boolean;
  teams: number;
  matchesPlayed: number;
  matchesTotal: number;
  status: "upcoming" | "live" | "finished";
}

export interface FieldRow {
  team: number;
  name: string | null;
  city: string | null;
  state: string | null;
  rank: number | null;
  rp: number | null;
  tbp: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  qualPlayed: number | null;
  opr: { np: number | null; auto: number | null; teleop: number | null; endgame: number | null; pen: number | null };
  avgNp: number | null;
  rating: { np: number; sd: number; matches: number } | null;
}

export interface EventDetail {
  event: EventSummary & { website: string | null; livestream: string | null; timezone: string | null; source: string };
  field: FieldRow[];
  matches: MatchView[];
  alliances: { number: number; name: string | null; captain: number | null; pick1: number | null; pick2: number | null; backup: number | null }[];
  awards: { type: string; placement: number; team: number; name: string | null }[];
  advancement: { slots: number; advancesTo: string | null; rows: { team: number; status: string; declined: boolean }[] } | null;
  /** Can this event be forecast (advancement simulator)? Null when yes, else why not. */
  forecastUnsupported: string | null;
}

export interface MatchExplanationView {
  season: number;
  red: number[];
  blue: number[];
  winProbRed: number;
  winProbBlue: number;
  predictedRed: number;
  predictedBlue: number;
  rangeRed: [number, number];
  rangeBlue: [number, number];
  factors: Factor[];
  confidence: { tier: ConfidenceTier; reason: string; minMatches: number; ratingShare: number };
  teamsRed: (TeamStrength & { name: string | null })[];
  teamsBlue: (TeamStrength & { name: string | null })[];
  engineVersion: string;
}

export interface ForecastView extends Forecast {
  eventName: string;
  eventStart: string | null;
  eventEnd: string | null;
  myTeam: number | null;
  engineVersion: string;
  /** current = today's ratings + results so far; pre-event = as it would have been made the day before (no hindsight). */
  mode: "current" | "pre-event";
  /** Set when a current-mode forecast of a finished event uses ratings that already include its results. */
  hindsightNote: string | null;
  /** False when the season's bonus ranking points have no fitted model yet (ranks then count win/tie RPs only). */
  bonusModelled: boolean;
}

export interface ReliabilityBin { lo: number; hi: number; n: number; predicted: number; actual: number }

export interface AccuracyBlock {
  n: number;
  /** Share of decided (non-tie) matches where the favourite won. */
  accuracy: number;
  brier: number;
  logLoss: number;
  /** Brier of always saying 50%: the "no skill" line. */
  baselineBrier: number;
  reliability: ReliabilityBin[];
  byTier: Record<ConfidenceTier, { n: number; accuracy: number; brier: number }>;
  byLevel: { qual: { n: number; accuracy: number }; playoff: { n: number; accuracy: number } };
  /** Week-by-week accuracy (ISO week start). */
  weekly: { week: string; n: number; accuracy: number }[];
  upsets: number;
}

export interface TrackRecord {
  seasons: { season: number; label: string; live: AccuracyBlock | null; backtest: AccuracyBlock | null }[];
  engineVersion: string;
  /** Minimum live sample before the headline switches from backtest to live. */
  liveThreshold: number;
  headline: { kind: "live" | "backtest"; season: number; accuracy: number; n: number } | null;
  recentCalls: (MatchView & { prediction: MatchPredictionView })[];
  generatedAt: string;
}

export interface CompareTeam {
  team: TeamInfo;
  stats: TeamSeasonStats | null;
  events: { code: string; name: string; start: string | null; opr: number | null; rank: number | null }[];
}

export interface CompareView {
  season: number;
  teams: CompareTeam[];
  /** Head-to-head: matches where they met (opponents) or played together (partners). */
  meetings: (MatchView & { relation: "opponents" | "partners" })[];
}

export interface ApiError { error: string; detail?: string }

export interface TeamSummary {
  team: number; name: string | null; place: string;
  opr: number | null; oprRank: number | null; of: number | null;
  rating: number | null; ratingSd: number | null; record: string | null;
  lastEvent: { code: string; name: string; start: string | null; end: string | null; rank: number | null; record: string | null } | null;
  nextEvent: { code: string; name: string; start: string | null; end: string | null; rank: number | null; record: string | null } | null;
}
