// Search's spelling correction ("Did you mean: hypnotic robotics"), deterministic, no AI. Each word of a query is
// checked against a vocabulary built from the stored data (team names, schools, event names and venues, cities and
// regions) and search's own words (the topics, the question and intent words, the game names). A word that is not in
// it, and is within the edit allowance of one that is (src/shared/fuzzy.ts allowedEdits: none up to 3 letters, 1 up
// to 7, then 2), is corrected to the closest one. Search then reads both queries and keeps the better answer
// (searchAnswer.ts spelled):
//   - the original found nothing, or found worse: the corrected query's answer, labelled "Did you mean: …";
//   - as good: the original's answer, with the corrected query offered when every fix is to search's own words.
// Never corrected: numbers, words with a digit, event codes and words typed in capitals ("USNJCMP"), words of 3
// letters or fewer, search's own words, any word of a team's name, and a plain form of a known word ("winning",
// "placed"). A word two names' words fit equally is left as typed: search's own fuzzy matching then lists both
// rather than guessing one.
import type { SearchAnswer } from "../../src/shared/api.js";
import { all, kvGet } from "../db.js";
import { registerCache } from "../caches.js";
import { SEASONS } from "../data/seasons.js";
import { REGION_PHRASES } from "../../src/shared/regions.js";
import { SEARCH_FILLER, SEARCH_PAGES, SEARCH_TOPICS } from "../../src/shared/search.js";
import { CONVERSATIONAL, EVENT_WORDS, PLURALS, QUESTION_WORDS, STOPWORDS, TIME_WORDS } from "../../src/shared/searchQuery.js";
import { allowedEdits, editDistance, normalize, words } from "./fuzzy.js";
import { FALLBACK_NOTE, carryOutcome } from "./searchLayers.js";
import { AWARDS, FILLER, INTENTS, LEADER_STAT_WORDS, PARAPHRASES, PHASES, SCAFFOLD, WEAK_SIGNALS } from "./searchCatalog.js";

/** Search's own words beyond its catalogs: what people ask about teams, events and matches. A misspelled word is
 *  corrected to these first ("oper" is OPR, not "open"). */
const ASKED_WORDS = [
  "opr", "oprs", "record", "records", "awards", "award", "worlds", "inspire", "playoffs", "playoff", "qualifiers", "qualifier", "qualifying",
  "quals", "championship", "championships", "champion", "champions", "league", "leagues", "meet", "meets", "premier", "scrimmage",
  "division", "divisions", "finals", "final", "semifinal", "semifinals", "alliance", "alliances", "captain", "captains", "rank", "ranked",
  "ranking", "rankings", "score", "scores", "scored", "scoring", "highest", "lowest", "average", "total", "points", "auto", "autonomous",
  "teleop", "endgame", "penalty", "penalties", "foul", "fouls", "match", "matches", "event", "events", "team", "teams", "season",
  "seasons", "rookie", "veteran", "school", "sponsor", "sponsors", "website", "location", "upcoming", "latest", "previous", "winner",
  "winners", "wins", "losses", "ties", "versus", "compare", "comparison", "stats", "statistics", "history", "timeline", "rating",
  "ratings", "prediction", "predictions", "predicted", "predict", "odds", "advancement", "advancing", "reliability", "consistency",
  "streak", "streaks", "percentile", "schedule", "difficulty", "bracket", "elims", "eliminations", "results", "standings", "rules",
  "robot", "robots", "robotics", "scouting", "finalist", "finalists", "regional", "kickoff", "invitational", "interleague",
  "tournament", "tournaments", "competition", "competitions", "opponent", "opponents", "partner", "partners", "component",
  "components", "breakdown", "margin", "margins", "carry", "confidence", "worldwide", "nationwide", "statewide", "trend", "trends",
  "improve", "improved", "improvement", "advance", "advanced", "range", "beat", "beats", "head", "median", "mean", "maximum",
  "minimum", "deviation", "percent", "percentage", "ratio", "rate", "share", "contribution", "contributions",
];

/** Plain English a query says around them: never corrected, and after search's own words as a correction. */
const PLAIN_WORDS = [
  "about", "above", "after", "again", "against", "also", "always", "another", "around", "away", "back", "because", "been", "before",
  "being", "below", "best", "better", "between", "both", "bottom", "call", "called", "came", "chance", "chances", "change", "city",
  "close", "come", "compared", "count", "could", "country", "current", "currently", "data", "date", "dates", "does", "doing", "done",
  "down", "during", "each", "early", "else", "even", "ever", "every", "fast", "fewest", "first", "five", "four", "free", "from",
  "full", "give", "goes", "going", "gone", "good", "great", "half", "have", "having", "help", "here", "high", "home", "into", "just",
  "keep", "kind", "know", "known", "late", "later", "least", "less", "like", "list", "little", "live", "long", "longest", "look",
  "looking", "lose", "losing", "lost", "made", "make", "makes", "many", "more", "most", "much", "must", "name", "named", "names",
  "near", "nearby", "need", "never", "next", "nine", "none", "number", "numbers", "often", "once", "only", "open", "other", "over",
  "page", "pages", "part", "past", "place", "placed", "play", "played", "playing", "plays", "please", "profile", "real", "recent",
  "region", "regions", "same", "second", "seven", "shared", "show", "since", "some", "state", "states", "still", "such", "take",
  "tell", "than", "thanks", "that", "their", "them", "then", "there", "these", "they", "third", "this", "those", "three", "through",
  "time", "times", "today", "tomorrow", "until", "upon", "very", "want", "week", "weekend", "well", "went", "what", "when", "where",
  "which", "while", "will", "with", "within", "without", "worse", "worst", "would", "year", "years", "yesterday", "your",
];

export interface Vocab {
  /** Words that are never corrected: search's own, event codes, every word of a team's name, and data words seen
   *  three times or more. */
  keep: Set<string>;
  /** How often each data word appears. */
  count: Map<string, number>;
  /** Every word of a team's name (a typed word on the way to one is left alone). */
  teamWords: string[];
  /** Search's own words (2: what is asked about, "opr", "awards"; 1: the plain words around it): a misspelled word
   *  reaches these before any name's word. */
  own: Map<string, 1 | 2>;
  /** Every word a correction may reach, by length. */
  byLength: Map<number, string[]>;
}

const phraseWords = (ps: Iterable<string>) => [...ps].flatMap((p) => words(p));

/** Search's own words, from its catalogs and lists (no database), each with its tier (Vocab.own). */
export function ownWords(): Map<string, 1 | 2> {
  const asked = [
    ...ASKED_WORDS, ...phraseWords(SEARCH_TOPICS.map(([p]) => p)), ...phraseWords(SEARCH_PAGES.flatMap((p) => p.words)),
    ...phraseWords(INTENTS.flatMap((i) => i.words)), ...AWARDS, ...Object.keys(PHASES), ...phraseWords(LEADER_STAT_WORDS),
    ...Object.keys(WEAK_SIGNALS), ...EVENT_WORDS, ...Object.keys(PLURALS), ...Object.values(PLURALS),
    ...phraseWords(SEASONS.map((s) => s.game)), ...phraseWords(REGION_PHRASES),
  ];
  const plain = [
    ...PLAIN_WORDS, ...SEARCH_FILLER, ...phraseWords(PARAPHRASES.flat()), ...phraseWords(FILLER), ...phraseWords(SCAFFOLD),
    ...phraseWords(CONVERSATIONAL.map((c) => c.words)), ...phraseWords(TIME_WORDS), ...QUESTION_WORDS, ...STOPWORDS,
  ];
  const out = new Map<string, 1 | 2>();
  for (const w of plain.map(normalize).filter(Boolean)) out.set(w, 1);
  for (const w of asked.map(normalize).filter(Boolean)) out.set(w, 2);
  return out;
}

type TeamRow = { name: string | null; school?: string | null; city: string | null; state: string | null };
type EventRow = { code: string; name: string | null; venue?: string | null; city: string | null; state: string | null };

/** The vocabulary for the stored teams and events. */
export function buildVocab(teams: TeamRow[], events: EventRow[]): Vocab {
  const own = ownWords();
  const count = new Map<string, number>();
  const add = (w: string) => count.set(w, (count.get(w) ?? 0) + 1);
  const keep = new Set(own.keys());
  const team = new Set<string>();
  for (const t of teams) {
    for (const w of words(t.name ?? "")) { add(w); team.add(w); }
    for (const w of words(`${t.school ?? ""} ${t.city ?? ""} ${t.state ?? ""}`)) add(w);
  }
  for (const e of events) {
    keep.add(e.code.toLowerCase());
    for (const w of words(`${e.name ?? ""} ${e.venue ?? ""} ${e.city ?? ""} ${e.state ?? ""}`)) add(w);
  }
  for (const w of team) keep.add(w);
  // A data word seen three times or more is a real word, not a one-off typo in the data ("Qualifer" in an event's name).
  for (const [w, n] of count) if (n >= 3) keep.add(w);
  const byLength = new Map<number, string[]>();
  for (const w of new Set([...own.keys(), ...count.keys()])) {
    if (!/^\p{L}+$/u.test(w)) continue;
    (byLength.get(w.length) ?? byLength.set(w.length, []).get(w.length)!).push(w);
  }
  return { keep, count, teamWords: [...team], own, byLength };
}

let vocabCache: { version: string; vocab: Promise<Vocab> } | null = null;

/** The vocabulary from the database, rebuilt when the search index is (its "search:version"). */
async function vocab(): Promise<Vocab> {
  const version = (await kvGet<string>("search:version")) ?? "0";
  if (vocabCache?.version === version) return vocabCache.vocab;
  const v = Promise.all([
    all<TeamRow>("SELECT name, school, city, state FROM teams"),
    all<EventRow>("SELECT code, name, venue, city, state FROM events"),
  ]).then(([teams, events]) => buildVocab(teams, events));
  vocabCache = { version, vocab: v };
  // A failed read must not stick: the next search retries.
  v.catch(() => { if (vocabCache?.vocab === v) vocabCache = null; });
  return v;
}
registerCache("Search spelling vocabulary", () => { vocabCache = null; });

/** One word differs from the other only by a plural ending ("gear", "gears"): a different word, never a typo. */
const pluralPair = (a: string, b: string) => {
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return l === `${s}s` || l === `${s}es`;
};

/** The commonest slips: a letter doubled or undoubled ("oradel" for "Oradell"), or two letters swapped ("recrod"). */
function slip(a: string, b: string): boolean {
  if (a.length === b.length) {
    const i = [...a].findIndex((ch, k) => ch !== b[k]);
    return i >= 0 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  if (l.length !== s.length + 1) return false;
  for (let k = 1; k < l.length; k++) if (l[k] === l[k - 1] && l.slice(0, k) + l.slice(k + 1) === s) return true;
  return false;
}

/** A plain form of a word the vocabulary keeps ("winning" of "win", "placed" of "place", "partners" of "partner"). */
function formOfKnown(w: string, keep: Set<string>): boolean {
  const m = /^(.{3,}?)(s|es|ed|d|ing|er|ers|est|ly)$/.exec(w);
  if (!m) return false;
  const stem = m[1];
  // "winning" → "win", "placed" → "place", "scouting" → "scout".
  return keep.has(stem) || keep.has(`${stem}e`) || (/(.)\1$/.test(stem) && keep.has(stem.slice(0, -1)));
}

/** A correction: the word it reaches and whether it is one of search's own words. */
export interface WordFix { word: string; own: boolean }

/** The correction for one word (lower case, letters only), or null to leave it as typed. `last`: the query's last
 *  word, which may still be being typed. */
export function correctWord(w: string, v: Vocab, last = false): WordFix | null {
  const max = allowedEdits(w.length);
  if (!max || v.keep.has(w) || formOfKnown(w, v.keep)) return null;
  const seen = v.count.get(w) ?? 0;
  const found: { word: string; d: number; own: number; slip: boolean; n: number }[] = [];
  for (let len = w.length - max; len <= w.length + max; len++) {
    for (const c of v.byLength.get(len) ?? []) {
      if (c === w || pluralPair(c, w)) continue;
      const d = editDistance(w, c, max);
      if (d > max) continue;
      const own = v.own.get(c) ?? 0, n = v.count.get(c) ?? 0;
      // A word the data has once or twice (an event's or a city's one-off spelling, "Oradel") is only corrected to a
      // word that is clearly the usual one: search's own, or one seen five times as often.
      if (seen && !own && n < Math.max(5, seen * 5)) continue;
      found.push({ word: c, d, own, slip: d === 1 && slip(w, c), n });
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => a.d - b.d || b.own - a.own || Number(b.slip) - Number(a.slip) || b.n - a.n || (a.word < b.word ? -1 : 1));
  const top = found[0];
  // The last word on its way to a team's name ("hypno" for "Hypnotic") is what search's prefix matching is for.
  if (last && !top.own && !top.word.startsWith(w) && v.teamWords.some((x) => x.length > w.length && x.startsWith(w))) return null;
  // Two names' words as close as each other, by the same kind of slip, and about as common: neither is guessed.
  const tied = found.filter((b) => b.d === top.d && b.own === top.own && b.slip === top.slip);
  if (!top.own && tied.length > 1 && tied[1].n * 3 > top.n) return null;
  // Search's own word only when no name's word is as close ("molt" is "most" or "Volt"): then it is a fix to try, never
  // one to offer beside results found as typed.
  return { word: top.word, own: top.own > 0 && !found.some((b) => b.d === top.d && !b.own) };
}

/** A query with its misspelled words corrected, each in the case it was typed in ("Hypnotc" → "Hypnotic"), or null
 *  when nothing needs correcting, with each fix (typed, corrected; lower case). `own`: every fix is to one of search's own words ("oper" → "opr"), so it may be
 *  offered even when the query as typed found something. Only whole words of letters are read: numbers, codes and
 *  punctuation stay as typed. */
export async function correctQuery(q: string): Promise<{ q: string; own: boolean; fixes: [string, string][] } | null> {
  const parts = q.split(/(\s+)/);
  if (!parts.some((p) => /^\p{L}{4,}$/u.test(p))) return null;
  const v = await vocab();
  let own = true;
  const fixes: [string, string][] = [];
  let lastWord = parts.length - 1;
  while (lastWord > 0 && !parts[lastWord].trim()) lastWord--;
  const out = parts.map((p, i) => {
    // Only a word of four letters or more, never one typed in capitals (an event code, an acronym).
    if (!/^\p{L}{4,}$/u.test(p) || p === p.toUpperCase()) return p;
    const lower = p.toLowerCase();
    if (normalize(p) !== lower) return p;
    const fix = correctWord(lower, v, i === lastWord);
    if (!fix) return p;
    fixes.push([lower, fix.word]);
    own &&= fix.own;
    return p[0] === p[0].toUpperCase() ? fix.word[0].toUpperCase() + fix.word.slice(1) : fix.word;
  });
  return fixes.length ? { q: out.join(""), own, fixes } : null;
}

/** How good an answer is, for choosing between a query as typed and its correction: 4 a direct answer (a card or a
 *  stat), 3 results that match what was asked (or the pages it names), 2 near matches only (or a team whose page has
 *  the rest), 1 a correction or the closest matches, 0 nothing. */
export function strength(a: SearchAnswer): number {
  if (a.stat || a.card) return 4;
  if (a.step === "recovery") return a.recovery?.closest.length ? 1 : 0;
  if (a.step === "did-you-mean") return 1;
  if (!a.hits.length) return a.pages.length ? 3 : 0;
  if (a.understood?.label.includes(FALLBACK_NOTE)) return 2;
  return a.hits[0].match === "fuzzy" ? 2 : 3;
}

/** How many of an answer's first results name `w` as a whole word (in their title or subtitle). */
const naming = (a: SearchAnswer, w: string) => a.hits.slice(0, 10).filter((h) => words(`${h.title} ${h.subtitle}`).includes(w)).length;

/** `a`, the answer for `typed`, read again with its spelling corrected (`run` answers a query). The corrected answer
 *  is taken, as a correction (`didYouMean`, step "did-you-mean" unless it found nothing), when it is better: stronger
 *  ("hypnotc robotics", "4215 recrod"), or as strong with more results naming the corrected words than named the typed
 *  ones ("oradel": one event's typo, "Oradell": every team there), or nothing either way when the fix is search's own
 *  word (the corrected reading says what was asked). Else `a`, with the fix offered (`didYouMean` alone) when it is
 *  search's own word and both found near matches alike. An answer that reads the query directly is never second-guessed. */
export async function spelled(typed: string, a: SearchAnswer, run: (q: string) => Promise<SearchAnswer>): Promise<SearchAnswer> {
  const was = strength(a);
  if (was >= 4) return a;
  const fix = await correctQuery(typed);
  // A query that matched what it asked can only be improved to a direct answer, which only a question word's fix makes.
  if (!fix || (was >= 3 && !fix.own)) return a;
  const b = await run(fix.q);
  const now = strength(b);
  const named = (x: SearchAnswer, i: 0 | 1) => fix.fixes.reduce((n, f) => n + naming(x, f[i]), 0);
  const better = now > was || (now === was && was > 0 && was < 3 && named(b, 1) > named(a, 0)) || (now === 0 && was === 0 && fix.own);
  // The name as search shows it ("Hypnotic Robotics"), when its own correction already said the same.
  const said = a.didYouMean && normalize(a.didYouMean) === normalize(fix.q) ? a.didYouMean : fix.q;
  if (better) {
    const didYouMean = b.step === "did-you-mean" && b.didYouMean ? b.didYouMean : said;
    return carryOutcome(b, { ...b, q: a.q, step: b.step === "deterministic" ? "did-you-mean" : b.step, didYouMean });
  }
  if (fix.own && now === was && was === 2 && !a.didYouMean) return carryOutcome(a, { ...a, didYouMean: said });
  return a;
}
