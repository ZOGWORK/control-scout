// How search reads the words of a query before it matches any name (docs/search.md, "Reading the query"). Fixed
// rules, no model: the server's search (server/api/search.ts, server/api/searchAnswer.ts) and the app's offline
// search read a query the same way, so "meets in New Jersey" and "meet in New Jersey" are one query everywhere.
//
// In order:
//   1. Plurals: the words in PLURALS become their singular ("meets" → "meet"). The name index matches each word as
//      a prefix ("meet"* finds "meet" and "meets"), but a plural prefix can never find the singular ("meets"* misses
//      "meet"), so the singular is the only spelling that finds both.
//   2. A conversational opening (CONVERSATIONAL: "how good is", "where is", …) is the question's frame, not part
//      of a name: "how good is simply complex" searches "simply complex". Only the opening goes, never the same word
//      later ("how good is good enough" searches "good enough"), and a word with no opening ("good teams") stays.
//   3. Names are matched without the stopwords (STOPWORDS: "in", "at", "the", …), the time words (TIME_WORDS:
//      "upcoming", "this weekend", …) and a question's own words (QUESTION_WORDS: "can", "will", …) when the query
//      is a question. Those words say what kind of answer is wanted, never which team or event.
import { REGION_PHRASES, isRegionCode } from "./regions.js";
import { SEARCH_TOPICS, type SearchTopic } from "./search.js";

/** The plurals read as their singular (lower case). Every pair has its own test (server/api/search.test.ts). */
export const PLURALS: Record<string, string> = {
  meets: "meet", events: "event", matches: "match", teams: "team", tournaments: "tournament",
  championships: "championship", qualifiers: "qualifier", scrimmages: "scrimmage", leagues: "league",
  divisions: "division", competitions: "competition", premiers: "premier", kickoffs: "kickoff",
};

/** "Meets in New Jersey" → "meet in New Jersey": each plural word in PLURALS as its singular, every other word as typed. */
export function singularize(q: string): string {
  return q.replace(/\p{L}+/gu, (w) => (Object.hasOwn(PLURALS, w.toLowerCase()) ? PLURALS[w.toLowerCase()] : w));
}

/** Words that never name a team or event when other words do (Requirement 1.1 of the FTC One Search brief). */
export const STOPWORDS = new Set(["in", "at", "on", "the", "a", "an", "for", "of", "this"]);

/** Common words that never name a team by themselves: a stat question's leftovers ("without" in "highest score
 *  without penalties", "team", "best") resolve no team when only these are left, however many team names hold
 *  them ("T.W.C.A. (Team Without a Cool Acronym)", "We are the best"). Beside a word of a name's own ("cool
 *  acronym", "hypnotic robotics") they still help it match. */
export const COMMON_WORDS = new Set([
  ...STOPWORDS, "and", "or", "not", "no", "with", "without", "to", "from", "by", "is", "are", "was", "were", "be", "it",
  "what", "who", "which", "how", "my", "our", "their", "all", "any", "every", "ever", "very", "so",
  "team", "robot", "robotic", "robotics", "ftc", "first", "tech", "challenge", "club",
  "best", "top", "highest", "lowest", "most", "least", "high", "low", "good", "great", "big", "new", "old",
  "score", "scores", "points", "point", "match", "game", "penalty", "penalties",
]);

/** Whether every word of `q` is a common word (COMMON_WORDS): nothing in it names a team. */
export const onlyCommonWords = (q: string): boolean => {
  const ws = singularize(q.toLowerCase()).split(/[^\p{L}\d]+/u).filter(Boolean);
  return ws.length > 0 && ws.every((w) => COMMON_WORDS.has(w));
};

/** What a question asks about, never who: "nj states alliances", "most inspire awards" leave "alliances" and "most
 *  inspire" once the question is read, and a team only loosely named so ("Alliance", "Inspires") isn't the one asked
 *  about. A stat question's leftovers made only of these and COMMON_WORDS resolve to a team only when its whole name
 *  is typed (onlyTopicWords). Plain search is unchanged: "inspire" still lists teams with Inspire in their names. */
export const TOPIC_WORDS = new Set([
  "alliance", "alliances", "award", "awards", "inspire", "event", "events", "world", "worlds", "state", "states", "championship",
  "championships", "playoff", "playoffs", "final", "finals", "winner", "winners", "rank", "ranking", "rankings", "record", "records",
  "opr", "rating", "ratings", "stat", "stats", "result", "results", "division", "divisions", "matches", "games", "qualifier",
  "qualifiers", "league", "leagues", "meet", "meets", "season", "seasons", "partner", "partners", "auto", "teleop", "endgame",
]);

/** Whether every word of `q` is a topic or common word (TOPIC_WORDS, COMMON_WORDS): it names no team unless typed whole. */
export const onlyTopicWords = (q: string): boolean => {
  const ws = q.toLowerCase().split(/[^\p{L}\d]+/u).filter(Boolean);
  return ws.length > 0 && ws.every((w) => TOPIC_WORDS.has(w) || COMMON_WORDS.has(w) || COMMON_WORDS.has(singularize(w)));
};

/** Words about when, never what: "upcoming meets in New Jersey" is New Jersey's meets from today on. "past",
 *  "recent", "previous" and "latest" are time words only beside an event word ("past meets"), so a name with one
 *  stays a name. Phrases are matched as whole words; longer ones first. */
// "Live", "right now", "happening now" with an event word are today's events (events run a day or two: today is the
// one under way). Longest first, so "live now" is one phrase.
export const TIME_WORDS = ["today", "tomorrow", "yesterday", "this weekend", "next weekend", "this week", "next week", "this month", "next month", "upcoming", "coming up", "past", "recent", "previous", "latest", "finished", "completed", "ended", "happened",
  "happening now", "going on now", "on right now", "right now", "live now", "live", "currently", "now"];
const ALWAYS_TIME = new Set(["today", "tomorrow", "yesterday", "this weekend", "next weekend", "this week", "next week", "this month", "next month", "upcoming", "coming up"]);

/** The words that say a query asks for events ("meets in New Jersey"), singular (after singularize). */
export const EVENT_WORDS = new Set(["meet", "event", "tournament", "championship", "qualifier", "scrimmage", "league", "competition", "premier", "kickoff", "comp", "champ", "champs"]);

/** A question's own words: dropped from name matching when the query reads as a question (starts with one and has
 *  at least three words, or ended in "?"), so "can robots descore samples" never searches for teams named "Can". */
export const QUESTION_WORDS = new Set(["can", "could", "will", "would", "should", "may", "might", "must", "why", "how", "what", "whats", "which", "who", "whom", "whose", "when", "where", "is", "are", "was", "were", "do", "does", "did", "has", "have", "had"]);

/** The conversational openings read as the question's frame (lower case, whole words, longest first). `topic`: what
 *  the opening asks about the team ("how good is X" asks for its season: OPR, rank and record). */
export const CONVERSATIONAL: { words: string; topic?: SearchTopic }[] = ([
  { words: "how good is", topic: "stats" }, { words: "how good are", topic: "stats" }, { words: "how good was", topic: "stats" },
  { words: "how strong is", topic: "stats" }, { words: "how strong are", topic: "stats" },
  { words: "how well is", topic: "stats" }, { words: "how well are", topic: "stats" },
  { words: "how is", topic: "stats" }, { words: "how are", topic: "stats" },
  { words: "what is the rank of", topic: "rankings" }, { words: "what's the rank of", topic: "rankings" }, { words: "whats the rank of", topic: "rankings" },
  { words: "what is the ranking of", topic: "rankings" }, { words: "what's the ranking of", topic: "rankings" },
  { words: "what is the record of", topic: "record" }, { words: "what's the record of", topic: "record" },
  { words: "where is" }, { words: "where are" }, { words: "where's" },
  { words: "tell me about" }, { words: "show me" }, { words: "what about" }, { words: "info on" }, { words: "info about" },
  { words: "information on" }, { words: "information about" }, { words: "look up" }, { words: "search for" }, { words: "find me" },
] as { words: string; topic?: SearchTopic }[]).sort((a, b) => b.words.split(" ").length - a.words.split(" ").length);

/** "how good is simply complex" → { rest: "simply complex", opening: "how good is", topic: "stats" }; null when the
 *  query has no opening, or nothing would be left after it. A trailing "?" or "doing" ("how is 4215 doing") goes too. */
export function stripConversation(q: string): { rest: string; opening: string; topic?: SearchTopic } | null {
  const t = q.trim().replace(/\s+/g, " ");
  const lower = t.toLowerCase();
  for (const c of CONVERSATIONAL) {
    if (!(lower === c.words || lower.startsWith(`${c.words} `))) continue;
    const rest = t.slice(c.words.length).replace(/[?!.]+$/, "").replace(/\s+doing$/i, "").trim();
    return rest ? { rest, opening: c.words, ...(c.topic ? { topic: c.topic } : {}) } : null;
  }
  return null;
}

/** The query search answers for a conversational one ("how good is simply complex" → "simply complex stats": what
 *  follows the opening, with what the opening asks about as its topic words), or the query itself. One rewrite for
 *  the answer, the click it teaches (learnQuery) and offline search. */
export function conversationQuery(q: string): string {
  const conv = stripConversation(q);
  if (!conv) return q;
  const topicWords = conv.topic ? SEARCH_TOPICS.find(([, t]) => t === conv.topic)?.[0] : undefined;
  return topicWords ? `${conv.rest} ${topicWords}` : conv.rest;
}

/** Whether the query reads as a question: it ended in "?" or starts with a question word and has three words or more. */
export function isQuestionForm(q: string): boolean {
  const t = q.trim();
  if (/\?\s*$/.test(t)) return true;
  const ws = t.toLowerCase().split(/\s+/).filter(Boolean);
  return ws.length >= 3 && QUESTION_WORDS.has(ws[0]);
}

/** The time phrase in a query, and the query without it ("upcoming meets in NJ" → "upcoming", "meets in NJ"). */
export function timePhrase(q: string): { phrase: string; rest: string } | null {
  const lower = ` ${q.toLowerCase().replace(/\s+/g, " ").trim()} `;
  // "states" (a state's championship: "past NJ states") counts as typed; singular, "state" is a place word.
  const hasEventWord = singularize(q).toLowerCase().split(/[^\p{L}]+/u).some((w) => EVENT_WORDS.has(w)) || /(?:^|\s)states(?=\s|$)/i.test(q);
  for (const p of TIME_WORDS) {
    if (!ALWAYS_TIME.has(p) && !hasEventWord) continue;
    if (!lower.includes(` ${p} `)) continue;
    return { phrase: p, rest: restOf(q, p) };
  }
  return null;
}

/** `q` with the whole-word phrase `p` taken out once, every other word as typed. */
function restOf(q: string, p: string): string {
  const ws = q.trim().split(/\s+/), pw = p.split(" ");
  for (let i = 0; i + pw.length <= ws.length; i++) {
    if (pw.every((w, k) => ws[i + k].toLowerCase() === w)) return [...ws.slice(0, i), ...ws.slice(i + pw.length)].join(" ");
  }
  return q.trim();
}

/** Indexes of `ws` inside a region name with a little word in it ("district of columbia"). */
function placeWords(ws: string[]): Set<number> {
  const lower = ws.map((w) => w.toLowerCase()), kept = new Set<number>();
  for (const p of REGION_PHRASES) {
    const pw = p.split(" ");
    if (!pw.some((w) => STOPWORDS.has(w))) continue;
    for (let i = 0; i + pw.length <= lower.length; i++) {
      if (pw.every((w, k) => lower[i + k] === w)) pw.forEach((_, k) => kept.add(i + k));
    }
  }
  return kept;
}

/**
 * The words of `q` that can name a team or event, as one string: plurals singular, stopwords, time words and (in a
 * question) question words out. When taking them out would leave nothing ("the", "upcoming"), the query as typed
 * (plurals singular) is kept, so a name made only of such words still searches. A conversational opening goes first
 * ("show me 4215" → "4215"). `asked`: the query as typed ended in "?" (which search's cleaning takes off).
 */
export function nameWords(q: string, asked = false): string {
  const one = singularize((stripConversation(q)?.rest ?? q).trim().replace(/\s+/g, " "));
  if (!one) return one;
  let rest = one;
  // Every time phrase goes ("upcoming qualifiers this weekend"): each pass takes one out, so this ends.
  for (let time = timePhrase(rest); time; time = timePhrase(rest)) rest = time.rest;
  const question = asked || isQuestionForm(q);
  const all = rest.split(" ").filter(Boolean);
  const place = placeWords(all);
  const ws = all.filter((w, i) => {
    const l = w.toLowerCase();
    // A place's own words stay: "IN" and "ON" typed as codes (Indiana, Ontario), "of" in "District of Columbia".
    if (place.has(i) || isRegionCode(w)) return true;
    return !STOPWORDS.has(l) && !(question && QUESTION_WORDS.has(l));
  });
  return ws.length ? ws.join(" ") : one;
}
