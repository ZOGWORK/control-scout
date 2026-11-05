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
const KINDS = /^(?:meets?|tournaments?|events?|competitions?)$/;
const EVENT_KIND_PHRASE = /^(?:league meets?|league tournaments|qualifiers|scrimmages?)$/;

/** How well words must name an event to be read as one. */
export const EVENT_FIT = 0.75;

/** Each run of words already asked about, by the names index it was read with (rebuilt with the search index), so a
 *  team's name typed again isn't searched for as an event again. Bounded: the oldest go first. */
const known = new WeakMap<object, Map<string, Promise<boolean>>>();
const KNOWN_MAX = 5000;

export async function parseContext(now = Date.now(), prefer: ReadonlySet<string> = new Set()): Promise<ParseContext> {
  const idx = await names();
  const seen = known.get(idx) ?? known.set(idx, new Map()).get(idx)!;
  return {
    names: idx,
    today: searchToday(now),
    prefer,
    nearTeam: async (words) => idx.nearTeam(words),
    isEvent(words) {
      const hit = seen.get(words);
      if (hit) return hit;
      if (seen.size >= KNOWN_MAX) seen.delete(seen.keys().next().value!);
      const p = isEvent(words);
      seen.set(words, p);
      p.catch(() => seen.delete(words));
      return p;
    },
  };

  async function isEvent(words: string): Promise<boolean> {
    if (words.length < 3) return false;
    const ws = words.split(" ");
    // No word starts the way any event's words do: no event search.
    if (!ws.some((w) => w.length >= 3 && idx.eventStem(w))) return false;
    const hits = await search(words, 5, new Set(), EVENT);
    // One plain word names an event only as its code ("usnjcmp"): a word inside an event's name ("Alphatronic" in
    // "DecodeRA: Alphatronic Version") is a team's or a place's first.
    // Event words alone ("league", "league meets") are a kind of event, read by the answers' own event kinds
    // (server/api/answers/index.ts EVENT_KINDS), never one event by name.
    if (ws.every((w) => EVENT_NAME_WORDS.has(w) || KINDS.test(w))) return ws.length > 1 && EVENT_KIND_PHRASE.test(words);
    if (ws.length === 1) return hits.some((h) => h.kind === "event" && h.ref.split(":")[1]?.toLowerCase() === words);
    return hits.some((h) => h.kind === "event" && eventFit(words, h.title, h.ref.split(":")[1] ?? "") >= EVENT_FIT);
  }
}
