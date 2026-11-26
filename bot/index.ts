// The Control Scout Discord bot: its own process (systemd unit control-scout-bot on the VM), so a bot
// crash, restart or deploy never touches the site, and the other way round. It reads the site's
// database through the site's own modules (bot/lookups.ts). It writes only its own tables: the teams
// servers follow and the log of what it posted for them (bot/follows.ts, migration 35), and its row in
// service_heartbeats, once a minute while connected, for the /status page (server/uptime.ts, migration 86).
//
//   DISCORD_BOT_TOKEN      required (bot/README.md: developer portal → Bot → Reset Token)
//   DISCORD_DEV_GUILD_ID   optional: register the commands in that one server (instant) instead of globally
import "../server/env.js";
import { Client, Events, GatewayIntentBits, Partials, REST, Routes, type APIApplicationCommand } from "discord.js";
import { env } from "../server/env.js";
import { configure, db, get } from "../server/db.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";
import { liveForecaster, refreshForecasters } from "../server/predict/engine.js";
import { COMMANDS, sameCommands } from "./commands.js";
import { createHandler, realLookups } from "./handler.js";
import { notifyTick, type Send } from "./follows.js";
import { isAskChannel } from "./ambient.js";
import { welcomeEmbed } from "./welcome.js";
import { forgetGuild } from "./forget.js";
import { guildLimit } from "./quota.js";
import { rememberGuild } from "./guilds.js";
import { REPORT, reporterName, wholeAnswer } from "./reactions.js";
import { sweepOldThumbs } from "./cleanup.js";
import { flushSearchFailures } from "../server/searchFailures.js";
import { site } from "./lookups.js";
import { configEmbed, configLines, type Config } from "./config.js";
import { chatSetup } from "./chatState.js";
import { RELEASE } from "../server/release.js";
import { beat } from "../server/uptime.js";

const log = (m: string) => console.log(`[${new Date().toISOString()}] [bot] ${m}`);

const token = env.discordBotToken;
if (!token) {
  // One line, then exit 78 (EX_CONFIG): the systemd unit doesn't restart on it, so a missing token
  // doesn't fill the journal every 5 seconds.
  log("DISCORD_BOT_TOKEN is not set: add it to .env (see bot/README.md). Not starting.");
  process.exit(78);
}

// WAL and a busy wait on the local database, as the site sets them; no migrations (the site owns the
// schema). A remote database (Turso) is read directly: the embedded replica file belongs to the site.
// The busy wait goes first: setting WAL needs a moment's lock, which the site's sync may be holding.
// Wait for the site to say its data is ready before opening the database: on a fresh install it restores the
// shipped snapshot by replacing the file, and a connection opened before that would stay on the old, empty one.
// On the VM the site answers on its own port (loopback); after 3 minutes the bot goes on regardless (and says so).
await waitForSite();
await db().execute("PRAGMA busy_timeout = 5000").catch(() => {});
await configure(db()).catch((e) => log(`database not ready yet (${(e as Error).message}); lookups will say so until it is`));

// One startup summary of what this process can do (bot/config.ts): chat and why not, report filing, follow posts, the
// site it talks to, the season, the release it runs and when it last reached Discord. `journalctl -u control-scout-bot
// | grep 'config:'` then answers it, with no test message and no test issue filed. Said after the database is open,
// since the chat switch and the follows live there.
// When the gateway is up: `since` while this process is connected, `last` when the moment it was connected, kept after a
// drop so /config says "not connected now (last connected …)" rather than claiming a connection it lost.
const gateway: { since: number | null; last: number | null } = { since: null, last: null };
// The ready line's two facts — which account this is and how many servers it is in — kept where configHere (which runs
// before the client is constructed, being top-level await above it) can read them: until the gateway says, the summary
// says it isn't ready rather than "0 servers", which would be the truth only for a bot that had looked.
const self: { tag: string | null; servers: number } = { tag: null, servers: 0 };
for (const line of configLines(await configHere())) log(line);

/** What this bot can do here, read now: the startup summary and /config both come from this, so the journal and the
 *  command can't disagree. Said once the database is open, since the chat switch and the follows live there. `guild`:
 *  the server /config was asked in, whose own chat limit is then part of the answer; the startup block has none. */
async function configHere(guild?: string | null): Promise<Config> {
  // Stopped follows are kept (their row says why), so they are counted apart: the tick posts for neither, but the
  // journal should say some exist rather than look healthy.
  const follows = await get<{ n: number; g: number; stopped: number }>(
    "SELECT COUNT(*) AS n, COUNT(DISTINCT guild_id) AS g, COALESCE(SUM(dropped_at IS NOT NULL), 0) AS stopped FROM discord_follows")
    .then((r) => ({ follows: Number(r?.n ?? 0), servers: Number(r?.g ?? 0), stopped: Number(r?.stopped ?? 0) }))
    .catch(() => null);
  // The newest heartbeat (server/uptime.ts), written once a minute while connected: the last time it was connected, which
  // outlives a restart — the startup summary asks before this process has reached the gateway.
  const beatAt = await get<{ at: number }>("SELECT at FROM service_heartbeats WHERE service = 'bot'")
    .then((r) => (r ? Number(r.at) : null))
    .catch(() => null);
  // The newest of the two: a heartbeat a minute into a session is later than its connect, and a beat from before a restart
  // is later than nothing.
  const lastConnected = Math.max(gateway.last ?? 0, beatAt ?? 0) || null;
  return {
    release: RELEASE, bot: self.tag === null ? null : { tag: self.tag, servers: self.servers },
    season: CURRENT_SEASON, sitePort: env.port, commands: { guild: env.discordDevGuildId },
    chat: await chatSetup(), follows, discord: { since: gateway.since, last: gateway.since ?? lastConnected },
    // The limit is the asking server's, so only /config has one; a failed read says so rather than hiding the line.
    ...(guild ? { limit: await guildLimit(guild).catch(() => null) } : {}),
  };
}

async function waitForSite(timeoutMs = 180_000): Promise<void> {
  const url = `http://127.0.0.1:${env.port}/api/health`;
  const until = Date.now() + timeoutMs;
  let said = false;
  while (Date.now() < until) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok && (await r.json() as { ready?: boolean }).ready) return;
    } catch { /* not up yet */ }
    if (!said) { log(`waiting for the site's data to be ready (${url})`); said = true; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  log("the site didn't report ready in 3 minutes; starting anyway (lookups say so if the data isn't there)");
}

// GuildMessages (not privileged) for "@Control Scout …": Discord sends the text only of messages that mention the
// bot, so without the privileged Message Content intent it never reads anything else. GuildMessageReactions and
// DirectMessageReactions (not privileged either) are what deliver a 👎 on an answer (bot/reactions.ts): a person adding
// one deliberately is reporting that answer, and without these intents the bot would never hear it. Partials: a report
// on an answer from before the bot's last restart still arrives (its message, channel and reaction may not be cached).
// Message Content is privileged and only requested when the server's env says the portal switch is on (bot/ambient.ts):
// asking for an intent the app isn't allowed makes login fail, so it can't be added before the portal is ready.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessageReactions,
    ...(env.discordMessageContent ? [GatewayIntentBits.MessageContent] : []),
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.Channel],
});
// /config answers with the same summary the startup log prints (bot/config.ts), read live rather than from startup.
const handle = createHandler(log, { ...realLookups, config: async (guild) => configEmbed(await configHere(guild)) });

async function register(appId: string): Promise<void> {
  const rest = new REST().setToken(token!);
  const guild = env.discordDevGuildId;
  const route = guild ? Routes.applicationGuildCommands(appId, guild) : Routes.applicationCommands(appId);
  const where = guild ? `server ${guild}` : "globally";
  const registered = (await rest.get(route)) as APIApplicationCommand[];
  if (sameCommands(registered)) { log(`commands unchanged (${registered.length}, ${where})`); return; }
  await rest.put(route, { body: COMMANDS });
  log(`commands registered (${COMMANDS.length}, ${where})`);
}

/** The gateway is up: the moment /config's and the journal's "discord connected since" count from. */
const connected = () => { gateway.since = gateway.last = Date.now(); };
client.on(Events.ShardReady, () => connected());
// Resumed after a network drop, without a fresh ready: the bot is connected again from now.
client.on(Events.ShardResume, () => { connected(); log("gateway resumed"); });

client.once(Events.ClientReady, (c) => {
  connected();
  self.tag = c.user.tag;
  self.servers = c.guilds.cache.size;
  log(`ready as ${c.user.tag} in ${c.guilds.cache.size} server${c.guilds.cache.size === 1 ? "" : "s"}`);
  // The names Discord shows, for the owner console (bot/guilds.ts): existing servers get theirs on the first connection
  // after this ships, and a rename or a new server keeps it current.
  for (const g of c.guilds.cache.values()) void rememberGuild(g.id, g.name).catch(() => {});
  void registerUntilDone(c.application.id);
  // The 👎 and 👍 the bot used to add are still on its older answers, where they are buttons that do nothing: taken off
  // once, on this first connection (bot/cleanup.ts).
  void sweepOldThumbs(client, log).catch((e) => log(`stale thumbs: sweep failed: ${(e as Error)?.message ?? String(e)}`));
  // Warm the season's ratings so the first /predict doesn't wait for them.
  liveForecaster(CURRENT_SEASON).then(() => log("ratings ready")).catch((e) => log(`ratings not ready: ${(e as Error).message}`));
});

/** Register, retrying (30 s, 1 min, 2 min … up to 10 min apart) until Discord takes it: a bot without its
 *  commands is no use, and a restart shouldn't be what fixes a passing network error. */
async function registerUntilDone(appId: string): Promise<void> {
  for (let wait = 30_000; !stopping; wait = Math.min(wait * 2, 600_000)) {
    try { await register(appId); return; } catch (e) {
      log(`command registration failed (${(e as Error).message}); retrying in ${wait / 1000} s`);
      await new Promise((r) => setTimeout(r, wait).unref());
    }
  }
}

// As the site does (server/index.ts): after a sync the data version moves, so rebuild the ratings in the
// background right away, and no /predict is the one that finds the old ones (or waits for new ones).
setInterval(() => { refreshForecasters().catch(() => {}); }, 15_000).unref();

// Automatic posts for followed teams (bot/follows.ts): every minute once connected, one tick at a time.
const send: Send = async (channelId, embed) => {
  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isSendable()) return "gone";
    await ch.send({ embeds: [embed] });
    return "ok";
  } catch (e) {
    // 10003 unknown channel, 50001 missing access, 50013 missing permissions: the channel is gone or closed to the bot.
    const code = (e as { code?: number }).code;
    return code === 10003 || code === 50001 || code === 50013 ? "gone" : "error";
  }
};
/** A stopped follow's creator is told by DM: the channel it posted in can't be posted in any more. */
const dm = async (userId: string, text: string): Promise<void> => {
  const user = await client.users.fetch(userId);
  await user.send({ content: text });
};
// The /status page's heartbeat (server/uptime.ts): every minute while connected to Discord.
setInterval(() => { if (client.isReady()) beat("bot").catch(() => {}); }, 60_000).unref();
let ticking = false;
setInterval(() => {
  if (ticking || !client.isReady()) return;
  ticking = true;
  notifyTick(send, site(), log, Date.now(), dm)
    .then((n) => { if (n) log(`follows: posted ${n}`); })
    .catch((e) => log(`follows: tick failed: ${(e as Error).message}`))
    .finally(() => { ticking = false; });
}, 60_000).unref();
client.on(Events.InteractionCreate, (i) => { void handle(i); });
client.on(Events.MessageCreate, (m) => {
  if (!client.user) return;
  // In a channel named #ask-control-scout (and only when Message Content is enabled) a message needs no mention; every
  // other channel still has to mention the bot or reply to it (bot/ambient.ts).
  const ambient = env.discordMessageContent && isAskChannel(m.channel as never);
  void handle.mention(m as never, client.user.id, ambient);
});
/** A 👎 added on purpose is a report (bot/handler.ts `downvoted`): the answer's question and words go to GitHub, and
 *  the person is told where the issue is. Only a message the bot posted has a row, so a 👎 anywhere else files nothing,
 *  and the bot adds no emoji of its own — so a 👍 somebody adds changes nothing, and the ones it did add are taken off
 *  once at startup (bot/cleanup.ts). */
client.on(Events.MessageReactionAdd, (r, u) => {
  if (u.bot || r.emoji.name !== REPORT) return;
  void (async () => {
    // Only an id arrives for a message Discord has no copy of (an answer from before the last restart): fetched, so the
    // issue has the answer's words and the report has the reporter's nickname (bot/reactions.ts).
    const answer = await wholeAnswer(r.message);
    await handle.downvoted(answer as never, {
      id: u.id, bot: u.bot, globalName: u.globalName, username: u.username,
      displayName: reporterName(answer, u.id),
    });
  })().catch(() => {});
});
// The site's failed-search queue counts Discord's own misses too (bot/ask.ts): the buffer is in this process, so the bot
// flushes it as the site does, every minute.
setInterval(() => {
  flushSearchFailures()
    .then((n) => { if (n) log(`search-failures: counted ${n}`); })
    .catch((e) => log(`search-failures: flush failed: ${(e as Error).message}`));
}, 60_000).unref();
client.on(Events.GuildCreate, (g) => {
  self.servers = client.guilds.cache.size;
  log(`added to a server (${self.servers} now): ${g.id}`);
  void rememberGuild(g.id, g.name).catch(() => {});
  // One short welcome with what to do next, in the system channel or the first one it can post in: an install that
  // never finds /follow is a bot nobody uses (bot/welcome.ts).
  const channel = (g.systemChannel?.isSendable()
    ? g.systemChannel
    : [...g.channels.cache.values()].find((c) => c.isTextBased() && c.isSendable())) as { send?: (p: { embeds: unknown[] }) => Promise<unknown> } | undefined;
  if (channel?.send) {
    void channel.send({ embeds: [welcomeEmbed()] }).catch((e) => log(`welcome: couldn't post in ${g.id} (${(e as Error)?.message ?? String(e)})`));
  }
  // A server it is added back to still has the answers it posted there, 👎s and 👍s and all: swept on the way in, since
  // the row says the sweep is done and would otherwise skip it (bot/cleanup.ts; a pass that misses something there asks
  // for a full one on the next start).
  void sweepOldThumbs(client, log, { only: g.id }).catch((e) => log(`stale thumbs: sweep failed in ${g.id}: ${(e as Error)?.message ?? String(e)}`));
});
client.on(Events.GuildUpdate, (_old, g) => { void rememberGuild(g.id, g.name).catch(() => {}); });
client.on(Events.GuildDelete, (g) => {
  self.servers = client.guilds.cache.size;
  log(`removed from a server (${self.servers} now): ${g.id}`);
  // `available: false` is Discord saying the server is unreachable (an outage), not that the bot was removed: the bot is
  // still in it, and its data must still be there when the gateway returns. Everything else is a real removal: the
  // server's own rows go with it (bot/forget.ts), since nothing here should outlive the bot's place in a server.
  if (!g.available) return;
  forgetGuild(g.id)
    .then((n) => log(`forgot a removed server's data (${n} row${n === 1 ? "" : "s"}): ${g.id}`))
    .catch((e) => log(`couldn't forget a removed server's data: ${(e as Error).message}`));
});
client.on(Events.Error, (e) => log(`client error: ${e.message}`));
client.on(Events.ShardDisconnect, () => {
  // Not connected any more: the summary says so, with when it last was (a heartbeat a minute at most).
  gateway.last = gateway.since ?? gateway.last;
  gateway.since = null;
  log("gateway disconnected; reconnecting");
});
// A stray rejection anywhere is logged, never fatal: the bot stays online.
process.on("unhandledRejection", (e) => log(`unhandled: ${(e as Error)?.message ?? String(e)}`));

let stopping = false;
const stop = (sig: string) => {
  if (stopping) return;
  stopping = true;
  log(`${sig}: shutting down`);
  void client.destroy().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.once("SIGTERM", () => stop("SIGTERM"));
process.once("SIGINT", () => stop("SIGINT"));

await client.login(token).catch((e) => {
  // A wrong token is a setting, like a missing one (no restart loop); anything else (the network) is retried by systemd.
  const bad = (e as { code?: string }).code === "TokenInvalid";
  log(`login failed: ${(e as Error).message}${bad ? " (check DISCORD_BOT_TOKEN). Not starting." : ""}`);
  process.exit(bad ? 78 : 1);
});
