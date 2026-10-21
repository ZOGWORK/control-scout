// Pre-match scouting report (v1.6 Task 2): "Know your match", one page per match
// (/events/:season/:code/match/:key). Types and the flag rules, shared by the server
// (server/api/matchReport.ts) and the web app (src/pages/MatchReportPage.tsx), kept pure so they're tested
// without a database or a browser. Docs: docs/match-report.md.
//
// Watch-list flags: a few short chips per team, the ones that change what you do in the match. Two kinds.
//
// Yours (worked out on the device, from your own data; never sent to the server):
//   - "Your team":          the personal store's myTeam.
//   - "Assigned to you":    assigned to you at this event in your workspace (any status).
//   - "On your pick list":  on your workspace's shared pick list this season, or on your own shortlist.
//   - "Tracked":            one of your tracked teams.
//
// From the data (the server's, the same for everyone; this season's numbers):
//   - "High penalties":  the team's penalty OPR (points given away per match) is in the top FLAG_TOP_SHARE
//                        (15%) of the season's teams with MIN_SEASON_MATCHES (5) matches or more, and at
//                        least MIN_PEN_POINTS (1) point a match.
//   - "Inconsistent":    its alliances' non-penalty scores swing the most: the spread of those scores (standard
//                        deviation over average) is in the season's top FLAG_TOP_SHARE, among teams with
//                        MIN_SEASON_MATCHES qualification matches or more (it needs that many itself).
//   - "Rising":          its event OPR climbed more than most this season: the rise from its first event to its
//                        latest (events with MIN_EVENT_MATCHES played, this one included; two at least) is in
//                        the season's top FLAG_TOP_SHARE among teams with two such events, and at least
//                        RISE_SHARE (15%) and RISE_POINTS (5) points. (Most teams improve over a season: only
//                        the steepest climbs are worth a flag.)
// A cutoff the season can't give (too few teams with enough matches yet) raises no flag.
import type { EventDetail, MatchDetail, MatchView } from "./api";
import type { TeamConsensus } from "./consensus";
import type { Reliability } from "./reliability";

export const FLAG_TOP_SHARE = 0.15;
export const MIN_SEASON_MATCHES = 5;
export const MIN_PEN_POINTS = 1;
/** A season needs this many teams with enough matches before a "top 15%" means anything. */
export const MIN_CUTOFF_TEAMS = 20;
export const MIN_EVENT_MATCHES = 4;
export const RISE_SHARE = 0.15;
export const RISE_POINTS = 5;

export interface OprSplit { np: number | null; auto: number | null; teleop: number | null; endgame: number | null; pen: number | null }

/** One event of the team's season, for the trend (event OPR, non-penalty). */
export interface TrendPoint { code: string; name: string; start: string | null; opr: number }

export type DataFlagKind = "penalties" | "inconsistent" | "rising";
export interface DataFlag { kind: DataFlagKind; label: string; detail: string }

export type WatchKind = "mine" | "assigned" | "picklist" | "tracked";
export interface WatchFlag { kind: WatchKind; label: string; detail: string }

export interface ReportTeam {
  team: number;
  name: string | null;
  city: string | null;
  state: string | null;
  /** At this event (null: no standing here yet). */
  event: { rank: number | null; wins: number | null; losses: number | null; ties: number | null; qualPlayed: number | null; opr: OprSplit } | null;
  /** This season, all events: OPR (the best event's, split from that same event), its world rank, the record. */
  season: { opr: OprSplit; rank: number | null; of: number | null; matches: number; wins: number; losses: number; ties: number } | null;
  /** Event OPR by event this season, oldest first (events with MIN_EVENT_MATCHES played). */
  trend: TrendPoint[];
  flags: DataFlag[];
  /** This season's reliability index (public match data only; null: not computed). */
  reliability?: Reliability | null;
}

/** GET /api/events/:season/:code/matches/:key/report: public, the same for everyone. */
export interface MatchReport {
  event: EventDetail["event"];
  /** As on the event page: on an event day, how fresh the results are (the page refreshes while live). */
  live: EventDetail["live"];
  match: MatchView;
  description: string | null;
  /** Bonus ranking points earned once played (2025+), as on the match page; null when none are recorded. */
  bonus: MatchDetail["bonus"];
  /** Every team in the lineup, red then blue. */
  teams: ReportTeam[];
  prev: { key: string; label: string } | null;
  next: { key: string; label: string } | null;
}

/** GET /api/scout/workspaces/:id/match-report: members only. Consensus per team (in the order asked), and
 *  which of the teams are on the workspace's pick list or assigned to the asker at the event. */
export interface MatchReportWorkspace {
  workspaceId: string;
  season: number;
  teams: TeamConsensus[];
  picklist: number[];
  assignedToMe: number[];
}

/** The season's cutoffs for the data flags (null: not enough teams yet to say). */
export interface FlagCutoffs { penalties: number | null; inconsistent: number | null; rising: number | null }

/** A team's OPR rise this season: latest event minus first (null with under two events). */
export const oprRise = (trend: readonly TrendPoint[]): number | null => (trend.length >= 2 ? trend[trend.length - 1].opr - trend[0].opr : null);

/** The value at the top `share` of `values` (the smallest value inside the top share); null with too few. */
export function topCutoff(values: number[], share = FLAG_TOP_SHARE, min = MIN_CUTOFF_TEAMS): number | null {
  const xs = values.filter((x) => Number.isFinite(x)).sort((a, b) => b - a);
  if (xs.length < min) return null;
  return xs[Math.max(0, Math.ceil(xs.length * share) - 1)];
}

export interface FlagInput {
  /** Season penalty OPR (points given away a match) and matches played this season. */
  penOpr: number | null;
  seasonMatches: number;
  /** Season non-penalty alliance scores in its qualification matches: spread (standard deviation) and average. */
  npDev: number | null;
  npAvg: number | null;
  qualPlayed: number;
  trend: TrendPoint[];
}

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const pct = (share: number) => `${Math.round((1 - share) * 100)}%`;

/** The data flags for one team (the rules at the top of this file). */
export function dataFlags(x: FlagInput, cut: FlagCutoffs): DataFlag[] {
  const out: DataFlag[] = [];
  if (cut.penalties != null && x.penOpr != null && x.seasonMatches >= MIN_SEASON_MATCHES && x.penOpr >= MIN_PEN_POINTS && x.penOpr >= cut.penalties) {
    out.push({ kind: "penalties", label: "High penalties", detail: `Gives away about ${r1(x.penOpr)} penalty points a match (OPR), more than ${pct(FLAG_TOP_SHARE)} of teams this season.` });
  }
  const cv = x.npDev != null && x.npAvg != null && x.npAvg > 0 ? x.npDev / x.npAvg : null;
  if (cut.inconsistent != null && cv != null && x.qualPlayed >= MIN_SEASON_MATCHES && cv >= cut.inconsistent) {
    out.push({ kind: "inconsistent", label: "Inconsistent", detail: `Its alliances' scores swing by about ±${Math.round(x.npDev!)} around ${Math.round(x.npAvg!)}, more than ${pct(FLAG_TOP_SHARE)} of teams' this season.` });
  }
  const t = x.trend, up = oprRise(t);
  if (cut.rising != null && up != null && up >= cut.rising && up >= RISE_POINTS && up >= RISE_SHARE * Math.abs(t[0].opr)) {
    const first = t[0], last = t[t.length - 1];
    out.push({ kind: "rising", label: "Rising", detail: `OPR up from ${r1(first.opr)} at ${first.name} to ${r1(last.opr)} at ${last.name}, a steeper climb than ${pct(FLAG_TOP_SHARE)} of teams this season.` });
  }
  return out;
}

export interface WatchInput {
  myTeam: number | null;
  tracked: readonly number[];
  /** The personal shortlist (bookmarks). */
  shortlist: readonly number[];
  /** From the workspace, when there is one. */
  picklist: readonly number[];
  assigned: readonly number[];
}

/** Your flags for one team (the rules at the top of this file), in that order. */
export function watchFlags(team: number, w: WatchInput): WatchFlag[] {
  const out: WatchFlag[] = [];
  if (w.myTeam === team) out.push({ kind: "mine", label: "Your team", detail: "Set as your team in Settings." });
  if (w.assigned.includes(team)) out.push({ kind: "assigned", label: "Assigned to you", detail: "Your workspace assigned you to scout this team here." });
  const shared = w.picklist.includes(team), own = w.shortlist.includes(team);
  if (shared || own) out.push({ kind: "picklist", label: "On your pick list", detail: shared && own ? "On your workspace's pick list and your shortlist." : shared ? "On your workspace's pick list." : "On your shortlist." });
  if (w.tracked.includes(team)) out.push({ kind: "tracked", label: "Tracked", detail: "One of your tracked teams." });
  return out;
}

/** The report's address (shareable): /events/2025/USNJQ1/match/qual:0:12 */
export const matchReportHref = (m: Pick<MatchView, "season" | "code" | "key">) =>
  `/events/${m.season}/${encodeURIComponent(m.code)}/match/${m.key}`;

/** A match key as the API takes it: qual:0:12 / playoff:3:1. */
export const MATCH_KEY = /^(qual|playoff):\d{1,3}:\d{1,4}$/;

/** A key as written in an address, in its one canonical form (QUAL:0:01 → qual:0:1); null when it can't be one.
 *  The page and the server's preview read an address the same way. */
export function normalMatchKey(raw: string | null | undefined): string | null {
  const m = /^(qual|playoff):(\d{1,3}):(\d{1,4})$/i.exec(raw ?? "");
  return m ? `${m[1].toLowerCase()}:${Number(m[2])}:${Number(m[3])}` : null;
}
