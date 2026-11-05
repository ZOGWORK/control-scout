// Search's one answer for every surface (the header box, /search, the address bar's search): docs/search.md.
//
// Fixed rules, in order, every one deterministic:
//   0. A question search answers directly ("when did hypnotic go to worlds", "has bad wolf won anything", "4215's next
//      event"): the team it names, and a card built from the stored data (./searchQuestions.ts).
//   1. A team number ("4215", "team 4215", "team-4215") is that team alone; a number with no team is the recovery state.
//   2. Two or more teams joined by "vs"/"versus" open Compare.
//   3. Otherwise the search itself (names, numbers, codes, matches, topic words: server/api/search.ts), with short forms
//      spelled out ("champs") and the name-and-topic reading taken when it fits better ("team talos" vs "team 4215").
//   4. Nothing for the whole query: each word on its own; a result matching more words ranks higher, and words that
//      match nothing are ignored.
// Before 2: a season, region, ranking or missing view read from the query (./searchIntents.ts).
// Then the step: "deterministic" when the top result fits what was typed, "did-you-mean" when it's a correction, and
// "recovery" when there's nothing, or only near matches to teams that never played (those are listed as closest).
// Learned click weights (./searchLearn.ts) may re-rank the results, never add one, and never pick the team an answer is
// about: every lookup that does (a stat, a high score, a question, an intent) asks with learn: false. Bruno AI is never asked here:
// the app asks /api/search/refine after these results are on screen (./searchBruno.ts).
import type { SearchAnswer, SearchHit, SearchRecovery, SearchUnderstood } from "../../src/shared/api.js";
import { SEARCH_BROWSE, SEARCH_FILLER, SEARCH_PAGE_LIMIT, SEARCH_TOPICS, TOPIC_LABEL, VERSUS, cardWho, onlyPageWords, pagesFor, showingLine } from "../../src/shared/search.js";
import { conversationQuery, isQuestionForm, nameWords, onlyCommonWords, singularize } from "../../src/shared/searchQuery.js";
import { readEventQuery, regionOf } from "../../src/shared/searchEventQuery.js";
import { eventSetAnswer } from "./searchEvents.js";
import { versusAnswer } from "./searchCompare.js";
import { ruleAnswer } from "./searchRules.js";
import { askAnswer, readAsk } from "./searchAsks.js";
import { readRuleQuery } from "../../src/shared/searchRuleQuery.js";
import { seasonLabel } from "../../src/shared/format.js";
import { cleanTeamName, searchTeamTitle, teamNameOf, teamWords } from "../../src/shared/teamTitle.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { all, get } from "../db.js";
import { fuzzyScore, normalize, wordScore, words } from "./fuzzy.js";
import { ftsQuery, search, searchIntent, teamAtEventAnswer } from "./search.js";
import { rerank } from "./searchLearn.js";
import { intentAnswer, parseIntent } from "./searchIntents.js";
import { parseQuestion, questionAnswer } from "./searchQuestions.js";
import { highScoreAnswer, parseHighScore } from "./searchHighScores.js";
import { statAnswer } from "./answers/index.js";
import { refreshSearchSeason } from "./answers/season.js";
import { layeredAnswer } from "./searchLayers.js";
import { spelled } from "./spelling.js";
import { booleanAnswer } from "./searchBoolean.js";
import { bottomAnswer, countAnswer, eventCodeAnswer, eventPageAnswer, explainAnswer, monthAnswer, nearMeAnswer, placeTeamsAnswer, rewriteQuery, teamFactAnswer, teamFallback, teamListAnswer, worldsAnswer } from "./searchCoverage.js";

export const MAX_QUERY = 80;
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
}

/** The query as search reads it: punctuation that never means anything dropped, spaces folded, at most MAX_QUERY. */
export function cleanQuery(raw: string): string {
  return String(raw ?? "").replace(/[!?,;"<>(){}[\]|\\^*`~=+]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY).trim();
}

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
    const name = ws.slice(0, -k).join(" ");
    const want = normalize(name);
    if (!want) return null;
    // Every team by that whole name: the candidates from the search index (accents and case folded, as search reads
    // a name) with no cap, then the teams themselves with their stored state and country, so a team with no city on
    // record still counts as in its state.
    const fts = ftsQuery(name);
    if (!fts) return null;
    const refs = (await all<{ ref: string }>("SELECT ref FROM search WHERE search MATCH ? AND kind = 'team'", [fts])).map((r) => Number(r.ref)).filter(Number.isFinite);
    if (!refs.length) return null;
    const rows = (await all<any>(
      `SELECT t.number, t.name, t.city, t.state, t.country, cs.season last FROM teams t
       LEFT JOIN team_seasons cs ON cs.team = t.number AND cs.season = ?
       WHERE t.number IN (${refs.map(() => "?").join(",")}) AND ${teamPageSql("t.number", "t.name")} ORDER BY cs.season IS NOT NULL DESC, t.number`,
      [CURRENT_SEASON, ...refs],
    )).filter((t) => normalize(cleanTeamName(t.number, t.name) ?? "") === want);
    if (!rows.length) return null;
    const hit = (t: any): SearchHit => ({ kind: "team", ref: String(t.number), title: searchTeamTitle(t.number, t.name), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season: t.last == null ? null : Number(t.last) });
    const there = rows.filter((t) => String(t.country ?? "").toLowerCase() === region.country.toLowerCase() && (!region.state || String(t.state ?? "").toLowerCase() === region.state.toLowerCase()));
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
  const a = await typedAnswer(raw, opts);
  // Then its spelling (./spelling.ts): a misspelled query is read again corrected, and the better answer kept. Never
  // a quoted phrase, which asks for exactly those words.
  if (opts.spell === false || String(raw ?? "").includes('"')) return a;
  const asked = /\?\s*$/.test(String(raw ?? ""));
  return spelled(cleanQuery(raw), a, (q) => searchAnswer(asked ? `${q}?` : q, { ...opts, spell: false }));
}

/** searchAnswer for the query as typed. */
async function typedAnswer(raw: string, opts: AnswerOptions): Promise<SearchAnswer> {
  const asked = /\?\s*$/.test(String(raw ?? ""));
  const reader = (q: string) => readerAnswer(asked ? `${q}?` : q, { ...opts, inner: true });
  // Boolean operators and quoted phrases are read from the query as typed, before cleaning drops '"' and '|'
  // (./searchBoolean.ts); a query without them goes through the layers exactly as before.
  const bool = /["&|-]|\b(?:and|or|not)\b/i.test(String(raw ?? "")) ? await booleanAnswer(String(raw ?? ""), reader, opts.full ?? (opts.limit ?? 12) >= SEARCH_PAGE_LIMIT) : null;
  // Cut to the caller's limit like every other answer (a quoted name adds the teams named exactly that).
  if (bool) return { ...bool, hits: bool.hits.slice(0, opts.limit ?? 12) };
  return layeredAnswer(cleanQuery(raw), reader);
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
  return { ...out, hits: out.hits.slice(0, shown), understood: out.understood ?? understoodOf(out) };
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

async function answerFor(read: string, opts: AnswerOptions): Promise<SearchAnswer> {
  const limit = opts.limit ?? 12, prefer = opts.prefer ?? new Set<string>();
  const q = read;
  if (!q) return recovery(q, ["Nothing typed yet: try a team number, a team or event name, or a match like USNJCMP Q12"]);

  // 0. A phrasing the readers below miss, said the way they read it ("compare 4215 and 6980" → "4215 vs 6980"):
  // ./searchCoverage.ts. Who won Worlds by a year or a game ("who won worlds last year" → "… 2024-25") is said so
  // before the stat answers read it; every other rewrite after them, which answer a team's own stats first.
  const rw = opts.intents !== false && (opts.rewrites ?? 0) < 2 ? rewriteQuery(q) : null;
  const rewritten = async (r: { q: string; note?: string }) => {
    const a = await searchAnswer(opts.asked ? `${r.q}?` : r.q, { ...opts, rewrites: (opts.rewrites ?? 0) + 1 });
    const u = a.understood ?? understoodOf(a);
    return { ...a, q, understood: r.note ? { ...u, label: `${u.label} · ${r.note}` } : u };
  };
  if (rw && rw.q !== q && (rw.pre || /^who won worlds /.test(rw.q))) return rewritten(rw);

  // 0. What a word means ("how is opr calculated"), before the stat answers read a word of it as a team's name
  // ("CALculated Risk"); and the questions that name no team ("teams near me", "lowest opr in nj").
  const said = opts.intents === false ? null : explainAnswer(q) ?? nearMeAnswer(q) ?? (await bottomAnswer(q));
  if (said) return said;

  // 0. A stat question about a team ("4215 highest score in worlds", "4215 worlds record"): ./answers/index.ts.
  // Common words alone ("without", "team", "best") name no team (COMMON_WORDS), however many names hold them.
  const resolve = (core: string): Promise<SearchAnswer> => (onlyCommonWords(core) ? Promise.resolve(answer(core, { hits: [], step: "deterministic" })) : searchAnswer(core, { ...opts, intents: false, learn: false }));
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

  // 0. A question a view answers ("top teams in New Jersey", "highest OPR", "will 4215 win their next match", "who won
  // Inspire at …", "how are predictions calculated"): that view's numbers and link (./searchAsks.ts).
  const ask = opts.intents === false ? null : readAsk(q);
  if (ask) {
    const a = await askAnswer(q, ask, { prefer, ask: (x) => searchAnswer(x, { ...opts, learn: false }) });
    if (a) return a;
  }

  // 0. A rules question ("Can robots descore … in autonomous?", "G402", "penalty for pinning"): the Rules quick
  // reference's matching entries, or a plain "no rule found". Never team names (./searchRules.ts).
  // A season's best scores ("what was the highest scoring match this season?") stay that question's.
  const rq = opts.intents === false || parseHighScore(q) ? null : readRuleQuery(q, opts.asked);
  if (rq) return ruleAnswer(q, rq);

  // 0a. The best scores of a season ("world record score bio buzz"), or of a team when one is named and found.
  const high = opts.intents === false ? null : parseHighScore(q);
  if (high) {
    if (!high.core) return highScoreAnswer(q, high, null, [], pagesFor(q));
    const base = await searchAnswer(high.core, { ...opts, intents: false, learn: false });
    const team = base.step !== "recovery" && base.hits[0]?.kind === "team" && !base.hits[0].href ? base.hits[0] : null;
    if (team) return highScoreAnswer(q, high, team, base.hits.slice(1), pagesFor(q));
  }

  // 0b. A question with a direct answer, when its team is found (else search goes on with the whole query).
  const question = opts.intents === false ? null : parseQuestion(q);
  if (question) {
    const base = await searchAnswer(question.core, { ...opts, intents: false, learn: false });
    const team = base.step !== "recovery" && base.hits[0]?.kind === "team" && !base.hits[0].href ? base.hits[0] : null;
    if (team) return questionAnswer(q, question, team, base.hits.slice(1), pagesFor(q));
  }

  // 0c. A conversational opening ("how good is simply complex", "where is 4215"): the question's frame, never part of
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

  // 1. A team number, alone or as "team 4215" / "team-4215" / "#4215".
  const num = /^(?:team)?[\s#-]*(\d{1,6})[.\s]*$/i.exec(q);
  if (num) {
    const n = String(Number(num[1]));
    const found = (await search(n, 5, prefer)).find((h) => h.kind === "team" && h.ref === n);
    // A season named in words ("4215 last season"): the team opens on it, as with a typed year.
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
  // Only a season written as one ("2024-25") counts here: a bare 2000–2099 is as likely a team ("2024 vs 4215").
  const vsSeason = /(?:^|\s)20\d\d\s*[-–/]\s*\d\d(?=\s|$)/.test(q) ? seasonOf(q) : { season: null, rest: q };
  const vs = await versusAnswer(vsSeason.rest, prefer, vsSeason.season ?? opts.season ?? null);
  if (vs) return vs;

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
  // A near match to a team that never played (a test registration, a typo'd sign-up) is a closest match, not a result.
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
