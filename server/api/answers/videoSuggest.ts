// No dead ends for video (search video brief, point 7): a search that asks to watch ("<team> highlights", "… with video",
// "who won … video") whose answer has nothing to play says so in one line (the answer's own: its "none", the highlights
// grid's or NoVideoLine's) and offers questions that do play, each run as a search and kept only when its answer has
// video. Nothing here is written for a team or an event: the questions come from the answer's own team and events, and
// the events with clips in the stored recordings.
import type { SearchAnswer, SearchVideo } from "../../../src/shared/api.js";
import type { StatAnswer } from "../../../src/shared/searchStat.js";
import { all } from "../../db.js";
import { registerCache } from "../../caches.js";
import { OFFICIAL_TYPES } from "./clauses.js";
import { CURRENT_SEASON } from "../../data/seasons.js";
import { seasonClipKeys, seasonVideoKinds } from "../../videos/recordings.js";
import { withoutWatch } from "../searchAnswer.js";
import { teamMatches } from "./matchSet.js";
import { inTurns } from "./followUps.js";
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
  // The query's spacing evened out first: only a watch word dropped counts.
  const flat = q.replace(/\s+/g, " ").trim();
  return withoutWatch(flat) !== flat || /highlights|video/.test(a.stat?.intent ?? "") || !!a.stat?.scope.includes("With video");
}

/** Whether an answer has anything to play. */
export const hasVideo = (v: SearchVideo | null | undefined) => !!(v?.main || v?.watch || (v?.rows && Object.keys(v.rows).length));

/** The questions to try, best first: the team's own highlights in its latest seasons with a clip, then the events
 *  with clips nearest the answer's own (its place, then its season's), then the latest season's. */
export async function videoCandidates(a: SearchAnswer, now = Date.now()): Promise<string[]> {
  const out: string[] = [];
  const team = a.stat?.team?.number ?? null;
  // Each read on its own: one that fails drops its own questions, never the others'.
  const ms = team != null ? await teamMatches(team).catch(() => []) : [];
  if (team != null) {
    for (let s = CURRENT_SEASON; s > CURRENT_SEASON - SEASONS_BACK && out.length < 2; s--) {
      const theirs = ms.filter((m) => m.season === s);
      if (!theirs.length) continue;
      const keys = await seasonClipKeys(s, now).catch(() => new Set<string>());
      if (theirs.some((m) => keys.has(`${m.code}|${m.level}|${m.series}|${m.number}`))) out.push(`${team} highlights ${seasonWords(s)}`);
    }
  }
  // The answer's events (its headline's and its rows'), else none: the latest season's.
  const refs = [refOfHref(a.stat?.headline?.href), ...rowRefs(a)].filter((r): r is NonNullable<typeof r> => !!r);
  const at = refs[0] ?? null;
  const season = at?.season ?? CURRENT_SEASON;
  for (const s of [season, season - 1]) {
    const kinds = await seasonVideoKinds(s, now).catch(() => new Map<string, string>());
    const filmed = [...kinds].filter(([, k]) => k === "clips").map(([c]) => c);
    if (!filmed.length) continue;
    const near = at ? await all<{ name: string }>(
      `SELECT e.name FROM events e, (SELECT country, state, start FROM events WHERE season = ? AND code = ?) x
       WHERE e.season = ? AND e.code IN (${filmed.map(() => "?").join(",")}) AND e.division_code IS NULL AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(",")})
       ORDER BY COALESCE(e.state, '') = COALESCE(x.state, '') AND COALESCE(e.country, '') = COALESCE(x.country, '') DESC, COALESCE(e.country, '') = COALESCE(x.country, '') DESC,
         e.type IN (${BIG.map(() => "?").join(",")}) DESC, e.start IS NULL, ABS(julianday(e.start) - julianday(x.start)) LIMIT ?`,
      [at.season, at.code, s, ...filmed, ...OFFICIAL_TYPES, ...BIG, TRY_MAX]).catch(() => []) : await all<{ name: string }>(
      `SELECT name FROM events WHERE season = ? AND code IN (${filmed.map(() => "?").join(",")}) AND division_code IS NULL AND type IN (${OFFICIAL_TYPES.map(() => "?").join(",")})
       ORDER BY type IN (${BIG.map(() => "?").join(",")}) DESC, start DESC LIMIT ?`, [s, ...filmed, ...OFFICIAL_TYPES, ...BIG, TRY_MAX]).catch(() => []);
    for (const e of near) out.push(`${e.name} highlights ${seasonWords(s)}`);
    if (out.length >= TRY_MAX) break;
  }
  return [...new Set(out)].slice(0, TRY_MAX);
}

/**
 * The answer with questions that do play, when the search asked to watch and its answer has nothing to play: a
 * "related" block first among its blocks. Each question is asked (`ask`, the page's own kept answer) and its video read
 * (`video`); only those with video are offered, at most three. Unchanged when none of them plays. Past `waitMs` the answer
 * goes with the ones found by then (it never waits longer), and the checks still to come never run.
 */
export async function withVideoAlternatives(q: string, a: SearchAnswer, v: SearchVideo | null | undefined,
  ask: (q: string) => Promise<SearchAnswer>, video: (a: SearchAnswer) => Promise<SearchVideo | undefined>, waitMs = WAIT_MS,
  candidates: (a: SearchAnswer) => Promise<string[]> = videoCandidates, who = ""): Promise<SearchAnswer> {
  if (!a.stat || hasVideo(v) || !asksVideo(q, a)) return a;
  // Past the wait the answer goes as it is, and the checks still to come are never run.
  // The ones found by then are offered all the same.
  let gaveUp = false;
  const offered: string[] = [];
  // The check this search is waiting on now: past its own wait, it stops waiting on it.
  let mine: Check | null = null;
  const find = (async () => {
    for (const c of await candidates(a).catch(() => [])) {
      if (offered.length >= OFFER_MAX || gaveUp) break;
      // Each check takes its turn in the process's one queue (./followUps.ts inTurns), so other requests and the
      // wait's own timer run between them.
      // One check per question and viewer (`who`) at a time, kept a minute: two searches asking at once share it.
      // Each search waiting on a check counts itself in and, past its own wait, out: the check runs while any search
      // still waits on it. A check that never ran, or whose reads failed, is never kept.
      const key = `${who}|${c}`;
      let check = checks.get(key);
      // Only a check that's done expires: one still running is shared however long it takes.
      if (!check || (check.done && Date.now() - check.at >= CHECK_TTL_MS)) {
        const e: Check = { at: Date.now(), waiting: 0, done: false, v: Promise.resolve(null) };
        e.v = inTurns(async (): Promise<boolean | null> => {
          if (e.waiting === 0) return null;
          let b: SearchAnswer;
          try { b = await ask(c); } catch { return null; }
          if (!b?.stat || b.stat.none) return false;
          let bv: SearchVideo | undefined;
          try { bv = await video(b); } catch { return null; }
          return hasVideo(bv);
        }).catch(() => null);
        void e.v.then((r) => { e.done = true; if (r === null && checks.get(key) === e) checks.delete(key); });
        if (checks.size >= CHECK_MAX) prune(Date.now());
        checks.set(key, e);
        check = e;
      }
      check.waiting++;
      mine = check;
      const ok = await check.v;
      if (mine === check) { check.waiting--; mine = null; }
      if (ok && !gaveUp) offered.push(c);
    }
    return offered;
  })();
  find.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const found = await Promise.race([find, new Promise<string[]>((r) => { timer = setTimeout(() => { gaveUp = true; if (mine) { mine.waiting--; mine = null; } r([...offered]); }, waitMs); })]).finally(() => clearTimeout(timer));
  if (!found.length) return a;
  const block: StatAnswer["blocks"][number] = { kind: "related", title: "Questions with video", queries: found };
  return { ...a, stat: { ...a.stat, blocks: [block, ...a.stat.blocks] } };
}

/** Questions checked lately (whether each plays, per viewer), shared by searches asking at once. */
interface Check { at: number; v: Promise<boolean | null>; waiting: number; done: boolean }
const checks = new Map<string, Check>();
/** Room for one more: the expired ones out, then the oldest done ones; a check still running is never dropped (the
 *  searches waiting on it would start a second). */
function prune(now: number) {
  for (const [k, e] of checks) if (e.done && now - e.at >= CHECK_TTL_MS) checks.delete(k);
  for (const [k, e] of checks) { if (checks.size < CHECK_MAX) break; if (e.done) checks.delete(k); }
}
const CHECK_TTL_MS = 60_000;
const CHECK_MAX = 500;
/** Forgets the questions checked (the owner's Clear caches, and tests). */
export const forgetVideoChecks = () => checks.clear();
registerCache("Search answers: video questions", forgetVideoChecks);

/** Longest the answer waits for its questions with video. */
const WAIT_MS = 2500;
