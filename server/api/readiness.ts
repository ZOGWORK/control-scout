// Is a season's derived data in step with its source results? The team records
// (team_season_records, written by computeRecords from the stats job and the live
// fast lane) are what "teams with results" counts read; until they are built, or
// while newer results wait for them, a zero there is not a fact. Two signals:
//
// - Data: results that the records are built from (scored qualification matches
//   at in-person events, with a listed team) exist, but the season has no records
//   at all → "preparing". This holds even when timestamps were copied along with
//   a restored database.
// - Time: the season's newest source results (its last completed sync,
//   seasons.last_sync, or the live fast lane's last stored results, kv
//   results:at:<season>) are newer than its last records build (kv
//   records:at:<season>, written by computeRecords) → "catching-up". So are records
//   with no build time that applies to the season at all (built before the stamp
//   existed, or restored without it): nothing shows they include the latest
//   results, so they aren't claimed up to date. The data cycle rebuilds such a
//   season (unprovenSeasons, server/data/cycle.ts), which stamps it.
import { all, get, kvGet } from "../db.js";
import { registerCache } from "../caches.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import type { SeasonReadiness } from "../../src/shared/home.js";

/** The kv key computeRecords stamps for a season: when the data it built from was read. */
export const recordsAtKey = (season: number) => `records:at:${season}`;
/** The kv key the live fast lane stamps for a season when it stores new results (its records rebuild is throttled). */
export const resultsAtKey = (season: number) => `results:at:${season}`;

const later = (a: string | null | undefined, b: string | null | undefined): string | null => (a && b ? (a > b ? a : b) : a || b || null);

/** When the season's source results last changed: its last completed sync, or live results stored since. */
async function resultsAt(season: number): Promise<string | null> {
  const [sync, live] = await Promise.all([
    get<{ last_sync: string | null }>("SELECT last_sync FROM seasons WHERE season = ?", [season]),
    kvGet<{ at: string }>(resultsAtKey(season)),
  ]);
  return later(sync?.last_sync, live?.at);
}

/** The season's records-build time. Before the per-season stamp existed: the stats job's own when it
 *  covered this season, and for the current season the live fast lane's (it only rebuilds live,
 *  current-season events); otherwise unknown rather than borrowed from another season. */
async function statsAt(season: number): Promise<string | null> {
  const [own, full, live] = await Promise.all([
    kvGet<{ at: string }>(recordsAtKey(season)),
    kvGet<{ at: string; seasons?: number[] }>("stats:last"),
    kvGet<{ at: string }>("records:last"),
  ]);
  if (own?.at) return own.at;
  const fullAt = full?.at && (!full.seasons || full.seasons.includes(season)) ? full.at : null;
  return later(fullAt, season === CURRENT_SEASON ? live?.at : null);
}

export async function seasonReadiness(season: number): Promise<SeasonReadiness> {
  const [source, at, records, played] = await Promise.all([
    resultsAt(season),
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
  const hasResults = played.length > 0;
  const state = hasResults && !records ? "preparing"
    : hasResults && (!at || (source && source > at)) ? "catching-up"
    : "ready";
  // Preparing: whatever stamp exists (a restored kv, a run that skipped the season) prepared nothing here.
  return { state, resultsAt: source, statsAt: state === "preparing" ? null : at };
}

/** Seasons whose records have no build time that applies to them (catching up with statsAt null), newest first. */
export async function unprovenSeasons(): Promise<number[]> {
  const seasons = await all<{ season: number }>("SELECT season FROM seasons ORDER BY season DESC");
  const out: number[] = [];
  for (const { season } of seasons) {
    const r = await seasonReadiness(Number(season));
    if (r.state === "catching-up" && r.statsAt == null) out.push(Number(season));
  }
  return out;
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
  const [source, own] = await Promise.all([resultsAt(season), kvGet<{ at: string }>(recordsAtKey(season))]);
  return `${source ?? ""}|${own?.at ?? ""}`;
}
