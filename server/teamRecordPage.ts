// A team's record-split page, /teams/<number>/record-split: the answer Search gives for "<number> record" (its
// latest season with matches: server/api/answers/families/matches.ts, intent "record"), whose card splits the record
// into qualification and playoff matches. At an address of its own, so search engines can index the answer. The page
// (src/pages/TeamRecordSplitPage.tsx) draws the same card as Search; its first HTML (server/seoMeta.ts) carries the
// whole answer as text.
//
// One rule for the page, its API, the team page's link and the sitemap: a team has a record-split page when its team
// page is one to index (server/indexable.ts) and its latest season with matches (the one Search's "record" reads:
// server/api/answers/index.ts latestSeason) holds both a qualification match and a playoff match on its record. Any
// other team's address is not found: never a page with half a split, never a sitemap entry.
import { all, get } from "./db.js";
import { teamIndexableSql } from "./indexable.js";
import { searchAnswer } from "./api/searchAnswer.js";
import { OFFICIAL_TYPES } from "../src/shared/eventRecord.js";
import { SEARCH_PAGE_LIMIT } from "../src/shared/search.js";
import type { StatAnswer, StatBlock } from "../src/shared/searchStat.js";

/** The team's page address for its record split. */
export const recordSplitPath = (team: number) => `/teams/${team}/record-split`;

export interface TeamRecordPage {
  team: { number: number; name: string | null };
  stat: StatAnswer;
}

export type SplitRecord = Extract<StatBlock, { kind: "record" }> & { split: NonNullable<Extract<StatBlock, { kind: "record" }>["split"]> };

/** The answer's record block, when it splits the record (the matches hold both qualifications and playoffs). */
export const splitOf = (stat: StatAnswer): SplitRecord | null =>
  (stat.blocks.find((b) => b.kind === "record" && !!b.split) as SplitRecord | undefined) ?? null;

const OFFICIAL = OFFICIAL_TYPES.map((t) => `'${t}'`).join(", ");

/**
 * The teams whose latest season holds a split record, and each one's lastmod: the latest day that season changed (the
 * last match it played that season, or a later change the source marked on one of those events). Never the build day.
 * The rows are the matches Search's record reads (server/api/answers/matchSet.ts: played, both scores reported, not
 * remote; official events only), on the team's record (src/shared/eventRecord.ts onRecord: a qualification unless the
 * team was a surrogate, a playoff match when it was on the field). Its season is the latest with one of those it was
 * on the field for (latestSeason). `team`: one team only.
 */
export async function recordSplitLastmods(team?: number): Promise<{ number: number; lastmod: string | null }[]> {
  return all<{ number: number; lastmod: string | null }>(
    `WITH r AS (
       SELECT rx.team, rx.season, rx.level, COALESCE(rx.on_field, 1) on_field,
              substr(COALESCE(rm.time, re.end, re.start), 1, 10) played, substr(re.upstream_updated, 1, 10) changed
       FROM match_teams rx
       JOIN matches rm ON rm.season = rx.season AND rm.code = rx.code AND rm.level = rx.level AND rm.series = rx.series AND rm.number = rx.number
       JOIN events re ON re.season = rx.season AND re.code = rx.code
       WHERE ${team != null ? "rx.team = ? AND " : ""}rm.played = 1 AND rm.red_np IS NOT NULL AND rm.blue_np IS NOT NULL AND COALESCE(re.remote, 0) = 0
         AND re.type IN (${OFFICIAL})
         AND CASE WHEN rx.level = 'qual' THEN COALESCE(rx.surrogate, 0) = 0 ELSE COALESCE(rx.on_field, 1) = 1 END),
     latest AS (SELECT team, MAX(season) season FROM r WHERE on_field = 1 GROUP BY team)
     SELECT r.team number, MAX(MAX(COALESCE(r.played, ''), COALESCE(r.changed, ''))) lastmod
     FROM latest l JOIN r ON r.team = l.team AND r.season = l.season
     GROUP BY r.team HAVING SUM(r.level = 'playoff') > 0 AND SUM(r.level <> 'playoff') > 0
     ORDER BY r.team`, team != null ? [team] : []);
}

/** Whether the team has a record-split page (the team page's link to it). */
export async function hasRecordSplit(n: number): Promise<boolean> {
  if (!(await get(`SELECT 1 FROM teams t WHERE t.number = ? AND ${teamIndexableSql("t.number", "t.name")}`, [n]))) return false;
  return (await recordSplitLastmods(n)).length > 0;
}

/** The page's answer, or null when the team has no record-split page (not found). */
export async function teamRecordPage(n: number): Promise<TeamRecordPage | null> {
  if (!Number.isSafeInteger(n) || n < 1) return null;
  if (!(await hasRecordSplit(n))) return null;
  // Search's own answer to "<n> record", so the page's numbers are the card's.
  const a = await searchAnswer(`${n} record`, { full: true, limit: SEARCH_PAGE_LIMIT, learn: false });
  const stat = a.stat;
  if (!stat || stat.none || stat.intent !== "record" || stat.team?.number !== n || !splitOf(stat)) return null;
  return { team: { number: n, name: stat.team.name ?? null }, stat };
}
