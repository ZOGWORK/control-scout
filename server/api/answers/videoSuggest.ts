// No dead ends for video (search video brief, point 7): a search that asks to watch ("<team> highlights", "… with video",
// "who won … video") whose answer has nothing to play says so in one line (the answer's own: its "none", the highlights
// grid's or NoVideoLine's) and offers questions that do play, each run as a search and kept only when its answer has
// video. Nothing here is written for a team or an event: the questions come from the answer's own team and events, and
// the events with clips in the stored recordings.
import type { SearchAnswer, SearchVideo } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { all } from "../../db.js";
import { OFFICIAL_TYPES } from "./clauses.js";
import { CURRENT_SEASON } from "../../data/seasons.js";
import { seasonClipKeys, seasonVideoKinds } from "../../videos/recordings.js";
import { withoutWatch } from "../searchAnswer.js";
import { teamMatches } from "./matchSet.js";
import { refOfHref, rowRefs } from "./video.js";

/** Most questions offered, and most tried to find them. */
const OFFER_MAX = 3;
const TRY_MAX = 8;
/** The events offered first: a region's championship, Worlds and premier events (their names are FIRST's own, the
 *  ones visitors know); then any official event. Never a scrimmage or an off-season event. */
const BIG = ["Championship", "FIRSTChampionship", "Premier", "SuperQualifier"];
/** Seasons back a team's own video is looked for. */
const SEASONS_BACK = 4;

/** A season as search reads it ("2025-26"). */
const seasonWords = (s: number) => `${s}-${String((s + 1) % 100).padStart(2, "0")}`;

/** Whether the search asked to watch: its words ("with video", "highlights", "video") or an answer of highlights. */
export function asksVideo(q: string, a: SearchAnswer): boolean {
  return withoutWatch(q) !== q || /highlights|video/.test(a.stat?.intent ?? "") || !!a.stat?.scope.includes("With video");
}

/** Whether an answer has anything to play. */
export const hasVideo = (v: SearchVideo | undefined) => !!(v?.main || v?.watch || (v?.rows && Object.keys(v.rows).length));

/** The questions to try, best first: the team's own highlights in its latest seasons with a clip, then the events
 *  with clips nearest the answer's own (its place, then its season's), then the latest season's. */
export async function videoCandidates(a: SearchAnswer, now = Date.now()): Promise<string[]> {
  const out: string[] = [];
  const team = a.stat?.team?.number ?? null;
  if (team != null) {
    const ms = await teamMatches(team);
    for (let s = CURRENT_SEASON; s > CURRENT_SEASON - SEASONS_BACK && out.length < 2; s--) {
      const theirs = ms.filter((m) => m.season === s);
      if (!theirs.length) continue;
      const keys = await seasonClipKeys(s, now);
      if (theirs.some((m) => keys.has(`${m.code}|${m.level}|${m.series}|${m.number}`))) out.push(`${team} highlights ${seasonWords(s)}`);
    }
  }
  // The answer's events (its headline's and its rows'), else none: the latest season's.
  const refs = [refOfHref(a.stat?.headline?.href), ...rowRefs(a)].filter((r): r is NonNullable<typeof r> => !!r);
  const at = refs[0] ?? null;
  const season = at?.season ?? CURRENT_SEASON;
  for (const s of [season, season - 1]) {
    const kinds = await seasonVideoKinds(s, now);
    const filmed = [...kinds].filter(([, k]) => k === "clips").map(([c]) => c);
    if (!filmed.length) continue;
    const near = at ? await all<{ name: string }>(
      `SELECT e.name FROM events e, (SELECT country, state, start FROM events WHERE season = ? AND code = ?) x
       WHERE e.season = ? AND e.code IN (${filmed.map(() => "?").join(",")}) AND e.division_code IS NULL AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(",")})
       ORDER BY COALESCE(e.state, '') = COALESCE(x.state, '') AND COALESCE(e.country, '') = COALESCE(x.country, '') DESC, COALESCE(e.country, '') = COALESCE(x.country, '') DESC,
         e.type IN (${BIG.map(() => "?").join(",")}) DESC, ABS(julianday(e.start) - julianday(x.start)) LIMIT ?`,
      [at.season, at.code, s, ...filmed, ...OFFICIAL_TYPES, ...BIG, TRY_MAX]) : await all<{ name: string }>(
      `SELECT name FROM events WHERE season = ? AND code IN (${filmed.map(() => "?").join(",")}) AND division_code IS NULL AND type IN (${OFFICIAL_TYPES.map(() => "?").join(",")})
       ORDER BY type IN (${BIG.map(() => "?").join(",")}) DESC, start DESC LIMIT ?`, [s, ...filmed, ...OFFICIAL_TYPES, ...BIG, TRY_MAX]);
    for (const e of near) out.push(`${e.name} highlights ${seasonWords(s)}`);
    if (out.length >= TRY_MAX) break;
  }
  return [...new Set(out)].slice(0, TRY_MAX);
}

/**
 * The answer with questions that do play, when the search asked to watch and its answer has nothing to play: a
 * "related" block first among its blocks. Each question is asked (`ask`, the page's own kept answer) and its video read
 * (`video`); only those with video are offered, at most three. Unchanged otherwise, when none plays, or when finding
 * them takes longer than `waitMs` (the answer never waits on them: the reads go on, so the next asking has them kept).
 */
export async function withVideoAlternatives(q: string, a: SearchAnswer, v: SearchVideo | undefined,
  ask: (q: string) => Promise<SearchAnswer>, video: (a: SearchAnswer) => Promise<SearchVideo | undefined>, waitMs = WAIT_MS,
  candidates: (a: SearchAnswer) => Promise<string[]> = videoCandidates): Promise<SearchAnswer> {
  if (!a.stat || hasVideo(v) || !asksVideo(q, a)) return a;
  const find = (async () => {
    const offered: string[] = [];
    for (const c of await candidates(a).catch(() => [])) {
      if (offered.length >= OFFER_MAX) break;
      const b = await ask(c).catch(() => null);
      if (b?.stat && !b.stat.none && hasVideo(await video(b).catch(() => undefined))) offered.push(c);
    }
    return offered;
  })();
  find.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const offered = await Promise.race([find, new Promise<string[]>((r) => { timer = setTimeout(() => r([]), waitMs); })]).finally(() => clearTimeout(timer));
  if (!offered.length) return a;
  const block: StatAnswer["blocks"][number] = { kind: "related", title: "Questions with video", queries: offered };
  return { ...a, stat: { ...a.stat, blocks: [block, ...a.stat.blocks] } };
}

/** Longest the answer waits for its questions with video. */
const WAIT_MS = 2500;
