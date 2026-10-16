// /api/rankings: the world ranking (every rated team by its engine rating), filtered by place,
// paged, with movement against last week's snapshot (rules: src/shared/rankings.ts; snapshots:
// server/stats/rankings.ts). Built to be linked around: the whole ranked list is read once per data
// version and season, each page's JSON is cached with its ETag, and a repeat visit is a 304.
import { createHash } from "node:crypto";
import { all, get } from "../db.js";
import { CURRENT_SEASON, PREDICT_SEASONS } from "../data/seasons.js";
import { dataVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import {
  RANKED_MIN_MATCHES, RANKINGS_PAGE_SIZE, WEEK_MS, inPlaces, movementOf, placeKey, rankTeams, weekStartMs,
  type PlaceFilter, type RankingPlaces, type RankingRow, type RankingsResponse,
} from "../../src/shared/rankings.js";

interface TeamRow { rank: number; team: number; rating: number; name: string | null; state: string | null; country: string | null }

/** Short-lived memo (the stats job can rewrite a season's rows under a version it already set). */
function memo<T>(ttlMs: number, max = 200) {
  const m = new Map<string, { at: number; v: Promise<T> }>();
  const fn = (key: string, make: () => Promise<T>): Promise<T> => {
    const hit = m.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.v;
    const v = make();
    m.set(key, { at: Date.now(), v });
    v.catch(() => { if (m.get(key)?.v === v) m.delete(key); });
    if (m.size > max) m.delete(m.keys().next().value!);
    return v;
  };
  return Object.assign(fn, { clear: () => m.clear() });
}

const listMemo = memo<TeamRow[]>(120_000, 20);
const snapMemo = memo<Map<number, { rank: number; rating: number }>>(600_000, 20);
const pageMemo = memo<{ body: string; etag: string }>(120_000, 500);
const placesMemo = memo<Omit<RankingPlaces, "mine" | "weeks">>(600_000, 20);
registerCache("World rankings", () => { listMemo.clear(); snapMemo.clear(); pageMemo.clear(); placesMemo.clear(); });

const teamCols = "t.name, t.state, t.country";

/** The live ranking: every team with a rating from 3+ rated matches this season (team_season_stats). */
async function liveList(season: number): Promise<TeamRow[]> {
  return listMemo(`${await dataVersion()}|live|${season}`, async () => rankTeams(await all<TeamRow>(
    `SELECT s.team, s.rating_np rating, ${teamCols} FROM team_season_stats s LEFT JOIN teams t ON t.number = s.team
     WHERE s.season = ? AND s.rating_np IS NOT NULL AND s.rating_matches >= ?`, [season, RANKED_MIN_MATCHES])));
}

/** A snapshot week's ranking, with team names (as stored then: rank and rating; names as now). */
async function weekList(season: number, week: string): Promise<TeamRow[]> {
  return listMemo(`${await dataVersion()}|week|${season}|${week}`, async () => (await all<TeamRow>(
    `SELECT r.team, r.rank, r.rating, ${teamCols} FROM ranking_snapshots r LEFT JOIN teams t ON t.number = r.team
     WHERE r.season = ? AND r.week = ? ORDER BY r.rank`, [season, week])).map((r) => ({ ...r, rank: Number(r.rank), team: Number(r.team), rating: Number(r.rating) })));
}

/** A week's ranks and ratings by team (a written week never changes). */
function snapshot(season: number, week: string) {
  return snapMemo(`${season}|${week}`, async () => new Map((await all<{ team: number; rank: number; rating: number }>(
    "SELECT team, rank, rating FROM ranking_snapshots WHERE season = ? AND week = ?", [season, week])).map((r) => [Number(r.team), { rank: Number(r.rank), rating: Number(r.rating) }])));
}

/** The season's snapshot weeks, newest first. */
export async function snapshotWeeks(season: number): Promise<string[]> {
  return (await all<{ week: string }>("SELECT week FROM ranking_weeks WHERE season = ? ORDER BY week DESC", [season])).map((r) => r.week);
}

/**
 * The snapshot a ranking is compared with: the newest one at least a week older. The live ranking
 * (only the current season's: a finished season has no "this week") counts from `now`; a snapshot
 * week from its own instant, so it's the week exactly before it.
 */
export function baselineWeek(weeks: string[], season: number, week: string | null, now: number): string | null {
  if (!week && season !== CURRENT_SEASON) return null;
  const limit = (week ? weekStartMs(week) : now) - WEEK_MS;
  return weeks.find((w) => weekStartMs(w) <= limit) ?? null;
}

/** The season /rankings opens on: the current one once anyone is rated in it, else the latest that has ratings. */
export async function defaultRankingsSeason(): Promise<number> {
  const r = await get<{ season: number | null }>(
    `SELECT MAX(season) season FROM team_season_stats WHERE rating_np IS NOT NULL AND rating_matches >= ? AND season IN (${PREDICT_SEASONS.map(() => "?").join(",")})`,
    [RANKED_MIN_MATCHES, ...PREDICT_SEASONS]);
  return r?.season ? Number(r.season) : CURRENT_SEASON;
}

export interface RankingsQuery { season: number; week: string | null; places: PlaceFilter[]; page: number }

/** One page of the ranking (pure over the lists it reads; `now` picks last week's snapshot). */
export async function rankings(q: RankingsQuery, now = Date.now()): Promise<RankingsResponse> {
  const weeks = await snapshotWeeks(q.season);
  const list = q.week ? (weeks.includes(q.week) ? await weekList(q.season, q.week) : []) : await liveList(q.season);
  const base = baselineWeek(weeks, q.season, q.week, now);
  const prev = base ? await snapshot(q.season, base) : null;
  const matching = q.places.length ? list.filter((t) => inPlaces(t, q.places)) : list;
  const pages = Math.max(1, Math.ceil(matching.length / RANKINGS_PAGE_SIZE));
  const page = Math.min(Math.max(1, q.page), pages);
  const rows: RankingRow[] = matching.slice((page - 1) * RANKINGS_PAGE_SIZE, page * RANKINGS_PAGE_SIZE).map((t) => ({
    rank: t.rank, team: Number(t.team), name: t.name ?? null, state: t.state ?? null, country: t.country ?? null,
    rating: t.rating, ...movementOf(t, prev, Number(t.team)),
  }));
  return {
    season: q.season, week: q.week, asOf: q.week ? new Date(weekStartMs(q.week)).toISOString() : await dataVersion().then((v) => (v === "0" ? null : v)),
    baseline: base, weeks, places: q.places.map(placeKey), ranked: list.length, total: matching.length, page, pages, pageSize: RANKINGS_PAGE_SIZE, rows,
  };
}

/**
 * The page's JSON and its ETag (a hash of the body), cached by data version, season, week, places,
 * page and last week's snapshot: an unchanged page is served from memory, and as a 304 to a browser
 * that has it.
 */
export async function rankingsPage(q: RankingsQuery, now = Date.now()): Promise<{ body: string; etag: string }> {
  const weeks = await snapshotWeeks(q.season);
  const key = [await dataVersion(), q.season, q.week ?? "live", q.places.map(placeKey).join(","), q.page, baselineWeek(weeks, q.season, q.week, now) ?? "-", weeks[0] ?? "-", weeks.at(-1) ?? "-", weeks.length].join("|");
  return pageMemo(key, async () => {
    const body = JSON.stringify(await rankings(q, now));
    return { body, etag: `"rk-${createHash("sha1").update(body).digest("base64url").slice(0, 20)}"` };
  });
}

/** Countries (and their states) with ranked teams this season, most teams first; plus the snapshot weeks. */
export async function rankingPlaces(season: number, team: number | null): Promise<RankingPlaces> {
  const base = await placesMemo(`${await dataVersion()}|${season}`, async () => {
    const list = await liveList(season);
    const byCountry = new Map<string, { teams: number; states: Map<string, number> }>();
    for (const t of list) {
      if (!t.country) continue;
      let c = byCountry.get(t.country);
      if (!c) { c = { teams: 0, states: new Map() }; byCountry.set(t.country, c); }
      c.teams++;
      if (t.state) { const s = t.state.toUpperCase(); c.states.set(s, (c.states.get(s) ?? 0) + 1); }
    }
    return {
      season,
      countries: [...byCountry].map(([country, c]) => ({ country, teams: c.teams, states: [...c.states].map(([state, teams]) => ({ state, teams })).sort((a, b) => b.teams - a.teams || a.state.localeCompare(b.state)) }))
        .sort((a, b) => b.teams - a.teams || a.country.localeCompare(b.country)),
    };
  });
  let mine: string | null | undefined;
  if (team != null) {
    const t = await get<{ state: string | null; country: string | null }>("SELECT state, country FROM teams WHERE number = ?", [team]);
    mine = t?.country ? placeKey({ country: t.country, state: t.state ? t.state.toUpperCase() : null }) : null;
  }
  return { ...base, weeks: await snapshotWeeks(season), ...(mine !== undefined ? { mine } : {}) };
}
