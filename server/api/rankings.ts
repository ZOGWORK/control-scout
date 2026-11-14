// /api/rankings: the world ranking (every rated team by its engine rating), filtered by place,
// paged, with movement against last week's snapshot (rules: src/shared/rankings.ts; snapshots:
// server/stats/rankings.ts). Built to be linked around: the whole ranked list is read once per data
// version and season, each page's JSON is cached with its ETag, and a repeat visit is a 304.
// The reads and the page itself are shared with the app offline (src/shared/rankingsBoard.ts): a saved
// season pack runs the same SQL and the same assembly, so it shows the same numbers.
import { createHash } from "node:crypto";
import { all, get } from "../db.js";
import { CURRENT_SEASON, PREDICT_SEASONS } from "../data/seasons.js";
import { dataVersion } from "../predict/engine.js";
import { registerCache } from "../caches.js";
import { RANKED_MIN_MATCHES, inPlaces, placeKey, type PlaceFilter, type RankingPlaces, type RankingsResponse } from "../../src/shared/rankings.js";
import {
  baselineWeek as sharedBaseline, rankingCountries, rankingsFrom, readLiveList, readMine, readSnapshot, readSwing, readWeekList, readWeeks,
  type RankingRows, type RankingTeamRow, type RankingsQuery,
} from "../../src/shared/rankingsBoard.js";

export type { RankingsQuery };

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

const listMemo = memo<RankingTeamRow[]>(120_000, 20);
const snapMemo = memo<Map<number, { rank: number; rating: number }>>(600_000, 20);
const pageMemo = memo<{ body: string; etag: string }>(120_000, 500);
const placesMemo = memo<Omit<RankingPlaces, "mine" | "weeks">>(600_000, 20);
registerCache("World rankings", () => { listMemo.clear(); snapMemo.clear(); pageMemo.clear(); placesMemo.clear(); });

const rows: RankingRows = (sql, args) => all(sql, args);

/** The live ranking: every team with a rating from 3+ rated matches this season (team_season_stats). */
async function liveList(season: number): Promise<RankingTeamRow[]> {
  return listMemo(`${await dataVersion()}|live|${season}`, () => readLiveList(rows, season));
}

/** A team's place in one region's live ranking for a season: its position among the region's ranked teams, how many
 *  there are, and its world rank (what /rankings?region= lists). Null when the team isn't ranked that season. */
export async function regionPlace(season: number, team: number, place: PlaceFilter): Promise<{ rank: number; of: number; world: number } | null> {
  const list = await liveList(season);
  const here = list.filter((t) => inPlaces(t, [place]));
  const i = here.findIndex((t) => Number(t.team) === team);
  return i < 0 ? null : { rank: i + 1, of: here.length, world: here[i].rank };
}

/** A snapshot week's ranking, with team names (as stored then: order and rating; names as now). */
async function weekList(season: number, week: string): Promise<RankingTeamRow[]> {
  return listMemo(`${await dataVersion()}|week|${season}|${week}`, () => readWeekList(rows, season, week));
}

/** A week's ranks and ratings by team, numbered as weekList numbers them. A written week's rows never change, but
 *  which teams count does (a team renamed to a placeholder by a sync), so the key carries the data version as the
 *  live list's does: both always agree on who is ranked. */
async function snapshot(season: number, week: string) {
  return snapMemo(`${await dataVersion()}|${season}|${week}`, () => readSnapshot(rows, season, week));
}

/** The season's snapshot weeks, newest first. */
export async function snapshotWeeks(season: number): Promise<string[]> {
  return readWeeks(rows, season);
}

/**
 * The snapshot a ranking is compared with: the newest one at least a week older. The live ranking
 * (only the current season's: a finished season has no "this week") counts from `now`; a snapshot
 * week from its own instant, so it's the week exactly before it.
 */
export function baselineWeek(weeks: string[], season: number, week: string | null, now: number): string | null {
  return sharedBaseline(weeks, season, week, now, CURRENT_SEASON);
}

/** The season /rankings opens on: the current one once anyone is rated in it, else the latest that has ratings. */
export async function defaultRankingsSeason(): Promise<number> {
  const r = await get<{ season: number | null }>(
    `SELECT MAX(season) season FROM team_season_stats WHERE rating_np IS NOT NULL AND rating_matches >= ? AND season IN (${PREDICT_SEASONS.map(() => "?").join(",")})`,
    [RANKED_MIN_MATCHES, ...PREDICT_SEASONS]);
  return r?.season ? Number(r.season) : CURRENT_SEASON;
}

/** One page of the ranking (pure over the lists it reads; `now` picks last week's snapshot). */
export async function rankings(q: RankingsQuery, now = Date.now()): Promise<RankingsResponse> {
  return rankingsFrom(q, {
    weeks: await snapshotWeeks(q.season),
    list: (week) => (week ? weekList(q.season, week) : liveList(q.season)),
    snapshot: (week) => snapshot(q.season, week),
    swing: (teams) => readSwing(rows, q.season, teams),
    asOf: await dataVersion().then((v) => (v === "0" ? null : v)),
    currentSeason: CURRENT_SEASON,
  }, now);
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
  const base = await placesMemo(`${await dataVersion()}|${season}`, async () => ({ season, countries: rankingCountries(await liveList(season)) }));
  const mine = team != null ? await readMine(rows, team) : undefined;
  return { ...base, weeks: await snapshotWeeks(season), ...(mine !== undefined ? { mine } : {}) };
}
