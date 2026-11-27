// "@Control Scout remind me when 4215 plays next": one person's reminder (migration 118). Anyone can ask for one — it
// posts only in the channel it was asked in and pings only that person, so it needs none of a follow's Manage Server.
// The tick (bot/index.ts, once a minute with the follows) reads each reminded team's next match the way /next does
// (bot/next.ts: the events it is entered in, earliest first, the first unplayed match) and posts once it is 15 minutes
// out — or as soon as it sees it, when the match is already closer than that (a schedule FIRST posted late).
import type { APIEmbed } from "discord.js";
import { all, run } from "../server/db.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";
import { teamProfile } from "../server/api/teams.js";
import { cachedEventDetail } from "../server/api/events.js";
import type { EventDetail } from "../src/shared/api.js";
import { aheadEvents, nextPlaying, type NextMatch } from "./next.js";
import { REMIND_MS } from "./follows.js";
import { FOOTER, VOLT, startsText, teamLink } from "./views.js";

/** A reminder nobody's match ever reached (the team entered nothing more this season) is dropped after this long. */
export const REMINDER_KEEP_MS = 60 * 86_400_000;
/** A sent reminder is kept this long (so a restart can't send it again), then deleted. */
const SENT_KEEP_MS = 86_400_000;
/** A match already this far past its start isn't reminded about: it's being played, or the schedule is stale. */
const LATE_MS = 5 * 60_000;

export interface Reminder { guild_id: string; channel_id: string; user_id: string; team: number; created_at: string; sent_match?: string | null }

/** Ask for one (again): a reminder already sent for this team starts over, so "remind me" twice means the next match —
 *  the match it was already sent for is kept, so asking again while that match is still ahead never pings it twice. */
export async function addReminder(guild: string, channel: string, user: string, team: number, now = Date.now()): Promise<void> {
  await run(
    `INSERT INTO discord_reminders (guild_id, channel_id, user_id, team, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id, team) DO UPDATE SET channel_id = excluded.channel_id, created_at = excluded.created_at, sent_at = NULL`,
    [guild, channel, user, team, new Date(now).toISOString()]);
}

/** Cancel this person's reminders in this server (one team's, or all of them); how many went. */
export async function cancelReminders(guild: string, user: string, team: number | null): Promise<number> {
  return team == null
    ? run("DELETE FROM discord_reminders WHERE guild_id = ? AND user_id = ? AND sent_at IS NULL", [guild, user])
    : run("DELETE FROM discord_reminders WHERE guild_id = ? AND user_id = ? AND team = ? AND sent_at IS NULL", [guild, user, team]);
}

/** A team's next unplayed match this season, read as /next reads it, or null when none is scheduled. */
export async function nextMatchFor(team: number, now = Date.now()): Promise<NextMatch | null> {
  const profile = await teamProfile(team);
  if (!profile) return null;
  const details: EventDetail[] = [];
  for (const e of aheadEvents(profile.events.filter((x) => x.season === CURRENT_SEASON), now)) {
    const d = await cachedEventDetail(e.season, e.code);
    if (!d) continue;
    details.push(d);
    const found = nextPlaying([d], team);
    if (found) return found;
  }
  return null;
}

/** The next event a team is entered in this season (the earliest not over), null when none is, or `unknown` when
 *  there's no such team: what "watch the next event 4215 is in" follows. */
export async function nextEventFor(team: number, now = Date.now()): Promise<{ code: string; name: string; start: string | null } | null | "unknown"> {
  const profile = await teamProfile(team);
  if (!profile) return "unknown";
  const e = aheadEvents(profile.events.filter((x) => x.season === CURRENT_SEASON), now)[0];
  return e ? { code: e.code, name: e.name, start: e.start } : null;
}

const matchKey =(n: NextMatch) => `${n.event.event.season}:${n.event.event.code}:${n.match.level}:${n.match.series}:${n.match.number}`;

/** Whether a reminder for this match is due now: within 15 minutes of its start and not more than a few minutes past it. */
export function reminderDue(n: NextMatch, now: number): boolean {
  const at = n.match.startsAt ? Date.parse(n.match.startsAt) : NaN;
  if (!Number.isFinite(at) || n.match.played) return false;
  return at - now <= REMIND_MS && now - at <= LATE_MS;
}

/** The reminder itself: who it's for (the only ping), the match and when, and a link to it. */
export function reminderPost(user: string, team: number, n: NextMatch, site: string): { content: string; embed: APIEmbed } {
  const ev = n.event.event;
  const m = n.match;
  const side = m.red.teams.some((t) => t.number === team) ? m.red : m.blue;
  const partners = side.teams.filter((t) => t.number !== team).map((t) => t.number);
  return {
    content: `<@${user}> ${team} is up soon.`,
    embed: {
      title: `${team} plays ${m.label} soon`,
      description: [
        `${startsText(m) ?? "Starting soon"} at [${ev.name}](${site}/events/${ev.season}/${encodeURIComponent(ev.code)}).`,
        partners.length ? `With ${partners.join(", ")}.` : "",
        `You asked to be reminded about ${teamLink(team, site)}; this was the one reminder. Ask again for the next match.`,
      ].filter(Boolean).join("\n"),
      color: VOLT,
      footer: FOOTER,
    },
  };
}

/** Sends one reminder: the content pings that user and nobody else. */
export type RemindSend = (channel: string, user: string, post: { content: string; embed: APIEmbed }) => Promise<"ok" | "gone" | "error">;

/** One tick: every reminder still to send, each team's next match read once, posted when it's 15 minutes out. */
export async function reminderTick(send: RemindSend, site: string, now = Date.now(), next: (team: number, now: number) => Promise<NextMatch | null> = nextMatchFor): Promise<number> {
  await run("DELETE FROM discord_reminders WHERE (sent_at IS NOT NULL AND sent_at < ?) OR created_at < ?",
    [new Date(now - SENT_KEEP_MS).toISOString(), new Date(now - REMINDER_KEEP_MS).toISOString()]);
  const rows = await all<Reminder>("SELECT guild_id, channel_id, user_id, team, created_at, sent_match FROM discord_reminders WHERE sent_at IS NULL");
  if (!rows.length) return 0;
  const matches = new Map<number, NextMatch | null>();
  let sent = 0;
  for (const r of rows) {
    const team = Number(r.team);
    if (!matches.has(team)) matches.set(team, await next(team, now).catch(() => null));
    const n = matches.get(team);
    if (!n || !reminderDue(n, now) || (r.sent_match != null && matchKey(n) === r.sent_match)) continue;
    const out = await send(String(r.channel_id), String(r.user_id), reminderPost(String(r.user_id), team, n, site));
    if (out === "error") continue;
    // Sent, or the channel is gone (nothing can ever post there): either way it is done.
    await run("UPDATE discord_reminders SET sent_at = ?, sent_match = ? WHERE guild_id = ? AND user_id = ? AND team = ?",
      [new Date(now).toISOString(), matchKey(n), r.guild_id, r.user_id, team]);
    if (out === "ok") sent++;
  }
  return sent;
}
