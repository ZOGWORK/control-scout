// One data writer at a time, across processes.
//
// The background cycle (sync + stats, often in a child process on the VM) and
// the live fast lane (server process, every minute on event days) both write
// the same database. SQLite takes one writer at a time anyway, but the cycle's
// long write transactions (a season's stats, the backtest ledger) would make
// the fast lane's writes wait out their busy timeout, and two syncs of the same
// event could interleave (an older fetch landing after a newer one). So the
// writers share a lease: a row in kv, taken atomically (an upsert that only
// succeeds when the current lease has expired), renewed while held, released
// at the end. A crashed holder's lease simply runs out (ttl).
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { get, run } from "../db.js";

export const LOCK_KEY = "lock:data-writer";

export interface LeaseInfo { token: string; what: string; until: number }

/** Who holds the writer lease right now (null when free or expired). */
export async function lockHolder(now = Date.now()): Promise<LeaseInfo | null> {
  const r = await get<{ value: string }>("SELECT value FROM kv WHERE key = ?", [LOCK_KEY]);
  if (!r) return null;
  try {
    const v = JSON.parse(r.value) as LeaseInfo;
    return v.until > now ? v : null;
  } catch { return null; }
}

/** SQLite "database is locked": another connection is mid-write (and kept it past the busy timeout). */
export const isBusy = (e: unknown) => /SQLITE_BUSY|database is locked/i.test(`${(e as { code?: string })?.code ?? ""} ${(e as Error)?.message ?? ""}`);

/** Take the lease if it is free (or expired). Returns its token, or null when someone else holds it. */
export async function tryAcquire(what: string, ttlMs: number): Promise<string | null> {
  // Look first: a read never waits on a writer (WAL), and while the lease is held there's nothing to
  // write. Trying the upsert anyway would queue behind the holder's long write transactions (a season's
  // stats, a backfill) and fail with SQLITE_BUSY after the busy timeout.
  if (await lockHolder()) return null;
  const token = `${hostname()}:${process.pid}:${randomUUID()}`;
  const now = Date.now();
  const value = JSON.stringify({ token, what, until: now + ttlMs } satisfies LeaseInfo);
  let n: number;
  try {
    n = await run(
      `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
       WHERE COALESCE(json_extract(kv.value, '$.until'), 0) <= ?`,
      [LOCK_KEY, value, new Date(now).toISOString(), now],
    );
  } catch (e) {
    if (isBusy(e)) return null; // someone is writing right now: as good as held
    throw e;
  }
  return n > 0 ? token : null;
}

/** Extend a lease we hold. False when it was lost (expired and taken by someone else). */
export async function renew(token: string, ttlMs: number): Promise<boolean> {
  const n = await run(
    "UPDATE kv SET value = json_set(value, '$.until', ?), updated_at = ? WHERE key = ? AND json_extract(value, '$.token') = ?",
    [Date.now() + ttlMs, new Date().toISOString(), LOCK_KEY, token],
  );
  return n > 0;
}

/** Give a lease back (only ours: a lease someone took after ours expired stays). */
export async function release(token: string): Promise<void> {
  await run("DELETE FROM kv WHERE key = ? AND json_extract(value, '$.token') = ?", [LOCK_KEY, token]);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LockOptions {
  /** Lease length; renewed every third of it while `fn` runs. */
  ttlMs?: number;
  /** Keep trying this long when the lease is held (0 = one try). */
  waitMs?: number;
  pollMs?: number;
}

/** Thrown (or returned as `busy`) when the lease stays taken. */
export class LockBusy extends Error {
  constructor(readonly holder: LeaseInfo | null) { super(`data writer busy${holder ? ` (${holder.what})` : ""}`); }
}

/**
 * Run `fn` holding the writer lease. Throws LockBusy if it can't be had
 * within `waitMs`.
 */
export async function withDataLock<T>(what: string, fn: () => Promise<T>, o: LockOptions = {}): Promise<T> {
  const ttl = o.ttlMs ?? 120_000;
  // Waiting is timed on the monotonic clock (wall-clock jumps must not stretch or skip it).
  const deadline = performance.now() + (o.waitMs ?? 0);
  let token = await tryAcquire(what, ttl);
  while (!token && performance.now() < deadline) {
    await sleep(Math.min(o.pollMs ?? 1000, Math.max(1, deadline - performance.now())));
    token = await tryAcquire(what, ttl);
  }
  if (!token) throw new LockBusy(await lockHolder());
  const held = token;
  const timer = setInterval(() => { renew(held, ttl).catch(() => {}); }, Math.max(1000, ttl / 3));
  timer.unref?.();
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    await release(held).catch(() => {});
  }
}
