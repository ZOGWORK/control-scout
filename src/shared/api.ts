// API contract shared by the server and the web app (types only).
import type { Reliability } from "./reliability";
import type { ConfidenceTier, Factor, Forecast, Partners, TeamStrength } from "@control-scout/predict-engine";

export type { ConfidenceTier, Factor, Forecast, Partners, TeamStrength };

/** The strongest real history between a lineup's robots (engine 2.4 partnership memory):
 *  two of them played together, or met as opponents, in an earlier match. A reason shown
 *  with the prediction; it doesn't move the odds in 2.4. */
export interface PairHistory {
  kind: "together" | "against";
  teams: [number, number];
  /** "Red"/"A" side the fact is about (together), or "A" for a red-vs-blue meeting. */
  side: "A" | "B";
  label: string;
}

export interface SeasonMeta { season: number; game: string; label: string; frozen: boolean; lastSync: string | null; /** False for 2019–2022: history only, no ratings or predictions. */ predictable: boolean }

export interface Meta {
  seasons: SeasonMeta[];
  currentSeason: number;
  engineVersion: string;
  dataAsOf: string | null;
  statsAt: string | null;
  auth: { email: boolean; google: boolean };
  firstConfigured: boolean;
  /** False on a server whose database has no FTC data yet. */
  dataLoaded: boolean;
}

export interface SearchHit {
  kind: "team" | "event" | "match" | "place";
  /** team: "4215"; event: "2025:USNJQ1"; match: "2025:USNJQ1:qual:0:12"; place: "USA:NJ" */
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
  /** At a league meet, the meet's own rank and ranking score (FIRST's are the league's running standing). */
  rank: number | null;
  rp: number | null;
  /** Every match at the event on the team's record, playoffs included (src/shared/eventRecord.ts): the rows add up to
   *  the season record. Null when we hold no scored match for it (not played yet, or no scores published). */
  wins: number | null;
  losses: number | null;
  ties: number | null;
  /** Matches counted in wins + losses + ties. */
  played: number | null;
  qualPlayed: number | null;
  /** The qualification matches alone (what FIRST's ranking shows); null when there's no record. */
  qual: { wins: number; losses: number; ties: number; played: number } | null;
  /** On the field in a played match there. False with a record: listed for matches it didn't take the field for. */
  onField: boolean;
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
  /** Reliability index (src/shared/reliability.ts), public match data only. Absent/null: not computed (e.g. an older offline pack). */
  reliability?: Reliability | null;
}

/** The season's field average over every team's scored live calls (server/stats/reportCards.ts). */
export interface ReportCardField {
  calls: number;
  decided: number;
  scored: number;
  hitRate: number | null;
  errMean: number | null;
  errAbs: number | null;
  errSd: number | null;
}

export interface ReportCardNumbers {
  /** Share of decided calls the model got right. */
  hitRate: number | null;
  /** Mean (actual − predicted) alliance score per robot: above 0 = scored more than predicted. */
  errMean: number | null;
  /** Mean absolute miss, points per robot. */
  errAbs: number | null;
  /** Spread (sd) of the misses, points per robot. */
  errSd: number | null;
}

/** How the engine's live calls on one team's matches turned out: one event, or the whole season (code null). */
export interface ReportCard {
  code: string | null;
  name: string | null;
  start: string | null;
  /** The event is over and every match is played (always false for the season row). */
  final: boolean;
  /** Scored live calls the team was in. */
  calls: number;
  /** Calls that weren't a tie or an exact 50/50. */
  decided: number;
  hits: number;
  /** Calls with a predicted score (the miss numbers use only these). */
  scored: number;
  raw: ReportCardNumbers;
  /** Pulled toward the field average with a prior worth `prior` calls. */
  shrunk: ReportCardNumbers;
}

export interface TeamReportCards {
  season: ReportCard | null;
  /** Finished events only, oldest first. */
  events: ReportCard[];
  field: ReportCardField | null;
  prior: number;
}

export interface TeamProfile {
  team: TeamInfo;
  season: number;
  /** Seasons this team has data for (newest first). */
  seasons: number[];
  stats: TeamSeasonStats | null;
  /** Predictability report card from live calls (null: no scored live call for this team this season). */
  reportCards?: TeamReportCards | null;
  events: TeamEventRow[];
  /** Awards across all seasons we hold (newest first). */
  awardsAllTime: { season: number; code: string; event: string; type: string; placement: number; name: string | null }[];
}

export interface AllianceScore {
  /** `name`: the team's name, when we hold it (match lists show it under the number). */
  teams: { number: number; surrogate: boolean; dq: boolean; onField: boolean; name?: string }[];
  score: { total: number; np: number; auto: number; teleop: number; endgame: number; pen: number; tips?: number } | null;
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
  /** Stated range of each final score, [lo, hi], holding rangeLevel (0.8) of real scores. Absent on calls
   *  logged before engine 2.2 (they stated none) and with noScoreBasis. */
  redRange?: [number, number];
  blueRange?: [number, number];
  rangeLevel?: number;
  factors?: Factor[];
  /** Notable reasons beyond the factors (unplayed matches from today's ratings only). */
  reasons?: string[];
  /** Earlier matches these robots played together or against each other (unplayed matches only). */
  history?: PairHistory;
  /** The season has no rated matches yet: win odds only, the predicted score means nothing. */
  noScoreBasis?: true;
  /** Bonus ranking point odds (2025+ qualification matches), made with the same call (same kind and moment). */
  bonus?: BonusOddsView;
}

/** P(each bonus RP) per alliance, in the season's label order (src/shared/labels.ts bonusLabels), and the
 *  expected ranking points from the match (win RPs × P(win) + expected bonus RPs). */
export interface BonusOddsView {
  red: [number, number, number];
  blue: [number, number, number];
  rpRed: number;
  rpBlue: number;
  /** The match's tier, capped by how much the season's bonus model has learned from. */
  tier: ConfidenceTier;
  reason?: string;
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
  /** Where the match starts in the event's recording (server/videos/recordings.ts), on the event's own routes. */
  clip?: MatchClip;
  prediction: MatchPredictionView | null;
}

/** A match's place in its event's recording: the video, the second to start from, and YouTube's link to it. */
export interface MatchClip { videoId: string; t: number; url: string }

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

/** A row of /api/events (the list): the detail-only fields are left out. */
export type EventListItem = Omit<EventSummary, "venue" | "divisionCode" | "region" | "remote"> & {
  /** A stream is set (the LIVE dot while it's on). */ stream?: true;
  /** Video to watch: "clips" (matches link to their second in a recording, or FIRST's own match videos) or "recording" (the event's stream, no match times). */
  video?: "clips" | "recording";
};

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
  /** The team's season OPR (np) so far, across all its events: what the field looks like before this event starts. */
  seasonOpr?: number | null;
  /** A league meet's own standing, from this meet's matches only (src/shared/meetStandings.ts). FIRST's rank and
   *  rp above are the league's running standing there. Absent: not a league meet; null: no counted match yet. */
  meet?: { rank: number; rs: number; tb: number[]; wins: number; losses: number; ties: number; played: number } | null;
}

/** An event's live stream as the owner set it (server/portal/streams.ts): YouTube, played from youtube-nocookie.com. */
export interface EventStream { videoId: string; streamUrl: string; /** "first": FIRST's liveStreamUrl, not one the owner set. */ source?: "first" }

/** A row of the owner portal's stream list. */
export interface OwnerStreamRow { season: number; code: string; name: string | null; start: string | null; end: string | null; url: string; videoId: string; updatedAt: string }

export interface EventDetail {
  event: EventSummary & { /** The venue's street address (FIRST's event list); absent from older servers and saved packs. */ address?: string | null; website: string | null; livestream: string | null; timezone: string | null; source: string; /** The Watch live section's stream; absent or null: no section. */ stream?: EventStream | null };
  field: FieldRow[];
  matches: MatchView[];
  alliances: { number: number; name: string | null; captain: number | null; pick1: number | null; pick2: number | null; backup: number | null }[];
  awards: { type: string; placement: number; team: number; name: string | null }[];
  advancement: { slots: number; advancesTo: string | null; rows: { team: number; status: string; declined: boolean }[] } | null;
  /** Can this event be forecast (advancement simulator)? Null when yes, else why not. */
  forecastUnsupported: string | null;
  /** Events on today (in their own time zone): how fresh the results are. Null on other days. */
  /** `auto`: this server checks FIRST on its own every `everySeconds`; false: only "Refresh results" checks. */
  live: { checkedAt: string | null; everySeconds: number; auto: boolean } | null;
  /** A region's own site's details and registered teams (FTC New Jersey), while FIRST has no team list and no
   *  schedule for the event; null once it has either. Absent from older servers and saved packs. */
  provisional?: ProvisionalInfo | null;
  /** Set when `field` is FIRST's pre-event registered teams (no rankings or schedule yet): the list can still
   *  change until the event. Absent from older servers and saved packs. */
  registered?: { fetchedAt: string } | null;
  /** This event is one session of an AM/PM pair and FIRST lists the pair's registrations together, with no word on
   *  who plays which session: never this session's `field`. Null otherwise. Absent from older servers and saved packs. */
  sharedSessions?: SharedSessions | null;
}

/** FIRST's registered teams for both sessions of an AM/PM event (server/data/registrations.ts markSharedSessions). */
export interface SharedSessions {
  fetchedAt: string;
  /** The other session's event. */
  other: { code: string; name: string };
  teams: { team: number; name: string | null; city: string | null; state: string | null }[];
}

/** Unofficial event info from a regional site (server/data/provisional.ts): shown labelled, never as FIRST's. */
export interface ProvisionalInfo {
  /** Who publishes it ("FTC New Jersey") and the page it's read from. */
  sourceName: string;
  url: string;
  /** When the page was last read. */
  fetchedAt: string;
  nickname: string | null;
  hosts: string | null;
  venue: string | null;
  address: string | null;
  capacity: string | null;
  schedule: string[];
  notes: string[];
  closed: boolean;
  /** Teams as the site lists them, with FIRST's team name and home where we have the team. `known`: FIRST
   *  has the team (it has a team page); a team new this season may not be in FIRST's list yet. */
  teams: { team: number; name: string | null; city: string | null; state: string | null; status: "registered" | "pending"; session: "AM" | "PM" | null; known: boolean }[];
  /** FIRST runs this event as AM and PM sessions but the site doesn't say who is in which. */
  sessionUnknown: boolean;
}

/** POST /api/events/:season/:code/refresh */
export interface EventRefreshResult {
  /** refreshed: FIRST was asked just now; recent: someone else did seconds ago; busy: a full update is running; failed: FIRST didn't answer. */
  outcome: "refreshed" | "recent" | "busy" | "failed";
  message: string;
  detail: EventDetail;
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
  /** The ranges' level (0.8 = 80%). Optional: offline answers from an older pack may lack it. */
  rangeLevel?: number;
  factors: Factor[];
  /** Earlier matches these robots played together or against each other, if any. */
  history?: PairHistory | null;
  confidence: { tier: ConfidenceTier; reason: string; minMatches: number; ratingShare: number };
  /** Notable reasons beyond the factors (engine explain: recent no-shows, near-zero matches). Never change the odds. */
  reasons?: string[];
  teamsRed: (TeamStrength & { name: string | null })[];
  teamsBlue: (TeamStrength & { name: string | null })[];
  /** The match level the odds assume (a what-if with no level is a qualification match). */
  level?: "qual" | "playoff";
  /** "contextual" (engine 2.0's win-probability model) or "legacy" (no reliability state yet). */
  probabilityModel?: "contextual" | "legacy";
  /** Bonus ranking point odds (qualification what-ifs of 2025+ seasons with a bonus model). */
  bonus?: BonusOddsView | null;
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
  /** False when this forecast simulated no bonus ranking points (Forecast.bonusDraws "none": ranks then count win/tie RPs only). */
  bonusModelled: boolean;
}

export interface ReliabilityBin { lo: number; hi: number; n: number; predicted: number; actual: number }

export interface AccuracyBlock {
  /** Every scored call (ties and 50:50 calls included). */
  n: number;
  /** Calls that could be right or wrong: neither a tied match nor a 50:50 call. `accuracy` and `upsets` count these. */
  decided: number;
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
  /** Decided calls the favourite lost (missed calls): decided − upsets were called correctly. */
  upsets: number;
  /** Score ranges (engine 2.2+): how often real alliance scores landed inside the stated range. Null when no
   *  call in the block stated one (calls logged before 2.2). Scored the same way as the win calls. */
  ranges?: RangeCoverage | null;
}

export interface RangeCoverage {
  /** The range's stated level (0.8: 8 in 10 real scores should land inside). */
  level: number;
  /** Alliance scores checked (two per call). */
  n: number;
  /** How many landed inside, and that share. */
  inside: number;
  coverage: number;
  /** Below the range / above it (share of n): which way the misses go. */
  below: number;
  above: number;
  /** Mean width of the stated ranges (points). */
  width: number;
  byTier: Record<ConfidenceTier, { n: number; coverage: number }>;
}

export interface ShadowScore { accuracy: number; brier: number; logLoss: number }

export interface ReplayCoverage {
  /** Matches with a final score this season. */
  scored: number;
  /** Of those, matches with a replayed call. */
  replayed: number;
  /** Skipped: played at a remote or hybrid event, which the replay leaves out. */
  eventSkipped: number;
  /** Skipped: an alliance didn't have exactly two robots on the field (a no-show, or a one-robot alliance). */
  shortHanded: number;
  /** Not replayed for another reason: normally, scored since the replay was last rebuilt. */
  other: number;
}

/** Bonus RP calls scored: one call per alliance per bonus RP (so 6 per match). */
export interface BonusAccuracy {
  /** Alliance-bonus calls scored. */
  n: number;
  /** Matches they came from. */
  matches: number;
  brier: number;
  /** Brier of always saying the rate those same calls came true at (hindsight reference, not a model). */
  baseRateBrier: number;
  /** Per bonus RP, in the season's label order. */
  bySlot: { label: string; n: number; brier: number; predicted: number; actual: number }[];
  reliability: ReliabilityBin[];
}

export interface TrackRecord {
  seasons: {
    season: number; label: string; live: AccuracyBlock | null; backtest: AccuracyBlock | null;
    /** How much of the season the replay covers: every match with a final score, and why the rest has no
     *  replayed call. The replay predicts only 2-on-2 matches from the robots that actually played, so a
     *  no-show (or a one-robot alliance) is skipped; a live call, logged from the schedule beforehand, isn't. */
    replay?: ReplayCoverage;
    /** Live calls split by the engine version that made them (versions are never compared on mixed cohorts). */
    liveByEngine?: { engine: string; n: number; accuracy: number; brier: number; logLoss: number }[];
    /** Side by side on the same live calls: the served model vs the shadow (previous) model,
     *  both computed from the same ratings at the same moment. Paired, so it compares models,
     *  not match difficulty. One entry per served/shadow model pair. */
    liveShadow?: { servedModel: string; shadowModel: string; n: number; served: ShadowScore; shadow: ShadowScore }[];
    /** Bonus ranking point calls (2025+ qualification matches), scored like win calls; live and replay never blended. */
    bonus?: { live: BonusAccuracy | null; backtest: BonusAccuracy | null };
  }[];
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
  /** Events this season, oldest first. OPR parts are that event's (season OPR parts are each the best event's,
   *  so the brief can link every number to the event it came from). */
  events: { code: string; name: string; start: string | null; opr: number | null; auto: number | null; teleop: number | null; endgame: number | null; rank: number | null }[];
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
  /** Reliability index 0–100 (public match data only) and the qualification matches it rests on. */
  reliability?: number | null; reliabilityMatches?: number | null;
  lastEvent: { code: string; name: string; start: string | null; end: string | null; rank: number | null; record: string | null } | null;
  nextEvent: { code: string; name: string; start: string | null; end: string | null; rank: number | null; record: string | null } | null;
}

/** One event a team played this season, for the shortlist's trend graphs (OPR is event OPR, non-penalty). */
export interface ShortlistEventPoint {
  code: string; name: string; start: string | null; rank: number | null;
  opr: number | null; auto: number | null; teleop: number | null; endgame: number | null;
  /** Average non-penalty alliance score in the team's matches there. */
  avgNp: number | null;
}

/** A shortlist row: the team summary plus the season OPR split and an event-by-event trend, in one request
 *  for the whole list (/api/shortlist). */
export interface ShortlistTeam extends TeamSummary {
  /** OPR split auto / TeleOp (driver-controlled) / endgame, from the one event that gives the season OPR (`opr`),
   *  so the parts belong to that total. Null parts when the team has no event stats. */
  breakdown: { auto: number | null; teleop: number | null; endgame: number | null; event: { code: string; name: string } | null };
  /** Events played this season with stats, oldest first. */
  events: ShortlistEventPoint[];
}

/** One match, with everything around it: /api/events/:season/:code/matches/:key */
export interface MatchDetail {
  event: { season: number; code: string; name: string; status: EventSummary["status"] };
  match: MatchView;
  /** FIRST's description, e.g. "Qualification 12" or "Match 3 (R2)". */
  description: string | null;
  /** Team → driver station (1–3). */
  stations: Record<number, number>;
  /** Bonus ranking points earned (2025+), in the season's own names. */
  bonus: { labels: [string, string, string]; red: [boolean, boolean, boolean] | null; blue: [boolean, boolean, boolean] | null } | null;
  /** Every robot in the lineup: who it is, and how it's doing at this event and this season. */
  teams: Record<number, {
    name: string | null; city: string | null; state: string | null;
    event: Pick<FieldRow, "rank" | "rp" | "wins" | "losses" | "ties" | "qualPlayed" | "opr" | "rating"> | null;
    season: { opr: number | null; rank: number | null; of: number | null } | null;
  }>;
  /** The full score sheet as FIRST reported it, row by row: each group (Auto, TeleOp, fouls) then what it's made
   *  of (depth 1). `count`: a tally (fouls), not points. Null: the season has no sheet, or none was stored. */
  sheet: { label: string; depth: 0 | 1; count?: true; red: number | null; blue: number | null }[] | null;
  /** The neighbouring matches at this event (by schedule order), for stepping through. */
  prev: { key: string; label: string } | null;
  next: { key: string; label: string } | null;
}

// ---------------------------------------------------------------------------
// Official result changes (/api/events/:season/:code/result-changes)
// ---------------------------------------------------------------------------

/** posted: a result appeared; revised: a posted result's values changed; schedule: time, field or lineup moved. */
export type ResultChangeKind = "posted" | "revised" | "schedule";

/** One alliance's official score as stored (null components: not reported by the source). */
export interface ResultScoreSide {
  total: number | null;
  np: number | null;
  auto: number | null;
  teleop: number | null;
  endgame: number | null;
  pen: number | null;
  tips: number | null;
  bonus: { movement: boolean; goal: boolean; pattern: boolean } | null;
}

export interface ResultSnapshot {
  red: ResultScoreSide;
  blue: ResultScoreSide;
  /** Disqualified teams, ascending. */
  dq: number[];
  /** False: totals only (the source hadn't reported a breakdown; the components are estimates). */
  breakdown: boolean;
}
export interface ScheduleSnapshot { time: string | null; field: string | null; /** Team numbers, ascending. */ red: number[]; blue: number[] }

interface ResultChangeBase {
  id: number;
  /** "qual:0:12": the match's key on /events/:season/:code. */
  match: { key: string; label: string };
  /** Changed values: "red.total", "blue.bonus.goal", "dq", "time", "field", "red", "blue" (labels has their names). */
  fields: string[];
  /** The feed the new value came from, and the one the stored value came from. */
  source: "first" | "ftc-scout";
  prevSource: "first" | "ftc-scout" | null;
  /** When the sync saw the change (not when FIRST made it). */
  checkedAt: string;
}

export type ResultChange = ResultChangeBase & (
  | { kind: "posted"; before: null; after: ResultSnapshot }
  | { kind: "revised"; before: ResultSnapshot; after: ResultSnapshot | null }
  | { kind: "schedule"; before: ScheduleSnapshot; after: ScheduleSnapshot }
);

export interface ResultChangesView {
  season: number;
  code: string;
  /** Set when the list is for one match. */
  match: string | null;
  /** When this event's results started being watched; null = not yet (nothing before it is known). */
  trackedSince: string | null;
  /** The last time the sync stored this event's results. */
  lastChecked: string | null;
  /** The season's names for the changed values (season-specific bonus RPs and endgame). */
  labels: Record<string, string>;
  /** Newest first. At most `cap` per event are kept; `pruned` older ones were dropped. */
  changes: ResultChange[];
  cap: number;
  pruned: number;
}
