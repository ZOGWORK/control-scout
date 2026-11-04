// The season search reads when a query names none (docs/search.md, "Season default"): the latest completed season,
// the newest one whose FIRST Championship has finished in the data. A season that has only just started (a few weeks
// of meets) would make every leaderboard and every "this season" answer nearly empty, so it waits until it's over.
// "This season" is that season too, and "last season" the one before it. A season the query names always wins.
// Read from the stored events, never a fixed year: once the 2026–27 Championship is over, 2026–27 is the default.
import { seasonLabel } from "../../../src/shared/format.js";
import { CURRENT_SEASON } from "../../data/seasons.js";
import { get } from "../../db.js";
import { CHAMPIONSHIP_TYPE } from "./clauses.js";

const TTL_MS = 10 * 60_000;
let cached: { season: number; at: number } | null = null;

/** The completed season from the data: the newest season with a FIRST Championship event that has ended, else (no
 *  Championship stored at all) the newest season with matches before the current one. */
async function readCompleted(today: string): Promise<number> {
  const c = await get<{ s: number | null }>("SELECT MAX(season) s FROM events WHERE type = ? AND COALESCE(end, start) < ?", [CHAMPIONSHIP_TYPE, today]);
  if (c?.s != null) return Number(c.s);
  const m = await get<{ s: number | null }>("SELECT MAX(season) s FROM team_season_stats WHERE matches > 0");
  return m?.s != null ? Math.min(Number(m.s), CURRENT_SEASON - 1) : CURRENT_SEASON - 1;
}

/** Reads the completed season again once `TTL_MS` has passed (search calls this before it reads a query). */
export async function refreshSearchSeason(now = Date.now()): Promise<number> {
  if (cached && now - cached.at < TTL_MS) return cached.season;
  cached = { season: await readCompleted(new Date(now).toISOString().slice(0, 10)), at: now };
  return cached.season;
}

/** The season a query with no season named means, as last read (the readers are synchronous). */
export const searchSeason = (): number => cached?.season ?? CURRENT_SEASON - 1;

/** Forgets the season read (tests that change the stored events). */
export function resetSearchSeason(): void { cached = null; }

/** The answer's note on the season it chose, when the query named none. */
export const searchSeasonWhy = (s = searchSeason()) => `With no season named, the season is ${seasonLabel(s)}, the latest completed season (its FIRST Championship has finished).`;
