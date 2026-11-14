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
import { inTurns, pageAnswer } from "./followUps.js";
import { answerVideo, refOfHref, rowRefs } from "./video.js";
import { searchVersion } from "../searchReads.js";
import { SEARCH_PAGE_LIMIT } from "../../../src/shared/search.js";
import { nameTypos, spelledBy, warmNameTypos } from "./nameTypos.js";

/** Most questions offered, and most tried to find them. */
const OFFER_MAX = 3;
const TRY_MAX = 8;
/** Events read for each try: room for those skipped. */
const READ_MAX = 3 * TRY_MAX;
/** Most tried from each season near the answer's own: the season before gets its turn too. */
const NEAR_MAX = TRY_MAX / 2;
/** The events offered first: a region's championship, Worlds and premier events (their names are FIRST's own, the
 *  ones visitors know); then any official event. Never a scrimmage or an off-season event. */
const BIG = ["Championship", "FIRSTChampionship", "Premier", "SuperQualifier"];
/** Asked last when no event's question is left (each typo-like, or the typos unknown): one about no event, whose
 *  answer is the season's best match with video. */
const GENERAL = ["highest score with video"];
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
 *  with clips nearest the answer's own (its place, its season then the one before); none of those, the latest
 *  seasons' best known, to make three. An event whose stored name reads like a typo (./nameTypos.ts) is skipped,
 *  before the cap, so the next one takes its place; with the typos unknown, no event is offered. With no event's
 *  question left, the general ones (GENERAL). */
export async function videoCandidates(a: SearchAnswer, now = Date.now(), typosOf: () => Promise<ReadonlySet<string>> = nameTypos): Promise<string[]> {
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
  const own = out.length;
  const typos = await typosOf().catch(() => null);
  if (!typos) return [...out, ...GENERAL];
  // The answer's events (its headline's and its rows').
  const refs = [refOfHref(a.stat?.headline?.href), ...rowRefs(a)].filter((r): r is NonNullable<typeof r> => !!r);
  const at = refs[0] ?? null;
  type Ref = NonNullable<typeof at>;
  const near: [number, Ref][] = at ? [[at.season, at], [at.season - 1, at]] : [];
  const tries: [number, Ref | null][] = [...near, [CURRENT_SEASON, null], [CURRENT_SEASON - 1, null]];
  for (const [s, from] of tries) {
    // The latest seasons' only to make three when fewer were found near the answer's own.
    if (out.length >= TRY_MAX || (!from && at && out.length >= own + OFFER_MAX)) break;
    const kinds = await seasonVideoKinds(s, now).catch(() => new Map<string, string>());
    const filmed = [...kinds].filter(([, k]) => k === "clips").map(([c]) => c);
    if (!filmed.length) continue;
    // More than needed are read, so the ones skipped are made up.
    const rows = from ? await all<{ name: string }>(
      `SELECT e.name FROM events e, (SELECT country, state, start FROM events WHERE season = ? AND code = ?) x
       WHERE e.season = ? AND e.code IN (${filmed.map(() => "?").join(",")}) AND e.division_code IS NULL AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(",")})
       ORDER BY COALESCE(e.state, '') = COALESCE(x.state, '') AND COALESCE(e.country, '') = COALESCE(x.country, '') DESC, COALESCE(e.country, '') = COALESCE(x.country, '') DESC,
         e.type IN (${BIG.map(() => "?").join(",")}) DESC, e.start IS NULL, ABS(julianday(e.start) - julianday(x.start)) LIMIT ?`,
      [from.season, from.code, s, ...filmed, ...OFFICIAL_TYPES, ...BIG, READ_MAX]).catch(() => []) : await all<{ name: string }>(
      `SELECT name FROM events WHERE season = ? AND code IN (${filmed.map(() => "?").join(",")}) AND division_code IS NULL AND type IN (${OFFICIAL_TYPES.map(() => "?").join(",")})
       ORDER BY type IN (${BIG.map(() => "?").join(",")}) DESC, start DESC LIMIT ?`, [s, ...filmed, ...OFFICIAL_TYPES, ...BIG, READ_MAX]).catch(() => []);
    const before = out.length;
    for (const e of rows) {
      if (out.length >= TRY_MAX || (from && out.length - before >= NEAR_MAX)) break;
      const q = `${e.name} highlights ${seasonWords(s)}`;
      if (spelledBy(e.name, typos) && !out.includes(q)) out.push(q);
    }
  }
  return out.length > own ? out : [...out, ...GENERAL];
}

/**
 * The answer with questions that do play, when the search asked to watch and its answer has nothing to play: a
 * "related" block first among its blocks. Each question is asked (`ask`, the page's own kept answer) and its video read
 * (`video`); only those with video are offered, at most three. Unchanged when none of them plays. Past `waitMs` the answer
 * goes with the ones found by then; with none found yet (the first search after the checks expire, each read cold) it
 * waits up to `moreMs` longer, and goes as soon as one is. Then the checks still to come never run.
 */
export async function withVideoAlternatives(q: string, a: SearchAnswer, v: SearchVideo | null | undefined,
  ask: (q: string) => Promise<SearchAnswer>, video: (a: SearchAnswer) => Promise<SearchVideo | undefined>, waitMs = WAIT_MS,
  candidates: (a: SearchAnswer) => Promise<string[]> = videoCandidates, who = "", moreMs = MORE_MS): Promise<SearchAnswer> {
  if (!a.stat || hasVideo(v) || !asksVideo(q, a)) return a;
  // Past the wait (and, with none found by then, the longer one) the answer goes as it is, and the checks still to
  // come are never run. The ones found by then are offered all the same.
  let gaveUp = false;
  const offered: string[] = [];
  // The check this search is waiting on now: past its own wait, it stops waiting on it.
  let mine: Check | null = null;
  // Past `waitMs` with none found: the first one found ends the wait.
  let past = false, onFound = () => {};
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
      if (ok && !gaveUp) { offered.push(c); if (past) onFound(); }
    }
    return offered;
  })();
  find.catch(() => {});
  const timers: ReturnType<typeof setTimeout>[] = [];
  const found: string[] = await Promise.race([find, new Promise<string[]>((r) => {
    const stop = () => { gaveUp = true; if (mine) { mine.waiting--; mine = null; } r([...offered]); };
    onFound = stop;
    // None found by the wait: the questions checked in the background (warmVideoQuestions) at once, else a little longer.
    timers.push(setTimeout(() => { past = true; if (offered.length || moreMs <= 0 || fallback(q).length) stop(); else timers.push(setTimeout(stop, moreMs)); }, waitMs));
  })]).finally(() => timers.forEach(clearTimeout));
  // The background set kept up with the data: built again, off this search, when it has moved, with the reads it was
  // built with. Never before it was built (server start): a process that never warmed it (a test) reads nothing here.
  if (known) { const o = known.o; void (o.version ?? searchVersion)().then((v) => { if (known && known.version !== v) return warmVideoQuestions(o); }).catch(() => {}); }
  if (!found.length) found.push(...fallback(q));
  if (!found.length) return a;
  const block: StatAnswer["blocks"][number] = { kind: "related", title: "Questions with video", queries: found };
  return { ...a, stat: { ...a.stat, blocks: [block, ...a.stat.blocks] } };
}

/** Questions with video checked in the background, for no answer's own place: the latest seasons' best known events
 *  with clips, then the general ones. Offered when none near an answer's own plays in time. Built per search index
 *  version, at server start (server/index.ts) and once the data moves; the last one is used until then. Checked as a
 *  visitor signed out sees them, so they play for everyone. */
let known: { version: string; qs: string[]; o: WarmReads } | null = null;
let knowing: Promise<void> | null = null;
/** Clear caches pressed so far: a build one overlapped is kept as stale (as ./nameTypos.ts). */
let knownClears = 0;
/** Builds dropped so far (forgetVideoQuestions(true), or past BUILD_MS): one started before never writes. */
let knownGen = 0;
const NO_ANSWER: SearchAnswer = { q: "", hits: [], pages: [], step: "deterministic", weak: false };
interface WarmReads {
  /** The page's own kept answer, and its video as a visitor signed out sees it (tests give their own). */
  ask?: (q: string) => Promise<SearchAnswer>; video?: (a: SearchAnswer) => Promise<SearchVideo | undefined>;
  candidates?: () => Promise<string[]>; version?: () => Promise<string>;
  /** The event-name typos built for the data as it is (tests give their own). */
  typosReady?: () => Promise<void>;
  checkMs?: number; buildMs?: number;
}
/** Longest one question's check takes in the background (past it, the question doesn't play), and the whole build
 *  (past it, the build is dropped and the next warm starts again): a check that never settles never holds it. */
const CHECK_MS = 5000;
const BUILD_MS = 60_000;
/** A promise, or `or` once `ms` have passed. */
const within = <T,>(p: Promise<T>, ms: number, or: T): Promise<T> => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<T>((r) => { t = setTimeout(() => r(or), ms); })]).finally(() => clearTimeout(t));
};
export function warmVideoQuestions(o: WarmReads = {}): Promise<void> {
  const ask = o.ask ?? ((x: string) => pageAnswer(x, SEARCH_PAGE_LIMIT, new Set()));
  const video = o.video ?? ((b: SearchAnswer) => answerVideo(b, Date.now()));
  return knowing ??= (async () => {
    const gen = knownGen, at = knownClears;
    const build = (async () => {
      const version = await (o.version ?? searchVersion)();
      if (known?.version === version) return;
      // The event-name typos for the data as it is now: the set in use may be the last version's, without a typo
      // this one added (./nameTypos.ts keeps serving it while it builds the next).
      if (o.typosReady) await o.typosReady(); else if (!o.candidates) await warmNameTypos();
      const qs: string[] = [];
      for (const c of [...new Set([...await (o.candidates ?? (() => videoCandidates(NO_ANSWER)))(), ...GENERAL])]) {
        if (qs.length >= OFFER_MAX || gen !== knownGen) break;
        // In the process's one queue, as a search's own checks are: other requests run between them. Bounded inside
        // its turn, so one that never settles frees the queue too.
        const ok = await inTurns(() => within((async () => {
          try { const b = await ask(c); return !!b?.stat && !b.stat.none && hasVideo(await video(b)); } catch { return false; }
        })(), o.checkMs ?? CHECK_MS, false)).catch(() => false);
        if (ok) qs.push(c);
      }
      if (gen === knownGen) known = { version: at === knownClears ? version : "", qs, o };
    })();
    build.catch(() => {});
    // Past the cap the build is dropped: it never writes, and the next warm starts a new one.
    if (!(await within(build.then(() => true), o.buildMs ?? BUILD_MS, false))) knownGen++;
  })().finally(() => { knowing = null; });
}
/** The background set's questions, never the search's own. */
const fallback = (q: string) => (known?.qs ?? []).filter((x) => x.toLowerCase() !== q.replace(/\s+/g, " ").trim().toLowerCase()).slice(0, OFFER_MAX);
/** Marks the background set stale (the owner's Clear caches, and tests): never read here, so a process with no
 *  database open opens none. */
export function forgetVideoQuestions(drop = false) {
  knownClears++;
  if (drop) { knownGen++; known = null; } else if (known) known = { ...known, version: "" };
}
registerCache("Search answers: questions with video, checked in the background", () => forgetVideoQuestions());

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

/** How long the answer waits for its questions with video, and how much longer when none is found by then. */
const WAIT_MS = 2500;
const MORE_MS = 2000;
