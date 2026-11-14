// Two or more teams' numbers as one comparison (src/shared/searchStat.ts "compare"), built to the search results
// guide's contract (.claude/search-viz-guide-2026-11-05.txt §10): a row per metric, Total first and then the rest by
// the size of the gap, each row on its own scale from zero with that scale's maximum printed, each team's value at the
// end of its bar, the gap once. The scale of a season stat is the season's own (the highest any team reached that
// season, rounded up), so the same value draws the same bar on every card that season. The page draws it
// (src/components/search/page/CompareCard.tsx); this decides nothing the numbers don't: a tie, or a value missing on
// either side, names no one. The rows are pure (src/shared/searchVersus.ts: the event pack builds the same card with
// no signal); the season scales are read here.
import { get } from "../../db.js";
import { niceMax, type StatColumn } from "../../../src/shared/searchVersus.js";

export { compareBlock, compareRow, compareRows, decidedText, decidingPhase, leadHeadline, niceMax, winShare, type CompareInput, type StatColumn } from "../../../src/shared/searchVersus.js";

const cache = new Map<string, { at: number; v: Record<string, number | null> }>();

/** Each stat's scale for a season: the highest any team reached that season, rounded up (niceMax). Fixed per
 *  season, so two cards with the same value draw the same bar. Read once an hour per season. */
export async function seasonScale(season: number, cols: readonly StatColumn[]): Promise<Record<string, number | null>> {
  const key = `${season}|${cols.join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
  const row = await get<Record<string, number | null>>(`SELECT ${cols.map((c) => `MAX(${c}) ${c}`).join(", ")} FROM team_season_stats WHERE season = ? AND matches > 0`, [season]);
  const v = Object.fromEntries(cols.map((c) => [c, row?.[c] != null && Number(row[c]) > 0 ? niceMax(Number(row[c])) : null]));
  cache.set(key, { at: Date.now(), v });
  return v;
}

const awardCache = new Map<string, { at: number; v: number | null }>();
/** The most awards any one team won in a season (or in all seasons, null): the awards rows' scale. */
export async function awardScale(season: number | null): Promise<number | null> {
  const key = String(season);
  const hit = awardCache.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.v;
  const row = await get<{ n: number | null }>(`SELECT MAX(n) n FROM (SELECT team, COUNT(*) n FROM awards${season != null ? " WHERE season = ?" : ""} GROUP BY team) x`, season != null ? [season] : []);
  const v = row?.n ? niceMax(Number(row.n)) : null;
  awardCache.set(key, { at: Date.now(), v });
  return v;
}
