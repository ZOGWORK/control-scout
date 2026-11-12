// A team's highlights page, /teams/<number>/highlights: the answer Search gives for "<number> highlights"
// (server/api/answers/highlights.ts teamHighlights, its standout matches of its latest season with matches), at an
// address of its own, so search engines can index the answer. The page (src/pages/TeamHighlightsPage.tsx) draws the
// same card as Search; its first HTML (server/seoMeta.ts) carries the whole answer as text.
//
// One rule for the page, its API, its robots tag and the sitemap: a team has a highlights page when its team page is
// one to index (server/indexable.ts) and it has a played match its robot was on the field for, scores reported, at an
// event that isn't remote (the matches teamHighlights reads: server/api/answers/matchSet.ts). Any other team's address
// is not found: never a page saying there is nothing, never a sitemap entry.
import { all, get } from "./db.js";
import { hasHighlightsSql, teamIndexableSql } from "./indexable.js";
import { teamHighlights } from "./api/answers/highlights.js";
import { answerVideo } from "./api/answers/video.js";
import type { SearchAnswer, SearchVideo } from "../src/shared/api.js";
import type { StatAnswer } from "../src/shared/searchStat.js";

/** The team's page address for its highlights. */
export const highlightsPath = (team: number) => `/teams/${team}/highlights`;

export interface TeamHighlightsPage {
  team: { number: number; name: string | null };
  stat: StatAnswer;
  /** The answer's match videos, as Search sends them with it (public ones only: the page is the same for everyone). */
  video?: SearchVideo;
}

/** The page's answer, or null when the team has no highlights page (not found). */
export async function teamHighlightsPage(n: number): Promise<TeamHighlightsPage | null> {
  if (!Number.isSafeInteger(n) || n < 1) return null;
  const t = await get<{ number: number; name: string | null }>(
    `SELECT t.number, t.name FROM teams t WHERE t.number = ? AND ${teamIndexableSql("t.number", "t.name")} AND ${hasHighlightsSql("t.number")}`, [n]);
  if (!t) return null;
  const team = { number: Number(t.number), name: t.name ?? null };
  const stat = await teamHighlights(team, undefined, undefined, undefined, "highlights");
  if (!stat || stat.none) return null;
  const answer: SearchAnswer = { q: `${n} highlights`, hits: [], pages: [], step: "deterministic", weak: false, stat };
  const video = await answerVideo(answer, Date.now(), { userId: null, teams: [] }).catch(() => undefined);
  return { team, stat, ...(video ? { video } : {}) };
}

/**
 * Every team with a highlights page and its lastmod: the latest day its highlights' season changed, the last day of
 * a match it played that season or a later change the source marked on one of those events. Never the build date.
 */
export async function highlightsEntries(): Promise<{ number: number; lastmod: string | null }[]> {
  return all<{ number: number; lastmod: string | null }>(
    `WITH h AS (
       SELECT hx.team, hx.season, substr(COALESCE(hm.time, he.end, he.start), 1, 10) played, substr(he.upstream_updated, 1, 10) changed
       FROM match_teams hx
       JOIN matches hm ON hm.season = hx.season AND hm.code = hx.code AND hm.level = hx.level AND hm.series = hx.series AND hm.number = hx.number
       JOIN events he ON he.season = hx.season AND he.code = hx.code
       WHERE hx.on_field = 1 AND hm.played = 1 AND hm.red_np IS NOT NULL AND hm.blue_np IS NOT NULL AND COALESCE(he.remote, 0) = 0),
     latest AS (SELECT team, MAX(season) season FROM h GROUP BY team)
     SELECT t.number, MAX(MAX(COALESCE(h.played, ''), COALESCE(h.changed, ''))) lastmod
     FROM teams t JOIN latest l ON l.team = t.number JOIN h ON h.team = l.team AND h.season = l.season
     WHERE ${teamIndexableSql("t.number", "t.name")}
     GROUP BY t.number ORDER BY t.number`);
}
