// What this process can do, said once at startup so one journalctl look answers it — chat and why not, report filing,
// follow posts, the site it talks to and the season — without a test message or a filed issue. Every line says whether
// something is set, never a secret's value (bot/index.ts logs these, `journalctl -u control-scout-bot | grep 'config:'`).
import type { APIEmbed } from "discord.js";
import { seasonWithGame } from "../server/data/seasons.js";
import { reportSetup } from "./report.js";
import type { ChatSetup } from "./chatState.js";
import { FOOTER, VOLT } from "./views.js";

export interface Config {
  season: number;
  /** The site's own port: the bot reads its API and database on loopback (bot/index.ts waitForSite). */
  sitePort: number;
  /** Where the slash commands are registered: a test server's id (DISCORD_DEV_GUILD_ID), or null for globally. */
  commands: { guild: string | null };
  chat: ChatSetup;
  /** The follows the tick will post for; null when they couldn't be read (the database wasn't ready). */
  follows: { follows: number; servers: number } | null;
}

/** The summary: one line each, all starting `config:` so one grep finds them all. */
export function configLines(c: Config): string[] {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const follows = c.follows;
  return [
    `config: season ${c.season} (${seasonWithGame(c.season)})`,
    `config: site http://127.0.0.1:${c.sitePort} (its own API, on loopback)`,
    `config: slash commands ${c.commands.guild ? `in server ${c.commands.guild} only (DISCORD_DEV_GUILD_ID)` : "globally (no DISCORD_DEV_GUILD_ID)"}`,
    `config: chat ${c.chat.on ? "on: Control Point is configured and the discordBruno switch is on" : `off — ${c.chat.why}`}`,
    `config: ${reportSetup().line}`,
    `config: follow posts ${follows === null
      ? "on — the follows couldn't be read yet (a tick a minute while connected)"
      : follows.follows === 0
        ? "on — nothing followed yet (a tick a minute while connected)"
        : `on — ${plural(follows.follows, "follow", "follows")} in ${plural(follows.servers, "server", "servers")} (a tick a minute while connected)`}`,
  ];
}

/** The same six answers as an embed, for /config: whoever can manage the server asks, and only they see it (the
 *  handler defers it ephemerally), since it describes this bot's own setup rather than a channel's. */
export function configEmbed(c: Config): APIEmbed {
  return {
    title: "What this bot can do here",
    description: configLines(c).map((l) => `• ${l.replace(/^config: /, "")}`).join("\n"),
    color: VOLT,
    footer: FOOTER,
  };
}
