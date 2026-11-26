// One person's chats in one server, paced (bot/handler.ts: /ask, a mention, a button). The per-server cap
// (bot/quota.ts) is a ceiling on the whole server; without a per-person pace one member can spend it alone — or make
// the bot answer a channel in a loop, which costs Control Point a model call each time.
//
// The pace is generous enough that a person asking a handful of questions back to back never sees it: six a minute and
// thirty an hour. At it, the bot says so plainly and points at the site, which has no such limit. Windows are UTC, like
// the server cap, and counted in `discord_person_usage` (migration 111), so a restart doesn't reset them.
import { all, run } from "../server/db.js";

/** A person's pace: chats a UTC minute, and a UTC hour. */
export const PERSON_PACE = { perMinute: 6, perHour: 30 };
/** Windows older than this many days are dropped with a later chat (a day's windows can't matter again). */
export const PACE_KEEP_DAYS = 2;

/** Allowed, or refused with which window and the seconds until it starts afresh. */
export type Pace = { ok: true } | { ok: false; window: "minute" | "hour"; retryAfter: number };

/** The two windows a person's chat counts in, as their keys (`m:`/`h:` then the UTC minute or hour). */
export const paceWindows = (now = Date.now()) => {
  const at = new Date(now).toISOString();
  return { minute: `m:${at.slice(0, 16)}`, hour: `h:${at.slice(0, 13)}` };
};

const nextMinute = (now: number) => { const d = new Date(now); d.setUTCSeconds(60, 0); return d.getTime(); };
const nextHour = (now: number) => { const d = new Date(now); d.setUTCMinutes(60, 0, 0); return d.getTime(); };
const secondsUntil = (at: number, now: number) => Math.max(1, Math.ceil((at - now) / 1000));

/** Count one chat in one window, if it has room, in one statement (as bot/quota.ts counts a server's). */
async function count(guild: string, user: string, window: string, max: number): Promise<boolean> {
  const changed = await run(
    `INSERT INTO discord_person_usage (guild_id, user_id, window, used)
       SELECT ?, ?, ?, 1
        WHERE COALESCE((SELECT used FROM discord_person_usage WHERE guild_id = ? AND user_id = ? AND window = ?), 0) < ?
     ON CONFLICT(guild_id, user_id, window) DO UPDATE SET used = used + 1 WHERE used < ?`,
    [guild, user, window, guild, user, window, max, max]);
  return changed > 0;
}

/** Drop windows from earlier days, with a later chat (one small delete, not one a chat). The window key is `m:`/`h:`
 *  then the ISO minute or hour, so its date is characters 3–12. */
async function sweep(now: number): Promise<void> {
  const before = new Date(now - PACE_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  await run("DELETE FROM discord_person_usage WHERE substr(window, 3, 10) < ?", [before]);
}

let writes = 0;

/**
 * Count one chat against this person's pace, or say when it may happen. A chat the hour refuses gives its minute back,
 * so a chat that never happened isn't counted against it.
 */
export async function takePersonChat(guild: string, user: string, now = Date.now()): Promise<Pace> {
  const w = paceWindows(now);
  if (!(await count(guild, user, w.minute, PERSON_PACE.perMinute))) {
    return { ok: false, window: "minute", retryAfter: secondsUntil(nextMinute(now), now) };
  }
  if (!(await count(guild, user, w.hour, PERSON_PACE.perHour))) {
    await run("UPDATE discord_person_usage SET used = used - 1 WHERE guild_id = ? AND user_id = ? AND window = ? AND used > 0", [guild, user, w.minute]);
    return { ok: false, window: "hour", retryAfter: secondsUntil(nextHour(now), now) };
  }
  if (++writes % 50 === 0) void sweep(now).catch(() => {});
  return { ok: true };
}

/** What this person has used in both windows (for a test, or /config's own numbers). */
export async function personUsage(guild: string, user: string, now = Date.now()): Promise<{ minute: number; hour: number }> {
  const w = paceWindows(now);
  const rows = await all<{ window: string; used: number }>(
    "SELECT window, used FROM discord_person_usage WHERE guild_id = ? AND user_id = ? AND window IN (?, ?)", [guild, user, w.minute, w.hour]);
  const at = (k: string) => Number(rows.find((r) => r.window === k)?.used ?? 0);
  return { minute: at(w.minute), hour: at(w.hour) };
}

/** A person at their pace: said in the channel or privately, with when it resets. */
export function paceEmbed(p: { window: "minute" | "hour" }): { title: string; description: string } {
  return {
    title: "One at a time",
    description: p.window === "minute"
      ? `That's ${PERSON_PACE.perMinute} questions in a minute — faster than I can keep up. Try again in a minute, or ask on controlscout.org, which has no such limit.`
      : `That's ${PERSON_PACE.perHour} questions in an hour in this server. The next one resets at the top of the hour; everyone else here gets their own.`,
  };
}
