// An event's highlights page, /events/<season>/<code>/highlights: the answer Search gives for "<event> highlights"
// (server/api/query/highlights.ts highlightsAnswer, the event's standout matches: best score, biggest margin, latest
// playoff match, best Auto, closest finish, biggest upset), at an address of its own, so search engines can index the
// answer. The page (src/pages/EventHighlightsPage.tsx) draws the same card as Search; its first HTML
// (server/seoMeta.ts) carries the whole answer as text.
//
// One rule for the page, its API, the event page's link and the sitemap: an event has a highlights page when its event
// page is one to index (server/indexable.ts: a code an address can carry, teams or a played match) and it has a match
// its highlights can pick from (the scope Search reads for an event named: server/api/query/matchFind.ts where, over
// the event and its divisions, played, all four scores reported, not remote; official events' matches only, unless the
// event itself isn't official, as Search reads an off-season event named). Any other event's address is not found:
// never a page saying there is nothing, never a sitemap entry.
import { all, get } from "./db.js";
import { eventHasDataSql, isReachableEventCode } from "./indexable.js";
import { highlightsAnswer, type HighlightFind } from "./api/query/highlights.js";
import { shortEvent } from "./api/answers/matchSet.js";
import { answerVideo } from "./api/answers/video.js";
import { OFFICIAL_TYPES } from "../src/shared/eventRecord.js";
import { dateRange, place } from "../src/shared/format.js";
import { eventPath } from "../src/shared/eventCode.js";
import type { SearchAnswer, SearchVideo } from "../src/shared/api.js";
import type { StatAnswer } from "../src/shared/searchStat.js";

/** The event's page address for its highlights. */
export const eventHighlightsPath = (season: number, code: string) => `${eventPath(season, code)}/highlights`;

export interface EventHighlightsPage {
  event: { season: number; code: string; name: string };
  stat: StatAnswer;
  /** The answer's match videos, as Search sends them with it (public ones only: the page is the same for everyone). */
  video?: SearchVideo;
}

const OFFICIAL = OFFICIAL_TYPES.map((t) => `'${t}'`).join(", ");

/**
 * SQL (constants only), for the event in `ev` (an events alias): it has a match its highlights can pick from. The
 * matches Search's highlights read for an event named (matchFind.ts where, with scopeEvents: the event and the
 * divisions that feed it), so the page is never empty.
 */
export const hasEventHighlightsSql = (ev: string): string =>
  `EXISTS (SELECT 1 FROM events he
     WHERE he.season = ${ev}.season AND (he.code = ${ev}.code OR he.division_code = ${ev}.code) AND COALESCE(he.remote, 0) = 0
       AND (COALESCE(${ev}.type, '') NOT IN (${OFFICIAL}) OR he.type IN (${OFFICIAL}))
       AND EXISTS (SELECT 1 FROM matches hm WHERE hm.season = he.season AND hm.code = he.code
         AND hm.played = 1 AND hm.red_np IS NOT NULL AND hm.blue_np IS NOT NULL AND hm.red_total IS NOT NULL AND hm.blue_total IS NOT NULL))`;

interface EventRow { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null; city: string | null; state: string | null }

/** The event, when it has a highlights page (the rule above); null otherwise. `code` as stored. */
async function eventWithHighlights(season: number, code: string): Promise<EventRow | null> {
  if (!Number.isSafeInteger(season) || season < 2000 || season > 2100 || !isReachableEventCode(code)) return null;
  const e = await get<EventRow>(
    `SELECT e.season, e.code, e.name, e.type, e.start, e.end, e.city, e.state FROM events e
     WHERE e.season = ? AND e.code = ? AND ${eventHasDataSql("e")} AND ${hasEventHighlightsSql("e")}`, [season, code]);
  return e ? { ...e, season: Number(e.season) } : null;
}

/** Whether the event has a highlights page (the event page's link to it). */
export async function hasEventHighlights(season: number, code: string): Promise<boolean> {
  return !!(await eventWithHighlights(season, code));
}

/** The scope Search reads for this event named (server/api/query/execute.ts highlights): its matches, in its season,
 *  under its name as that season held it; an event that isn't official reads its own matches all the same. */
export function eventHighlightFind(e: EventRow): HighlightFind {
  return {
    season: e.season, region: null, level: null, finals: false, kind: null,
    events: [{ season: e.season, code: e.code }],
    ...(!(OFFICIAL_TYPES as readonly string[]).includes(e.type ?? "") ? { named: true } : {}),
    eventName: new Map([[e.season, { name: shortEvent(e.name, e.type), when: dateRange(e.start, e.end) || null, where: place(e.city, e.state) || null }]]),
    at: "", chips: [],
  };
}

/** The page's answer, or null when the event has no highlights page (not found). `code` as stored. */
export async function eventHighlightsPage(season: number, code: string): Promise<EventHighlightsPage | null> {
  const e = await eventWithHighlights(season, code);
  if (!e) return null;
  const stat = await highlightsAnswer(eventHighlightFind(e));
  if (!stat || stat.none) return null;
  const answer: SearchAnswer = { q: `${e.name} highlights`, hits: [], pages: [], step: "deterministic", weak: false, stat };
  const video = await answerVideo(answer, Date.now(), { userId: null, teams: [] }).catch(() => undefined);
  return { event: { season: e.season, code: e.code, name: e.name }, stat, ...(video ? { video } : {}) };
}

/**
 * Every event with a highlights page, and its lastmod: the latest day its highlights changed (the last day of a match
 * they read, or a later change the source marked on the event or a division). Never the build date. Only codes an
 * address can carry are listed by the sitemap (isReachableEventCode), as for the event pages.
 */
export async function eventHighlightsLastmods(): Promise<{ season: number; code: string; lastmod: string | null }[]> {
  // One pass over the matches, grouped by the event that played them (by its key: quick over every season), each
  // group counted for that event and for the event its division feeds; then each event with data takes its own and its
  // divisions' groups (official ones only for an official event, as its highlights read them).
  const rows = await all<{ season: number; code: string; lastmod: string | null }>(
    `WITH g AS (
       SELECT he.season, he.code, he.division_code, he.type,
              MAX(MAX(COALESCE(substr(COALESCE(hm.time, he.end, he.start), 1, 10), ''), COALESCE(substr(he.upstream_updated, 1, 10), ''))) d
       FROM matches hm JOIN events he ON he.season = hm.season AND he.code = hm.code
       WHERE hm.played = 1 AND hm.red_np IS NOT NULL AND hm.blue_np IS NOT NULL AND hm.red_total IS NOT NULL AND hm.blue_total IS NOT NULL
         AND COALESCE(he.remote, 0) = 0
       GROUP BY he.season, he.code),
     t AS (SELECT season, code target, type, d FROM g UNION ALL SELECT season, division_code, type, d FROM g WHERE division_code IS NOT NULL)
     SELECT ev.season, ev.code, MAX(t.d) lastmod
     FROM events ev JOIN t ON t.season = ev.season AND t.target = ev.code
     WHERE (COALESCE(ev.type, '') NOT IN (${OFFICIAL}) OR t.type IN (${OFFICIAL})) AND ${eventHasDataSql("ev")}
     GROUP BY ev.season, ev.code
     ORDER BY ev.season DESC, ev.code`);
  return rows.filter((r) => isReachableEventCode(r.code)).map((r) => ({ season: Number(r.season), code: r.code, lastmod: r.lastmod || null }));
}
