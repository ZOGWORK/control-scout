// Search's one answer for every surface (the header box, /search, the address bar's search): docs/search.md.
//
// Fixed rules, in order, every one deterministic:
//   0. A question search answers directly ("when did hypnotic go to worlds", "has bad wolf won anything", "12345's next
//      event"): the team it names, and a card built from the stored data (./searchQuestions.ts).
//   1. A team number ("12345", "team 12345", "team-12345") is that team alone; a number with no team is the recovery state.
//   2. Two or more teams joined by "vs"/"versus" open Compare.
//   3. Otherwise the search itself (names, numbers, codes, matches, topic words: server/api/search.ts), with short forms
//      spelled out ("champs") and the name-and-topic reading taken when it fits better ("team talos" vs "team 12345").
//   4. Nothing for the whole query: each word on its own; a result matching more words ranks higher, and words that
//      match nothing are ignored.
// Before 2: a season, region, ranking or missing view read from the query (./searchIntents.ts).
// Then the step: "deterministic" when the top result fits what was typed, "did-you-mean" when it's a correction, and
// "recovery" when there's nothing, or only near matches to teams that never played (those are listed as closest).
// Learned click weights (./searchLearn.ts) may re-rank the results, never add one, and never pick the team an answer is
// about: every lookup that does (a stat, a high score, a question, an intent) asks with learn: false. Bruno AI is never asked here:
// the app asks /api/search/refine after these results are on screen (./searchBruno.ts).
import type { SearchAnswer, SearchHit, SearchRecovery, SearchUnderstood } from "../../src/shared/api.js";
import { SEARCH_BROWSE, SEARCH_FILLER, SEARCH_PAGE_LIMIT, SEARCH_TOPICS, firstCards, TOPIC_LABEL, VERSUS, cardWho, onlyPageWords, pagesFor, showingLine } from "../../src/shared/search.js";
import { conversationQuery, EVENT_WORDS, isQuestionForm, nameWords, onlyCommonWords, onlyTopicWords, singularize } from "../../src/shared/searchQuery.js";
import { readEventQuery, regionOf } from "../../src/shared/searchEventQuery.js";
import { eventSetAnswer, withEventParents, withWholeFamilies } from "./searchEvents.js";
import { compareOneAnswer, versusAnswer } from "./searchCompare.js";
import { ruleAnswer } from "./searchRules.js";
import { askAnswer, readAsk } from "./searchAsks.js";
import { readRuleQuery } from "../../src/shared/searchRuleQuery.js";
import { seasonLabel } from "../../src/shared/format.js";
import { cleanTeamName, searchTeamTitle, teamNameOf, teamWords } from "../../src/shared/teamTitle.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import { CURRENT_SEASON, SEASONS } from "../data/seasons.js";
import { all, get } from "../db.js";
import { fuzzyScore, joinThousands, normalize, wordScore, words } from "./fuzzy.js";
import { ftsQuery, search, searchIntent, teamAtEventAnswer } from "./search.js";
import { rerank } from "./searchLearn.js";
import { intentAnswer, parseIntent } from "./searchIntents.js";
import { inRegion, namedTeamHit, teamsByName } from "./teamsByName.js";
import { parseQuestion, questionAnswer } from "./searchQuestions.js";
import { highScoreAnswer, parseHighScore } from "./searchHighScores.js";
import { eventVersusSearch, leagueSearch, statAnswer } from "./answers/index.js";
import { placeAwardsSearch, readPlaceAwards } from "./answers/families/placeAwards.js";
import { refreshSearchSeason } from "./answers/season.js";
import { FALLBACK_NOTE, carryOutcome, layeredAnswer, nameKey, teamNames } from "./searchLayers.js";
import { INFORMAL, informalQuery, spelledNumbers } from "./query/lexicon.js";
import { numberQuery, spelled, strength } from "./spelling.js";
import { booleanAnswer } from "./searchBoolean.js";
import { asksOfTeams, pipelineAnswer, pipelineReads } from "./query/execute.js";
import { derivedVerdict, yesNoAnswer } from "./answers/yesNo.js";
import { sorryFor } from "./answers/sorry.js";
import { fold, names } from "./query/names.js";
import { normalise, parseQuery } from "./query/parse.js";
import { parseContext } from "./query/context.js";
import { pickShared } from "./query/shared.js";
import { asideWord, asksWhich, onlyOrdinary } from "./query/ordinary.js";
import { LEXICON } from "./query/lexicon.js";
import { awardQuery, bottomAnswer, calledTeams, countAnswer, eventCodeAnswer, eventPageAnswer, explainAnswer, explainTeamAnswer, monthAnswer, nearMeAnswer, namedParts, placeTeamsAnswer, rewriteQuery, teamFactAnswer, teamFallback, teamListAnswer, worldsAnswer } from "./searchCoverage.js";

/** The longest query read: a full question ("did the prediction for 12345 at the state championship get it right, or
 *  was it way off") fits. Longer is cut at a word, never inside one. */
export const MAX_QUERY = 160;
/** A top result scoring under this against what was typed is a correction ("did you mean"), not a match. */
export const WEAK_SCORE = 0.9;

export interface AnswerOptions {
  limit?: number; prefer?: ReadonlySet<string>; learn?: boolean;
  /** Read seasons, regions and missing views (./searchIntents.ts): off for the core of an intent. */
  intents?: boolean;
  /** A season the query named in words ("last season", read by ./searchIntents.ts): as if typed as "2024-25". */
  season?: number | null;
  /** Set by searchAnswer for its own query: the query as typed (cleaned, its plurals kept: page words read it), and
   *  whether it ended in "?". */
  typed?: string;
  asked?: boolean;
  /** The time "upcoming", "past" and "this weekend" are read from (tests). */
  now?: number;
  /** How many rewrites (./searchCoverage.ts) led here: a rewrite is read once more at most, never in a loop. */
  rewrites?: number;
  /** Set for every search searchAnswer makes inside a top-level one: the layers (./searchLayers.ts) run once, outside. */
  inner?: boolean;
  /** False: no spelling correction (./spelling.ts), for the corrected query's own search. */
  spell?: boolean;
  /** A stat answer's blocks are worked out (/search and its first paint, never the dropdown): ./answers/index.ts.
   *  Set by searchAnswer from the caller's limit (the page asks for SEARCH_PAGE_LIMIT) unless given. */
  full?: boolean;
  /** False: the page's answer without its sorry note or verdict, for checking a sorry suggestion (never in a loop). */
  sorry?: boolean;
}

/** The query as search reads it: punctuation that never means anything dropped, spaces folded, at most MAX_QUERY
 *  (cut at the last whole word: a word cut in two, "2025-2", would be read as another). */
export function cleanQuery(raw: string): string {
  // "1,000" is one number before its comma could be dropped as punctuation; a stored name written that way is indexed
  // as one number too (SEARCH_INDEX_SCHEMA 6). "40+ teams" is "40 or more teams" (a size, as the events-over-a-size
  // answer reads it), kept before "+" is cleaned.
  const q = joinThousands(String(raw ?? "")).replace(/(\d)\s*\+\s*(?=teams?\b)/gi, "$1 or more ").replace(/[!?,;"<>(){}[\]|\\^*`~=+]/g, " ").replace(/\s+/g, " ").trim();
  if (q.length <= MAX_QUERY) return q;
  const cut = q.slice(0, MAX_QUERY);
  return (q[MAX_QUERY] === " " ? cut : cut.replace(/\s+\S*$/, "")).trim() || cut;
}

/** `q` without a comma clause that only says what isn't asked: "not just …"/"not only …" (more than that is wanted), or
 *  "not" and a season ("not 2025", "not this season": the season said beside it is the one). Any other "not" clause
 *  ("…, not rookies") is a filter and stays, and a quoted phrase is never touched (it asks for exactly those words). */
export function withoutContrast(q: string): string {
  if (q.includes('"')) return q;
  const SEASON = String.raw`(?:(?:the |this |last |next |that )?(?:season|year)|20\d\d(?:\s*[-–/]\s*\d{2,4})?)`;
  return q.replace(new RegExp(String.raw`\s*,\s*not\s+(?:(?:just|only)\s+[^,]*?|${SEASON})\s*(?=,|[?.!]*\s*$)`, "gi"), "");
}

/** `q` without the words at its end that only talk around the question, when the parser reads every word before them:
 *  a last comma clause of ordinary words (./query/ordinary.ts) that names no number, place, time, event or question
 *  word ("who won inspire at <event>, i forgot"; a team named by such words is no team there), or the same said with
 *  no comma, its words ones the parser leaves unread ("<event> i forget", "<team> next match date please"). A clause
 *  that says something ("…, this month", "…, or nah", "…, not rookies") stays, and so does anything the parser needs. */
export async function withoutAside(q: string, opts: { now?: number; prefer?: ReadonlySet<string> } = {}): Promise<string> {
  if (q.includes('"')) return q;
  const ctx = await parseContext(opts.now, opts.prefer);
  const m = /^(.*\S)\s*,\s*([^,]+?)\s*([?!.]*)\s*$/s.exec(q);
  const asideOnly = (t: string) => t.trim().split(/\s+/).every((w) => asideWord(w) || FILLER_ONE.has(fold(w)));
  if (m && asideOnly(m[2])) {
    const p = await parseQuery(m[2], ctx);
    const said = p.symbols.length || p.teams.some((t) => t.via === "number") || p.place || p.time || p.event || p.named || p.worlds || p.states || p.award;
    if (!said) return `${m[1]}${m[3]}`;
  }
  // No comma: the unread ordinary words at the end, and the filler among them ("i", "please").
  const p = await parseQuery(q, ctx);
  if (!p.leftover.length || !p.leftover.every((w) => asideWord(w))) return q;
  const ws = q.trim().split(/\s+/);
  const unread = new Set(p.leftover.map((w) => fold(w)));
  let k = ws.length;
  while (k > 0 && (unread.has(fold(ws[k - 1])) || FILLER_ONE.has(fold(ws[k - 1])))) k--;
  // Every word the parser left unread is in that end, and something is left before it.
  const tail = ws.slice(k).map(fold);
  if (k === 0 || k === ws.length || ![...unread].every((w) => tail.includes(w))) return q;
  const rest = ws.slice(0, k).join(" ") + (/[?]\s*$/.test(q) ? "?" : "");
  const again = await parseQuery(rest, ctx);
  return again.leftover.length ? q : rest;
}
/** The lexicon's one-word filler ("i", "please"). */
const FILLER_ONE = new Set(LEXICON.filter((e) => e.words.length === 1 && e.syms.every((x) => x.k === "filler")).map((e) => e.words[0]));

const SHORT_FORMS: Record<string, string> = { champs: "championship", champ: "championship", cmp: "championship", quals: "qualifier", worlds: "first championship", states: "state championship" };
const MATCH_WORDS = /\b(q|qual|m|match|f|final)\s*-?\s*\d{1,3}\b/i;
const expandShortForms = (q: string) => (MATCH_WORDS.test(q) ? q : q.split(" ").map((w) => SHORT_FORMS[w.toLowerCase()] ?? w).join(" "));

const isTopicWord = (w: string) => SEARCH_TOPICS.some(([p]) => p.split(" ").includes(w));
const nameOf = (h: SearchHit) => (h.kind === "team" ? teamNameOf(h.title) : h.title);
const key = (h: SearchHit) => `${h.kind}:${h.ref}`;
const uniq = (hs: SearchHit[]) => { const seen = new Set<string>(); return hs.filter((h) => !seen.has(key(h)) && !!seen.add(key(h))); };

/** How closely the top hit matches the name part of what was typed (1: exactly; its number counts as exact). */
export function topScore(q: string, hits: SearchHit[]): number {
  const top = hits[0];
  if (!top) return 0;
  if (top.kind === "match" || top.href) return 1;
  const rest = (searchIntent(q)?.rest ?? q).trim();
  if (top.kind === "team" && rest.split(" ").includes(top.ref)) return 1;
  if (top.kind === "event" && rest.toUpperCase().split(" ").includes(top.ref.split(":")[1])) return 1;
  return Math.max(fuzzyScore(rest, nameOf(top)), fuzzyScore(rest, top.title));
}

/** Whether a team has ever played a match (a registration alone doesn't make a partial name match a result). */
async function played(team: string): Promise<boolean> {
  return !!(await get("SELECT 1 FROM team_event_stats WHERE team = ? AND matches > 0 LIMIT 1", [Number(team)]));
}

/** A season named in the query ("2025-26", "2025–26", "2025"), and the query without it. Never inside a match query. */
function seasonOf(q: string): { season: number | null; rest: string } {
  if (MATCH_WORDS.test(q)) return { season: null, rest: q };
  const m = /(?:^|\s)(20\d\d)(?:\s*[-–/]\s*(\d\d))?(?=\s|$)/.exec(q);
  if (!m) return { season: null, rest: q };
  const s = Number(m[1]);
  if (m[2] && (s + 1) % 100 !== Number(m[2])) return { season: null, rest: q };
  const rest = (q.slice(0, m.index) + " " + q.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return rest ? { season: s, rest } : { season: null, rest: q };
}

const answer = (q: string, a: Partial<SearchAnswer> & Pick<SearchAnswer, "hits" | "step">): SearchAnswer =>
  ({ q, pages: pagesFor(q), weak: a.step === "did-you-mean" || a.step === "recovery", ...a });

/** Only a site page's word ("contact", "rankings"): the page, named, never "matching contact". */
const pageUnderstood = (q: string): SearchUnderstood => ({ kind: "names", label: `Pages: ${pagesFor(q).map((p) => p.title).join(", ")}` });

/** "robo rebels nj", "bad wolf new jersey": a team name, then a place (its last one to three words). Null unless the
 *  name alone is a team's whole name. The teams by that name in the place, or, when none is there, every team by
 *  that name, saying the place has none. */
async function namedInPlace(q: string, limit: number, prefer: ReadonlySet<string>): Promise<SearchAnswer | null> {
  const ws = q.trim().split(/\s+/);
  for (let k = Math.min(3, ws.length - 1); k >= 1; k--) {
    const region = regionOf(ws.slice(-k));
    if (!region) continue;
    // "In" or "from" before the place says where the team is ("ultraviolet from nj"): never a word of the name.
    const name = ws.slice(0, -k).join(" ").replace(/\s+(?:in|from)$/i, "");
    if (!normalize(name)) return null;
    // Every team by that whole name (server/api/teamsByName.ts), then the ones in the place.
    const rows = await teamsByName(name);
    if (!rows.length) return null;
    const hit = namedTeamHit;
    const there = rows.filter((t) => inRegion(t, region));
    const shown = cleanTeamName(rows[0].number, rows[0].name);
    const label = there.length
      ? `${there.length === 1 ? "The team" : `${there.length} teams`} named ${shown} in ${region.name}`
      : `No team named ${shown} in ${region.name}: ${rows.length === 1 ? "the one" : `all ${rows.length}`} by that name`;
    return answer(q, { hits: (there.length ? there : rows).slice(0, limit).map(hit), step: "deterministic", understood: { kind: "names", label } });
  }
  return null;
}

const recovery = (q: string, understood: string[], closest: SearchHit[] = []): SearchAnswer =>
  answer(q, { hits: [], step: "recovery", recovery: { understood, closest, browse: SEARCH_BROWSE } satisfies SearchRecovery });

/** Search's answer for `raw` (docs/search.md). A top-level search goes through the layers (./searchLayers.ts,
 *  docs/search-layers.md): the readers below are Layer 1, and a query they miss is read again by its words. */
export async function searchAnswer(raw: string, opts: AnswerOptions = {}): Promise<SearchAnswer> {
  // The season a query naming none means (./answers/season.ts), read before the readers that use it.
  await refreshSearchSeason();
  if (opts.inner || opts.intents === false || opts.rewrites) return readerAnswer(raw, opts);
  // Informal short forms said in full first ("events happening rn"), in the query as typed (its quotes and operators
  // kept), the answer keeping the query as typed.
  // A clause saying what isn't asked ("…, not just one number", "in 2024-25, not this season") goes; the rest is the ask.
  const plain = withoutContrast(String(raw ?? ""));
  if (plain !== String(raw ?? "")) {
    const b = await searchAnswer(plain, opts);
    return carryOutcome(b, { ...b, q: cleanQuery(raw) });
  }
  // A last clause that only talks around the question ("…, i forgot", "…, be honest") goes too: never a team's name.
  const unasked = await withoutAside(String(raw ?? ""), opts);
  if (unasked !== String(raw ?? "")) {
    const b = await searchAnswer(unasked, opts);
    return carryOutcome(b, { ...b, q: cleanQuery(raw) });
  }
  const said = String(raw ?? ""), full = await inFull(said);
  if (full !== said) {
    const b = await searchAnswer(full, opts);
    return carryOutcome(b, { ...b, q: cleanQuery(raw) });
  }
  // A season written with both years ("2025-2026"): written as search reads one ("2025-26").
  // Numbers said as words after a word that takes one ("opr over eighty") in digits (./query/lexicon.ts spelledNumbers).
  // A season written with a comma ("2025, 26", "season 25, 26") is the same season: consecutive years only, the
  // second as two digits (two four-digit numbers with a comma, "2024, 2025", are two teams), and two two-digit years
  // only beside a season word, so a list of team numbers ("25, 26") stays a list.
  const next = (a: string, b: string) => (Number(b) === (Number(a.slice(-2)) + 1) % 100);
  const dated = said.replace(/\b(20\d\d)\s*[-–/]\s*(20\d\d)\b/g, (w, a: string, b: string) => (Number(b) === Number(a) + 1 ? `${a}-${b.slice(2)}` : w))
    .replace(/\b(20\d\d)\s*,\s*(\d\d)\b/g, (w, a: string, b: string) => (next(a, b) ? `${a}-${b}` : w))
    .replace(/\b(season\s+)(\d\d)\s*,\s*(\d\d)\b|\b(\d\d)\s*,\s*(\d\d)(\s+season)\b/gi, (w, pre?: string, a1?: string, b1?: string, a2?: string, b2?: string, post?: string) => {
      const [a, b] = a1 ? [a1, b1!] : [a2!, b2!];
      return next(a, b) ? `${pre ?? ""}20${a}-${b}${post ?? ""}` : w;
    });
  // The names are loaded only when there is a number said as words; the rewrite itself is the name-aware one, on the
  // text as typed.
  const saysNumber = spelledNumbers(dated) !== dated;
  const years = saysNumber ? spelledNumbers(dated, await inAName()) : dated;
  if (years !== said) {
    const b = await searchAnswer(years, opts);
    return carryOutcome(b, { ...b, q: cleanQuery(raw) });
  }
  const a = await numberedAnswer(raw, opts);
  // A season said by its game ("how many teams in nj decode year", "…, centerstage") and not answered as said: the
  // same ask with the season's years, the way every reader reads a season. Only when the words as said found no
  // answer, so a team or event named like a game keeps its own.
  if (!a.stat && !a.card && (a.step === "recovery" || !a.hits.length)) {
    const bySeason = seasonByGame(said);
    if (bySeason !== said) {
      const b = await searchAnswer(bySeason, opts);
      if (b.stat || b.card) return carryOutcome(b, { ...b, q: cleanQuery(raw) });
    }
  }
  // Then its spelling (./spelling.ts): a misspelled query is read again corrected, and the better answer kept. Never
  // a quoted phrase, which asks for exactly those words.
  if (opts.spell === false || String(raw ?? "").includes('"')) return onPage(raw, a, opts);
  const asked = /\?\s*$/.test(String(raw ?? ""));
  return onPage(raw, await spelled(cleanQuery(raw), a, (q) => searchAnswer(asked ? `${q}?` : q, { ...opts, spell: false })), opts);
}

/** `q` with a game's name (and a "year" or "season" after it, an "in" or a comma before it) said as its season's years
 *  ("in decode" → "2025-26"); `q` itself when it names no game or is the game alone. */
export function seasonByGame(q: string): string {
  for (const s of SEASONS) {
    const g = [...s.game.toLowerCase().replace(/\s+/g, "")].join("\\s*");
    const re = new RegExp(`(?:\\s*,\\s*|\\s+(?:in|during|for)\\s+(?:the\\s+)?|\\s+)${g}(?:\\s+(?:season|year))?(?=\\s|[?!.]|$)`, "i");
    const m = re.exec(` ${q}`);
    if (!m) continue;
    const label = `${s.season}-${String((s.season + 1) % 100).padStart(2, "0")}`;
    const out = ` ${q}`.replace(re, ` ${label}`).replace(/\s+/g, " ").trim();
    return out === label ? q : out;
  }
  return q;
}

/** `q` with its informal short forms said in full (./query/lexicon.ts INFORMAL), never a word of a team's name or,
 *  beside its other words, an event's. */
async function inFull(q: string): Promise<string> {
  if (!INFORMAL.some(([f]) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${f}(?![\\p{L}\\p{N}])`, "iu").test(q))) return q;
  const [{ byName, list }, events] = await Promise.all([teamNames(), eventNames()]);
  // As far as the longest team's or event's name runs, in words.
  longestName ??= Math.max(4, ...list.map(([n]) => n.split(" ").length), ...events.map((n) => n.split(" ").length));
  return informalQuery(q, (words, wider) => {
    const k = nameKey(words);
    return byName.has(k) || (wider && events.some((n) => ` ${n} `.includes(` ${k} `)));
  }, longestName);
}
let longestName: number | undefined;

/** Whether words are part of a team's or event's name, word for word ("top ten" in "Top Ten Robotics"). */
async function inAName(): Promise<(words: string) => boolean> {
  const [{ list }, events] = await Promise.all([teamNames(), eventNames()]);
  return (words) => {
    const k = ` ${nameKey(words)} `;
    return list.some(([n]) => ` ${n} `.includes(k)) || events.some((n) => ` ${n} `.includes(k));
  };
}

let eventNameList: { at: number; list: string[] } | null = null;
async function eventNames(): Promise<string[]> {
  if (eventNameList && Date.now() - eventNameList.at < 10 * 60_000) return eventNameList.list;
  const rows = await all<{ name: string }>("SELECT DISTINCT name FROM events WHERE name IS NOT NULL");
  eventNameList = { at: Date.now(), list: rows.map((r) => nameKey(r.name)) };
  longestName = undefined;
  return eventNameList.list;
}

/** What the page adds to an answer (the dropdown's is never changed): a yes-or-no question's answer, else, for a
 *  question search can't answer yet, the sorry note. */
async function onPage(raw: string, a: SearchAnswer, opts: AnswerOptions): Promise<SearchAnswer> {
  if (!(opts.full ?? (opts.limit ?? 12) >= SEARCH_PAGE_LIMIT) || opts.sorry === false) return a;
  return (await withVerdict(raw, a, opts)) ?? withSorry(raw, a, opts);
}

/** A yes-or-no question on the page ("has 12345 ever been to worlds", "did 12345 ever lose to 67890"): the answer
 *  above the card that answered it, which is kept as it was; the evidence card of its own (./answers/yesNo.ts) when
 *  nothing did. Null when it isn't one. */
async function withVerdict(raw: string, a: SearchAnswer, opts: AnswerOptions): Promise<SearchAnswer | null> {
  // Which team a shared name means is asked first: no verdict for one of them.
  if (a.understood?.label.startsWith(WHICH)) return null;
  const q = cleanQuery(raw);
  const yn = await yesNoAnswer(q, { full: true, pages: pagesFor(q), now: opts.now, prefer: opts.prefer, resolve: (core) => resolveCore(core, opts) });
  const answered = (!!a.stat || !!a.card) && a.step !== "recovery" && !(a.understood?.label ?? "").includes(FALLBACK_NOTE);
  // Any other yes-or-no question answered with a count: its yes or no from the count (./answers/yesNo.ts derivedVerdict).
  const verdict = yn?.verdict ?? (answered ? derivedVerdict(q, a) : null);
  if (!verdict) return null;
  // A copy keeps the outcome failed-search reporting reads (./searchLayers.ts).
  return answered ? carryOutcome(a, { ...a, verdict }) : { ...yn!, q: a.q };
}

/** A question search can't answer yet: sorry, with what was read and the searches that do answer about it
 *  (./answers/sorry.ts). */
async function withSorry(raw: string, a: SearchAnswer, opts: AnswerOptions): Promise<SearchAnswer> {
  // Each suggestion run as the page runs it (with no sorry of its own, so never in a loop), kept only if it answers.
  const answers = async (s: string) => {
    const b = await searchAnswer(s, { ...opts, full: true, limit: SEARCH_PAGE_LIMIT, learn: false, sorry: false });
    const empty = (b.card?.none && !b.card.lines.length) || (b.stat?.none && !b.stat.headline);
    return b.step !== "recovery" && !(b.understood?.label ?? "").includes(FALLBACK_NOTE) && (!!b.hits.length || !!b.stat || !!b.card) && !empty;
  };
  const sorry = await sorryFor(cleanQuery(raw), a, { ...opts, answers });
  // A copy keeps the outcome failed-search reporting reads (./searchLayers.ts).
  return sorry ? carryOutcome(a, { ...a, sorry }) : a;
}

/** typedAnswer, with search's own nouns read in the other number when the query as typed reads nothing: its plurals
 *  as singulars ("4215 upcoming events" is "4215 upcoming event"), else its singulars as plurals ("4215 season").
 *  Singular and plural are one question. A query answered as typed is never read again, and the answer keeps the
 *  query as typed. */
async function numberedAnswer(raw: string, opts: AnswerOptions): Promise<SearchAnswer> {
  let a = await typedAnswer(raw, opts);
  if (String(raw ?? "").includes('"')) return a;
  const asked = /\?\s*$/.test(String(raw ?? ""));
  // A team's page opened at the section that answers ("4215 seasons": its history) answers more than the page alone,
  // and a question read ("4215 opr") is a direct answer on both surfaces, whether or not its stat card was built.
  const answers = (x: SearchAnswer) => (x.intent && !x.understood?.label.includes(FALLBACK_NOTE) ? Math.max(strength(x), 4) : strength(x))
    + (x.hits[0]?.kind === "team" && x.hits[0].section && !x.understood?.label.includes(FALLBACK_NOTE) ? 0.5 : 0);
  // Read again only when the query as typed found nothing, or only a team's page with no question read: decided by the
  // intent read, never by the stat card the page builds and the dropdown doesn't, so both surfaces read it alike.
  // Anything else it read ("which ultraviolet?", a team at an event it never played) is its answer.
  const unread = (x: SearchAnswer) => strength(x) <= 2 || (!x.intent && !x.stat && !x.card && x.understood?.kind === "team" && x.step !== "closest");
  // Then "states" as the championship it means for any place (owner): "nyc states", "romania states results", where
  // no state championship is named so.
  const q = cleanQuery(raw);
  const champ = STATES_WORD.test(q) && !/\bunited states\b/i.test(q) ? q.replace(new RegExp(STATES_WORD.source, "gi"), "$1championship") : null;
  for (const other of [numberQuery(q), numberQuery(q, true), champ]) {
    if (!unread(a)) return a;
    if (!other) continue;
    const b = await typedAnswer(asked ? `${other}?` : other, opts);
    if (answers(b) > answers(a)) a = carryOutcome(b, { ...b, q: a.q });
  }
  return a;
}
const STATES_WORD = /(^| )states(?= |$)/i;

/** searchAnswer for the query as typed. */
async function typedAnswer(raw: string, opts: AnswerOptions): Promise<SearchAnswer> {
  const asked = /\?\s*$/.test(String(raw ?? ""));
  const reader = (q: string) => readerAnswer(asked ? `${q}?` : q, { ...opts, inner: true });
  // Boolean operators and quoted phrases are read from the query as typed, before cleaning drops '"' and '|'
  // (./searchBoolean.ts); a query without them goes through the layers exactly as before.
  // A question the search pipeline reads completely ("12345 and 67890 matches together") is its answer, whatever
  // operator words it holds: "and" there joins two teams of one question, not two searches.
  const operators = /["&|-]|\b(?:and|or|not)\b/i.test(String(raw ?? ""));
  if (operators && !String(raw ?? "").includes('"') && opts.intents !== false && (await pipelineReads(cleanQuery(raw), opts.now, opts.prefer))) return layeredAnswer(cleanQuery(raw), reader, opts.prefer);
  const bool = operators ? await booleanAnswer(String(raw ?? ""), reader, opts.full ?? (opts.limit ?? 12) >= SEARCH_PAGE_LIMIT) : null;
  // Cut to the caller's limit like every other answer (a quoted name adds the teams named exactly that).
  if (bool) return { ...bool, hits: bool.hits.slice(0, opts.limit ?? 12) };
  return layeredAnswer(cleanQuery(raw), reader, opts.prefer);
}

/** A team number typed against the next word ("23268matches at nj championship"): the two words apart. Three letters
 *  or more, so an ordinal ("2nd", "10th") or a match code ("q12") stays as typed. */
export const unglue = (q: string): string => q.replace(/(^|\s)(\d{1,6})(\p{L}{3,})(?=\s|$)/gu, "$1$2 $3");

/** Layer 1, the readers' answer for `raw`. Plurals are read as their singular first (src/shared/searchQuery.ts),
 *  so "meets in New Jersey" is answered exactly as "meet in New Jersey"; the answer keeps the query as typed. */
export async function readerAnswer(raw: string, opts: AnswerOptions): Promise<SearchAnswer> {
  const typed = cleanQuery(raw);
  const read = singularize(unglue(typed));
  // Cleaning takes the "?" off; that it was there still says the query is a question ("robots can descore?").
  // One reading for every surface (brief Requirement 2): the answer is worked out on the page's full list, whatever
  // the caller's limit, and only then cut to it. A dropdown's 15 are the page's first 15, same step, same order.
  const shown = opts.limit ?? 12;
  const a = await answerFor(read, { ...opts, full: opts.full ?? shown >= SEARCH_PAGE_LIMIT, typed, asked: /\?\s*$/.test(String(raw ?? "")), limit: Math.max(shown, SEARCH_PAGE_LIMIT) });
  // The page words as typed ("records" stays a page word); links the answer added itself (a region's rankings) stay.
  const own = (p: { href: string }) => !pagesFor(read).some((x) => x.href === p.href);
  const out = read === typed ? a : { ...a, q: typed, pages: [...a.pages.filter(own), ...pagesFor(typed).filter((p) => !a.pages.some((x) => x.href === p.href && own(x)))] };
  // The page's cut counts cards (an event with its divisions is one: firstCards); a shorter list (the dropdown) is
  // the page's first rows. A list of names matched, cut by raw hits, may hold part of a family: made whole first. Never
  // an event set: it is every event its filters keep, so a member left out was left out by them (a date, a place).
  const names = (out.understood ?? understoodOf(out)).kind === "names";
  const listed = shown >= SEARCH_PAGE_LIMIT ? firstCards(names ? await withWholeFamilies(out.hits, opts.now) : await withEventParents(out.hits), shown) : await withEventParents(out.hits.slice(0, shown));
  return { ...out, hits: listed, understood: out.understood ?? understoodOf(out) };
}

/** What an answer understood the query as, in words (SearchUnderstood): never a result's title for a set of results. */
export function understoodOf(a: SearchAnswer): SearchUnderstood {
  const top = a.hits[0];
  if (a.card) { const who = cardWho(a.card); return { kind: "question", label: who ? `${who} · ${a.card.title}` : a.card.title }; }
  if (a.step === "recovery") return { kind: "names", label: a.recovery?.understood[0] ?? `No match for "${a.q}"` };
  if (top?.href?.startsWith("/compare")) return { kind: "compare", label: showingLine(a) ?? "Compare" };
  if (a.intent) return { kind: top?.kind === "team" ? "team" : "names", label: a.intent.understood.join(" · ") };
  if (a.step === "did-you-mean" && a.didYouMean) return { kind: "names", label: `Closest names to "${a.q}" (did you mean "${a.didYouMean}"?)` };
  // One team the words name exactly: that team (and what was asked about it).
  if (top?.kind === "team" && top.match !== "fuzzy" && (a.hits.length === 1 || top.facts || top.section || a.hits[1]?.match !== "exact")) return { kind: "team", label: showingLine(a) ?? teamWords(top.title) };
  if (top?.kind === "match") {
    // One match number in each division of an event ("USNJCMP Q1"): said once, for the event.
    const same = a.hits.filter((h) => h.kind === "match" && h.title.split(" · ")[0] === top.title.split(" · ")[0]);
    const event = /^(.+?) · (.+?) - [^·]+ Division$/.exec(top.title);
    if (same.length > 1 && event && same.every((h) => h.title.startsWith(`${event[1]} · ${event[2]} - `))) return { kind: "names", label: `${event[1]} at ${event[2]}, in each of its ${same.length} divisions` };
    return { kind: "names", label: top.title };
  }
  return { kind: "names", label: `Teams, events and matches matching "${nameWords(a.q)}"` };
}

/** Marks each team and event hit exact or fuzzy (SearchHit.match): exact when every word typed starts a word of its
 *  name (or is its number or code); fuzzy otherwise, naming the words that matched somewhere (its school, city or
 *  venue, a typo, the middle of a word). Exact hits stay first; fuzzy ones keep their order after them. */
function markMatches(rest: string, hits: SearchHit[]): SearchHit[] {
  const qs = words(nameWords(searchIntent(rest)?.rest ?? rest)).filter((w) => !SEARCH_FILLER.has(w));
  if (!qs.length) return hits;
  const marked = hits.map((h): SearchHit => {
    if (h.kind !== "team" && h.kind !== "event") return h;
    if (h.href || h.match || h.atEvent) return h;
    const own = words(h.kind === "team" ? `${h.ref} ${nameOf(h)}` : `${h.title} ${h.ref.split(":")[1] ?? ""}`);
    if (qs.every((q) => own.some((w) => w === q || w.startsWith(q)))) return { ...h, match: "exact" };
    // A name typed without its spaces ("badwolf" for Bad Wolf) is that name.
    if (qs.join("") === words(nameOf(h)).join("")) return { ...h, match: "exact" };
    const all = words(`${h.title} ${h.subtitle}`);
    const matched = qs.filter((q) => all.some((w) => wordScore(q, w) >= 0.6 || w.includes(q)));
    return { ...h, match: "fuzzy", ...(matched.length ? { matched } : {}) };
  });
  return [...marked.filter((h) => h.match !== "fuzzy"), ...marked.filter((h) => h.match === "fuzzy")];
}

/** How a question about a shared name that nothing told apart begins: "Which "Ultraviolet"? …". */
export const WHICH = "Which \"";
/** Every word search's own lexicon reads: a run made only of them is the question's, never a team's name. */
const LEX_WORDS = new Set(LEXICON.flatMap((e) => e.words));

/** A name several teams share in `q` (its whole name, nothing else beside it but the question's words), told apart by
 *  the shared rules: `q` asked again with that team's number, the card saying which name was read as which team; or,
 *  still tied, the teams it can be, each with its place, and the same question asked about each, one tap each. Null:
 *  no shared name, or one typed with its number beside it, "team" before it, or a versus (Compare asks its own). */
async function sharedName(q: string, opts: AnswerOptions): Promise<SearchAnswer | null> {
  const typed = opts.typed ?? q;
  if (VERSUS.test(` ${typed} `)) return null;
  const idx = await names();
  const ws = normalise(typed).split(" ").filter(Boolean);
  // Cheap first: no run of the words is a name two teams share.
  const taken = new Array<boolean>(ws.length).fill(false);
  const spans: { i: number; len: number; teams: ReturnType<typeof idx.teamsNamed> }[] = [];
  for (let len = Math.min(idx.longest, 12); len >= 1; len--) {
    for (let i = 0; i + len <= ws.length; i++) {
      if (taken.slice(i, i + len).some(Boolean)) continue;
      const said = ws.slice(i, i + len).join(" ");
      if (said.split(" ").every((w) => LEX_WORDS.has(w) || /^\d+$/.test(w))) continue;
      const teams = idx.teamsNamed(said);
      if (!teams.length) continue;
      // A longer name holds its words, a team's own or one several share.
      taken.fill(true, i, i + len);
      if (teams.length < 2) continue;
      const beside = [ws[i - 1], ws[i + len]].some((w) => !!w && teams.some((t) => String(t.number) === w));
      if (beside || /^(?:team|ftc)$/.test(ws[i - 1] ?? "")) continue;
      // A place's name, or ordinary words, are read as such (the parser's rules): no question about which team.
      const pl = idx.place(said, said);
      if ((pl && pl.kind !== "city") || onlyOrdinary(said)) continue;
      spans.push({ i, len, teams });
    }
  }
  if (!spans.length) return null;
  const p = await parseQuery(typed, await parseContext(opts.now, opts.prefer));
  if (p.named) return null;
  // A place typed right after the name ("robo rebels nj", "gear heads from michigan") picks among them, or says plainly
  // that none of the name is there: the team-in-a-place reader's own answer. A place elsewhere is the question's.
  const pl = p.place;
  const placeWords = pl ? fold(pl.typed).split(" ").filter(Boolean) : [];
  const placeAfter = (sp: (typeof spans)[number]) => {
    const after = ws.slice(sp.i + sp.len);
    const from = /^(?:in|from|of)$/.test(after[0] ?? "") ? 1 : 0;
    return placeWords.length > 0 && placeWords.every((w, k) => after[from + k] === w);
  };
  if (pl && spans.some(placeAfter)) return null;
  // A name the parser settled by the place typed beside it ("robo rebels michigan") is the team-in-a-place answer.
  const settledByParse = (sp: (typeof spans)[number]) => p.teams.some((t) => t.rule?.startsWith("the one in ") && !t.rule.startsWith("the one in the same") && t.candidates?.some((n) => sp.teams.some((x) => x.number === n)));
  if (spans.some(settledByParse)) return null;
  // Words search reads nothing in ("favorite color") ask what no team's answer holds: the sorry note says so instead.
  const inSpans = new Set(spans.flatMap((sp) => ws.slice(sp.i, sp.i + sp.len)));
  if (p.leftover.some((w) => !w.split(" ").every((x) => inSpans.has(fold(x))) && !onlyOrdinary(w))) return null;
  // The other teams named, settled: never one of the span's own teams (the parser may have settled the span itself).
  const settled = p.teams.filter((t) => !t.candidates || t.rule).map((t) => idx.team(t.number)).filter((t) => !!t);
  const prefer = opts.prefer ?? new Set<string>();
  const picks = spans.map((sp) => {
    const own = new Set(sp.teams.map((t) => t.number));
    const others = settled.filter((t) => !own.has(t.number));
    return { ...sp, r: pickShared(sp.teams, { mine: (n) => prefer.has(`team:${n}`), others }) };
  });
  // The query with each name's team number in its place; a name with none given stays as typed. Right to left by
  // position, so each name's place is still its own.
  const asked = (n: (number | null)[]) => {
    const out = [...ws];
    for (const [k, sp] of [...picks.entries()].sort((a, b) => b[1].i - a[1].i)) if (n[k] != null) out.splice(sp.i, sp.len, String(n[k]));
    return out.join(" ");
  };
  const shown = (t: { number: number; city: string | null; state: string | null; country: string | null }) => `${t.number} (${[t.city?.trim(), t.state].filter(Boolean).join(", ") || t.country || "?"})`;
  // The name as typed in the question ("ultraviolet"), the team's own spelling once one is picked.
  const typedOf = (sp: (typeof picks)[number]) => ws.slice(sp.i, sp.i + sp.len).join(" ");
  const nameOfSpan = (sp: (typeof picks)[number]) => cleanTeamName(sp.teams[0].number, sp.teams[0].name) ?? typedOf(sp);
  const tied = picks.find((x) => "tied" in x.r);
  if (tied && "tied" in tied.r) {
    const choices = tied.r.tied;
    // Registrations alone, none of them played: the teams list of the name, as before, picks none either.
    if (choices.every((t) => t.lastPlayed == null)) return null;
    // The other names: the team settled, else as typed (asked about next).
    const fixed = picks.map((x) => ("team" in x.r ? x.r.team.number : null));
    const at = picks.indexOf(tied);
    const hits = (await Promise.all(choices.map(async (t) => (await search(String(t.number), 3, prefer, new Set(["team"]))).find((h) => h.kind === "team" && h.ref === String(t.number)))))
      .filter((h): h is SearchHit => !!h).map((h) => ({ ...h, match: "exact" as const }));
    return answer(q, {
      hits, step: "deterministic",
      understood: { kind: "names", label: `${WHICH}${typedOf(tied)}"? ${choices.length} teams have that name: ${choices.map(shown).join(", ")}` },
      suggest: choices.slice(0, 4).map((t) => asked(fixed.map((n, k) => (k === at ? t.number : n)))),
    });
  }
  const numbers = picks.map((x) => ("team" in x.r ? x.r.team.number : 0));
  const said = picks.map((x) => ("team" in x.r ? `${nameOfSpan(x)}: ${shown(x.r.team)}, ${x.r.rule} of ${x.teams.length} teams with the name` : ""));
  const a = await searchAnswer(opts.asked ? `${asked(numbers)}?` : asked(numbers), { ...opts, rewrites: (opts.rewrites ?? 0) + 1 });
  const u = a.understood ?? understoodOf(a);
  return carryOutcome(a, { ...a, q, understood: { ...u, label: `${u.label} · ${said.join(" · ")}` } });
}

/** A question's leftover words read as a team (`core`): search's answer for them alone. Common words alone ("without",
 *  "team", "best") name no team (COMMON_WORDS), however many names hold them; topic words alone ("alliances", "most
 *  inspire") name a team only typed as its whole name, so "nj states alliances" is never team Alliance and "most
 *  inspire awards" never team Inspires (onlyTopicWords). */
async function resolveCore(core: string, opts: AnswerOptions): Promise<SearchAnswer> {
  const nothing = answer(core, { hits: [], step: "deterministic" });
  if (onlyCommonWords(core)) return nothing;
  const idx = await names();
  const ws = core.toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const own = idx.teamsNamed(core).length > 0;
  // A team's number typed among other words is that team, never a name its words nearly spell ("4215 date please" is
  // 4215, not 4218 Late() Knights); unless the words are a team's whole name with the number in it.
  const nums = [...new Set(ws.map((w) => w.replace(/^(\d+)s$/, "$1")).filter((w) => /^[1-9]\d{0,5}$/.test(w) && idx.team(Number(w))))];
  const byNumber = nums.length === 1 && !own && ws.length > 1;
  if (!own) {
    // A place's name (with ordinary words around it) is the place, never a team named after it ("Texas" is no
    // "Texas Robots", "romania" no placeholder "2025 FTC Romania Team").
    const rest = ws.filter((w) => !onlyOrdinary(w));
    const pl = rest.length ? idx.place(rest.join(" "), core.split(/\s+/).filter((w) => !onlyOrdinary(w)).join(" ")) : null;
    if (pl && pl.kind !== "city") return nothing;
  }
  // Ordinary words ("average", "lost", "actual rank") name a team only as its whole name, and never in a question
  // asking which team: there the team is the answer.
  if (onlyOrdinary(core) && (!own || asksWhich(opts.typed ?? ""))) return nothing;
  const r = await searchAnswer(core, { ...opts, intents: false, learn: false });
  // Search's own reading keeps what the words ask about (a topic's facts); only when its team isn't the number's is
  // the number read alone.
  // Only a near miss of the number (a team number as long, not it) is swapped back: "top 25 hypnotic" stays Hypnotic.
  const top = r.hits[0]?.kind === "team" ? r.hits[0].ref : null;
  if (byNumber && r.step !== "recovery" && top && top !== nums[0] && /^\d+$/.test(top) && top.length === nums[0].length) return resolveCore(nums[0], opts);
  if (!onlyTopicWords(core) && !onlyOrdinary(core)) return r;
  const whole = (t: string) => t.toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();
  return { ...r, hits: r.hits.filter((h) => h.kind !== "team" || whole(teamNameOf(h.title)) === whole(core)) };
}

async function answerFor(read: string, opts: AnswerOptions): Promise<SearchAnswer> {
  const limit = opts.limit ?? 12, prefer = opts.prefer ?? new Set<string>();
  const q = read;
  if (!q) return recovery(q, ["Nothing typed yet: try a team number, a team or event name, or a match like USNJCMP Q12"]);

  // 0. The search pipeline (./query/, docs/search-pipeline.md): the query parsed into slots in any word order and run
  // as one structured question over the stored data. A query it can't read completely goes on to the readers below.
  // It reads the words as typed: plurals are its lexicon's to read, and a team's name keeps its own ("Robotics").
  // A league's standings with no team: before the pipeline reads "league leaderboard" as its own board.
  const league = opts.intents === false ? null : await leagueSearch(opts.typed ?? q, { full: !!opts.full, pages: pagesFor(q) });
  if (league) return league;
  const piped = opts.intents === false ? null : await pipelineAnswer(opts.typed ?? q, { full: !!opts.full, pages: pagesFor(q), now: opts.now, prefer, resolve: (core) => resolveCore(core, opts) });
  if (piped) return piped;

  // A name several teams share, read before the readers below pick one of them by search's order: the one the shared
  // rules pick (./query/shared.ts), asked again with its number; still tied, which one (each with its place).
  const shared = opts.intents === false || (opts.rewrites ?? 0) >= 2 ? null : await sharedName(q, opts);
  if (shared) return shared;

  // 0. A phrasing the readers below miss, said the way they read it ("compare 12345 and 67890" → "12345 vs 67890"):
  // ./searchCoverage.ts. Who won Worlds by a year or a game ("who won worlds last year" → "… 2024-25") is said so
  // before the stat answers read it; every other rewrite after them, which answer a team's own stats first.
  // Events named on every side ("Romania Championship vs NJ Championship", "Worlds vs <event>"): the events side by
  // side, before a rewrite reads a side as a team's name. Only a season written as one ("2024-25") is the season.
  const evSeason = /(?:^|\s)20\d\d\s*[-–/]\s*\d\d(?=\s|$)/.test(q) ? seasonOf(q) : { season: null, rest: q };
  const evs = opts.intents === false ? null : await eventVersusSearch(evSeason.rest, evSeason.season ?? opts.season ?? null, { full: !!opts.full, pages: pagesFor(q), asked: q, alias: expandShortForms });
  if (evs) return evs;
  const rw = opts.intents !== false && (opts.rewrites ?? 0) < 2 ? rewriteQuery(q, await namedParts(q)) : null;
  const rewritten = async (r: { q: string; note?: string }) => {
    const a = await searchAnswer(opts.asked ? `${r.q}?` : r.q, { ...opts, rewrites: (opts.rewrites ?? 0) + 1 });
    const u = a.understood ?? understoodOf(a);
    return { ...a, q, understood: r.note ? { ...u, label: `${u.label} · ${r.note}` } : u };
  };
  if (rw && rw.q !== q && (rw.pre || /^who won worlds /.test(rw.q))) return rewritten(rw);
  // An event's award asked any way round ("East Bergen inspire award winner", "who got inspire at …"): the award ask,
  // before the stat answers read an award word as a team's name ("got", "Think-aBot-it").
  const aw = opts.intents === false ? null : await awardQuery(q);
  const awarded = aw ? readAsk(aw) : null;
  if (awarded) {
    const a = await askAnswer(q, awarded, { prefer, ask: (x) => searchAnswer(x, { ...opts, learn: false }) });
    if (a) return a;
  }
  // A place's award winners ("Michigan Inspire winners", "awards won by teams from <town>", "did any <state> team win
  // Inspire at worlds"), before the stat answers read the place or the award as a team's name.
  const placeAwards = opts.intents === false ? null : await readPlaceAwards(q);
  if (placeAwards) return placeAwardsSearch(q, placeAwards, pagesFor(q));

  // 0. What a word means ("how is opr calculated"), before the stat answers read a word of it as a team's name
  // ("CALculated Risk"); and the questions that name no team ("teams near me", "lowest opr in nj").
  const said = opts.intents === false ? null : explainAnswer(q) ?? nearMeAnswer(q) ?? (await bottomAnswer(q));
  if (said) return said;
  // A word's meaning for one team ("how is OPR calculated, with 4215 as an example"): the team's numbers and the word's.
  // `full` asks for the page's answer, whatever this surface shows: the explainer decides on it.
  const meant = opts.intents === false ? null : await explainTeamAnswer(q, (x, full) => searchAnswer(x, full ? { ...opts, learn: false, full: true, limit: Math.max(opts.limit ?? 0, SEARCH_PAGE_LIMIT) } : { ...opts, learn: false }), (opts.full ?? (opts.limit ?? 12) >= SEARCH_PAGE_LIMIT));
  if (meant) return meant;

  // 0. A stat question about a team ("12345 highest score in worlds", "12345 worlds record"): ./answers/index.ts.
  const resolve = (core: string) => resolveCore(core, opts);
  const stat = opts.intents === false ? null : await statAnswer(q, resolve, { full: !!opts.full, pages: pagesFor(q) });
  if (stat) return stat;

  // 0. Then the other rewrites, and a question answered on its own: what a word means, a count, the FIRST Championship,
  // an event's tab (./searchCoverage.ts).
  if (rw && rw.q !== q) return rewritten(rw);
  if (opts.intents !== false) {
    const direct = explainAnswer(q) ?? (await countAnswer(q)) ?? (await teamFactAnswer(q, prefer)) ?? (await teamListAnswer(q)) ?? (await placeTeamsAnswer(q, prefer))
      ?? (await monthAnswer(q, opts.now)) ?? (await worldsAnswer(q, opts.now)) ?? (await eventCodeAnswer(q, opts.now)) ?? (await eventPageAnswer(q, prefer, opts.now));
    if (direct) return direct;
  }

  // 0. A question a view answers ("top teams in New Jersey", "highest OPR", "will 12345 win their next match", "who won
  // Inspire at …", "how are predictions calculated"): that view's numbers and link (./searchAsks.ts).
  const ask = opts.intents === false ? null : readAsk(q);
  if (ask) {
    const a = await askAnswer(q, ask, { prefer, ask: (x) => searchAnswer(x, { ...opts, learn: false }) });
    if (a) return a;
  }

  // 0. A rules question ("Can robots descore … in autonomous?", "G402", "penalty for pinning"): the Rules quick
  // reference's matching entries, or a plain "no rule found". Never team names (./searchRules.ts).
  // A season's best scores ("what was the highest scoring match this season?") stay that question's, and a question
  // about teams ("which team fouls the least in NJ", "12345 penalty points") is their numbers', never the rules.
  const rq = opts.intents === false || parseHighScore(q) ? null : readRuleQuery(q, opts.asked);
  if (rq && !(await asksOfTeams(opts.typed ?? q, opts.now, prefer))) return ruleAnswer(q, rq);

  // 0a. The best scores of a season ("world record score bio buzz"), or of a team when one is named and found.
  const high = opts.intents === false ? null : parseHighScore(q);
  if (high) {
    if (!high.core) return highScoreAnswer(q, high, null, [], pagesFor(q));
    const base = await resolveCore(high.core, opts);
    const team = base.step !== "recovery" && base.hits[0]?.kind === "team" && !base.hits[0].href ? base.hits[0] : null;
    if (team) return highScoreAnswer(q, high, team, base.hits.slice(1), pagesFor(q));
  }

  // 0b. A question with a direct answer, when its team is found (else search goes on with the whole query).
  const question = opts.intents === false ? null : parseQuestion(q);
  if (question) {
    // Read with its plurals as typed: "4215 upcoming events" is the list, though `q` says "event".
    if (opts.typed && parseQuestion(opts.typed)?.many) question.many = true;
    const base = await resolveCore(question.core, opts);
    const team = base.step !== "recovery" && base.hits[0]?.kind === "team" && !base.hits[0].href ? base.hits[0] : null;
    if (team) {
      const ans = await questionAnswer(q, question, team, base.hits.slice(1), pagesFor(q));
      // The team found by a near spelling of its name ("hypnotik robotics upcoming events"): said as a correction.
      const said = opts.typed ?? q, name = teamNameOf(team.title);
      const at = said.toLowerCase().indexOf(question.core.toLowerCase());
      // A plural ending alone ("hypnotics robotics") is no misspelling: the name is found as typed.
      const bare = (x: string) => normalize(x).split(" ").map((w) => w.replace(/s$/, "")).join(" ");
      if (team.match !== "fuzzy" || at < 0 || !name || bare(name) === bare(question.core)) return ans;
      return { ...ans, step: "did-you-mean", didYouMean: `${said.slice(0, at)}${name}${said.slice(at + question.core.length)}` };
    }
  }

  // 0c. A conversational opening ("how good is simply complex", "where is 12345"): the question's frame, never part of
  // a name. What follows it is searched, with what the opening asks about ("how good is": the season's OPR, rank and
  // record) read as that topic.
  const conv = opts.intents === false ? q : conversationQuery(q);
  if (conv !== q) {
    const a = await searchAnswer(opts.asked ? `${conv}?` : conv, opts);
    // Links the inner answer added itself ("show me highest OPR": the rankings) stay, then the page words as typed.
    const added = a.pages.filter((p) => !pagesFor(conv).some((x) => x.href === p.href));
    return { ...a, q, pages: [...added, ...pagesFor(q).filter((p) => !added.some((x) => x.href === p.href))] };
  }

  // 0d. A set of events read from a place, a time or a year ("upcoming meets in New Jersey", "meets this weekend",
  // "2024 Houston Championship Edison Division"), or a region alone ("New Jersey", "NJ"): the events themselves,
  // filtered on their stored fields and listed by date (./searchEvents.ts). Never a did-you-mean.
  const evq = opts.intents === false ? null : readEventQuery(q);
  // A team at one of its events ("hypnotic at New Jersey Championship") is the team's answer, not a set of events.
  const teamAt = evq?.words.length && /\sat\s/i.test(q) ? await teamAtEventAnswer(q, limit, prefer) : null;
  if (evq && !teamAt) return eventSetAnswer(q, evq, { now: opts.now });
  const region = opts.intents === false || /\d/.test(q) ? null : regionOf(q.split(" "));
  if (region) {
    const teams = (await search(q, limit, prefer)).filter((h) => h.kind === "team");
    return eventSetAnswer(q, { kinds: [], time: null, year: null, season: null, region, where: null, words: [] }, { now: opts.now, others: teams });
  }

  // A team's whole name and then a place ("robo rebels nj", "bad wolf new jersey"): the teams by that name in that
  // place, or plainly that none is there, with every team by the name.
  const placed = opts.intents === false ? null : await namedInPlace(q, limit, prefer);
  if (placed) return placed;

  // 1. A team number, alone or as "team 12345" / "team-12345" / "#12345".
  const num = /^(?:team)?[\s#-]*(\d{1,6})[.\s]*$/i.exec(q);
  if (num) {
    const n = String(Number(num[1]));
    const found = (await search(n, 5, prefer)).find((h) => h.kind === "team" && h.ref === n);
    // A season named in words ("12345 last season"): the team opens on it, as with a typed year.
    const team = found && opts.season != null ? { ...found, linkSeason: opts.season, subtitle: [seasonLabel(opts.season), found.subtitle].filter(Boolean).join(" · ") } : found;
    return team ? answer(q, { hits: [team], step: "deterministic" }) : recovery(q, [`A team number: ${n}`, `No FTC team ${n} on record`]);
  }

  // 1b. A season, a region, a ranking or a view that doesn't exist yet: the closest real view, and what's missing.
  let it = opts.intents === false ? null : parseIntent(q);
  // A region read from a bare name ("New Jersey Championship rankings") that's really part of an event's name: the event.
  if (it?.regionBare) {
    const asEvent = await search(it.withoutRanking, 5, prefer);
    if (asEvent[0]?.kind === "event" && topScore(it.withoutRanking, asEvent) >= WEAK_SCORE) it = null;
  }
  if (it && it.core !== q) {
    const a = await intentAnswer(q, it, await searchAnswer(it.core, { ...opts, intents: false, learn: false, season: it.season ?? opts.season }));
    if (a) return a;
  }

  // 2. Teams side by side (in a season, when one is named).
  // Only a season written as one ("2024-25") counts here: a bare 2000–2099 is as likely a team ("2024 vs 12345").
  const vsSeason = /(?:^|\s)20\d\d\s*[-–/]\s*\d\d(?=\s|$)/.test(q) ? seasonOf(q) : { season: null, rest: q };
  const vs = await versusAnswer(vsSeason.rest, prefer, vsSeason.season ?? opts.season ?? null);
  if (vs) return vs;
  // One team, Compare asked for ("compare 12345"): Compare with it in, and its closest rivals to compare it with.
  const one = await compareOneAnswer(vsSeason.rest, prefer, vsSeason.season ?? opts.season ?? null);
  if (one) return one;

  // 3. The search, on the season-free, short-forms-expanded query; the name-and-topic reading when it fits better.
  // A season named makes a team's numbers and link that season's.
  const typed = seasonOf(expandShortForms(q));
  const rest = typed.rest, season = typed.season ?? opts.season ?? null;
  let hits = await search(rest, limit, prefer, undefined, season, opts.asked);
  const intent = searchIntent(rest);
  if (hits.length && intent && !intent.topic) {
    const alt = await search(intent.rest, limit, prefer, undefined, season, opts.asked);
    if (topScore(rest, alt) > topScore(rest, hits)) hits = alt;
  }

  // 4. Word by word: a result matching more words first; words matching nothing are ignored.
  let byWords = false;
  if (!hits.length) {
    const ws = words(nameWords(rest, opts.asked)).filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !SEARCH_FILLER.has(w) && !isTopicWord(w));
    const count = new Map<string, { h: SearchHit; n: number; first: number }>();
    for (const [i, w] of ws.entries()) for (const h of await search(w, limit, prefer, undefined, season)) {
      const c = count.get(key(h)) ?? { h, n: 0, first: i };
      c.n++; count.set(key(h), c);
    }
    hits = [...count.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((c) => c.h).slice(0, limit);
    byWords = hits.length > 0;
  }

  // A season in the query: its events first, and teams open on it.
  if (season != null) {
    hits = [...hits.filter((h) => h.kind !== "event" || h.season === season), ...hits.filter((h) => h.kind === "event" && h.season !== season)]
      .map((h) => (h.kind === "team" ? { ...h, linkSeason: season, subtitle: [seasonLabel(season), h.subtitle].filter(Boolean).join(" · ") } : h));
  }

  // Word by word is never the answer: it's the closest matches, each naming the word it matched (brief Requirement 6).
  if (byWords) {
    // An event's name said with a kind of event none of its events is ("bergen qualifier", where Bergen's events are
    // league tournaments): the events by the name, the label saying the kind matched none of them.
    const said = rest.split(/\s+/), kindless = said.filter((w) => !EVENT_WORDS.has(singularize(w).toLowerCase()));
    if (kindless.length && kindless.length < said.length && !kindless.every((w) => /^\d+$/.test(w))) {
      const named = kindless.join(" ");
      const evs = (await search(named, limit, prefer, undefined, season)).filter((h) => h.kind === "event");
      const kind = said.find((w) => !kindless.includes(w))!.toLowerCase();
      if (evs.length) return answer(q, { hits: evs, step: "deterministic", understood: { kind: "names", label: `No ${singularize(kind)} named "${named}": events matching "${named}"` } });
    }
    // A team the query names after all (a number in it, or a name with trailing words): the team, never "no results".
    const kept = opts.intents === false ? null : await teamFallback(rest, prefer);
    if (kept) return { ...kept, q };
    // A question ("what is the best ftc team right now") isn't a list of names: a word of it matching a town
    // ("Best") or a team ("The Best Friends") is no answer, so it says what it read and offers the browse links.
    if (opts.asked || isQuestionForm(opts.typed ?? q)) return recovery(q, [`No team, event or match matched "${nameWords(q)}"`]);
    const ws = words(nameWords(rest, opts.asked));
    const closest = uniq(hits).slice(0, 10).map((h): SearchHit => ({ ...h, match: "fuzzy", matched: ws.filter((w) => words(`${h.title} ${h.subtitle}`).some((x) => x.startsWith(w))) }));
    return recovery(q, [`No team, event or match matched all of "${nameWords(q)}"`, "Closest matches: each has some of the words"], closest);
  }

  if (!hits.length && onlyPageWords(opts.typed ?? q)) return answer(q, { hits: [], step: "deterministic", understood: pageUnderstood(opts.typed ?? q) }); // "records": the pages
  if (!hits.length) {
    const kept = opts.intents === false ? null : await teamFallback(rest, prefer);
    if (kept) return { ...kept, q };
    const understood = intent?.topic ? [`A question about ${TOPIC_LABEL[intent.topic].toLowerCase()}`, `No team or event matched "${intent.rest}"`] : [`No team, event or match matched "${q}"`];
    return recovery(q, understood);
  }

  const score = topScore(rest, hits);
  const exact = score >= 0.999;
  // Only a site page's word ("rankings", "rules") that near-matches names ("Iron Hawkings"): the page is the answer,
  // not a guess at a team. A name beside it ("hipnotic rankings") keeps its corrected results.
  if (score < WEAK_SCORE && onlyPageWords(opts.typed ?? q)) return answer(q, { hits: [], step: "deterministic", understood: pageUnderstood(opts.typed ?? q) });
  // A near match to a team that never played (a test registration, a typo'd sign-up) is a closest match, not a result,
  // unless the words call it by its name's own part ("<name> juniors" for "<Name> Junior").
  const called = !exact && hits[0].kind === "team" ? await calledTeams(rest, prefer) : [];
  // The hits already listed keep what the season named gave them (its link, its label).
  const listed = called.map((c) => hits.find((h) => h.kind === "team" && h.ref === c.ref) ?? c);
  if (called.some((h) => h.ref === hits[0].ref)) return answer(q, { hits: [...listed, ...hits.filter((h) => !called.some((c) => c.ref === h.ref))].slice(0, limit), step: "deterministic" });
  if (!exact && hits[0].kind === "team" && !hits[0].href && !(await played(hits[0].ref))) {
    return recovery(q, [`No exact match for "${q}"`], uniq(hits).slice(0, 5));
  }
  // Learned order, read under the same key a pick is counted under (learnQuery).
  if (opts.learn !== false) hits = await rerank(nameWords(rest), hits, { pinTop: exact });
  const marked = markMatches(rest, uniq(hits));
  // A correction ("did you mean") only for a genuine near miss to a name: the top hit's own name is close to what was
  // typed but not it ("hipnotic robotics"). Words found only in a school, city or venue ("River Dell") are results,
  // labelled as fuzzy matches, never a "correction" to some unrelated name.
  const top = marked[0];
  const named = searchIntent(rest)?.rest ?? rest;
  const nearName = top.match === "fuzzy" && fuzzyScore(named, nameOf(top)) >= 0.6;
  // Two names as close as each other ("molt bots": Volt Bots and Bolt Bots): both are listed, neither is guessed.
  // Every other near name, not just the next: learned clicks may have put a less close one between them.
  const tie = nearName && marked.slice(1).some((h) => h.kind === top.kind && h.match === "fuzzy" && fuzzyScore(named, nameOf(h)) >= fuzzyScore(named, nameOf(top)));
  if (!nearName || tie) return answer(q, { hits: marked, step: "deterministic" });
  const topic = (intent ?? searchIntent(rest, true))?.phrase;
  return answer(q, { hits: marked, step: "did-you-mean", didYouMean: `${nameOf(top)}${topic ? ` ${topic}` : ""}` });
}

/** The query a pick of `raw`'s results is learned under: what the ranking read (an intent's core, short forms spelled
 *  out, the season taken off), so "champs" and "championship" teach the same order. */
export function learnQuery(raw: string): string {
  const q = conversationQuery(singularize(cleanQuery(raw)));
  const it = parseIntent(q);
  return nameWords(seasonOf(expandShortForms(it && it.core !== q && it.core ? it.core : q)).rest);
}
