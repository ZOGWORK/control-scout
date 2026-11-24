// The results search sent lately, by query: a result opened from search (POST /api/search/click) is checked against
// what /api/search really gave for its query, instead of running the whole search again for every click. A query
// asked too long ago (or never) isn't known here, and the click route runs the search as it always did.
import type { SearchHit, SearchIntentNote } from "../../src/shared/api.js";
import { normalize } from "./fuzzy.js";
import { cleanQuery } from "./searchAnswer.js";

/** Kept this long, for this many queries at most: a click comes seconds after its search. */
export const SERVED_TTL_MS = 10 * 60_000;
const SERVED_MAX = 2000;

// Each result keeps the time it was last sent and the intent of the answer that sent it: a result search stopped
// giving leaves 10 minutes after it was last given (however often the query is asked), and two answers to the same
// words never mix their intents.
interface Sent { at: number; href: boolean; intent: SearchIntentNote | undefined }
interface Served { at: number; hits: Map<string, Sent> }
const served = new Map<string, Served>();
type Kind = SearchHit["kind"];
const keyOf = (q: string) => normalize(cleanQuery(q));
const hitKey = (kind: string, ref: string) => `${kind}
${ref}`;

/** /api/search (its plain answer) or /refine answered `q` with these hits and this intent: each hit known to have
 *  been given, until SERVED_TTL_MS after it last was (the header's short list and the results page ask the same
 *  query with different limits, and a weak answer's refined hits are clickable too). */
export function noteServed(q: string, intent: SearchIntentNote | undefined, hits: readonly Pick<SearchHit, "kind" | "ref" | "href">[], now = Date.now()): void {
  const k = keyOf(q);
  if (!k) return;
  const s: Served = served.get(k) ?? { at: now, hits: new Map() };
  s.at = now;
  for (const [h, x] of s.hits) if (now - x.at >= SERVED_TTL_MS) s.hits.delete(h);
  for (const h of hits) s.hits.set(hitKey(h.kind, h.ref), { at: now, href: !!h.href, intent });
  served.delete(k);
  served.set(k, s);
  if (served.size > SERVED_MAX) served.delete(served.keys().next().value!);
}

/** Whether search gave this result for `q` lately: null when it didn't (or long ago; the caller searches again),
 *  else its href flag (for results that open a feature) and the intent of the answer that gave it. */
export function servedHit(q: string, kind: string, ref: string, now = Date.now()): { intent: SearchIntentNote | undefined; hit: { kind: Kind; ref: string; href: boolean } } | null {
  const x = served.get(keyOf(q))?.hits.get(hitKey(kind, ref));
  if (!x || now - x.at >= SERVED_TTL_MS) return null;
  return { intent: x.intent, hit: { kind: kind as Kind, ref, href: x.href } };
}

export const resetServed = () => served.clear();
