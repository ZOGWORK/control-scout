// Is a season's derived data in step with its source results? The team records
// (team_season_records, written by computeRecords from the stats job and the live
// fast lane) are what "teams with results" counts read; until they are built, or
// while a newer sync waits for them, a zero there is not a fact. Two signals:
//
// - Data: results that the records are built from (scored qualification matches
//   at in-person events, with a listed team) exist, but the season has no records
//   at all → "preparing". This holds even when timestamps were copied along with
//   a restored database.
// - Time: the season's last completed sync (seasons.last_sync, written at the end
//   of syncSeason) is newer than the season's last records build
//   (kv records:at:<season>, written by computeRecords) → "catching-up".
import { all, get, kvGet } from "../db.js";
import { registerCache } from "../caches.js";
import type { SeasonReadiness } from "../../src/shared/home.js";

/** The kv key computeRecords stamps for a season: when the data it built from was read. */
export const recordsAtKey = (season: number) => `records:at:${season}`;

/** The season's records-build time. Before the per-season stamp existed, the stats job's own
 *  (when it covered this season) and the live fast lane's, whichever is newer. */
async function statsAt(season: number): Promise<string | null> {
  const [own, full, live] = await Promise.all([
    kvGet<{ at: string }>(recordsAtKey(season)),
    kvGet<{ at: string; seasons?: number[] }>("stats:last"),
    kvGet<{ at: string }>("records:last"),
  ]);
  if (own?.at) return own.at;
  const fullAt = full?.at && (!full.seasons || full.seasons.includes(season)) ? full.at : null;
  const liveAt = live?.at ?? null;
  return fullAt && liveAt ? (liveAt > fullAt ? liveAt : fullAt) : fullAt ?? liveAt;
}

export async function seasonReadiness(season: number): Promise<SeasonReadiness> {
  const [sync, at, records, played] = await Promise.all([
    get<{ last_sync: string | null }>("SELECT last_sync FROM seasons WHERE season = ?", [season]),
    statsAt(season),
    get<{ one: number }>("SELECT 1 one FROM team_season_records WHERE season = ? LIMIT 1", [season]),
    // What computeRecords counts: a listed (non-surrogate) team in a scored qualification match at an in-person event.
    all<{ one: number }>(
      `SELECT 1 one FROM match_teams mt
       JOIN matches m ON m.season = mt.season AND m.code = mt.code AND m.level = mt.level AND m.series = mt.series AND m.number = mt.number
       JOIN events e ON e.season = mt.season AND e.code = mt.code
       WHERE mt.season = ? AND mt.level = 'qual' AND mt.surrogate = 0 AND m.played = 1
         AND m.red_np IS NOT NULL AND m.blue_np IS NOT NULL AND e.remote = 0
       LIMIT 1`, [season]),
  ]);
  const resultsAt = sync?.last_sync ?? null;
  const hasResults = played.length > 0;
  const state = hasResults && !records ? "preparing"
    : hasResults && resultsAt && at && resultsAt > at ? "catching-up"
    : "ready";
  return { state, resultsAt, statsAt: at };
}

/** A season's readiness, reused for half a minute (the directory asks on every page; its scan can
 *  read a whole season's lineups when nothing has been played). */
const READINESS_TTL_MS = 30_000;
const cached = new Map<number, { at: number; value: Promise<SeasonReadiness> }>();
registerCache("Season readiness", () => cached.clear());
export function cachedReadiness(season: number): Promise<SeasonReadiness> {
  const hit = cached.get(season);
  if (hit && Date.now() - hit.at < READINESS_TTL_MS) return hit.value;
  const value = seasonReadiness(season);
  cached.set(season, { at: Date.now(), value });
  value.catch(() => { if (cached.get(season)?.value === value) cached.delete(season); });
  return value;
}

/** What a cached answer built from the season's records depends on (see home.ts overviewKey). */
export async function readinessKey(season: number): Promise<string> {
  const [sync, own] = await Promise.all([
    get<{ last_sync: string | null }>("SELECT last_sync FROM seasons WHERE season = ?", [season]),
    kvGet<{ at: string }>(recordsAtKey(season)),
  ]);
  return `${sync?.last_sync ?? ""}|${own?.at ?? ""}`;
}
