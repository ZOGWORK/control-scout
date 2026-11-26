// What one server asks of the bot's follow posts (/settings, Manage Server): quiet hours, whether match-day heads-ups
// are posted at all, and a role to ping on them. Kept in `discord_guild_settings` (migration 111), so it outlives a
// restart and goes with the server's other rows when the bot is removed (bot/forget.ts).
//
// Quiet hours are UTC: Discord gives the bot no server time zone, and a wrong guess is worse than a stated one. The
// window wraps past midnight (22 to 7). Inside it nothing is posted: a reminder that falls there is skipped rather than
// queued (the match starts without it), which is what /settings says.
import type { APIEmbed } from "discord.js";
import { all, get, run } from "../server/db.js";
import { FOOTER, VOLT } from "./views.js";

/** A server's settings, as enforced. */
export interface GuildSettings {
  /** UTC hours the server asked for silence, start..end wrapping past midnight; null: no quiet hours. */
  quiet: { start: number; end: number } | null;
  /** False: the server wants results and event posts only, no reminders, on-deck or schedule-change heads-ups. */
  reminders: boolean;
  /** A role to ping on a match reminder (its id), or null. Never @everyone or @here. */
  pingRole: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** What a server has without a row: every post, no quiet hours, no ping. */
export const DEFAULT_SETTINGS: GuildSettings = { quiet: null, reminders: true, pingRole: null, updatedAt: null, updatedBy: null };

/** A UTC hour, 0–23, or null when the text isn't one. */
const hour = (v: string): number | null => {
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
};

/**
 * Quiet hours from what someone typed: "22-7", "22:00-07:00", "off", "none", or empty. Anything else is refused with
 * the reason, rather than read as some window they didn't ask for.
 */
export function parseQuiet(text: string): { quiet: { start: number; end: number } | null } | { problem: string } {
  const t = String(text ?? "").trim().toLowerCase();
  if (!t || t === "off" || t === "none") return { quiet: null };
  const m = /^(\d{1,2})(?::\d{2})?\s*(?:-|to|–)\s*(\d{1,2})(?::\d{2})?$/.exec(t);
  if (!m) return { problem: "Quiet hours look like `22-7` (UTC), or `off` for none." };
  const start = hour(m[1]), end = hour(m[2]);
  if (start == null || end == null) return { problem: "Quiet hours are two hours from 0 to 23, like `22-7` (UTC)." };
  if (start === end) return { problem: "Quiet hours can't start and end at the same hour: that is all day or none. Use `off` for none." };
  return { quiet: { start, end } };
}

/** "22:00–07:00 UTC", or "none". */
export const quietWords = (q: GuildSettings["quiet"]) =>
  q ? `${String(q.start).padStart(2, "0")}:00–${String(q.end).padStart(2, "0")}:00 UTC` : "none";

/** Is this hour (UTC) inside the server's quiet window? A window that wraps (22 to 7) covers both ends of the day. */
export function inQuietHours(q: GuildSettings["quiet"], now = Date.now()): boolean {
  if (!q) return false;
  const h = new Date(now).getUTCHours();
  return q.start < q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

/** The server's settings as enforced; no row is the default, and a failed read must never silence the bot. */
export async function guildSettings(guild: string): Promise<GuildSettings> {
  const r = await get<{ quiet_start: number | null; quiet_end: number | null; reminders: number; ping_role: string | null; updated_at: string; updated_by: string | null }>(
    "SELECT quiet_start, quiet_end, reminders, ping_role, updated_at, updated_by FROM discord_guild_settings WHERE guild_id = ?", [guild]);
  if (!r) return DEFAULT_SETTINGS;
  const start = r.quiet_start == null ? null : Number(r.quiet_start);
  const end = r.quiet_end == null ? null : Number(r.quiet_end);
  return {
    quiet: start != null && end != null ? { start, end } : null,
    reminders: Number(r.reminders) !== 0,
    pingRole: r.ping_role ?? null,
    updatedAt: r.updated_at ?? null,
    updatedBy: r.updated_by ?? null,
  };
}

/** Every server's row, for the tick: one read a minute instead of one a channel. */
export async function allSettings(): Promise<Map<string, GuildSettings>> {
  const list = await all<{ guild_id: string; quiet_start: number | null; quiet_end: number | null; reminders: number; ping_role: string | null; updated_at: string; updated_by: string | null }>(
    "SELECT guild_id, quiet_start, quiet_end, reminders, ping_role, updated_at, updated_by FROM discord_guild_settings");
  return new Map(list.map((r) => {
    const start = r.quiet_start == null ? null : Number(r.quiet_start);
    const end = r.quiet_end == null ? null : Number(r.quiet_end);
    return [String(r.guild_id), {
      quiet: start != null && end != null ? { start, end } : null,
      reminders: Number(r.reminders) !== 0,
      pingRole: r.ping_role ?? null,
      updatedAt: r.updated_at ?? null,
      updatedBy: r.updated_by ?? null,
    }] as [string, GuildSettings];
  }));
}

/** Save a server's settings; `null` quiet is no quiet hours, and a failed write is the caller's to report. */
export async function setGuildSettings(guild: string, s: Pick<GuildSettings, "quiet" | "reminders" | "pingRole">, by: string | null = null, now = Date.now()): Promise<void> {
  await run(
    `INSERT INTO discord_guild_settings (guild_id, quiet_start, quiet_end, reminders, ping_role, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end,
       reminders = excluded.reminders, ping_role = excluded.ping_role, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
    [guild, s.quiet?.start ?? null, s.quiet?.end ?? null, s.reminders ? 1 : 0, s.pingRole, new Date(now).toISOString(), by]);
}

/**
 * Whether a post may go out now, and whether it should carry a ping. `kind` is the post's kind in `discord_posts`
 * (reminder, result, eve, schedule, recap, moved, changed, new, on-deck, rollover). Quiet hours stop every post; a
 * server that muted reminders still gets results, event posts and the season notice.
 */
export const MATCH_HEADS_UP = new Set(["reminder", "ondeck", "moved", "changed", "new"]);

export function allows(s: GuildSettings, kind: string, now = Date.now()): boolean {
  if (inQuietHours(s.quiet, now)) return false;
  if (!s.reminders && MATCH_HEADS_UP.has(kind)) return false;
  return true;
}

/** Whether this post is one the server asked to ping its role on (only the 15-minute reminder and the on-deck one). */
export const pings = (s: GuildSettings, kind: string) => (s.pingRole && (kind === "reminder" || kind === "ondeck") ? s.pingRole : null);

/** /settings: what this server asked for, in words. */
export function settingsEmbed(g: GuildSettings, guild: string): APIEmbed {
  const when = g.updatedAt ? `\nLast changed ${g.updatedAt.slice(0, 10)}${g.updatedBy ? ` by <@${g.updatedBy}>` : ""}.` : "";
  return {
    title: "How this server gets its posts",
    description: [
      `**Quiet hours:** ${quietWords(g.quiet)}${g.quiet ? " — nothing is posted then. A reminder that falls in them is skipped, not sent late." : ""}`,
      `**Match reminders:** ${g.reminders ? "on: a heads-up before each match, on-deck and schedule changes." : "off: results and event posts only."}`,
      `**Ping on reminders:** ${g.pingRole ? `<@&${g.pingRole}>` : "nobody (answers and posts never ping @everyone)."}`,
      "",
      `Change it with \`/settings\`, for example \`/settings quiet_hours:22-7\` or \`/settings reminders:off\`. Settings are per server and never change what \`/ask\` answers.${when}`,
    ].join("\n"),
    color: VOLT,
    footer: FOOTER,
  };
}
