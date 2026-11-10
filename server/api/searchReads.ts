// Search's repeated reads, kept: one search reads the same index rows several times (each layer and each reading of
// the query asks again: "4215 lasetest matches" asked the trigram index for "4215 lasetest" twice, and a misspelled
// query is read once as typed and once corrected), and the next search often reads them too (a retry, the next
// letter typed). The rows kept are what the database returned, for the same statement and arguments.
//
// What they read changes only when the data does: the search index only in the stats job's rebuild ("search:version",
// server/stats/job.ts rebuildSearch), and teams and events only in a sync or the live lane, each of which moves
// "data:version". Either moving drops everything kept (the versions are checked every few seconds), as does any write
// this process makes to those tables (db.ts dataWriteCount), and no read is kept more than ten minutes. "Clear caches"
// in the owner portal empties it too.
//
// Whole answers are kept the same way (keptAnswer), for a minute: the same query asked again (a retry, a second
// visitor) is answered at once. A minute, so what changes without the data (learned clicks, "upcoming" as the clock
// moves, a switch flipped in the owner portal) shows within one. The /search page and /api/search share one kept
// answer (server/api/answers/followUps.ts pageAnswer), so a visit and the app's refresh of it cost one reading.
//
// Whole pages are kept too (keptPage): the HTML the server drew for a team, event, search or home address, for
// PAGE_TTL_MS, under the same invalidation. Drawing a team or event page is the dearest thing a request does (the
// app's own markup rendered here, 300–470 KB, then its critical CSS: 0.4–1 s of this process's one thread, measured
// 2026-11-10), and at a meet the same few pages are asked for over and over. Thirty seconds, so a live event's page
// never lags its API by more than that (the live lane's writes drop everything kept anyway, through dataWriteCount).
// Past its time, a kept answer or page is still served once more while a fresh one is made behind it (STALE_MS),
// so a busy page is remade by the server, not by a visitor waiting; nothing kept outlives a data move.
import { all, dataWriteCount, kvGet } from "../db.js";
import { registerCache } from "../caches.js";

const VERSION_CHECK_MS = 2_000, READ_TTL_MS = 10 * 60_000, READS_KEPT = 5_000, ANSWER_TTL_MS = 60_000, ANSWERS_KEPT = 1_000;
export const PAGE_TTL_MS = 30_000, PAGES_KEPT = 200;
/** How long past its time a kept answer or page is still served while its fresh copy is made. */
export const STALE_MS = 5 * 60_000;
type Kept = { at: number; value: Promise<unknown>; renewing?: boolean };
const fresh = (version = "", checked = 0, writes = dataWriteCount()) => ({ version, checked, writes, rows: new Map<string, Kept>(), answers: new Map<string, Kept>(), pages: new Map<string, Kept>() });
let kept = fresh();
let checking: Promise<void> | null = null;

async function checkVersion(now: number): Promise<void> {
  const [s, d] = await Promise.all([kvGet<string>("search:version"), kvGet<string>("data:version")]);
  const version = `${s ?? "0"}|${d ?? "0"}`;
  if (version !== kept.version) kept = fresh(version, now);
  else kept.checked = now;
}

/** The value kept under `key` (made by `make` when there's none, or it's older than `ttl`), most recently used last,
 *  so the oldest is the one dropped past `max`. A failed one isn't kept: the next ask makes it again. */
async function keep<T>(which: "rows" | "answers" | "pages", key: string, ttl: number, max: number, make: () => Promise<T>): Promise<T> {
  const now = Date.now();
  // A write here since: whatever was kept may be out of date, and the versions are read again too.
  if (kept.writes !== dataWriteCount()) kept = fresh();
  if (now - kept.checked > VERSION_CHECK_MS) {
    checking ??= checkVersion(now).finally(() => { checking = null; });
    await checking;
  }
  const map = kept[which];
  const hit = map.get(key);
  if (hit && now - hit.at < ttl) { map.delete(key); map.set(key, hit); return hit.value as Promise<T>; }
  // Past its time but still of this data (a version move or a write empties everything, above): an answer or page
  // is served as kept while one fresh copy is made behind it, so no visitor waits for the remake. Only once it's made
  // does it replace the kept one; a failed remake leaves the kept one for the next ask to try again.
  if (hit && which !== "rows" && now - hit.at < ttl + STALE_MS) {
    if (!hit.renewing) {
      hit.renewing = true;
      const store = kept, next = make();
      next.then(() => { if (kept === store && map.get(key) === hit) { map.delete(key); map.set(key, { at: Date.now(), value: next }); } },
        () => { hit.renewing = false; });
    }
    return hit.value as Promise<T>;
  }
  const value = make();
  map.set(key, { at: now, value });
  if (map.size > max) map.delete(map.keys().next().value!);
  value.catch(() => { if (map.get(key)?.value === value) map.delete(key); });
  return value;
}

/** `all(sql, args)`, kept as above. The rows are shared by every caller: read them, never change them. */
export const searchRead = <T>(sql: string, args: (string | number | null)[] = []): Promise<readonly T[]> =>
  keep("rows", `${sql}\u0000${JSON.stringify(args)}`, READ_TTL_MS, READS_KEPT, () => all<T>(sql, args));

/** A whole answer, kept a minute under `key` (the query and every option that changes its answer). Shared by every
 *  caller: never changed. */
export const keptAnswer = <T>(key: string, make: () => Promise<T>): Promise<T> => keep("answers", key, ANSWER_TTL_MS, ANSWERS_KEPT, make);

/** A whole page, kept PAGE_TTL_MS under `key` (its address: path and query). Shared by every visitor: never changed. */
export const keptPage = <T>(key: string, make: () => Promise<T>): Promise<T> => keep("pages", key, PAGE_TTL_MS, PAGES_KEPT, make);

/** How many of each are kept right now (the owner portal's caches view, tests). */
export const keptCounts = () => ({ rows: kept.rows.size, answers: kept.answers.size, pages: kept.pages.size });

registerCache("Search reads, answers and pages", () => { kept = fresh(); });
