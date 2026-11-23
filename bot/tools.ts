// Bruno's lookups: the bot's own tools over Control Scout's data, run before a chat (bot/ask.ts). A Discord message
// often asks several things at once — "what is the best team rn, where are they from and what is their auto opr" — and
// search answers one question at a time, so the message is split into its parts, each part is searched, and every
// part's facts go to him with the message's own (server/api/searchBrunoAnswer.ts's answerFacts). A part that only leans
// on an earlier one ("where are they from", "…and who is by") is filled in with the team or record the earlier part
// named before it's searched, so it isn't a dead fragment. Data only: every line is search's, never a guess, and a part
// search can't answer adds nothing.
import type { SearchAnswer } from "../src/shared/api.js";

/** The parts of one message read at most: the first asks, the rest are its follow-ups ("and their auto opr"). */
export const MAX_PARTS = 3;
/** How many of the parts' fact lines a chat gets, and how much text: the message's own facts come first and its packet
 *  holds 40 lines (bot/ask.ts's CHAT_FACTS), so the parts must not crowd it out. Wide enough that each part's share
 *  takes its answer's own rows, after the lines every answer starts with (its title, its heading). */
export const LOOKUP_LINES = 18;
export const LOOKUP_CHARS = 2400;

/** Words that say nothing about the question ("what is like the best team rn" is "what is the best team"). Short on
 *  purpose: a word dropped here is one search no longer reads. */
const FILLER = /\b(?:like|rn|right\s+now|please|pls|plz|bro|tho|though|btw|tbh|actually|anyway)\b/gi;
/** The words a question (or an auxiliary) starts with: what makes the rest of a message a part of its own. */
const ASKS = "what|whats|which|who|whose|where|when|how|why|is|are|was|were|does|do|did|can|could|will|would|has|have";
/** A separator that starts another question. "4215 and 6980 opr" is one question (the words after "and" aren't one);
 *  "…, where are they from and what is their auto opr" is three. */
const SPLIT = new RegExp(`(?:\\s*[,;]\\s*(?:and\\s+|also\\s+|plus\\s+)?|\\s+(?:and|also|plus)\\s+)(?=(?:${ASKS})\\b)`, "i");
/** The words a part may have and still name nothing: "who is by", "where from". */
const FRAME_WORDS = new Set(["who", "whom", "whose", "what", "whats", "which", "where", "when", "how", "why", "is", "are", "was", "were", "by", "from", "it", "its", "they", "them", "their", "there", "that", "this", "s"]);
/** A part that says "they", "their" or "it": who it means is the part before it. */
const PRONOUN = /\b(?:they|them|their|theirs|it|its|he|him|his|she|her|hers)\b/i;
/** A question's own frame, dropped to leave what it asks about ("the bio buzz world record"). */
const LEAD = /^(?:what(?:'s|s| is| was| are)|which|who(?:'s|s| is| was)|whom|whose|where(?:'s|s| is| are)|when(?:'s| is| was)|how(?:'s| is| are| was)|why|is|are|was|were|does|do|did|can|could|will|would|has|have|of|for|about)\b\s*/i;

/** The question with its filler dropped and its edges tidied. */
export function plainAsk(q: string): string {
  return q.replace(FILLER, " ").replace(/\s+/g, " ").replace(/^[\s,;:?.!-]+|[\s,;:?.!-]+$/g, "");
}

/** The parts of a message that each ask something, in order, at most MAX_PARTS. A message that asks one thing is one
 *  part, whole: parts are only split where another question starts. */
export function splitAsk(q: string): string[] {
  const text = plainAsk(q);
  if (!text) return [];
  const parts = text.split(SPLIT).map(plainAsk).filter((p) => /\w/.test(p));
  return parts.length > 1 ? parts.slice(0, MAX_PARTS) : [text];
}

/** A part that names nothing by itself: every word is its frame ("who is by", "where from"). */
function frameOnly(part: string): boolean {
  const words = part.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  return words.length > 0 && words.every((w) => FRAME_WORDS.has(w.replace(/'s$/, "")));
}

/** Whether a part only leans on an earlier one: "where are they from" (a pronoun), "…and who is by" (no subject at
 *  all). Searched as typed it's a fragment search can find nothing for. */
export const needsSubject = (part: string): boolean => PRONOUN.test(part) || frameOnly(part);

/** The team an answer is about, when it's about one: its card's, its stat's, or the first team among its results. A
 *  board answers with its top team's name in the headline ("23268 Ultraviolet") or as its first row, and that team is
 *  what a follow-up like "where are they from" means. */
function answerTeam(a: SearchAnswer | null | undefined): number | null {
  const direct = a?.card?.team?.number ?? a?.stat?.team?.number ?? Number(a?.hits?.find((h) => h.kind === "team")?.ref);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const board = a?.stat?.blocks.find((b) => b.kind === "leaderboard");
  const said = a?.stat?.headline?.value ?? (board?.kind === "leaderboard" ? board.rows[0]?.team.label : undefined) ?? "";
  const n = /^(\d{1,6})\b/.exec(said)?.[1];
  return n ? Number(n) : null;
}

/** What an earlier part asks about, its question's frame dropped: "what is the bio buzz world record" is "bio buzz
 *  world record", so "…and who is by" becomes a question search can read. */
export function subjectPhrase(text: string): string {
  return text.replace(LEAD, "").replace(/^the\s+/i, "").replace(/\s+/g, " ").trim();
}

/**
 * The follow-up `parts[i]` as the question the site can answer. A pronoun is filled in with the team the earlier
 *  part's answer names — "where are they from" after a board whose #1 is 23268 asks "where are 23268 from" — or with
 *  the earlier part's words. A part with nothing but its own frame ("…and who is by") is asked as the thing it asks
 *  about: "bio buzz world record", the same question typed into controlscout.org/search, whose card names the
 *  alliance and so answers the "who". Nothing earlier to lean on (or nothing named): the part is left as it is.
 */
export function resolveAsk(parts: string[], i: number, answers: (SearchAnswer | null | undefined)[] = []): string {
  const part = parts[i];
  let j = i - 1;
  while (j >= 0 && needsSubject(parts[j])) j--;
  if (j < 0) return part;
  const team = answerTeam(answers[j]);
  const phrase = subjectPhrase(parts[j]);
  if (!PRONOUN.test(part)) return phrase || part;
  const said = team ? String(team) : phrase;
  return said ? part.replace(new RegExp(PRONOUN.source, "gi"), said) : part;
}

/** What a message's lookups found: the facts for the chat, and the site's own answer to the first part search could
 *  answer (its card, for the post beside Bruno's words). */
export interface Lookup { facts: string[]; answer?: SearchAnswer }

/**
 * The facts of a message's parts, each part searched on its own: the parts in the order asked, no line twice, and at
 * most LOOKUP_LINES lines and LOOKUP_CHARS characters. A part search can't answer contributes nothing. Parts that name
 * what they ask about are searched together; a follow-up waits for the earlier part's answer and asks its question
 * with that subject in it (resolveAsk).
 */
export async function lookupFacts(parts: string[], deps: {
  search: (q: string) => Promise<SearchAnswer | null>;
  facts: (a: SearchAnswer) => Promise<string[]>;
}): Promise<Lookup> {
  if (parts.length < 2) return { facts: [] };
  const answers: (SearchAnswer | null)[] = new Array(parts.length).fill(null);
  await Promise.all(parts.map(async (p, i) => {
    // A follow-up can't be searched until the part it leans on has answered: it's read below, in order.
    if (i > 0 && needsSubject(p)) return;
    answers[i] = await deps.search(p).catch(() => null);
  }));
  for (let i = 1; i < parts.length; i++) {
    if (!needsSubject(parts[i])) continue;
    answers[i] = await deps.search(resolveAsk(parts, i, answers)).catch(() => null);
  }
  const lines = await Promise.all(answers.map((a) => (a ? deps.facts(a).catch(() => [] as string[]) : [])));
  const out: string[] = [];
  const seen = new Set<string>();
  let size = 0;
  const take = (ls: string[], room: number) => {
    for (const f of ls) {
      if (room <= 0) return;
      if (!f || seen.has(f)) continue;
      // Bounded: a broad part's answer is 40 lines of its own, and the message's facts come first in the packet.
      if (out.length >= LOOKUP_LINES || size + f.length + 1 > LOOKUP_CHARS) return;
      seen.add(f);
      out.push(f);
      size += f.length + 1;
      room--;
    }
  };
  // Each part keeps a share first, so a board of 25 rows can't fill the packet before the follow-up's one line; what's
  // left is filled in the order asked.
  const share = Math.max(1, Math.ceil(LOOKUP_LINES / lines.length));
  for (const ls of lines) take(ls, share);
  for (const ls of lines) take(ls, Number.POSITIVE_INFINITY);
  const answer = answers.find((a): a is SearchAnswer => !!a && !!(a.card || a.stat || a.hits.length));
  return { facts: out, ...(answer ? { answer } : {}) };
}
