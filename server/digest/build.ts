// What one account's weekly digest says (docs/digest.md), read only from data Scout already stores: results,
// event rankings, OPR, the live prediction ledger, the published power rankings and the account's follows.
// Nothing here calls FIRST or any other outside service, so a slow upstream can never hold a send up.
//
// The week is one fixed definition everywhere: Monday to Sunday (match dates as the event gives them, its own
// local day) before the Monday the digest goes out. "Coming up" is the 14 days from that Monday on.
import { all, get } from "../db.js";
import { decidedCall, rightCall } from "../api/accuracy.js";
import { latestRankings } from "../powerRankings/store.js";
import type { Movement, PowerRankingsResponse } from "../../src/shared/powerRankings.js";

const DAY = 86_400_000;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** How many result rows and upcoming rows an email lists before "see the rest" (a long follow list stays scannable). */
export const MAX_RESULTS = 10;
export const MAX_UPCOMING = 8;
/** OPR change smaller than this reads as flat (it moves by fractions as matches are re-fit). */
export const OPR_FLAT = 1;
/** "Coming up" looks this many days ahead. */
export const UPCOMING_DAYS = 14;

export interface TeamWeek {
  team: number; teamName: string | null;
  season: number; code: string; event: string;
  /** The team's last match day there this week: the order (most recent first). */
  lastDay: string;
  record: { wins: number; losses: number; ties: number } | null;
  /** The event is over (it ended before the Monday the digest goes out). */
  finished: boolean;
  rank: number | null;
  playoff: { kind: "winner" | "finalist" } | { kind: "alliance"; number: number; seat: "captain" | "pick1" | "pick2" | "backup" } | null;
  opr: number | null;
  /** The team's OPR at its previous event this season (null: this is its first). */
  oprBefore: number | null;
}

export interface Upcoming {
  team: number; teamName: string | null;
  season: number; code: string; event: string;
  start: string; end: string | null; city: string | null; state: string | null;
  /** Days from the send date to its first day: 0 today, 1 tomorrow… */
  inDays: number;
  /** A match schedule is posted (no times are ever shown either way: the email only says whether there is one). */
  scheduled: boolean;
}

export interface CallRecord { calls: number; right: number }

export interface RankingRow { team: number; teamName: string | null; rank: number; movement: Movement | null }

export interface DigestData {
  /** The Monday it goes out (New York date); the week it reports is the seven days before. */
  week: string; from: string; to: string;
  name: string | null;
  followed: number[];
  /** Every result row: the subject and summary count them all; the email lists the first MAX_RESULTS. */
  results: TeamWeek[];
  predictions: { week: CallRecord; season: CallRecord & { season: number } } | null;
  upcoming: Upcoming[];
  moreUpcoming: number;
  rankings: { week: string; title: string; rows: RankingRow[]; fallback: boolean } | null;
}

export type Section = "results" | "predictions" | "upcoming" | "rankings";
/** Is there anything to report about the account's own teams? The rankings' "biggest movers" fallback alone isn't:
 *  it's shown alongside real news, never sent on its own. */
export const hasNews = (d: DigestData) => d.results.length > 0 || !!d.predictions || d.upcoming.length > 0 || (!!d.rankings && !d.rankings.fallback);

export const sectionsOf = (d: DigestData): Section[] => [
  ...(d.results.length ? ["results" as const] : []), ...(d.predictions ? ["predictions" as const] : []),
  ...(d.upcoming.length ? ["upcoming" as const] : []), ...(d.rankings ? ["rankings" as const] : []),
];

const marks = (xs: unknown[]) => xs.map(() => "?").join(",");
const n = (v: unknown) => (v == null ? null : Number(v));

async function teamNames(teams: number[]): Promise<Map<number, string | null>> {
  if (!teams.length) return new Map();
  const rows = await all<{ number: number; name: string | null }>(`SELECT number, name FROM teams WHERE number IN (${marks(teams)})`, teams);
  return new Map(rows.map((r) => [Number(r.number), r.name?.trim() || null]));
}

/** Followed teams' events with a result last week, one row per team and event (two events: two rows). */
export async function teamWeeks(teams: number[], from: string, to: string, week: string): Promise<TeamWeek[]> {
  if (!teams.length) return [];
  // A match's day is its own date (event-local); with no time on record, the event's last day stands in.
  const day = "COALESCE(substr(m.time, 1, 10), e.end, e.start)";
  const played = await all<any>(
    `SELECT mt.team, m.season, m.code, MAX(${day}) last_day, e.name, e.start, e.end
     FROM match_teams mt
     JOIN matches m ON m.season = mt.season AND m.code = mt.code AND m.level = mt.level AND m.series = mt.series AND m.number = mt.number
     JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE mt.team IN (${marks(teams)}) AND m.played = 1 AND ${day} BETWEEN ? AND ?
     GROUP BY mt.team, m.season, m.code`, [...teams, from, to]);
  if (!played.length) return [];
  const names = await teamNames([...new Set(played.map((r) => Number(r.team)))]);
  const out: TeamWeek[] = [];
  for (const r of played) {
    const team = Number(r.team), season = Number(r.season), code = String(r.code);
    const [et, stats, awards, alliance, before] = await Promise.all([
      get<any>("SELECT rank, wins, losses, ties FROM event_teams WHERE season = ? AND code = ? AND team = ?", [season, code, team]),
      get<any>("SELECT opr_np FROM team_event_stats WHERE season = ? AND code = ? AND team = ?", [season, code, team]),
      all<any>("SELECT type FROM awards WHERE season = ? AND code = ? AND team = ? AND type IN ('Winner', 'Finalist')", [season, code, team]),
      get<any>("SELECT number, captain, pick1, pick2, backup FROM alliances WHERE season = ? AND code = ? AND ? IN (captain, pick1, pick2, backup)", [season, code, team]),
      // Its OPR at the event it played before this one (same season), as the team page lists them.
      get<any>(
        `SELECT s.opr_np FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code
         WHERE s.team = ? AND s.season = ? AND s.code != ? AND s.opr_np IS NOT NULL AND s.matches > 0 AND e.start < ?
         ORDER BY e.start DESC, e.code DESC LIMIT 1`, [team, season, code, r.start ?? r.last_day]),
    ]);
    const finished = String(r.end ?? r.start ?? r.last_day) < week;
    const types = new Set(awards.map((a) => a.type));
    const seat = alliance ? (["captain", "pick1", "pick2", "backup"] as const).find((k) => Number(alliance[k]) === team) ?? null : null;
    out.push({
      team, teamName: names.get(team) ?? null, season, code, event: String(r.name), lastDay: String(r.last_day),
      record: et && et.wins != null ? { wins: Number(et.wins), losses: Number(et.losses ?? 0), ties: Number(et.ties ?? 0) } : null,
      finished, rank: n(et?.rank),
      playoff: types.has("Winner") ? { kind: "winner" } : types.has("Finalist") ? { kind: "finalist" }
        : alliance && seat ? { kind: "alliance", number: Number(alliance.number), seat } : null,
      opr: n(stats?.opr_np), oprBefore: n(before?.opr_np),
    });
  }
  // Most recent event first, then by team number; one team's two events stay side by side within a day.
  return out.sort((a, b) => (a.lastDay !== b.lastDay ? (a.lastDay < b.lastDay ? 1 : -1) : a.team - b.team || a.code.localeCompare(b.code)));
}

/** The live ledger's calls on matches with a followed team: last week's and the season's, counted as the track record counts them. */
export async function callRecords(teams: number[], season: number, from: string, to: string): Promise<DigestData["predictions"]> {
  if (!teams.length) return null;
  const rows = await all<{ p: number; y: number; day: string | null }>(
    `SELECT p.p_red p, p.outcome y, substr(COALESCE(p.match_time, m.time), 1, 10) day
     FROM predictions p LEFT JOIN matches m ON m.season = p.season AND m.code = p.code AND m.level = p.level AND m.series = p.series AND m.number = p.number
     WHERE p.kind = 'live' AND p.season = ? AND p.outcome IS NOT NULL
       AND EXISTS (SELECT 1 FROM match_teams mt WHERE mt.season = p.season AND mt.code = p.code AND mt.level = p.level AND mt.series = p.series
                   AND mt.number = p.number AND mt.team IN (${marks(teams)}))`, [season, ...teams]);
  const decided = rows.map((r) => ({ p: Number(r.p), y: Number(r.y), day: r.day })).filter(decidedCall);
  const count = (xs: typeof decided): CallRecord => ({ calls: xs.length, right: xs.filter(rightCall).length });
  const week = count(decided.filter((r) => r.day != null && r.day >= from && r.day <= to));
  // No calls on a followed team's match last week: no section (never a 0 of 0).
  if (!week.calls) return null;
  return { week, season: { ...count(decided), season } };
}

/** Followed teams' events starting in the next UPCOMING_DAYS (registered or on the roster), soonest first. A registration list
 *  FIRST filed for an AM/PM pair (shared = 1) says who registered for the pair, not for this session, so it isn't used. */
export async function upcomingEvents(teams: number[], week: string): Promise<Upcoming[]> {
  if (!teams.length) return [];
  const until = addDays(week, UPCOMING_DAYS);
  const rows = await all<any>(
    `SELECT x.team, e.season, e.code, e.name, e.start, e.end, e.city, e.state,
       EXISTS (SELECT 1 FROM matches m WHERE m.season = e.season AND m.code = e.code) scheduled
     FROM (SELECT season, code, team FROM event_teams WHERE team IN (${marks(teams)})
           UNION SELECT season, code, team FROM event_registrations WHERE shared = 0 AND team IN (${marks(teams)})) x
     JOIN events e ON e.season = x.season AND e.code = x.code
     WHERE e.start >= ? AND e.start <= ?`, [...teams, ...teams, week, until]);
  const names = await teamNames([...new Set(rows.map((r) => Number(r.team)))]);
  return rows.map((r): Upcoming => ({
    team: Number(r.team), teamName: names.get(Number(r.team)) ?? null, season: Number(r.season), code: String(r.code), event: String(r.name),
    start: String(r.start), end: r.end ?? null, city: r.city?.trim() || null, state: r.state?.trim() || null, inDays: daysBetween(week, String(r.start)),
    scheduled: Number(r.scheduled) === 1,
  })).sort((a, b) => a.start.localeCompare(b.start) || a.event.localeCompare(b.event) || a.team - b.team);
}

/** Followed teams' places in a power rankings week published last week; the five biggest movers when none is in it. */
export function rankingMoves(res: PowerRankingsResponse, teams: number[], from: string, week: string): DigestData["rankings"] {
  const w = res.week;
  // Only a week that came out in the week reported: last Friday's list, never an older one's movement as if new.
  if (!w || w.sample || w.published < from || w.published >= week) return null;
  const follow = new Set(teams);
  const mine = w.entries.filter((e) => follow.has(e.team));
  const row = (e: (typeof w.entries)[number]): RankingRow => ({ team: e.team, teamName: e.name, rank: e.rank, movement: e.movement });
  if (mine.length) return { week: w.week, title: w.title, rows: mine.map(row), fallback: false };
  const by = (m: Movement | null) => (m && (m.kind === "up" || m.kind === "down") ? m.by : 0);
  const movers = w.entries.filter((e) => by(e.movement) > 0).sort((a, b) => by(b.movement) - by(a.movement) || a.rank - b.rank).slice(0, 5);
  return movers.length ? { week: w.week, title: w.title, rows: movers.map(row), fallback: true } : null;
}

export interface BuildInput {
  week: string; season: number; followed: number[]; name: string | null;
  /** Tests: the power rankings as published (default: the live list). */
  rankings?: PowerRankingsResponse;
}

/** Everything one account's digest for `week` (a Monday, New York date) holds. */
export async function buildDigest(i: BuildInput): Promise<DigestData> {
  const from = addDays(i.week, -7), to = addDays(i.week, -1);
  const [weeks, predictions, upcoming, rankings] = await Promise.all([
    teamWeeks(i.followed, from, to, i.week),
    callRecords(i.followed, i.season, from, to),
    upcomingEvents(i.followed, i.week),
    i.rankings ? Promise.resolve(i.rankings) : latestRankings(i.week),
  ]);
  return {
    week: i.week, from, to, name: i.name, followed: i.followed,
    results: weeks,
    predictions,
    upcoming: upcoming.slice(0, MAX_UPCOMING), moreUpcoming: Math.max(0, upcoming.length - MAX_UPCOMING),
    rankings: rankingMoves(rankings, i.followed, from, i.week),
  };
}
