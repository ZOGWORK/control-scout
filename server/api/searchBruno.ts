// Bruno AI in search (docs/search.md): step 3 of the fallback chain. Asked only when search's own answer is a guess or
// nothing (SearchAnswer.weak), and only by the app after that answer is on screen (GET /api/search/refine), so the
// first results never wait on him. He rewrites the QUERY (Control Point's POST /internal/bruno/search); search then
// runs again on his words, so every result and number shown is search's own. He never answers, and never supplies a
// result. Off (the brunoSearch switch, off from migration 64), unconfigured, failing or slow: no refinement, and the
// app keeps what it has.
import type { SearchAnswer } from "../../src/shared/api.js";
import { SEARCH_BROWSE } from "../../src/shared/search.js";
import { brunoAvailable, brunoSearchQuery } from "../auth/controlPoint.js";
import { isEnabled } from "../flags.js";
import { normalize } from "./fuzzy.js";
import { cleanQuery, searchAnswer, type AnswerOptions } from "./searchAnswer.js";

export const BRUNO_TIMEOUT_MS = 3000;
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Bruno's readings by normalized query (null: he found no search in it). Failures aren't kept: the next ask retries. */
const cache = new Map<string, { at: number; refined: string | null }>();
export const resetBrunoCache = () => cache.clear();

/** Bruno's rewrite of `q`, cached a day; undefined when he can't be asked (off, unconfigured, failed, timed out). */
export async function brunoReading(q: string, now = Date.now()): Promise<string | null | undefined> {
  if (!(await isEnabled("brunoSearch").catch(() => false)) || !brunoAvailable()) return undefined;
  const k = normalize(q);
  const hit = cache.get(k);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.refined;
  try {
    const { query } = await brunoSearchQuery(q, BRUNO_TIMEOUT_MS);
    const refined = typeof query === "string" && query.trim() ? cleanQuery(query) : null;
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(k, { at: now, refined });
    return refined;
  } catch (e) {
    console.warn("[search] Bruno unavailable:", (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message?.slice(0, 120));
    return undefined;
  }
}

/**
 * Step 3: Bruno's reading of `raw`, and search's answer on it. `null` when there's nothing to add: Bruno off or
 * unreachable, or his reading finds no more than search did (the app then keeps its own answer). When he read it
 * but search finds nothing on his words, the recovery state says so (his reading included).
 */
export async function refine(raw: string, opts: AnswerOptions = {}): Promise<SearchAnswer | null> {
  const q = cleanQuery(raw);
  if (!q) return null;
  const refined = await brunoReading(q);
  if (refined === undefined) return null;
  const base = await searchAnswer(q, { ...opts, learn: false });
  if (refined === null || normalize(refined) === normalize(q)) {
    return base.step === "recovery" ? { ...base, recovery: { ...base.recovery!, ai: { refined: null } } } : null;
  }
  const again = await searchAnswer(refined, opts);
  if (!again.hits.length) {
    return { ...base, step: "recovery", hits: [], recovery: { understood: base.recovery?.understood ?? [], closest: base.recovery?.closest ?? base.hits.slice(0, 5), ai: { refined }, browse: SEARCH_BROWSE } };
  }
  return { ...again, q, step: "ai", refined, weak: false, pages: base.pages };
}
