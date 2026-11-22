// Interactions in, embeds out. Every command answers: the reply is deferred before any lookup (Discord
// allows 3 seconds for a first response; a cold event can take longer), and every failure becomes a
// friendly embed, logged here with the command and its arguments. Autocomplete answers from a cached
// event list and never throws.
import { MessageFlags, PermissionFlagsBits, type APIEmbed, type AutocompleteInteraction, type ChatInputCommandInteraction, type Interaction } from "discord.js";
import { AnswerCache } from "./guard.js";
import { FOOTER, Friendly, VOLT, errorEmbed, pride, unavailableEmbed } from "./views.js";
import { addFollow, followingEmbed, listFollows, removeFollow } from "./follows.js";
import { BOT_COMMANDS } from "../src/shared/discord.js";
import { eventChoices, eventLookup, predictLookup, rankChoices, rankingsLookup, site, teamLookup } from "./lookups.js";
import { isEnabled } from "../server/flags.js";
import { featureOffMessage } from "../src/shared/flags.js";
import { ask as askSearch, chatPost, realAskDeps, type AskDeps, type AskReply } from "./ask.js";
import { takeChat, type Quota } from "./quota.js";
import { keep as keepThread, learn as learnMemory, recall as recallMemory, teamsAsked, thread as readThread } from "./memory.js";
import { fileReport, wantsReport, type Filed, type Report } from "./report.js";
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";

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
  /** /ask and a mention: Bruno's chat reply, else the website's search answer (bot/ask.ts); `history`: the reply
   *  thread before it; `memory`: the server's own lines for the chat (bot/memory.ts). */
  ask: (question: string, history?: BrunoChatTurn[], memory?: string[]) => Promise<AskReply>;
  /** What a server teaches the bot (bot/memory.ts); absent: nothing is remembered. */
  memory?: Memory;
  /** Files a "Report this to ControlScout" as a GitHub issue (bot/report.ts); absent: reporting is off. */
  report?: (r: Report) => Promise<Filed>;
  /** /config: what this bot can do here, gathered the same way its startup log gathers it (bot/config.ts), for the
   *  server it was asked in (its chat limit belongs to that server); absent: said as unreadable rather than failing.
   *  Private: the handler defers it ephemerally. */
  config?: (guild: string | null) => Promise<APIEmbed>;
  /** The owner's feature toggles the bot follows (server/flags.ts); absent: always on. */
  enabled?: (flag: "discordBot" | "livePredictions") => Promise<boolean>;
  /** The server's chat limit (bot/quota.ts): every server has the default, unless its own row replaced it; absent: none
   *  enforced. */
  quota?: (guild: string) => Promise<Quota>;
}

/** What a server teaches the bot, as the handler uses it (bot/memory.ts keeps it in the database). */
export interface Memory {
  /** The server's remembered teams, most asked first, and the name this person goes by there. */
  recall: (guild: string, user: string) => Promise<{ teams: number[]; name: string | null }>;
  /** Remember this ask: the asker's name and the teams it named. */
  learn: (guild: string, user: string, name: string | null, teams: number[]) => Promise<void>;
  /** A reply thread's turns, by the id of the answer that started it (kept past a restart). */
  thread: (root: string) => Promise<BrunoChatTurn[]>;
  /** Keep a reply thread's last turns, in its server, so it can be forgotten with the rest of that server's data. */
  keep: (root: string, turns: BrunoChatTurn[], guild: string | null) => Promise<void>;
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
  ask: async (question, history, memory) => askSearch(question, await (askDeps ??= realAskDeps()), site(), history, memory),
  enabled: (flag) => isEnabled(flag),
  quota: takeChat,
  memory: { recall: recallMemory, learn: learnMemory, thread: readThread, keep: keepThread },
  report: fileReport,
};
let askDeps: Promise<AskDeps> | undefined;

/** What every command answers while the owner has the bot switched off (the discordBot feature toggle). */
export const BOT_OFF_TITLE = "Turned off for now";

/** Filed: where the report is, and what went with it (bot/report.ts). */
export function reportedEmbed(r: { number: number; url: string }): APIEmbed {
  return {
    title: "Reported",
    description: `Filed as [Discord type issue #${r.number}](${r.url}), with the message, the thread before it and my last log lines. Thanks — that's the whole report, no form to fill in.`,
    color: VOLT, footer: FOOTER,
  };
}

/** A server that has reached its chat limit (bot/quota.ts): said plainly, with when it resets. Nothing else stops. */
export function limitEmbed(q: { limited: "hour" | "day"; retryAfter: number }): APIEmbed {
  const mins = Math.max(1, Math.ceil(q.retryAfter / 60));
  const wait = q.limited === "hour"
    ? `${mins} minute${mins === 1 ? "" : "s"}`
    : `${Math.max(1, Math.ceil(mins / 60))} hour${Math.ceil(mins / 60) === 1 ? "" : "s"}`;
  return {
    title: "This server's limit is reached",
    description: `Control Scout answers a set number of chats in this server each ${q.limited}. The next one resets in ${wait}. Everything on controlscout.org still works, and this server's follow posts keep coming.`,
    color: VOLT, footer: FOOTER,
  };
}

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

/** Turns of a reply thread Bruno sees, at most (Control Point's cap), and the threads remembered. */
export const THREAD_TURNS = 6;
const THREADS_MAX = 2000;
const TURN_MAX = 600;
const turn = (role: BrunoChatTurn["role"], text: string): BrunoChatTurn => ({ role, text: text.trim().replace(/\s+/g, " ").slice(0, TURN_MAX) });

/** An answer pings nobody: not the asker, not @everyone, a role or a person named in Bruno's text. */
export const NO_PINGS = { parse: [] as never[], repliedUser: false };

/** What one answer posts: Bruno's chat reply as text, or the card (with its video link as the text). */
export interface AskPost { content?: string; embeds: APIEmbed[] }

/** The command and its arguments as one line, for the cache key and the log. */
export function describe(i: Pick<ChatInputCommandInteraction, "commandName" | "options">): string {
  const args = i.options.data.map((o) => `${o.name}=${String(o.value ?? "").trim().toUpperCase().slice(0, 100)}`).sort();
  return [`/${i.commandName}`, ...args].join(" ");
}

/** The bot's own log lines a report carries (bot/report.ts): enough to see what it did for the message, no more. */
export const REPORT_LOG_LINES = 20;

/** A report already filed for the same words in the same server, and when: a second "report this" answers the same
 *  issue rather than opening another. */
const REPORT_REPEAT_MS = 10 * 60_000;

export function createHandler(log: Log, lookups: Lookups = realLookups, opts: { ttlMs?: number } = {}) {
  // The last lines of the bot's own log, kept for a report: "Report this to ControlScout" files them with the issue.
  const recentLogs: string[] = [];
  const logLine: Log = (m) => { recentLogs.push(m); if (recentLogs.length > REPORT_LOG_LINES) recentLogs.shift(); log(m); };
  const filed = new Map<string, { at: number; number: number; url: string }>();
  // Reports being filed right now, by the same key: a second ask waits for the first instead of opening an issue too.
  const filing = new Map<string, Promise<Filed>>();
  const cache = new AnswerCache<APIEmbed>(opts.ttlMs ?? 60_000, 2000, (e) => e instanceof Friendly);
  // Nobody is paced per person: every message is answered (a person asking twice in a row gets both answers). Only the
  // same question within a minute is the answer already given, whoever asks.
  const asks = new AnswerCache<AskReply>(opts.ttlMs ?? 60_000, 2000);
  // The server's chat limit (bot/quota.ts): every server has the default cap, and a read that fails allows the chat —
  // a database blip must never silence the bot.
  const quota = lookups.quota;
  const mayChat = async (guild: string | null | undefined): Promise<Quota> =>
    !guild || !quota ? { ok: true } : quota(guild).catch((): Quota => ({ ok: true }));

  /**
   * /ask and a mention, logged with the question and how it was answered (never who asked). Cached by the whole
   * question (the log line's key is cut at 100 characters; two long questions alike that far are still two
   * questions), the same for /ask and a mention, whatever its case or spacing, and by the thread before it: a
   * follow-up in a thread is its own question.
   */
  async function askReply(question: string, key: string, history: BrunoChatTurn[] = [], memory: string[] = []): Promise<AskReply> {
    const t0 = Date.now();
    let fresh = false;
    // The server's own lines are part of the key: two servers asking the same thing get different answers.
    const k = [question, ...history.map((t) => `${t.role}:${t.text}`), ...memory].join("\u0000").trim().replace(/\s+/g, " ").toUpperCase();
    const r = await asks.get(k, () => { fresh = true; return lookups.ask(question, history, memory); });
    // The bot's own fallback (bot/smallTalk.ts) is a chat too, but not Bruno's: the log says `talk`.
    const bruno = [r.chat?.by === "scout" ? "talk" : r.meta.chat ? "chat" : null, r.meta.refined ? "rewrite" : null, r.meta.sentence ? "sentence" : null].filter(Boolean).join("+") || "no";
    logLine(`${key} step=${r.meta.step} bruno=${bruno}${history.length ? ` thread=${history.length}` : ""}${r.content || r.chat?.video ? " video" : ""} ${fresh ? "" : "cached "}${Date.now() - t0}ms`);
    return r;
  }
  /** An answer as a post: Bruno's chat reply as text, else the card with its video link as the text. `quote`: show the
   *  question (a slash command's reply doesn't; a reply to a message already does). */
  const askPost = (question: string, r: AskReply, quote: boolean): AskPost =>
    r.chat ? { content: chatPost(question, r.chat, { quote }), embeds: [] } : { ...(r.content ? { content: r.content } : {}), embeds: [pride(r.embed)] };
  /** The thread a post of the bot's carries on, by its message id: every turn up to and including that answer. */
  const threads = new Map<string, BrunoChatTurn[]>();
  /** A thread's turns: from this process' cache, else from the server's memory (a reply to an answer from before a restart). */
  async function historyFor(root: string): Promise<BrunoChatTurn[]> {
    const cached = threads.get(root);
    if (cached) return cached;
    const kept = lookups.memory ? await lookups.memory.thread(root).catch(() => []) : [];
    if (kept.length) threads.set(root, kept);
    return kept;
  }
  function remember(id: string | undefined, history: BrunoChatTurn[], question: string, r: AskReply, guild: string | null) {
    // The bot's own words aren't his: a reply to the fallback starts a new thread instead of handing the model turns
    // it never said (bot/smallTalk.ts).
    if (!id || !r.chat || r.chat.by === "scout") return;
    const turns = [...history, turn("user", question), turn("bruno", r.chat.text)].slice(-THREAD_TURNS);
    if (threads.size >= THREADS_MAX) threads.delete(threads.keys().next().value!);
    threads.set(id, turns);
    // Kept past a restart (bot/memory.ts), so a reply to an answer from before a deploy still carries the thread on.
    void lookups.memory?.keep(id, turns, guild).catch(() => {});
  }
  /** The server's own lines for a chat: the teams it asks about and the name the asker goes by there (bot/memory.ts). */
  async function serverLines(guild: string | null | undefined, user: string | null | undefined): Promise<string[]> {
    if (!guild || !user || !lookups.memory) return [];
    const m = await lookups.memory.recall(guild, user).catch(() => null);
    if (!m) return [];
    return [
      m.teams.length ? `This server asks about teams ${m.teams.join(", ")} most: when a question doesn't name a team, it means one of these, and say which one you picked.` : "",
      m.name ? `The person asking goes by ${m.name} here.` : "",
    ].filter(Boolean);
  }
  /**
   * "Report this to ControlScout": file one GitHub issue with what the bot can see (bot/report.ts) and say where it is,
   * or say plainly that it couldn't. `key` identifies the thing reported — its message, in its channel — so the same
   * message never files twice (a repeat, a second mention while the first is still being filed) while two members'
   * different reports are two issues.
   */
  async function reportIt(key: string, where: Omit<Report, "message" | "thread" | "logs">, q: string, thread: BrunoChatTurn[], post: (e: APIEmbed) => Promise<unknown>): Promise<void> {
    const at = Date.now();
    const already = filed.get(key);
    if (already && at - already.at < REPORT_REPEAT_MS) {
      await post(reportedEmbed(already));
      return;
    }
    // The same report asked for twice at once: both get the one issue (the promise is shared, not just its result).
    let flight = filing.get(key);
    if (!flight) {
      flight = lookups.report!({ ...where, message: q, thread, logs: [...recentLogs] }).catch((): Filed => ({ ok: false, reason: "the report failed" }));
      filing.set(key, flight);
      void flight.finally(() => { if (filing.get(key) === flight) filing.delete(key); });
    }
    const r = await flight;
    if (!r.ok) {
      logLine(`report failed: ${r.reason}`);
      await post(r.limited
        ? errorEmbed("That's a lot of reports", "This person or server has asked for a few this hour. Try again later, or report it on controlscout.org.")
        : errorEmbed("Couldn't file that report", "Something on my side stopped the report from reaching GitHub. Try again in a moment, or report it on controlscout.org."));
      return;
    }
    if (filed.size > 200) filed.clear();
    filed.set(key, { at, number: r.number, url: r.url });
    logLine(`report filed: #${r.number} guild=${where.guild ?? "-"}`);
    await post(reportedEmbed(r));
  }
  /** Remember what this ask taught the server: the asker's name and the teams the message named (bot/memory.ts). */
  function learnAsk(guild: string | null | undefined, user: string, name: string | null, q: string): void {
    if (!guild || !lookups.memory) return;
    void lookups.memory.learn(guild, user, name, teamsAsked(q)).catch(() => {});
  }

  function answer(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const key = describe(i);
    switch (i.commandName) {
      case "team": return cache.get(key, () => lookups.team(i.options.getInteger("number", true)));
      case "predict": return predict(i, key);
      case "event": return cache.get(key, () => lookups.event(i.options.getString("code", true)));
      case "rankings": return cache.get(key, () => lookups.rankings());
      case "help": return Promise.resolve(helpEmbed());
      case "config":
        return lookups.config
          ? lookups.config(i.guildId)
          : Promise.reject(new Friendly("Couldn't read the config", "This bot couldn't read its own setup just now. Try again in a moment."));
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
    
    // /config answers privately: it describes this bot's own setup, which a channel doesn't need to read.
    await i.deferReply(i.commandName === "config" ? { flags: MessageFlags.Ephemeral } : undefined);
    if (i.commandName === "ask") {
      const question = i.options.getString("question", true);
      // The server's chat limit (bot/quota.ts): said plainly, before any lookup.
      const over = await mayChat(i.guildId);
      if (!over.ok) { await i.editReply({ embeds: [pride(limitEmbed(over))] }); return; }
      // "Report this to ControlScout" in /ask: the same report a mention files (bot/report.ts), before the chat limit —
      // a report is not a chat, and a server at its cap should still be able to report a bug.
      if (lookups.report && wantsReport(question)) {
        const key = `${i.guildId ?? ""}|${i.channelId ?? ""}|${i.user.id}|${question.trim().toLowerCase()}`;
        await reportIt(key, { guild: i.guildId, channel: i.channelId, user: i.user.id, name: i.user.globalName ?? i.user.username ?? null }, question, [],
          async (embed) => i.editReply({ embeds: [pride(embed)] }));
        return;
      }
      // What this server has taught the bot (bot/memory.ts): its lines for this chat, then what this question adds.
      const lines = await serverLines(i.guildId, i.user.id);
      learnAsk(i.guildId, i.user.id, i.user.globalName ?? i.user.username ?? null, question);
      let post: AskPost;
      let r: AskReply | undefined;
      try {
        r = await askReply(question, describe(i), [], lines);
        post = askPost(question, r, true);
      } catch (e) {
        logLine(`${describe(i)} failed: ${(e as Error)?.message ?? String(e)}`);
        post = { embeds: [pride(unavailableEmbed())] };
      }
      const sent = await i.editReply({ ...post, allowedMentions: NO_PINGS });
      if (r) remember((sent as { id?: string } | undefined)?.id, [], question, r, i.guildId);
      return;
    }
    let embed: APIEmbed;
    try {
      embed = await answer(i);
    } catch (e) {
      if (e instanceof Friendly) embed = errorEmbed(e.title, e.detail);
      else {
        logLine(`${describe(i)} failed: ${(e as Error)?.message ?? String(e)}`);
        embed = unavailableEmbed();
      }
    }
    await i.editReply({ embeds: [pride(embed)] });
  }

  async function autocomplete(i: AutocompleteInteraction): Promise<void> {
    let list: { name: string; value: string }[] = [];
    try {
      if (lookups.enabled && !(await lookups.enabled("discordBot"))) { await i.respond([]); return; }
      list = await lookups.choices(String(i.options.getFocused() ?? ""));
    } catch (e) {
      logLine(`autocomplete /${i.commandName} failed: ${(e as Error)?.message ?? String(e)}`);
    }
    await i.respond(list.slice(0, 25));
  }

  /**
   * "@Control Scout who won decode", or a reply to one of its answers: a chat with Bruno (the same answer as /ask,
   * same cache, same 3-second pace), as a reply. A reply to his answer carries the thread on: he sees the turns
   * before it. Only a message from a person in a server that @mentions the bot itself or replies to its post:
   * never its own or another bot's, never @everyone or a role. Discord sends the text of a message that mentions
   * the bot without the privileged Message Content intent, so the bot never reads anything else (a reply that
   * arrives without its text is left alone).
   */
  async function mention(m: MentionMessage, botId: string): Promise<void> {
    try {
      if (m.author.bot || !m.guildId) return;
      const replyTo = m.reference?.messageId && m.mentions?.repliedUser?.id === botId ? m.reference.messageId : null;
      if (!new RegExp(`<@!?${botId}>`).test(m.content) && !(replyTo && m.content.trim())) return;
      const q = m.content.replace(/<@[!&]?\d+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      const history = replyTo ? await historyFor(replyTo) : [];
      // Nobody is pinged by an answer (his text could name @everyone, a role or a person), reply or not.
      const send = (post: AskPost) => m.reply({ ...post, allowedMentions: NO_PINGS })
        // No Read Message History in that channel: a plain message instead of a reply.
        .catch(() => m.channel.send?.({ ...post, allowedMentions: NO_PINGS }));
      const card = (embed: APIEmbed) => send({ embeds: [pride(embed)] });
      if (lookups.enabled && !(await lookups.enabled("discordBot"))) {
        await card(errorEmbed(BOT_OFF_TITLE, "Control Scout's Discord bot is turned off by the owner right now. Everything on controlscout.org still works, and this server's follows are kept for when it's back."));
        return;
      }
      if (!q) {
        await card({ title: "Ask me anything", description: "Write your question after the mention, like the website's search box:\n`@Control Scout who won decode` · `@Control Scout 4215 vs 6980`\nOr use `/ask question:`. Reply to my answer to keep talking.", color: VOLT, footer: FOOTER });
        return;
      }
      // "Report this to ControlScout": a GitHub issue with the message, the thread before it and the bot's log lines.
      // Before the chat limit: a report is not a chat, and a server at its cap should still be able to report a bug.
      if (lookups.report && wantsReport(q)) {
        // Its key is the message itself in its channel: one report per message, never a merged one for two members.
        const key = `${m.guildId ?? ""}|${m.channelId ?? ""}|${m.id ?? ""}|${replyTo ?? ""}`;
        await reportIt(key, { guild: m.guildId, channel: m.channelId ?? null, user: m.author.id, name: m.author.globalName ?? m.author.username ?? null }, q, history, card);
        return;
      }
      // The server's chat limit, if one is set (none is, today): said in the channel, before the typing indicator goes up.
      // After the bare-mention help: that asks nothing of Control Scout, so it never uses a chat.
      const over = await mayChat(m.guildId);
      if (!over.ok) { await card(limitEmbed(over)); return; }
      // What this server has taught the bot (bot/memory.ts): its lines for this chat, then what this message adds.
      const lines = await serverLines(m.guildId, m.author.id);
      learnAsk(m.guildId, m.author.id, m.author.globalName ?? m.author.username ?? null, q);
      // Typing lasts about 10 s and a model reply can take 45: keep it up while the chat is written.
      void m.channel.sendTyping?.().catch(() => {});
      const typing = setInterval(() => { void m.channel.sendTyping?.().catch(() => {}); }, 8_000);
      typing.unref?.();
      let r: AskReply;
      try {
        r = await askReply(q, `@mention question=${q.toUpperCase().slice(0, 100)}`, history, lines);
      } catch (e) {
        clearInterval(typing);
        logLine(`@mention ask failed: ${(e as Error)?.message ?? String(e)}`);
        await card(unavailableEmbed());
        return;
      }
      clearInterval(typing);
      // The reply quotes the message it answers: no need to repeat the question.
      const sent = await send(askPost(q, r, false));
      remember((sent as { id?: string } | undefined)?.id, history, q, r, m.guildId ?? null);
    } catch (e) {
      logLine(`mention failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async function handle(i: Interaction): Promise<void> {
    try {
      if (i.isChatInputCommand()) await command(i);
      else if (i.isAutocomplete()) await autocomplete(i);
    } catch (e) {
      // Discord itself failed (the interaction expired, the network dropped): log it and stay up.
      logLine(`interaction failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }
  return Object.assign(handle, { mention });
}

/** The parts of a discord.js Message a mention answer uses (a stand-in in tests). */
export interface MentionMessage {
  /** `globalName`/`username`: what Discord calls the person (the server's nickname is `displayName` there); remembered
   *  by the server's memory so an answer can use it. */
  author: { id: string; bot: boolean; globalName?: string | null; username?: string };
  guildId: string | null;
  /** The channel's id: a report says where it happened (bot/report.ts). */
  channelId?: string | null;
  /** The message's id: a report is filed once per message, however often it is asked for. */
  id?: string;
  content: string;
  /** The message it replies to, and that message's author. */
  reference?: { messageId?: string } | null;
  mentions?: { repliedUser?: { id: string } | null };
  reply: (opts: { content?: string; embeds: APIEmbed[]; allowedMentions: { parse: never[]; repliedUser: boolean } }) => Promise<unknown>;
  channel: { send?: (opts: { content?: string; embeds: APIEmbed[]; allowedMentions: { parse: never[]; repliedUser: boolean } }) => Promise<unknown>; sendTyping?: () => Promise<unknown> };
}
