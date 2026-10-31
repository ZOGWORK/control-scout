// Search's learning (docs/search.md): which results people open for which queries, as aggregate click counts per
// season, on this server only (the search_clicks table; nothing is sent anywhere). With the data one VM gets, click
// weights are the model: no neural network, no outside service.
//
// The rules it can't break:
//   - It only re-orders results the deterministic search already found; it never adds a team, event, number or link.
//   - Cold start (no clicks) and the searchLearning switch off both give exactly the deterministic order.
//   - Smoothed: a result needs MIN_CLICKS before it can move at all, so one misclick never flips a top result.
//   - An exact match for what was typed keeps the top place (a new team searched by name is never buried).
//   - Per season: last season's clicks count a quarter, older ones not at all, so a new season's choices take over.
//   - Aggregate only: counts by query and word, never by account, device or IP; nothing a person searched is shown to anyone.
import type { SearchHit } from "../../src/shared/api.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { all, run } from "../db.js";
import { isEnabled } from "../flags.js";
import { normalize, words } from "./fuzzy.js";

export const MIN_CLICKS = 3;
export const LAST_SEASON_WEIGHT = 0.25;
/** A word's clicks count this much against the whole query's (a word is weaker evidence). */
const WORD_WEIGHT = 0.3;
/** No one result's count grows past this (a flood of clicks can't make it unmovable). */
const MAX_CLICKS = 500;

const queryTerm = (q: string) => `q:${normalize(q)}`;
const wordTerms = (q: string) => [...new Set(words(q).filter((w) => w.length >= 2))].slice(0, 8).map((w) => `w:${w}`);
const k = (kind: string, ref: string) => `${kind}:${ref}`;

/** Count one opened result for a query: the query's term and each of its words, this season. */
export async function recordClick(q: string, hit: Pick<SearchHit, "kind" | "ref">, season = CURRENT_SEASON): Promise<void> {
  for (const term of [queryTerm(q), ...wordTerms(q)]) {
    await run(`INSERT INTO search_clicks (season, term, kind, ref, clicks) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (season, term, kind, ref) DO UPDATE SET clicks = MIN(clicks + 1, ${MAX_CLICKS})`, [season, term, hit.kind, hit.ref]);
  }
}

/** Each result's learned weight for `q`: this season's clicks plus a quarter of last season's, the query's own
 *  counting fully and its words' less. */
export async function weights(q: string, season = CURRENT_SEASON): Promise<Map<string, number>> {
  const qt = queryTerm(q), wts = wordTerms(q);
  const terms = [qt, ...wts];
  const rows = await all<{ season: number; term: string; kind: string; ref: string; clicks: number }>(
    `SELECT season, term, kind, ref, clicks FROM search_clicks WHERE season IN (?, ?) AND term IN (${terms.map(() => "?").join(",")})`,
    [season, season - 1, ...terms]);
  const out = new Map<string, number>();
  for (const r of rows) {
    const w = (r.season === season ? 1 : LAST_SEASON_WEIGHT) * (r.term === qt ? 1 : WORD_WEIGHT / Math.max(1, wts.length));
    out.set(k(r.kind, r.ref), (out.get(k(r.kind, r.ref)) ?? 0) + Number(r.clicks) * w);
  }
  return out;
}

/** `hits` re-ordered by learned weight (stable: equal weights keep the deterministic order). `pinTop`: the first
 *  result is an exact match and stays first. Off, cold, or under MIN_CLICKS everywhere: `hits` unchanged. */
export async function rerank(q: string, hits: SearchHit[], opts: { pinTop?: boolean; season?: number } = {}): Promise<SearchHit[]> {
  if (hits.length < 2 || !(await isEnabled("searchLearning").catch(() => false))) return hits;
  const w = await weights(q, opts.season).catch(() => new Map<string, number>());
  const score = (h: SearchHit) => { const x = w.get(k(h.kind, h.ref)) ?? 0; return x >= MIN_CLICKS ? Math.log2(x) : 0; };
  if (![...hits].some((h) => score(h) > 0)) return hits;
  const head = opts.pinTop ? hits.slice(0, 1) : [];
  const rest = (opts.pinTop ? hits.slice(1) : hits).map((h, i) => ({ h, i, s: score(h) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.h);
  return [...head, ...rest];
}
