// Bruno's lookups: the bot's own tools over Control Scout's data, run before a chat (bot/ask.ts). A Discord message
// often asks several things at once — "what is the best team rn, where are they from and what is their auto opr" — and
// search answers one question at a time, so the message is split into its parts, each part is searched, and every
// part's facts go to him with the message's own (server/api/searchBrunoAnswer.ts's answerFacts). Data only: every line
// is search's, never a guess, and a part search can't answer adds nothing.
import type { SearchAnswer } from "../src/shared/api.js";

/** The parts of one message read at most: the first asks, the rest are its follow-ups ("and their auto opr"). */
export const MAX_PARTS = 3;
/** How many of the parts' fact lines a chat gets, and how much text: the message's own facts come first and its packet
 *  holds 40 lines (bot/ask.ts's CHAT_FACTS), so the parts must not crowd it out. */
export const LOOKUP_LINES = 12;
export const LOOKUP_CHARS = 1800;

/** Words that say nothing about the question ("what is like the best team rn" is "what is the best team"). Short on
 *  purpose: a word dropped here is one search no longer reads. */
const FILLER = /\b(?:like|rn|right\s+now|please|pls|plz|bro|tho|though|btw|tbh|actually|anyway)\b/gi;
/** The words a question (or an auxiliary) starts with: what makes the rest of a message a part of its own. */
const ASKS = "what|whats|which|who|whose|where|when|how|why|is|are|was|were|does|do|did|can|could|will|would|has|have";
/** A separator that starts another question. "4215 and 6980 opr" is one question (the words after "and" aren't one);
 *  "…, where are they from and what is their auto opr" is three. */
const SPLIT = new RegExp(`(?:\\s*[,;]\\s*(?:and\\s+|also\\s+|plus\\s+)?|\\s+(?:and|also|plus)\\s+)(?=(?:${ASKS})\\b)`, "i");

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

/** The facts of a message's parts, each part searched on its own: the parts in the order asked, no line twice, and at
 *  most LOOKUP_LINES lines and LOOKUP_CHARS characters. A part search can't answer contributes nothing. */
export async function lookupFacts(parts: string[], deps: {
  search: (q: string) => Promise<SearchAnswer | null>;
  facts: (a: SearchAnswer) => Promise<string[]>;
}): Promise<string[]> {
  if (parts.length < 2) return [];
  const answers = await Promise.all(parts.map((p) => deps.search(p).catch(() => null)));
  const out: string[] = [];
  let size = 0;
  for (const a of answers) {
    if (!a) continue;
    for (const f of await deps.facts(a).catch(() => [] as string[])) {
      if (!f || out.includes(f)) continue;
      // Bounded: a broad part's answer is 40 lines of its own, and the message's facts come first in the packet.
      if (out.length >= LOOKUP_LINES || size + f.length + 1 > LOOKUP_CHARS) return out;
      out.push(f);
      size += f.length + 1;
    }
  }
  return out;
}
