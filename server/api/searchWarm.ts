// Search's most-asked answers, made before a new process answers anyone (the search audit's S3, 2026-11-24). Each
// deploy (about 25 a day) starts a process whose kept answers are empty, so the first visitor to ask each of the
// popular searches after it waited for a whole answer (30–1,600 ms) that the last process had kept.
//
// What's counted: the searches answered with no preferred teams and no My team (the answers any visitor shares),
// by query and limit, in this process's memory. Every few minutes, and as the process stops, the top HOT_MAX are
// written to kv ("search:hot"), this process's own first, then the last list's for the rest. Only the queries, never
// who asked or how often. The next process reads the list and makes each answer (warmHot), a turn of the loop
// between them, before it takes over from the lane still serving (server/index.ts), or right after it's ready on a
// cold start.
import { kvGet, kvSet } from "../db.js";
import { pageAnswer } from "./answers/followUps.js";

/** How many of the most-asked searches are kept in the list, and so made by the next process. */
export const HOT_MAX = 500;
/** How long the next process spends making them at most. */
export const HOT_WARM_MS = 45_000;
/** How many different searches are counted before the least-asked are dropped. */
const COUNTED_MAX = 20_000;
const KEY = "search:hot";

type Asked = [q: string, limit: number];
const counts = new Map<string, number>();

/** A search answered for any visitor (no preferred teams, no My team): counted. */
export function noteAsked(q: string, limit: number): void {
  if (!q.trim()) return;
  const k = JSON.stringify([q, limit]);
  counts.set(k, (counts.get(k) ?? 0) + 1);
  if (counts.size > COUNTED_MAX) {
    // The least asked half go.
    const keep = [...counts].sort((a, b) => b[1] - a[1]).slice(0, COUNTED_MAX / 2);
    counts.clear();
    for (const [x, n] of keep) counts.set(x, n);
  }
}

const valid = (x: unknown): x is Asked => Array.isArray(x) && typeof x[0] === "string" && typeof x[1] === "number";

/** The list as kept: the searches to make, most asked first. */
export async function hotList(): Promise<Asked[]> {
  const v = await kvGet<unknown>(KEY).catch(() => null);
  return Array.isArray(v) ? v.filter(valid).slice(0, HOT_MAX) : [];
}

/** This process's most asked first, then the kept list's others, HOT_MAX in all. Written only when there's
 *  something counted. */
export async function saveHot(): Promise<number> {
  if (!counts.size) return 0;
  const mine = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => JSON.parse(k) as Asked);
  const seen = new Set(mine.map((x) => JSON.stringify(x)));
  const list = [...mine, ...(await hotList()).filter((x) => !seen.has(JSON.stringify(x)))].slice(0, HOT_MAX);
  await kvSet(KEY, list);
  return list.length;
}

/** Make each answer on the list (kept a minute, then served stale while remade: ./searchReads.ts), one at a time with
 *  a turn of the loop between them, for up to `ms`. Returns how many were made. */
export async function warmHot(ms = HOT_WARM_MS, now = () => Date.now()): Promise<number> {
  const end = now() + ms;
  let made = 0;
  for (const [q, limit] of await hotList()) {
    if (now() >= end) break;
    await new Promise<void>((go) => setImmediate(go));
    try { await pageAnswer(q, limit, new Set()); made++; } catch { /* the next one */ }
  }
  return made;
}
