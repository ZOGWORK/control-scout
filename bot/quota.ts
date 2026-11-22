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
 * Count one chat against `guild`'s limit, or say it may not happen. No limit: allowed at once, and nothing is written.
 * With one: both windows are counted in one statement (two mentions at once can't lose a count, and a restart keeps
 * them in the table), and the windows that are long over are dropped with the first chat of each hour.
 */
export async function takeChat(guild: string, now = Date.now()): Promise<Quota> {
  const { perHour, perDay } = await guildLimit(guild);
  if (perHour == null && perDay == null) return { ok: true };
  const w = windows(now);
  const rows = await all<{ window: string; used: number }>(
    "SELECT window, used FROM discord_chat_usage WHERE guild_id = ? AND window IN (?, ?)", [guild, w.hour, w.day]);
  const used = (key: string) => Number(rows.find((r) => r.window === key)?.used ?? 0);
  const hour = used(w.hour), day = used(w.day);
  if (perHour != null && hour >= perHour) return { ok: false, limited: "hour", retryAfter: Math.max(1, Math.ceil((nextHour(now) - now) / 1000)) };
  if (perDay != null && day >= perDay) return { ok: false, limited: "day", retryAfter: Math.max(1, Math.ceil((nextDay(now) - now) / 1000)) };
  await run(
    `INSERT INTO discord_chat_usage (guild_id, window, used) VALUES (?, ?, 1), (?, ?, 1)
     ON CONFLICT(guild_id, window) DO UPDATE SET used = used + 1`,
    [guild, w.hour, guild, w.day]);
  if (hour === 0) await run("DELETE FROM discord_chat_usage WHERE guild_id = ? AND window NOT IN (?, ?)", [guild, w.hour, w.day]);
  return { ok: true };
}
