// The results search sent lately, by query: a result opened from search (POST /api/search/click) is checked against
// what /api/search really gave for its query, instead of running the whole search again for every click. A query
// asked too long ago (or never) isn't known here, and the click route runs the search as it always did.
import type { SearchHit, SearchIntentNote } from "../../src/shared/api.js";
import { normalize } from "./fuzzy.js";
import { cleanQuery } from "./searchAnswer.js";

/** Kept this long, for this many queries at most: a click comes seconds after its search. */
export const SERVED_TTL_MS = 10 * 60_000;
const SERVED_MAX = 2000;

interface Served { at: number; intent: SearchIntentNote | undefined; hits: Map<string, boolean> }
const served = new Map<string, Served>();
const keyOf = (q: string) => normalize(cleanQuery(q));
const hitKey = (kind: string, ref: string) => `${kind}\n${ref}`;

/** /api/search answered `q` with these hits (and this intent): added to what that query is known to have given
 *  (the header's short list and the results page ask the same query with different limits). */
export function noteServed(q: string, intent: SearchIntentNote | undefined, hits: readonly Pick<SearchHit, "kind" | "ref" | "href">[], now = Date.now()): void {
  const k = keyOf(q);
  if (!k) return;
  const was = served.get(k);
  const s: Served = was && now - was.at < SERVED_TTL_MS ? was : { at: now, intent, hits: new Map() };
  s.at = now;
  if (intent) s.intent = intent;
  for (const h of hits) s.hits.set(hitKey(h.kind, h.ref), !!h.href);
  served.delete(k);
  served.set(k, s);
  if (served.size > SERVED_MAX) served.delete(served.keys().next().value!);
}

/** What search sent for `q`: null when it isn't known here (the caller searches), else whether it gave this result
 *  (`hit`: its href flag, for results that open a feature) and the intent it read. */
export function servedHit(q: string, kind: string, ref: string, now = Date.now()): { intent: SearchIntentNote | undefined; hit: { kind: string; ref: string; href: boolean } | null } | null {
  const s = served.get(keyOf(q));
  if (!s || now - s.at >= SERVED_TTL_MS) return null;
  const href = s.hits.get(hitKey(kind, ref));
  return { intent: s.intent, hit: href === undefined ? null : { kind, ref, href } };
}

export const resetServed = () => served.clear();
