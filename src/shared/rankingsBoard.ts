// The world ranking's reads and its page, shared by the server (server/api/rankings.ts, over its database) and the
// app offline (src/lib/offline/boards.ts, over a saved season pack): the same SQL and the same assembly, so a page
// read from the pack has exactly the server's numbers. Rules: src/shared/rankings.ts.
import {
  RANKED_MIN_MATCHES, RANKINGS_PAGE_SIZE, WEEK_MS, inPlaces, movementOf, placeKey, rankTeams, weekStartMs,
  type PlaceFilter, type RankingPlaces, type RankingRow, type RankingsResponse,
} from "./rankings";
import { teamPageSql } from "./teamPages";
import { swingCell, type SwingCell } from "./reliability";

/** Rows as plain objects, from the server's database or a saved pack (sync or async). */
export type RankingRows = <T = any>(sql: string, args: (string | number)[]) => Promise<T[]> | T[];

export interface RankingTeamRow { rank: number; team: number; rating: number; name: string | null; state: string | null; country: string | null }

const teamCols = "t.name, t.state, t.country";
// Teams without a public page (src/shared/teamPages.ts: placeholders like "Off-Season Demo Team") are never
// ranked: the live list leaves them out before ranking, and a stored week is renumbered without them (in its
// stored order), so the teams below move up a place and no rank is skipped.
const ranked = teamPageSql("s.team", "t.name"), rankedNoJoin = teamPageSql("s.team");

/** The live ranking: every team with a rating from 3+ rated matches this season (team_season_stats). */
export async function readLiveList(all: RankingRows, season: number): Promise<RankingTeamRow[]> {
  return rankTeams(await all<RankingTeamRow>(
    `SELECT s.team, s.rating_np rating, ${teamCols} FROM team_season_stats s LEFT JOIN teams t ON t.number = s.team
     WHERE s.season = ? AND s.rating_np IS NOT NULL AND s.rating_matches >= ? AND ${ranked}`, [season, RANKED_MIN_MATCHES]));
}

/** A snapshot week's ranking, with team names (as stored then: order and rating; names as now). */
export async function readWeekList(all: RankingRows, season: number, week: string): Promise<RankingTeamRow[]> {
  return (await all<RankingTeamRow>(
    `SELECT s.team, s.rating, ${teamCols} FROM ranking_snapshots s LEFT JOIN teams t ON t.number = s.team
     WHERE s.season = ? AND s.week = ? AND ${ranked} ORDER BY s.rank`, [season, week])).map((r, i) => ({ ...r, rank: i + 1, team: Number(r.team), rating: Number(r.rating) }));
}

/** A week's ranks and ratings by team, numbered as readWeekList numbers them. */
export async function readSnapshot(all: RankingRows, season: number, week: string): Promise<Map<number, { rank: number; rating: number }>> {
  return new Map((await all<{ team: number; rating: number }>(
    `SELECT s.team, s.rating FROM ranking_snapshots s WHERE s.season = ? AND s.week = ? AND ${rankedNoJoin} ORDER BY s.rank`, [season, week]))
    .map((r, i) => [Number(r.team), { rank: i + 1, rating: Number(r.rating) }]));
}

/** The season's snapshot weeks, newest first. */
export async function readWeeks(all: RankingRows, season: number): Promise<string[]> {
  return (await all<{ week: string }>("SELECT week FROM ranking_weeks WHERE season = ? ORDER BY week DESC", [season])).map((r) => r.week);
}

/** Season swing (the consistency stat) of these teams. */
export async function readSwing(all: RankingRows, season: number, teams: number[]): Promise<Map<number, SwingCell>> {
  if (!teams.length) return new Map();
  return new Map((await all<{ team: number; swing: number | null; contrib_n: number }>(
    `SELECT team, swing, contrib_n FROM team_reliability WHERE season = ? AND code = '' AND team IN (${teams.map(() => "?").join(",")})`,
    [season, ...teams])).map((r) => [Number(r.team), swingCell(r.swing == null ? null : Number(r.swing), Number(r.contrib_n))]));
}

/** A team's home as a place key ("USA:TX", or the country alone), null when its country isn't known. */
export async function readMine(all: RankingRows, team: number): Promise<string | null> {
  const t = (await all<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [team]))[0];
  return t?.country ? placeKey({ country: t.country, state: t.state ? t.state.toUpperCase() : null }) : null;
}

/**
 * The snapshot a ranking is compared with: the newest one at least a week older. The live ranking
 * (only the current season's: a finished season has no "this week") counts from `now`; a snapshot
 * week from its own instant, so it's the week exactly before it.
 */
export function baselineWeek(weeks: string[], season: number, week: string | null, now: number, currentSeason: number): string | null {
  if (!week && season !== currentSeason) return null;
  const limit = (week ? weekStartMs(week) : now) - WEEK_MS;
  return weeks.find((w) => weekStartMs(w) <= limit) ?? null;
}

export interface RankingsQuery { season: number; week: string | null; places: PlaceFilter[]; page: number }

/** Where one page of the ranking reads from: the server memoizes these, a saved pack reads them directly. */
export interface RankingSource {
  weeks: string[];
  /** The ranked list: the live one (week null) or a snapshot week's. */
  list: (week: string | null) => Promise<RankingTeamRow[]>;
  /** Last week's ranks and ratings (null: no movement shown). */
  snapshot: (week: string) => Promise<Map<number, { rank: number; rating: number }> | null>;
  swing: (teams: number[]) => Promise<Map<number, SwingCell>>;
  /** The live ranking's data time (ISO), null when unknown. */
  asOf: string | null;
  currentSeason: number;
}

/** One page of the ranking (pure over its source; `now` picks last week's snapshot). */
export async function rankingsFrom(q: RankingsQuery, src: RankingSource, now: number): Promise<RankingsResponse> {
  const weeks = src.weeks;
  const list = q.week ? (weeks.includes(q.week) ? await src.list(q.week) : []) : await src.list(null);
  const base = baselineWeek(weeks, q.season, q.week, now, src.currentSeason);
  const prev = base ? await src.snapshot(base) : null;
  const matching = q.places.length ? list.filter((t) => inPlaces(t, q.places)) : list;
  const pages = Math.max(1, Math.ceil(matching.length / RANKINGS_PAGE_SIZE));
  const page = Math.min(Math.max(1, q.page), pages);
  const slice = matching.slice((page - 1) * RANKINGS_PAGE_SIZE, page * RANKINGS_PAGE_SIZE);
  // Swing (the consistency stat) is today's, so the live ranking shows it and a snapshot week doesn't.
  const swing = q.week || !slice.length ? null : await src.swing(slice.map((t) => Number(t.team)));
  const rows: RankingRow[] = slice.map((t) => ({
    rank: t.rank, team: Number(t.team), name: t.name ?? null, state: t.state ?? null, country: t.country ?? null,
    rating: t.rating, ...movementOf(t, prev, Number(t.team)),
    ...(swing?.has(Number(t.team)) ? { swing: swing.get(Number(t.team))! } : {}),
  }));
  return {
    season: q.season, week: q.week, asOf: q.week ? new Date(weekStartMs(q.week)).toISOString() : src.asOf,
    // A source without last week's snapshot (a saved pack older than a week) shows no movement, and says so.
    baseline: prev ? base : null, weeks, places: q.places.map(placeKey), ranked: list.length, total: matching.length, page, pages, pageSize: RANKINGS_PAGE_SIZE, rows,
  };
}

/** Countries (and their states) with ranked teams, most teams first. */
export function rankingCountries(list: { country: string | null; state: string | null }[]): RankingPlaces["countries"] {
  const byCountry = new Map<string, { teams: number; states: Map<string, number> }>();
  for (const t of list) {
    if (!t.country) continue;
    let c = byCountry.get(t.country);
    if (!c) { c = { teams: 0, states: new Map() }; byCountry.set(t.country, c); }
    c.teams++;
    if (t.state) { const s = t.state.toUpperCase(); c.states.set(s, (c.states.get(s) ?? 0) + 1); }
  }
  return [...byCountry].map(([country, c]) => ({ country, teams: c.teams, states: [...c.states].map(([state, teams]) => ({ state, teams })).sort((a, b) => b.teams - a.teams || a.state.localeCompare(b.state)) }))
    .sort((a, b) => b.teams - a.teams || a.country.localeCompare(b.country));
}
