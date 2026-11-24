// What a query is when it isn't about FTC data (docs/search-pipeline.md, "Chat and off-topic"): a question to the site
// itself ("who made you"), a question about an earlier answer ("was that the same in all the matches you said"), a
// question about getting something ("where do i get a <part>"), or a reaction ("lol"). Read only when search found
// nothing in the query (server/api/searchAnswer.ts), so a query search answers is never read here. Every word comes
// from the lexicon (CHAT_WORDS); none of it names a team, an event or a query.
import { CHAT_WORDS, INFORMAL, LEXICON } from "./lexicon.js";
import { everydayWord } from "../../../src/shared/query/everyday.js";
import { readTime } from "./time.js";

export type ChatKind = "follow-up" | "meta" | "off-topic" | "reaction";

/** Symbols that say nothing about FTC data: a query with only these (and unread words) asks nothing search holds. */
const NOT_DATA = new Set(["filler", "prep", "future"]);
const DATA_PHRASES = LEXICON.filter((e) => e.syms.some((s) => !NOT_DATA.has(s.k))).map((e) => e.words);
const SHORT_FORMS = INFORMAL.map(([from, to]) => [from.split(" "), to.split(" ")] as const);
const phrases = (ps: string[]) => ps.map((p) => p.split(" "));

/** The query's words, lower case, informal short forms said in full ("u" → "you"). */
export function chatWords(q: string): string[] {
  const ws = q.toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < ws.length;) {
    const short = SHORT_FORMS.find(([from]) => from.every((w, k) => ws[i + k] === w));
    if (short) { out.push(...short[1]); i += short[0].length; } else out.push(ws[i++]);
  }
  return out;
}

/** Lexicon words that join or frame what a question asks about ("and", "or", "vs", "if", "named") or rank it ("best",
 *  "top"): said about pizza as readily as about teams, so none of them makes a question an FTC one. */
const FRAMING = new Set([...NOT_DATA, "agg", "and", "compare", "vs", "together", "list", "hypo", "named"]);
/** What a question asks about: every lexicon phrase that reads as FTC data, not framing. */
const SUBJECT_PHRASES = LEXICON.filter((e) => e.syms.some((s) => !FRAMING.has(s.k))).map((e) => e.words);
/** The words search's data phrases are made of: one that is a data phrase alone ("match", "award"), or one only data
 *  phrases use ("championship", from "world championship"); never one framing or plain phrases use ("best", "the"). */
const FRAME_WORDS = new Set(LEXICON.filter((e) => e.syms.every((s) => FRAMING.has(s.k))).flatMap((e) => e.words));
const ALONE = new Set(SUBJECT_PHRASES.filter((p) => p.length === 1).map((p) => p[0]));
const DATA_WORDS = new Set(SUBJECT_PHRASES.flat().filter((w) => ALONE.has(w) || !FRAME_WORDS.has(w)));
/** Data words English uses far more often than FTC questions do: said beside an everyday subject ("weather forecast",
 *  "pizza place"), they are that subject's. */
const SHARED_WORDS = new Set(["forecast", "forecasts", "place", "places"]);
/** Every word search reads something in: its lexicon's and its chat words'. */
const SEARCH_WORDS = new Set([...LEXICON.flatMap((e) => e.words).flatMap((p) => p.split(" ")), ...Object.values(CHAT_WORDS).flat().flatMap((p) => p.split(" "))]);
/** Whether search reads `w`, or the word it is the plain plural of ("drivers" as "driver"), as everydayWord reads one. */
const searchWord = (w: string) => SEARCH_WORDS.has(w) || (w.length > 4 && w.endsWith("s") && SEARCH_WORDS.has(w.slice(0, -1)));
/** Words that start a place said last ("in new york", "near boston"): what follows may be a town no word list holds. */
const PLACE_PREPS = new Set(["in", "near", "around"]);

/** Where each phrase of `ps` starts in `ws`. */
const at = (ws: string[], ps: string[][]) => ws.flatMap((_, i) => ps.filter((p) => p.every((w, k) => ws[i + k] === w)).map((p) => ({ i, end: i + p.length })));
const has = (ws: string[], ps: string[][]) => at(ws, ps).length > 0;

/** Whether any word asks about FTC data: a number, or a lexicon phrase that reads as a metric, a thing, a scope… */
export function asksData(ws: string[]): boolean {
  return ws.some((w) => /\d/.test(w)) || has(ws, DATA_PHRASES);
}

const SAYER = phrases(CHAT_WORDS.sayer), SAID = phrases(CHAT_WORDS.said), THERE = new Set(CHAT_WORDS.there);
const EARLIER = new Set(CHAT_WORDS.earlier), ANSWER = new Set(CHAT_WORDS.answerWord);

/** A query pointing back at an earlier answer: "you said", "u just told me", "the matches listed here", "your last
 *  answer". Its words may name data ("the same auto points"): that data is the earlier answer's. */
export function pointsBack(ws: string[]): boolean {
  // Who said it, then saying (one word may sit between: "you just said").
  for (const s of at(ws, SAYER)) {
    for (const d of at(ws, SAID)) if (d.i === s.end || d.i === s.end + 1) return true;
  }
  // Saying, then where it was said: "said here", "listed above".
  for (const d of at(ws, SAID)) if (THERE.has(ws[d.end])) return true;
  // The earlier answer named: "your last answer", "the previous search".
  return ws.some((w, i) => EARLIER.has(w) && ANSWER.has(ws[i + 1]));
}

const ADDRESSEE = phrases(CHAT_WORDS.addressee), REACTION = phrases(CHAT_WORDS.reaction), QUESTION = new Set(CHAT_WORDS.question);
const ACQUIRE = new Set(CHAT_WORDS.acquire), ASKER = new Set(CHAT_WORDS.asker), MODAL = new Set(CHAT_WORDS.modal);

/** "Where do i get", "where can we buy", "where to order": a question about getting hold of something. */
function asksWhereToGet(ws: string[]): boolean {
  return ws.some((w, i) => {
    if (w !== "where") return false;
    const [a, b, c] = ws.slice(i + 1, i + 4);
    return (a === "to" && ACQUIRE.has(b)) || (MODAL.has(a) && ASKER.has(b) && ACQUIRE.has(c));
  });
}

/** The words of `q` that name what it is about when that's something search holds nothing on: everyday English
 *  ("weather", "pizza") that is none of search's own words, its time said aside ("today") and its place last ("in new
 *  york"). Empty when it asks about FTC data (a number, or anything search reads as data rather than framing), or when
 *  a word before the place is unread ("zqx stuff in <town>"): what that word is isn't known, so neither is the question. */
export function otherSubject(q: string): string[] {
  const ws = chatWords(readTime(q.toLowerCase(), new Date().toISOString().slice(0, 10)).rest);
  if (ws.some((w) => /\d/.test(w))) return [];
  // The place starts at its first word ("in boston in summer"): all from there on is where and when.
  const place = ws.findIndex((w) => PLACE_PREPS.has(w));
  const head = place > 0 ? ws.slice(0, place) : ws;
  if (head.some((w) => !everydayWord(w) && !searchWord(w))) return [];
  const subject = head.filter((w) => !searchWord(w));
  // Any word of search's data ("match", "award", "opr", "local championship") makes it an FTC question, but the few
  // English shares far more widely ("weather forecast", "pizza place").
  if (head.some((w) => DATA_WORDS.has(w) && !SHARED_WORDS.has(w))) return [];
  return subject;
}

/** Whether `q` asks where to get something ("where do i get a <part>"). */
export const asksToGet = (q: string): boolean => asksWhereToGet(chatWords(q));

/** What `q` is, when it isn't a search of FTC data; null when it may be one. */
export function chatKind(q: string): ChatKind | null {
  const ws = chatWords(q);
  if (!ws.length) return null;
  if (pointsBack(ws)) return "follow-up";
  // Nothing in it reads as FTC data: getting something, the site addressed, or a reaction.
  if (!asksData(ws)) {
    if (asksWhereToGet(ws)) return "off-topic";
    // Addressed to the site ("who made you", "tell me about bruno"). With thanks or laughter in it, only when it asks a
    // question ("thanks bruno, who made you?"): "thank you", "thanks a lot bruno" is a reaction, whatever words it adds.
    const addressed = has(ws, ADDRESSEE), reacted = has(ws, REACTION);
    const asked = /\?\s*$/.test(q) || ws.some((w) => QUESTION.has(w));
    if (addressed && (!reacted || asked)) return "meta";
    if (reacted) return "reaction";
  }
  // About something search holds nothing on ("what is the weather in <city> today", "best pizza in <place>"): its
  // place, its time and a ranking said with it are no FTC question. A reaction or words to the site said beside data
  // ("lol that match was funny") is neither: it stays what it was before this card.
  if (has(ws, REACTION) || has(ws, ADDRESSEE)) return null;
  if (otherSubject(q).length) return "off-topic";
  return null;
}
