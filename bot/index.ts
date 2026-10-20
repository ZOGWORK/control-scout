// The Control Scout Discord bot: its own process (systemd unit control-scout-bot on the VM), so a bot
// crash, restart or deploy never touches the site, and the other way round. It reads the site's
// database through the site's own modules (bot/lookups.ts) and never writes to it.
//
//   DISCORD_BOT_TOKEN      required (bot/README.md: developer portal → Bot → Reset Token)
//   DISCORD_DEV_GUILD_ID   optional: register the commands in that one server (instant) instead of globally
import "../server/env.js";
import { Client, Events, GatewayIntentBits, REST, Routes, type APIApplicationCommand } from "discord.js";
import { env } from "../server/env.js";
import { configure, db } from "../server/db.js";
import { CURRENT_SEASON } from "../server/data/seasons.js";
import { liveForecaster, refreshForecasters } from "../server/predict/engine.js";
import { COMMANDS, sameCommands } from "./commands.js";
import { createHandler } from "./handler.js";

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
await db().execute("PRAGMA busy_timeout = 5000").catch(() => {});
await configure(db()).catch((e) => log(`database not ready yet (${(e as Error).message}); lookups will say so until it is`));

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const handle = createHandler(log);

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

client.once(Events.ClientReady, (c) => {
  log(`ready as ${c.user.tag} in ${c.guilds.cache.size} server${c.guilds.cache.size === 1 ? "" : "s"}`);
  void registerUntilDone(c.application.id);
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
client.on(Events.InteractionCreate, (i) => { void handle(i); });
client.on(Events.GuildCreate, (g) => log(`added to a server (${client.guilds.cache.size} now): ${g.id}`));
client.on(Events.GuildDelete, (g) => log(`removed from a server (${client.guilds.cache.size} now): ${g.id}`));
client.on(Events.Error, (e) => log(`client error: ${e.message}`));
client.on(Events.ShardDisconnect, () => log("gateway disconnected; reconnecting"));
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
