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
import type { SearchAnswer, SearchHit } from "../../src/shared/api.js";
import { search } from "./search.js";
import { all, kvGet } from "../db.js";
import { teamPageSql } from "../../src/shared/teamPages.js";
import { registerCache } from "../caches.js";
import { SEASONS } from "../data/seasons.js";
import { REGION_NAMES } from "../../src/shared/regions.js";
import { SEARCH_FILLER, SEARCH_PAGES, SEARCH_TOPICS, pagesFor } from "../../src/shared/search.js";
import { CONVERSATIONAL, EVENT_WORDS, PLURALS, QUESTION_WORDS, STOPWORDS, TIME_WORDS } from "../../src/shared/searchQuery.js";
import { EVENT_NAME_WORDS, LEXICON } from "./query/lexicon.js";
import { allowedEdits, charSet, editDistance, normalize, setsApart, words } from "./fuzzy.js";
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
  "winners", "winning", "appearance", "appearances", "wins", "losses", "ties", "versus", "compare", "comparison", "stats", "statistics", "history", "timeline", "rating",
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
  /** Each of those words' characters (charSet), in the same order: worked out once, so a typed word is measured
   *  (editDistance) only against the words whose letters are near enough to be within its edits (setsApart). */
  setsByLength: Map<number, Int32Array>;
}

const phraseWords = (ps: Iterable<string>) => [...ps].flatMap((p) => words(p));

/** Search's own words, from its catalogs and lists (no database), each with its tier (Vocab.own). */
export function ownWords(): Map<string, 1 | 2> {
  const asked = [
    ...ASKED_WORDS, ...phraseWords(SEARCH_TOPICS.map(([p]) => p)), ...phraseWords(SEARCH_PAGES.flatMap((p) => p.words)),
    ...phraseWords(INTENTS.flatMap((i) => i.words)), ...AWARDS, ...Object.keys(PHASES), ...phraseWords(LEADER_STAT_WORDS),
    ...Object.keys(WEAK_SIGNALS), ...EVENT_WORDS, ...Object.keys(PLURALS), ...Object.values(PLURALS),
    ...phraseWords(SEASONS.map((s) => s.game)), ...phraseWords(REGION_NAMES),
  ];
  const plain = [
    ...PLAIN_WORDS, ...SEARCH_FILLER, ...phraseWords(PARAPHRASES.flat()), ...phraseWords(FILLER), ...phraseWords(SCAFFOLD),
    ...phraseWords(CONVERSATIONAL.map((c) => c.words)), ...phraseWords(TIME_WORDS), ...QUESTION_WORDS, ...STOPWORDS,
  ];
  const out = new Map<string, 1 | 2>();
  for (const w of plain.map(normalize).filter(Boolean)) out.set(w, 1);
  for (const w of asked.map(normalize).filter(Boolean)) out.set(w, 2);
  // Each of search's own nouns in both numbers ("rank", "ranks"): a typo of either is a typo of the same word.
  for (const [w, other] of numberPairs()) if (!out.has(other)) out.set(other, 2);
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
  const setsByLength = new Map([...byLength].map(([len, ws]) => [len, Int32Array.from(ws, (w) => charSet(w))]));
  return { keep, count, teamWords: [...team], own, byLength, setsByLength };
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
/** Builds the vocabulary ahead of the first search (server start). */
export const warmSpelling = async (): Promise<void> => { await vocab(); };

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
  // "worldes" is "worlds" mistyped, not a form of "world": "-es" only follows s, x, z, ch, sh or o.
  if (m[2] === "es" && keep.has(`${stem}s`) && !/(?:s|x|z|ch|sh|o)$/.test(stem)) return false;
  // "winning" → "win", "placed" → "place", "scouting" → "scout".
  return keep.has(stem) || keep.has(`${stem}e`) || (/(.)\1$/.test(stem) && keep.has(stem.slice(0, -1)));
}

/** The same letters, give or take one ("appreacne", "appearance"): the letters one has and the other doesn't, counted
 *  both ways, number at most one. */
function jumbled(a: string, b: string): boolean {
  const n = new Map<string, number>();
  for (const ch of a) n.set(ch, (n.get(ch) ?? 0) + 1);
  for (const ch of b) n.set(ch, (n.get(ch) ?? 0) - 1);
  let off = 0;
  for (const k of n.values()) off += Math.abs(k);
  return off <= 1;
}

/** The keys beside each letter on a QWERTY keyboard: a slip onto one is the likeliest typo ("evntd" for "events"). */
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const NEAR = new Map<string, Set<string>>();
for (let r = 0; r < ROWS.length; r++) for (let c = 0; c < ROWS[r].length; c++) {
  const near = new Set<string>();
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const ch = ROWS[r + dr]?.[c + dc]; if (ch && (dr || dc)) near.add(ch); }
  NEAR.set(ROWS[r][c], near);
}
/** Edits from `a` to `b` (a swap counts one), a slip onto a neighbouring key half of one: how far a typo is from one of
 *  search's own words, whose allowance is half an edit more than a name's. */
export function typoDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i ? (j ? 0 : i) : j)));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const sub = a[i - 1] === b[j - 1] ? 0 : NEAR.get(a[i - 1])?.has(b[j - 1]) ? 0.5 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

/** The nouns search asks about (its intent words: "award", "event", "rating"), each form to its other number ("awards"
 *  → "award", "award" → "awards"). Never a word naming an event or its kind by itself ("worlds" is the FIRST
 *  Championship, "states" a state championship): the lexicon reads those as events, not counts of a thing. */
let pairs: Map<string, string> | null = null;
function numberPairs(): Map<string, string> {
  if (pairs) return pairs;
  // Plain words around a question ("how", "year", "won") are never its nouns, whatever list also has them.
  const plain = new Set([...PLAIN_WORDS, ...QUESTION_WORDS, ...STOPWORDS, ...phraseWords(TIME_WORDS)].map(normalize));
  // A word the lexicon reads only as something else ("last", "upcoming": which one; "highest": a measure's end) is
  // never a noun; the lexicon's things, measures, awards and forecasts are, and so are the catalog's other words.
  const kinds = new Map<string, Set<string>>();
  for (const e of LEXICON) if (e.words.length === 1) for (const x of e.syms) (kinds.get(e.words[0]) ?? kinds.set(e.words[0], new Set()).get(e.words[0])!).add(x.k);
  const noun = (w: string) => !kinds.has(w) || ["thing", "metric", "award", "predict"].some((k) => kinds.get(w)!.has(k));
  const nouns = new Set([...ASKED_WORDS, ...phraseWords(INTENTS.flatMap((i) => i.words)), ...Object.keys(PLURALS), ...Object.values(PLURALS)].map(normalize).filter((w) => /^\p{L}{3,}$/u.test(w) && !plain.has(w) && noun(w)));
  // An event read by its kind's word alone ("worlds", "states") or a word of an event's name ("championship",
  // "league"), unless the lexicon reads it as events in general ("event", "tournament").
  const thing = new Set(LEXICON.filter((e) => e.words.length === 1 && e.syms.some((x) => x.k === "thing")).map((e) => e.words[0]));
  const named = new Set([...LEXICON.filter((e) => e.words.length === 1 && e.syms.some((x) => x.k === "worlds" || x.k === "states")).map((e) => e.words[0]),
    ...[...EVENT_NAME_WORDS].filter((w) => !thing.has(w))]);
  const many = (w: string) => (/(?:s|x|z|ch|sh)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
  pairs = new Map();
  for (const w of nouns) {
    if (/(?:ed|est|ly)$/.test(w) || (w.endsWith("s") && nouns.has(w.slice(0, -1)))) continue;
    const p = many(w);
    // A short word's plural only when search knows it ("opr", "oprs"; never "won", "wons").
    if (named.has(w) || named.has(p) || PLURALS[w] || (w.length < 4 && !nouns.has(p) && !kinds.has(p))) continue;
    pairs.set(w, p);
    pairs.set(p, w);
  }
  for (const [p, w] of Object.entries(PLURALS)) if (!named.has(w) && !named.has(p)) { pairs.set(p, w); pairs.set(w, p); }
  return pairs;
}

/** A query with each of search's own nouns in the other number: its plurals as singulars ("4215 upcoming events" →
 *  "4215 upcoming event"), else (`many`) its singulars as plurals ("4215 season" → "4215 seasons"); null when it has
 *  none. The same question, read again when the query as typed reads nothing (searchAnswer.ts), whose answer is kept
 *  unless this reading answers more: a team's name with the word in it ("Season Robotics") still reads as typed. */
export function numberQuery(q: string, many = false): string | null {
  const ps = numberPairs();
  let changed = false;
  const out = q.replace(/\p{L}+/gu, (w) => {
    const lower = w.toLowerCase(), other = ps.get(lower);
    // A plural is one ending in s its other form doesn't.
    if (!other || many === lower.endsWith("s") || other.endsWith("s") === lower.endsWith("s")) return w;
    changed = true;
    return other;
  });
  return changed ? out : null;
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
  const set = charSet(w);
  // A word allowed one edit reaches one of search's own words by half an edit more, a slip onto a neighbouring key
  // (typoDistance: "evntd" is "events").
  const reach = max === 1 ? 1.5 : max;
  for (let len = w.length - Math.ceil(reach); len <= w.length + Math.ceil(reach); len++) {
    const list = v.byLength.get(len) ?? [], sets = v.setsByLength.get(len);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const own = v.own.get(c) ?? 0, n = v.count.get(c) ?? 0;
      if (sets && setsApart(set, sets[i], own === 2 ? Math.ceil(reach) : max)) continue;
      if (c === w || pluralPair(c, w)) continue;
      const d = own === 2 ? typoDistance(w, c) : editDistance(w, c, max);
      if (d > (own === 2 ? reach : max)) continue;
      // A word the data has once or twice (an event's or a city's one-off spelling, "Oradel") is only corrected to a
      // word that is clearly the usual one: search's own, or one seen five times as often.
      if (seen && !own && n < Math.max(5, seen * 5)) continue;
      found.push({ word: c, d, own, slip: d === 1 && slip(w, c), n });
    }
  }
  // Else a long word typed with its letters jumbled ("appreacne" for "appearance"): one of search's own words with the
  // same first letter and the same letters, give or take one, in any order. Edits count each move, so they miss it.
  if (!found.length && w.length >= 7) {
    for (let len = w.length - 1; len <= w.length + 1; len++) {
      for (const c of v.byLength.get(len) ?? []) if (c[0] === w[0] && v.own.get(c) === 2 && !pluralPair(c, w) && jumbled(w, c)) found.push({ word: c, d: max, own: 2, slip: false, n: v.count.get(c) ?? 0 });
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
 *  ("hypnotc robotics", "12345 recrod"), or as strong with more results naming the corrected words than named the typed
 *  ones ("oradel": one event's typo, "Oradell": every team there), or nothing either way when the fix is search's own
 *  word (the corrected reading says what was asked). Else `a`, with the fix offered (`didYouMean` alone) when it is
 *  search's own word and both found near matches alike. An answer that reads the query directly is never second-guessed. */
export async function spelled(typed: string, a: SearchAnswer, run: (q: string) => Promise<SearchAnswer>): Promise<SearchAnswer> {
  const was = strength(a);
  if (was >= 4) return a;
  // A team number typed wrong ("42-5", "4z15"): the real team numbers one key away.
  if (was <= 1) { const n = await numberFix(typed); if (n) return carryOutcome(a, { ...n, q: a.q }); }
  // "What is the bet", "what is the best time": search ranks teams, so "… best team" is offered (and shown when the
  // query as typed found nothing that matches).
  const best = was <= 3 ? bestFix(typed) : null;
  if (best) {
    const b = await run(best);
    if (strength(b) >= 4) return was === 3 ? carryOutcome(a, { ...a, didYouMean: best }) : carryOutcome(b, { ...b, q: a.q, step: "did-you-mean", didYouMean: best });
  }
  // A query cut off mid-word: read without the word, offered as a correction.
  const cut = was <= 1 ? await cutOff(typed) : null;
  if (cut) {
    const b = await run(cut);
    if (strength(b) > was) return carryOutcome(b, { ...b, q: a.q, step: b.step === "deterministic" ? "did-you-mean" : b.step, didYouMean: b.step === "did-you-mean" && b.didYouMean ? b.didYouMean : cut });
  }
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

/** "What is the bet", "what is the best time": a "what is the best" question with "best" mistyped, or with a word
 *  after it that isn't a team ("time"). Search ranks teams, so the fix is "what is the best team", or null. A stat
 *  after it ("what is the best auto") is answered as typed before this is read. */
export function bestFix(typed: string): string | null {
  const m = /^((?:what|who|which)(?:'s|s| is| are) (?:the )?)(\p{L}+)(?: (\p{L}+))?$/iu.exec(typed.trim().replace(/\s+/g, " "));
  if (!m) return null;
  const b = m[2].toLowerCase(), w = m[3]?.toLowerCase();
  if (b !== "best" && !(b.length >= 3 && editDistance(b, "best", 1) <= 1)) return null;
  if ((b === "best" && !w) || (w && /^(?:teams?|robots?)$/.test(w))) return null;
  return `${m[1]}best team`;
}

/** A query cut off mid-word ("when was the first time enforcers whe"): its last word, of three letters or fewer, is no
 *  word search or the data knows. The query without it, or null. A trip question left without its trip ("when was the
 *  first time enforcers") is completed as the one asked about most, Worlds ("… went to worlds"). */
export async function cutOff(typed: string): Promise<string | null> {
  const m = /^(.*\S)\s+(\p{L}{1,3})$/u.exec(typed.trim());
  if (!m) return null;
  const w = m[2].toLowerCase(), v = await vocab();
  if (v.keep.has(w) || v.count.has(w) || v.own.has(w)) return null;
  const rest = m[1];
  return /^when (?:was|is) the (?:first|last|most recent) time \S/i.test(rest) && !/\b(?:worlds?|states?|championships?)\b/i.test(rest) ? `${rest} went to worlds` : rest;
}

/** A team number one key off: a digit alone, or 2 to 6 characters starting and ending with a digit, at most one of them not a digit
 *  ("42-5", "4z15"), or all digits and no team by that number ("42155"). A match code ("q12") is never one. */
const NUMBERISH = /^(?:\d|\d[\da-z_-]{0,4}\d)$/i;

/** "42-5" isn't a team, nor a name: the teams whose number is one edit away (a key changed, added or dropped; a
 *  non-digit only changed or dropped) that search lists, the most recently active first, then the most matches played,
 *  then teams with none yet. Null when the
 *  query isn't a number typed wrong, is a real team, or no team is that close. */
export async function numberFix(typed: string): Promise<SearchAnswer | null> {
  const t = typed.trim();
  if (!NUMBERISH.test(t)) return null;
  const odd = [...t].filter((c) => !/\d/.test(c)).length;
  if (odd > 1) return null;
  // A real team is no typo; a placeholder entry's number ("99999", the off-season demo team) has no page to show.
  const own = odd ? [] : await all<{ page: number }>(`SELECT ${teamPageSql("t.number", "t.name")} AS page FROM teams t WHERE t.number = ?`, [Number(t)]);
  if (own.some((r) => Number(r.page))) return null;
  const placeholder = own.length > 0;
  const near = new Set<string>();
  const add = (s: string) => { if (/^[1-9]\d{0,5}$/.test(s)) near.add(s); };
  for (let i = 0; i < t.length; i++) {
    add(t.slice(0, i) + t.slice(i + 1));
    for (let d = 0; d <= 9; d++) add(t.slice(0, i) + d + t.slice(i + 1));
  }
  if (!odd) for (let i = 0; i <= t.length; i++) for (let d = 0; d <= 9; d++) add(t.slice(0, i) + d + t.slice(i));
  near.delete(t);
  const nums = [...near].map(Number);
  // Every registered team that close (a new team has a page before its first match), ranked by its match history.
  const rows = nums.length ? await all<{ team: number }>(`SELECT t.number AS team, MAX(s.season) AS s, COALESCE(SUM(s.matches), 0) AS m FROM teams t LEFT JOIN team_season_stats s ON s.team = t.number AND s.matches > 0 WHERE t.number IN (${nums.map(() => "?").join(",")}) GROUP BY t.number ORDER BY s IS NULL, s DESC, m DESC, t.number LIMIT 6`, nums) : [];
  const listed = async (teams: number[]) => {
    const out: SearchHit[] = [];
    for (const n of teams) {
      if (out.length >= 3) break;
      const h = (await search(String(n), 5, new Set(), new Set(["team"]))).find((x) => x.kind === "team" && x.ref === String(n));
      if (h) out.push({ ...h, match: "fuzzy" });
    }
    return out;
  };
  let hits = await listed(rows.map((r) => Number(r.team)));
  // No team one key away that search lists ("676767"): the nearest numbers of teams that have played, on each side, so
  // a number is never answered with an empty page.
  if (!hits.length && !odd) {
    const n = Number(t);
    const side = (op: string, dir: string) => all<{ team: number }>(`SELECT t.number AS team FROM teams t WHERE t.number ${op} ? AND ${teamPageSql("t.number", "t.name")} AND EXISTS (SELECT 1 FROM team_season_stats s WHERE s.team = t.number AND s.matches > 0) ORDER BY t.number ${dir} LIMIT 3`, [n]);
    const [below, above] = await Promise.all([side("<", "DESC"), side(">", "ASC")]);
    hits = await listed([...below, ...above].map((r) => Number(r.team)).sort((a, b) => Math.abs(a - n) - Math.abs(b - n) || a - b));
  }
  if (!hits.length) return null;
  const label = `${placeholder ? `No team page for ${t} (a placeholder entry)` : `No team ${t}`}: the closest team number${hits.length > 1 ? "s" : ""}`;
  return { q: t, hits, pages: pagesFor(t), step: "did-you-mean", didYouMean: hits[0].ref, weak: true, understood: { kind: "names", label } };
}
