// The server names Discord shows the bot (migration 103). The console's Discord panel lists servers by name as well as
// id, so a cap can be set without hunting for a snowflake; nothing here is read at answer time, and a server's row goes
// with the rest of its data when the bot is removed (bot/forget.ts).
//
// A name is whatever Discord shows today: on GuildCreate, on a rename (GuildUpdate) and once at startup for every server
// the bot is already in, so existing servers get theirs on the next deploy.
import { all, run } from "../server/db.js";

/** Discord's own cap on a server's name. */
export const NAME_MAX = 100;

/** Remember a server's name (and that the bot is in it). A name Discord sends is always kept whole, trimmed. */
export async function rememberGuild(guild: string, name: string, now = Date.now()): Promise<void> {
  const at = new Date(now).toISOString();
  await run(
    `INSERT INTO discord_guilds (guild_id, name, joined_at, seen_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET name = excluded.name, seen_at = excluded.seen_at`,
    [guild, String(name ?? "").trim().slice(0, NAME_MAX) || "Unnamed server", at, at],
  );
}

/** Every server name the bot knows, by id. */
export async function guildNames(): Promise<Map<string, string>> {
  const rows = await all<{ guild_id: string; name: string }>("SELECT guild_id, name FROM discord_guilds");
  return new Map(rows.map((r) => [String(r.guild_id), String(r.name)]));
}
