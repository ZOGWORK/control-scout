// Per-server chat limits for the Discord bot: at most `perHour` chats an hour and `perDay` a day, counted in UTC windows so
// a limit resets on the clock rather than an hour after a server's first ask. No server is capped by default — DEFAULT_LIMIT
// is none in either window — and a server only gets a ceiling when the owner console, or setGuildLimit, gives it a row of
// its own. A row replaces both windows (a null or zero there is no cap for that window), and clearGuildLimit deletes the
// row to leave the server uncapped again. A server's two counters start with its limit: setting or clearing one deletes its
// usage, so chats from before it are not counted against it.
import { all, get, run } from "../server/db.js";

/** A server's limit: null (or 0) is none. */
export interface GuildLimit { perHour: number | null; perDay: number | null }
/** A server's limit as enforced, and where it came from: the default, or a row of its own. */
export interface LimitSetting extends GuildLimit { custom: boolean }
/** Allowed, or refused with the seconds until the window that ran out starts afresh. */
export type Quota = { ok: true } | { ok: false; limited: "hour" | "day"; retryAfter: number };

/** What a server has without a row of its own: no cap in either window. The cap feature is built — the owner console
 *  sets one server at a time — but nothing caps every server, and an uncapped chat is allowed at once and writes no
 *  count (takeChat, below). */
export const DEFAULT_LIMIT: GuildLimit = { perHour: null, perDay: null };

/** The two UTC windows a chat counts in, as their keys (the owner console reads them too). */
export const chatWindows = (now = Date.now()) => {
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

/** The server's limit as enforced: its own row's, or the default it has without one (`custom: false`). */
export async function guildLimit(guild: string): Promise<LimitSetting> {
  const r = await get<{ per_hour: number | null; per_day: number | null }>("SELECT per_hour, per_day FROM discord_limits WHERE guild_id = ?", [guild]);
  if (!r) return { ...DEFAULT_LIMIT, custom: false };
  return { perHour: asLimit(r.per_hour), perDay: asLimit(r.per_day), custom: true };
}

/** Set a server's own limit (nulls clear a window's cap). `by`: who set it (a Discord user id, or the owner console's
 *  email); `now`: for tests. The server's counters start afresh: what it asked before this isn't counted against it. */
export async function setGuildLimit(guild: string, limit: GuildLimit, by: string | null = null, now = Date.now()): Promise<void> {
  await run(
    `INSERT INTO discord_limits (guild_id, per_hour, per_day, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET per_hour = excluded.per_hour, per_day = excluded.per_day,
       updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [guild, limit.perHour, limit.perDay, by, new Date(now).toISOString()]);
  await run("DELETE FROM discord_chat_usage WHERE guild_id = ?", [guild]);
}

/** Back to the default cap: delete the server's row. (A row of nulls is no cap, not the default.) The counters start
 *  afresh here too, so a server that spent most of a custom cap today isn't refused the moment it goes back. */
export async function clearGuildLimit(guild: string): Promise<void> {
  await run("DELETE FROM discord_limits WHERE guild_id = ?", [guild]);
  await run("DELETE FROM discord_chat_usage WHERE guild_id = ?", [guild]);
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
 * Count one chat against `guild`'s limits, or say it may not happen. Both windows unlimited: allowed at once, and
 * nothing is written. Otherwise: the hour is taken first, then the day — each atomically, so concurrent chats can't
 * overshoot a cap — and a chat the day refuses gives its hour back. The windows that are long over are dropped with the
 * first chat of an hour.
 */
export async function takeChat(guild: string, now = Date.now()): Promise<Quota> {
  const { perHour, perDay } = await guildLimit(guild);
  if (perHour == null && perDay == null) return { ok: true };
  const w = chatWindows(now);
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
