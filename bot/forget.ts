// A server's data, deleted when the bot is removed from it: the follows and the posts they already sent, the chat limit
// and what it used, the teams it asked about, the names its people went by there, the reply threads it kept, the
// questions it was asked, the votes on its answers and its name. Nothing else the bot writes is per-server, so this is
// the whole of what it knew about a server; one added again starts from nothing, the default chat cap included, since
// its limit row is gone too.
//
// `GuildDelete` also fires when a server is only unreachable (`available: false`, a Discord outage): bot/index.ts skips
// that case, since the bot is still in the server and its data must be there when the gateway comes back.
import { all, run } from "../server/db.js";

/** Everything the bot knows about one server, gone. Returns how many rows that took. */
export async function forgetGuild(guild: string): Promise<number> {
  // The channels first: a posted follow is keyed by channel, not server, so its rows are found through the follows.
  const channels = (await all<{ channel_id: string }>("SELECT DISTINCT channel_id FROM discord_follows WHERE guild_id = ?", [guild]))
    .map((r) => r.channel_id);
  let gone = 0;
  for (const channel of channels) gone += await run("DELETE FROM discord_posts WHERE channel_id = ?", [channel]);
  gone += await run("DELETE FROM discord_follows WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_limits WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_chat_usage WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_guild_teams WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_people WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_threads WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_asks WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_answers WHERE guild_id = ?", [guild]);
  gone += await run("DELETE FROM discord_guilds WHERE guild_id = ?", [guild]);
  return gone;
}
