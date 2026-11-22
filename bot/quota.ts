// Per-server chat limits for the Discord bot, built for the day a server's Control Scout traffic needs a cap: at most
// `perHour` chats an hour and `perDay` a day, counted in UTC windows so a limit resets on the clock rather than an hour
// after a server's first ask. A server with no row — every server today — has no limit: nothing is counted, nothing is
// written and nothing is refused, so this costs one indexed read per answer and no more. When a limit is set (the owner
// console, or setGuildLimit below) the two counters start with it: usage from before it is not counted against it.
import { all, get, run } from "../server/db.js";

/** A server's limit: null (or 0) is none. */
export interface GuildLimit { perHour: number | null; perDay: number | null }
/** Allowed, or refused with the seconds until the window that ran out starts afresh. */
export type Quota = { ok: true } | { ok: false; limited: "hour" | "day"; retryAfter: number };

/** The two UTC windows a chat counts in, as their keys. */
const windows = (now: number) => {
  const at = new Date(now).toISOString();
  return { hour: `h:${at.slice(0, 13)}`, day: `d:${at.slice(0, 10)}` };
};
/** The start of the next UTC hour, and of the next UTC day. */
const nextHour = (now: number) => { const d = new Date(now); d.setUTCMinutes(60, 0, 0); return d.getTime(); };
const nextDay = (now: number) => { const d = new Date(now); d.setUTCHours(24, 0, 0, 0); return d.getTime(); };
/** Whole seconds from `now` until `at`, at least 1. */
const secondsUntil = (at: number, now: number) => Math.max(1, Math.ceil((at - now) / 1000));
/** A stored number as a limit: a positive count, or null (none). */
const asLimit = (v: unknown) => (typeof v === "number" && v > 0 ? Math.floor(v) : null);

/** The server's limit (both null: none). */
export async function guildLimit(guild: string): Promise<GuildLimit> {
  const r = await get<{ per_hour: number | null; per_day: number | null }>("SELECT per_hour, per_day FROM discord_limits WHERE guild_id = ?", [guild]);
  return { perHour: asLimit(r?.per_hour), perDay: asLimit(r?.per_day) };
}

/** Set a server's limit (nulls clear it). `by`: who asked, a Discord user id; `now`: for tests. */
export async function setGuildLimit(guild: string, limit: GuildLimit, by: string | null = null, now = Date.now()): Promise<void> {
  await run(
    `INSERT INTO discord_limits (guild_id, per_hour, per_day, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET per_hour = excluded.per_hour, per_day = excluded.per_day,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [guild, limit.perHour, limit.perDay, by, new Date(now).toISOString()]);
}

/**
 * Count one chat in one window, if that window has room, in a single statement: the room is checked and the count added
 * by the database, so two chats at the same moment can't both take a server's last slot. `max` null is no limit for the
 * window (nothing written). False: the window was full.
 */
async function count(guild: string, window: string, max: number | null): Promise<boolean> {
  if (max == null) return true;
  const changed = await run(
    `INSERT INTO discord_chat_usage (guild_id, window, used)
       SELECT ?, ?, 1
        WHERE COALESCE((SELECT used FROM discord_chat_usage WHERE guild_id = ? AND window = ?), 0) < ?
     ON CONFLICT(guild_id, window) DO UPDATE SET used = used + 1 WHERE used < ?`,
    [guild, window, guild, window, max, max]);
  return changed > 0;
}

/**
 * Count one chat against `guild`'s limits, or say it may not happen. No limit: allowed at once, and nothing is written.
 * With one: the hour is taken first, then the day — each atomically, so concurrent chats can't overshoot a cap — and a
 * chat the day refuses gives its hour back. The windows that are long over are dropped with the first chat of an hour.
 */
export async function takeChat(guild: string, now = Date.now()): Promise<Quota> {
  const { perHour, perDay } = await guildLimit(guild);
  if (perHour == null && perDay == null) return { ok: true };
  const w = windows(now);
  // Read for housekeeping only (is this the hour's first chat?); the caps themselves are enforced by count() below.
  const before = await all<{ window: string }>("SELECT window FROM discord_chat_usage WHERE guild_id = ? AND window IN (?, ?)", [guild, w.hour, w.day]);
  const freshHour = !before.some((r) => r.window === w.hour);
  if (!(await count(guild, w.hour, perHour))) return { ok: false, limited: "hour", retryAfter: secondsUntil(nextHour(now), now) };
  if (!(await count(guild, w.day, perDay))) {
    // Refused by the day: the hour's slot goes back, so a chat that never happened isn't counted against it.
    if (perHour != null) await run("UPDATE discord_chat_usage SET used = used - 1 WHERE guild_id = ? AND window = ? AND used > 0", [guild, w.hour]);
    return { ok: false, limited: "day", retryAfter: secondsUntil(nextDay(now), now) };
  }
  if (freshHour) await run("DELETE FROM discord_chat_usage WHERE guild_id = ? AND window NOT IN (?, ?)", [guild, w.hour, w.day]);
  return { ok: true };
}
