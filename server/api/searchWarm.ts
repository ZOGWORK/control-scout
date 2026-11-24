// Search's most-asked answers, made before a new process answers anyone (the search audit's S3, 2026-11-24). Each
// deploy (about 25 a day) starts a process whose kept answers are empty, so the first visitor to ask each of the
// popular searches after it waited for a whole answer (30–1,600 ms) that the last process had kept.
//
// What's counted: the searches answered with no preferred teams and no My team (the answers any visitor shares),
// by query and limit, in this process's memory. Every few minutes, and as the process stops, the top HOT_MAX are
// written to kv under this lane's own key ("search:hot:a", "search:hot:b": deploy/lanes.sh; "search:hot:one" outside
// the lanes), this process's own first, then its lane's last list for the rest. One writer per key (one process per
// lane at a time, its saves one after another), so two lanes saving at once never lose each other's. Only the
// queries, never who asked or how often. The next process reads every lane's list, merged (warmHot), and makes each
// answer, a turn of the loop between them, before it takes over from the lane still serving (server/index.ts), or
// right after it's ready on a cold start.
import { kvGet, kvSet } from "../db.js";
import { pageAnswer, precomputeFollowUps } from "./answers/followUps.js";
import { SEARCH_PAGE_LIMIT } from "../../src/shared/search.js";
import { keptGeneration, searchVersion } from "./searchReads.js";

/** How many of the most-asked searches are kept in the list, and so made by the next process. */
export const HOT_MAX = 500;
/** How long the next process spends making them at most (none is started after it). */
export const HOT_WARM_MS = 45_000;
/** How many different searches are counted before the least-asked are dropped. */
const COUNTED_MAX = 20_000;
/** This lane's key, and every lane's (read by the next process). */
const LANES = ["a", "b", "one"] as const;
const keyOf = (lane: string) => `search:hot:${lane}`;
const ownKey = () => keyOf(process.env.CS_LANE === "a" || process.env.CS_LANE === "b" ? process.env.CS_LANE : "one");

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
/** The list under `key`; a failed read throws (a save then writes nothing, never a short list over the kept one). */
const listAt = async (key: string): Promise<Asked[]> => {
  const v = await kvGet<unknown>(key);
  return Array.isArray(v) ? v.filter(valid).slice(0, HOT_MAX) : [];
};

/** Every lane's list, merged: each list's first, then each one's second, and so on, each search once, HOT_MAX in all. */
export async function hotList(): Promise<Asked[]> {
  return (await hotListRead()).list;
}

/** hotList, and whether every lane's list was read (`whole`): a lane that can't be read is left out, so the others
 *  still warm, but a run over a partial list isn't the whole index's (precomputeHot tries it again). */
async function hotListRead(): Promise<{ list: Asked[]; whole: boolean }> {
  let whole = true;
  const lists = await Promise.all(LANES.map((l) => listAt(keyOf(l)).catch(() => { whole = false; return [] as Asked[]; })));
  const out: Asked[] = [], seen = new Set<string>();
  for (let i = 0; out.length < HOT_MAX && lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const x = l[i], k = x && JSON.stringify(x);
      if (x && !seen.has(k) && out.length < HOT_MAX) { seen.add(k); out.push(x); }
    }
  }
  return { list: out, whole };
}

let saving: Promise<number> = Promise.resolve(0);
/** This process's most asked first, then its lane's last list for the others, HOT_MAX in all, under its lane's key.
 *  Written only when there's something counted; one save at a time. */
export function saveHot(): Promise<number> {
  const next = saving.catch(() => 0).then(async () => {
    if (!counts.size) return 0;
    const key = ownKey();
    const mine = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => JSON.parse(k) as Asked);
    const seen = new Set(mine.map((x) => JSON.stringify(x)));
    const list = [...mine, ...(await listAt(key)).filter((x) => !seen.has(JSON.stringify(x)))].slice(0, HOT_MAX);
    await kvSet(key, list);
    return list.length;
  });
  saving = next;
  return next;
}

/** Make each answer on the list (kept a minute, then served stale while remade: ./searchReads.ts), one at a time with
 *  a turn of the loop between them, starting none after `ms` (a soft bound: the one started last is finished, a whole
 *  answer at most, 30–1,600 ms). One the kept store moved under while it was made (a clip-start change or a data move:
 *  only made answers are carried) is made again once. Returns how many were made. */
export async function warmHot(ms = HOT_WARM_MS, now = () => Date.now()): Promise<number> {
  const end = now() + ms;
  let made = 0;
  for (const [q, limit] of await hotList()) {
    if (now() >= end) break;
    await new Promise<void>((go) => setImmediate(go));
    try {
      const at = keptGeneration();
      await pageAnswer(q, limit, new Set());
      if (keptGeneration() !== at && now() < end) await pageAnswer(q, limit, new Set());
      made++;
    } catch { /* the next one */ }
  }
  return made;
}

/** How many of the most-asked searches get their follow-ups made ahead (the search audit's S9): each set is up to 41
 *  searches, mostly answers other sets share, so a hundred is a few CPU-minutes per stats run, all of it `later` work
 *  behind live searches. */
export const HOT_FOLLOW_MAX = 100;
let aheadFor: string | null = null, aheadRunning: Promise<number> | null = null;

/** The most-asked searches' follow-ups made ahead once per search index (after start, and after each stats run moves
 *  "search:version"): People also ask for them is there at once (./answers/followUps.ts followUpsWithin). Only the
 *  page's own searches (its limit). Never two runs at once; nothing when the index hasn't moved since a run that made
 *  them all. */
export function precomputeHot(): Promise<number> {
  return (aheadRunning ??= (async () => {
    const version = await searchVersion();
    if (version === aheadFor) return 0;
    const { list, whole } = await hotListRead();
    const qs = list.filter(([, limit]) => limit === SEARCH_PAGE_LIMIT).map(([q]) => q).slice(0, HOT_FOLLOW_MAX);
    const made = await precomputeFollowUps(qs);
    // Done for this index only when every lane's list was read, there were searches in it, and every one was made:
    // a set that failed, or a lane that couldn't be read, is tried again on the next tick (server/index.ts), not
    // left slow until the next stats run.
    if (whole && qs.length && made === qs.length && (await searchVersion()) === version) aheadFor = version;
    return made;
  })().finally(() => { aheadRunning = null; }));
}
