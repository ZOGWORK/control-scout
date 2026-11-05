// The parser's view of the stored data (./parse.ts ParseContext): names from ./names.ts, events through search's own
// index (server/api/search.ts). One per query. A misspelled name is left to search's spelling layer
// (server/api/spelling.ts), which reads the query again corrected and says "Did you mean".
import { search } from "../search.js";
import { searchToday } from "../searchEvents.js";
import { eventFit } from "../answers/index.js";
import { EVENT_NAME_WORDS } from "./lexicon.js";
import { names } from "./names.js";
import type { ParseContext } from "./parse.js";

const EVENT = new Set(["event"] as const);

/** How well words must name an event to be read as one. */
export const EVENT_FIT = 0.75;

export async function parseContext(now = Date.now(), prefer: ReadonlySet<string> = new Set()): Promise<ParseContext> {
  const idx = await names();
  return {
    names: idx,
    today: searchToday(now),
    prefer,
    async isEvent(words) {
      if (words.length < 3) return false;
      const ws = words.split(" ");
      const hits = await search(words, 5, new Set(), EVENT);
      // One plain word names an event only as its code ("usnjcmp"): a word inside an event's name ("Alphatronic" in
      // "DecodeRA: Alphatronic Version") is a team's or a place's first.
      if (ws.length === 1 && !EVENT_NAME_WORDS.has(ws[0])) return hits.some((h) => h.kind === "event" && h.ref.split(":")[1]?.toLowerCase() === words);
      return hits.some((h) => h.kind === "event" && eventFit(words, h.title, h.ref.split(":")[1] ?? "") >= EVENT_FIT);
    },
  };
}
