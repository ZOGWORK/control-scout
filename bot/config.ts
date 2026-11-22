// What this process can do, said once at startup so one journalctl look answers it — chat and why not, report filing,
// follow posts, the site it talks to, the season, the release it runs, the account it is and its servers, and when it
// last reached Discord — without a test message or a filed issue. `/config` adds the one thing only a server can
// answer: the chat limit that server has (bot/quota.ts). Every line says whether something is set, never a secret's value (bot/index.ts logs
// these, `journalctl -u control-scout-bot | grep 'config:'`).
import type { APIEmbed } from "discord.js";
import { seasonWithGame } from "../server/data/seasons.js";
import { reportSetup } from "./report.js";
import type { ChatSetup } from "./chatState.js";
import type { LimitSetting } from "./quota.js";
import { FOOTER, VOLT } from "./views.js";

/** How a time reads in a line: the journal has only words, Discord has <t:…> stamps each reader sees in their clock. */
export interface Clock {
  /** An absolute moment, "2026-11-22 14:03 UTC". */
  abs: (at: number) => string;
  /** How long ago, "3 minutes ago" (or "in 2 minutes" for a moment still to come). */
  rel: (at: number) => string;
}

/** "just now", "3 minutes ago", "2 hours ago", "4 days ago": the journal's way of saying when. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.round(Math.abs(now - at) / 1000);
  const n = s < 45 ? 0 : s < 90 * 60 ? Math.round(s / 60) : s < 36 * 3600 ? Math.round(s / 3600) : Math.round(s / 86_400);
  if (!n) return "just now";
  const unit = s < 45 ? "second" : s < 90 * 60 ? "minute" : s < 36 * 3600 ? "hour" : "day";
  return `${n} ${unit}${n === 1 ? "" : "s"} ${at <= now ? "ago" : "from now"}`;
}

const JOURNAL: Clock = {
  abs: (at) => `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`,
  rel: (at) => ago(at),
};

export interface Config {
  /** The commit this process runs (server/release.ts, the same string /api/health reports); null in development. */
  release: string | null;
  /** The account this process is and how many servers it is in (`guilds.cache`), as the journal's ready line says it;
   *  null until the gateway reports ready, since the startup block runs before that and "0 servers" would be a lie. */
  bot: { tag: string; servers: number } | null;
  season: number;
  /** The site's own port: the bot reads its API and database on loopback (bot/index.ts waitForSite). */
  sitePort: number;
  /** Where the slash commands are registered: a test server's id (DISCORD_DEV_GUILD_ID), or null for globally. */
  commands: { guild: string | null };
  chat: ChatSetup;
  /** The chat limit where /config was asked (bot/quota.ts): every server has one, or its own row replaced it. Absent
   *  in the startup block, which has no server to ask about; null when it couldn't be read. */
  limit?: LimitSetting | null;
  /** The follows the tick will post for; null when they couldn't be read (the database wasn't ready). */
  follows: { follows: number; servers: number } | null;
  /** Discord: when this process reached the gateway (null until it does), and the newest heartbeat it wrote
   *  (server/uptime.ts, once a minute while connected) — the last time it was connected, which outlives a restart. */
  discord: { since: number | null; last: number | null };
}

/** A chat limit in words: "30 an hour, 100 a day" (whichever it has), or "none", and where it came from. */
export function limitLine(l: LimitSetting | null): string {
  if (!l) return "chat limit couldn't be read just now";
  const caps = [l.perHour == null ? null : `${l.perHour} an hour`, l.perDay == null ? null : `${l.perDay} a day`]
    .filter(Boolean).join(", ");
  return `chat limit ${caps || "none"} (${l.custom ? "set for this server" : "the default for every server"})`;
}

/** The summary: one line each, all starting `config:` so one grep finds them all. */
export function configLines(c: Config, clock: Clock = JOURNAL): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const follows = c.follows;
  const { since, last } = c.discord;
  return [
    c.release
      ? `config: release ${c.release}`
      : "config: release development (no RELEASE file: the commit isn't known here)",
    c.bot
      ? `config: bot ${c.bot.tag} in ${plural(c.bot.servers, "server", "servers")}`
      : "config: bot not ready yet (the gateway hasn't said which account this is; the ready line follows)",
    `config: season ${c.season} (${seasonWithGame(c.season)})`,
    `config: site http://127.0.0.1:${c.sitePort} (its own API, on loopback)`,
    `config: slash commands ${c.commands.guild ? `in server ${c.commands.guild} only (DISCORD_DEV_GUILD_ID)` : "globally (no DISCORD_DEV_GUILD_ID)"}`,
    `config: chat ${c.chat.on ? "on: Control Point is configured and the discordBruno switch is on" : `off — ${c.chat.why}`}`,
    // Only where there is a server to ask about: /config, not the startup block.
    ...(c.limit === undefined ? [] : [`config: ${limitLine(c.limit)}`]),
    `config: ${reportSetup().line}`,
    `config: follow posts ${follows === null
      ? "on — the follows couldn't be read yet (a tick a minute while connected)"
      : follows.follows === 0
        ? "on — nothing followed yet (a tick a minute while connected)"
        : `on — ${plural(follows.follows, "follow", "follows")} in ${plural(follows.servers, "server", "servers")} (a tick a minute while connected)`}`,
    since !== null
      ? `config: discord connected since ${clock.abs(since)} (${clock.rel(since)})`
      : last !== null
        ? `config: discord not connected now (last connected ${clock.rel(last)})`
        : "config: discord not connected yet (the gateway is still connecting)",
  ];
}

/** /config's times: Discord timestamps, so "3 minutes ago" is in whoever reads it their own clock. */
const DISCORD_CLOCK: Clock = {
  abs: (at) => `<t:${Math.floor(at / 1000)}:t>`,
  rel: (at) => `<t:${Math.floor(at / 1000)}:R>`,
};

/** The same answers as an embed, for /config: whoever can manage the server asks, and only they see it (the handler
 *  defers it ephemerally), since it describes this bot's own setup rather than a channel's. */
export function configEmbed(c: Config): APIEmbed {
  return {
    title: "What this bot can do here",
    description: configLines(c, DISCORD_CLOCK).map((l) => `• ${l.replace(/^config: /, "")}`).join("\n"),
    color: VOLT,
    footer: FOOTER,
  };
}
