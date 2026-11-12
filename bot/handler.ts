// Interactions in, embeds out. Every command answers: the reply is deferred before any lookup (Discord
// allows 3 seconds for a first response; a cold event can take longer), and every failure becomes a
// friendly embed, logged here with the command and its arguments. Autocomplete answers from a cached
// event list and never throws.
import { MessageFlags, PermissionFlagsBits, type APIEmbed, type AutocompleteInteraction, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import { AnswerCache, Cooldown } from "./guard.js";
import { FOOTER, Friendly, VOLT, errorEmbed, pride, unavailableEmbed } from "./views.js";
import { addFollow, followingEmbed, listFollows, removeFollow } from "./follows.js";
import { BOT_COMMANDS } from "../src/shared/discord.js";
import { eventChoices, eventLookup, predictLookup, rankChoices, rankingsLookup, site, teamLookup } from "./lookups.js";
import { isEnabled } from "../server/flags.js";
import { featureOffMessage } from "../src/shared/flags.js";
import { ask as askSearch, realAskDeps, type AskDeps, type AskReply } from "./ask.js";

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
  /** /ask: the website's search answer to a question (bot/ask.ts). */
  ask: (question: string) => Promise<AskReply>;
  /** The owner's feature toggles the bot follows (server/flags.ts); absent: always on. */
  enabled?: (flag: "discordBot" | "livePredictions") => Promise<boolean>;
}

export const realLookups: Lookups = {
  team: teamLookup,
  predict: predictLookup,
  event: eventLookup,
  rankings: () => rankingsLookup(),
  choices: async (typed) => rankChoices(await eventChoices(), typed),
  follow: addFollow,
  unfollow: removeFollow,
  following: async (guild) => followingEmbed(await listFollows(guild), site()),
  ask: async (question) => askSearch(question, await (askDeps ??= realAskDeps()), site()),
  enabled: (flag) => isEnabled(flag),
};
let askDeps: Promise<AskDeps> | undefined;

/** What every command answers while the owner has the bot switched off (the discordBot feature toggle). */
export const BOT_OFF_TITLE = "Turned off for now";

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
  // /ask keeps every command's 3-second pace; the same question within a minute is the answer already given.
  const asks = new AnswerCache<AskReply>(opts.ttlMs ?? 60_000, 2000);

  /** /ask, logged with the question and how it was answered (never who asked). */
  async function askAnswer(question: string, key: string): Promise<APIEmbed> {
    const t0 = Date.now();
    let fresh = false;
    // Cached by the whole question (the log line's key is cut at 100 characters; two long questions alike that far
    // are still two questions), the same for /ask and a mention, whatever its case or spacing.
    const r = await asks.get(question.trim().replace(/\s+/g, " ").toUpperCase(), () => { fresh = true; return lookups.ask(question); });
    const bruno = [r.meta.refined ? "rewrite" : null, r.meta.sentence ? "sentence" : null].filter(Boolean).join("+") || "no";
    log(`${key} step=${r.meta.step} bruno=${bruno}${r.content ? " video" : ""} ${fresh ? "" : "cached "}${Date.now() - t0}ms`);
    if (r.content) videoOf.set(r.embed, r.content);
    return r.embed;
  }
  /** An answer's main video link, sent as the message's text so Discord shows a player under the embed. */
  const videoOf = new WeakMap<APIEmbed, string>();
  const withVideo = (embed: APIEmbed) => { const content = videoOf.get(embed); return { ...(content ? { content } : {}), embeds: [pride(embed)] }; };

  function answer(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const key = describe(i);
    switch (i.commandName) {
      case "team": return cache.get(key, () => lookups.team(i.options.getInteger("number", true)));
      case "predict": return predict(i, key);
      case "event": return cache.get(key, () => lookups.event(i.options.getString("code", true)));
      case "rankings": return cache.get(key, () => lookups.rankings());
      case "help": return Promise.resolve(helpEmbed());
      case "ask": return askAnswer(i.options.getString("question", true), key);
      case "follow": case "unfollow": case "following": return manage(i);
      default: return Promise.reject(new Friendly("Unknown command", "This command isn't one Control Scout knows. Try /help for the list."));
    }
  }

  /** /predict, unless the owner switched live predictions off (the livePredictions feature toggle). */
  async function predict(i: ChatInputCommandInteraction, key: string): Promise<APIEmbed> {
    if (lookups.enabled && !(await lookups.enabled("livePredictions"))) throw new Friendly("Predictions are off", featureOffMessage("livePredictions"));
    return cache.get(key, () => lookups.predict(i.options.getString("event", true), i.options.getInteger("match", true)));
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
    // Switched off by the owner: a short, private note for whoever asked, and nothing else runs (follows are kept).
    if (lookups.enabled && !(await lookups.enabled("discordBot"))) {
      await i.reply({ embeds: [pride(errorEmbed(BOT_OFF_TITLE, "Control Scout's Discord bot is turned off by the owner right now. Everything on controlscout.org still works, and this server's follows are kept for when it's back."))], flags: MessageFlags.Ephemeral });
      return;
    }
    const wait = cooldown.take(i.user.id);
    if (wait > 0) {
      await i.reply({ embeds: [pride(errorEmbed("Slow down", `One command every 3 seconds. Try again in ${Math.ceil(wait / 1000)} s.`))], flags: MessageFlags.Ephemeral });
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
    await i.editReply(withVideo(embed));
  }

  async function autocomplete(i: AutocompleteInteraction): Promise<void> {
    let list: { name: string; value: string }[] = [];
    try {
      if (lookups.enabled && !(await lookups.enabled("discordBot"))) { await i.respond([]); return; }
      list = await lookups.choices(String(i.options.getFocused() ?? ""));
    } catch (e) {
      log(`autocomplete /${i.commandName} failed: ${(e as Error)?.message ?? String(e)}`);
    }
    await i.respond(list.slice(0, 25));
  }

  /**
   * "@Control Scout who won decode": the same answer as /ask (same cache, same 3-second pace), as a reply. Only a
   * message that @mentions the bot itself, in a server, from a person: never its own or another bot's, never a reply
   * that only pings it, never @everyone or a role. Discord sends the text of a message that mentions the bot without
   * the privileged Message Content intent, so the bot never reads anything else.
   */
  async function mention(m: MentionMessage, botId: string): Promise<void> {
    try {
      if (m.author.bot || !m.guildId) return;
      if (!new RegExp(`<@!?${botId}>`).test(m.content)) return;
      const q = m.content.replace(/<@[!&]?\d+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      const send = (embed: APIEmbed) => m.reply({ ...withVideo(embed), allowedMentions: { repliedUser: false } })
        // No Read Message History in that channel: a plain message instead of a reply.
        .catch(() => m.channel.send?.(withVideo(embed)));
      if (lookups.enabled && !(await lookups.enabled("discordBot"))) {
        await send(errorEmbed(BOT_OFF_TITLE, "Control Scout's Discord bot is turned off by the owner right now. Everything on controlscout.org still works, and this server's follows are kept for when it's back."));
        return;
      }
      // Too fast: nothing in the channel (a public "slow down" would be noise); the next one past 3 s is answered.
      if (cooldown.take(m.author.id) > 0) return;
      if (!q) {
        await send({ title: "Ask me anything", description: "Write your question after the mention, like the website's search box:\n`@Control Scout who won decode` · `@Control Scout 4215 vs 6980`\nOr use `/ask question:`.", color: VOLT, footer: FOOTER });
        return;
      }
      void m.channel.sendTyping?.().catch(() => {});
      let embed: APIEmbed;
      try {
        embed = await askAnswer(q, `/ask question=${q.toUpperCase().slice(0, 100)}`);
      } catch (e) {
        log(`@mention ask failed: ${(e as Error)?.message ?? String(e)}`);
        embed = unavailableEmbed();
      }
      await send(embed);
    } catch (e) {
      log(`mention failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async function handle(i: Interaction): Promise<void> {
    try {
      if (i.isChatInputCommand()) await command(i);
      else if (i.isAutocomplete()) await autocomplete(i);
    } catch (e) {
      // Discord itself failed (the interaction expired, the network dropped): log it and stay up.
      log(`interaction failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }
  return Object.assign(handle, { mention });
}

/** The parts of a discord.js Message a mention answer uses (a stand-in in tests). */
export interface MentionMessage {
  author: { id: string; bot: boolean };
  guildId: string | null;
  content: string;
  reply: (opts: { content?: string; embeds: APIEmbed[]; allowedMentions: { repliedUser: boolean } }) => Promise<unknown>;
  channel: { send?: (opts: { content?: string; embeds: APIEmbed[] }) => Promise<unknown>; sendTyping?: () => Promise<unknown> };
}
