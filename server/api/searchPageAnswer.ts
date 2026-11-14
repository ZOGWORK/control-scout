// The /search page's answer, read one way by GET /api/search?answer=1 (server/app.ts) and by Control Scout Lite's
// search page (server/lite/routes.ts), so the two show the same answer for the same words.
import { SEASON_NUMBERS } from "../data/seasons.js";
import { SEARCH_PAGE_LIMIT } from "../../src/shared/search.js";
import { teamParts } from "../../src/shared/searchPage.js";
import type { SearchAnswer, SearchHit } from "../../src/shared/api.js";
import { MAX_QUERY } from "./searchAnswer.js";
import { withSeason } from "./answers/season.js";
import { teamHighlights } from "./answers/highlights.js";
import { loneTeamHit } from "./searchLayers.js";
import { withEventParents } from "./searchEvents.js";
import { withTeamStats } from "./searchTeamStats.js";

/** ?season=2024 (the answer's season picker; /search's ?in=): the query asked about that season instead, whatever
 *  season it names (server/api/answers/season.ts withSeason). A season search holds no data for is ignored. */
export const pickedSeasonOf = (raw: unknown): number | null => { const s = Number(raw); return SEASON_NUMBERS.includes(s) ? s : null; };
export const pickedQuery = async (rawQ: unknown, rawSeason: unknown): Promise<string> => {
  const q = String(rawQ ?? ""), s = pickedSeasonOf(rawSeason);
  return s != null && q.trim() ? withSeason(q.slice(0, MAX_QUERY), s) : q;
};

/** A search for one team alone ("4215") on the results page: the team's highlights as its answer
 *  (server/api/answers/highlights.ts). Never in the header's short list, and never for a topic about the team (a
 *  section, facts, an event pick). A season asked for ("4215 2024-25") is the one shown. Nor for a question about the
 *  team search couldn't answer ("will 4215 win …", "how many teams named …"). */
export async function withHighlights(ans: SearchAnswer, limit: number): Promise<SearchAnswer> {
  const lone = limit >= SEARCH_PAGE_LIMIT ? loneTeamHit(ans) : undefined;
  const highlights = lone ? await teamHighlights({ number: Number(lone.ref), name: teamParts(lone.title)?.name ?? null }, lone.linkSeason).catch(() => null) : null;
  return highlights ? { ...ans, stat: highlights } : ans;
}

/** The hits as the page lists them: a division under its event, team rows with their season numbers
 *  (server/api/searchTeamStats.ts), added once, on the answer that's sent. */
export const answerHits = (hits: SearchHit[]): Promise<SearchHit[]> => withEventParents(hits).then(withTeamStats);
