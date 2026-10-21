// Interactions in, embeds out. Every command answers: the reply is deferred before any lookup (Discord
// allows 3 seconds for a first response; a cold event can take longer), and every failure becomes a
// friendly embed, logged here with the command and its arguments. Autocomplete answers from a cached
// event list and never throws.
import { MessageFlags, PermissionFlagsBits, type APIEmbed, type AutocompleteInteraction, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import { AnswerCache, Cooldown } from "./guard.js";
import { FOOTER, Friendly, VOLT, errorEmbed, unavailableEmbed } from "./views.js";
import { addFollow, followingEmbed, listFollows, removeFollow } from "./follows.js";
import { BOT_COMMANDS } from "../src/shared/discord.js";
import { eventChoices, eventLookup, predictLookup, rankChoices, rankingsLookup, teamLookup } from "./lookups.js";

export type Log = (m: string) => void;

export interface Lookups {
  team: (n: number) => Promise<APIEmbed>;
  predict: (event: string, match: number) => Promise<APIEmbed>;
  event: (code: string) => Promise<APIEmbed>;
  rankings: () => Promise<APIEmbed>;
  choices: (typed: string) => Promise<{ name: string; value: string }[]>;
  follow: (guild: string, channel: string, team: number, by: string) => Promise<"added" | "already">;
  unfollow: (guild: string, team: number, channel?: string | null) => Promise<number>;
  following: (guild: string) => Promise<APIEmbed>;
}

export const realLookups: Lookups = {
  team: teamLookup,
  predict: predictLookup,
  event: eventLookup,
  rankings: () => rankingsLookup(),
  choices: async (typed) => rankChoices(await eventChoices(), typed),
  follow: addFollow,
  unfollow: removeFollow,
  following: async (guild) => followingEmbed(await listFollows(guild)),
};

/** /help: every command, from the same list the site shows (src/shared/discord.ts). */
export function helpEmbed(): APIEmbed {
  return {
    title: "Control Scout commands",
    url: "https://controlscout.org",
    description: BOT_COMMANDS.map((c) => "`" + c.usage + "` " + c.what + (c.admin ? " *(Manage Server)*" : "")).join("\n"),
    color: VOLT,
    footer: FOOTER,
  };
}

/** Can the bot post embeds in this channel? (A follow that can never post is refused up front.) */
function canPost(i: ChatInputCommandInteraction, channelId: string): boolean {
  try {
    const ch = i.guild?.channels.cache.get(channelId);
    const me = i.guild?.members.me;
    if (!ch || !me || !("permissionsFor" in ch)) return true; // not cached: the first post finds out
    const p = ch.permissionsFor(me);
    return !!p?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
  } catch { return true; }
}

/** The command and its arguments as one line, for the cache key and the log. */
export function describe(i: Pick<ChatInputCommandInteraction, "commandName" | "options">): string {
  const args = i.options.data.map((o) => `${o.name}=${String(o.value ?? "").trim().toUpperCase().slice(0, 100)}`).sort();
  return [`/${i.commandName}`, ...args].join(" ");
}

export function createHandler(log: Log, lookups: Lookups = realLookups, opts: { ttlMs?: number; cooldownMs?: number } = {}) {
  const cache = new AnswerCache<APIEmbed>(opts.ttlMs ?? 60_000, 2000, (e) => e instanceof Friendly);
  const cooldown = new Cooldown(opts.cooldownMs ?? 3000);

  function answer(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const key = describe(i);
    switch (i.commandName) {
      case "team": return cache.get(key, () => lookups.team(i.options.getInteger("number", true)));
      case "predict": return cache.get(key, () => lookups.predict(i.options.getString("event", true), i.options.getInteger("match", true)));
      case "event": return cache.get(key, () => lookups.event(i.options.getString("code", true)));
      case "rankings": return cache.get(key, () => lookups.rankings());
      case "help": return Promise.resolve(helpEmbed());
      case "follow": case "unfollow": case "following": return manage(i);
      default: return Promise.reject(new Friendly("Unknown command", "This command isn't one Control Scout knows. Try /help for the list."));
    }
  }

  /** The server's follows: never cached (they change), and only inside a server. */
  async function manage(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const guild = i.guildId;
    if (!guild) throw new Friendly("Servers only", "Follows belong to a server: use this in one of its channels.");
    if (i.commandName === "following") return lookups.following(guild);
    const team = i.options.getInteger("team", true);
    const picked = i.options.getChannel("channel")?.id ?? null;
    const where = picked ? ` in <#${picked}>` : "";
    if (i.commandName === "unfollow") {
      const n = await lookups.unfollow(guild, team, picked);
      if (!n) throw new Friendly("Not following", `This server doesn't follow ${team}${where}.`);
      return { title: `Stopped following ${team}`, description: `No more automatic posts for **${team}**${where}.`, color: VOLT, footer: FOOTER };
    }
    const channel = picked ?? i.channelId;
    if (!canPost(i, channel)) throw new Friendly("Can't post there", `Control Scout needs View Channel, Send Messages and Embed Links in <#${channel}>. Give its role those, or pick another channel.`);
    const r = await lookups.follow(guild, channel, team, i.user.id);
    return {
      title: r === "added" ? `Following ${team}` : `Already following ${team}`,
      description: `<#${channel}> gets posts for **${team}**: the evening before each event, its schedule with win odds once posted, 15 minutes before each match, each result and whether the call was right, and a recap at the end of each day. Stop with /unfollow team:${team}.`,
      color: VOLT,
      footer: FOOTER,
    };
  }

  async function command(i: ChatInputCommandInteraction): Promise<void> {
    const wait = cooldown.take(i.user.id);
    if (wait > 0) {
      await i.reply({ embeds: [errorEmbed("Slow down", `One command every 3 seconds. Try again in ${Math.ceil(wait / 1000)} s.`)], flags: MessageFlags.Ephemeral });
      return;
    }
    await i.deferReply();
    let embed: APIEmbed;
    try {
      embed = await answer(i);
    } catch (e) {
      if (e instanceof Friendly) embed = errorEmbed(e.title, e.detail);
      else {
        log(`${describe(i)} failed: ${(e as Error)?.message ?? String(e)}`);
        embed = unavailableEmbed();
      }
    }
    await i.editReply({ embeds: [embed] });
  }

  async function autocomplete(i: AutocompleteInteraction): Promise<void> {
    let list: { name: string; value: string }[] = [];
    try {
      list = await lookups.choices(String(i.options.getFocused() ?? ""));
    } catch (e) {
      log(`autocomplete /${i.commandName} failed: ${(e as Error)?.message ?? String(e)}`);
    }
    await i.respond(list.slice(0, 25));
  }

  return async function handle(i: Interaction): Promise<void> {
    try {
      if (i.isChatInputCommand()) await command(i);
      else if (i.isAutocomplete()) await autocomplete(i);
    } catch (e) {
      // Discord itself failed (the interaction expired, the network dropped): log it and stay up.
      log(`interaction failed: ${(e as Error)?.message ?? String(e)}`);
    }
  };
}
