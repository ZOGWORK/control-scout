// The follow tick's own health (bot/follows.ts runs it every minute), kept where the owner console can read it without
// the journal: when it last finished, how many posts it sent, and how many sends failed. A bot connected to Discord with
// a tick that throws every minute looks healthy in the panel today — the posts simply never arrive — so the panel gets
// this beside its other numbers.
//
// Stored in `kv` (migration 1) under two keys, written after every tick, success or failure: a tick that never runs
// leaves the moment it last did, which is what makes a stopped tick visible.
import { all, run } from "../server/db.js";

/** The tick's last result, as the console reads it. */
export interface TickHealth {
  /** When the last tick finished (ISO); null: none has run since this was added. */
  at: string | null;
  /** Posts it sent, and sends that failed, on that tick. */
  posted: number;
  failed: number;
  /** The last tick threw instead of finishing (the next minute tries again). */
  error: string | null;
}

const AT = "bot:tick:at", POSTED = "bot:tick:posted", FAILED = "bot:tick:failed", ERROR = "bot:tick:error";

/** Record what one tick did. Never throws into the tick: a health write must not be why a tick fails. */
export async function noteTick(r: { posted: number; failed: number; error?: string | null }, now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString();
  const put = (key: string, value: string) => run(
    "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    [key, value, at]);
  await Promise.all([
    put(AT, at),
    put(POSTED, String(Math.max(0, Math.floor(r.posted)))),
    put(FAILED, String(Math.max(0, Math.floor(r.failed)))),
    put(ERROR, (r.error ?? "").slice(0, 300)),
  ]).catch(() => {});
}

/** The last tick, for the owner console: nulls when it has never run, never a claim it didn't. */
export async function tickHealth(): Promise<TickHealth> {
  const list = await all<{ key: string; value: string }>("SELECT key, value FROM kv WHERE key IN (?, ?, ?, ?)", [AT, POSTED, FAILED, ERROR]);
  const v = (k: string) => list.find((r) => r.key === k)?.value ?? null;
  const at = v(AT);
  return {
    at,
    posted: Number(v(POSTED) ?? 0) || 0,
    failed: Number(v(FAILED) ?? 0) || 0,
    error: v(ERROR) || null,
  };
}
