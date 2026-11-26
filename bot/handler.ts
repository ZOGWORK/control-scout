// Interactions in, embeds out. Every command answers: the reply is deferred before any lookup (Discord
// allows 3 seconds for a first response; a cold event can take longer), and every failure becomes a
// friendly embed, logged here with the command and its arguments. Autocomplete answers from a cached
// event list and never throws.
import { ComponentType, MessageFlags, PermissionFlagsBits, TextInputStyle, type APIActionRowComponent, type APIButtonComponent, type APIEmbed, type AutocompleteInteraction, type ButtonInteraction, type ChatInputCommandInteraction, type Interaction, type ModalSubmitInteraction } from "discord.js";
import { AnswerCache } from "./guard.js";
import { FOOTER, Friendly, VOLT, errorEmbed, pride, unavailableEmbed } from "./views.js";
import { addFollow, followName, followingEmbed, listFollows, removeFollow, type FollowTarget } from "./follows.js";
import { REPORT_PREFIX, answerComponents, buttonQuestion, dbButtonStore, QuestionButtons } from "./buttons.js";
import { DEFAULT_SETTINGS, answerField, guildSettings, parseQuiet, parseStyle, setGuildSettings, settingsEmbed, styleLine, type GuildSettings, type GuildSettingsPatch } from "./settings.js";
import { paceEmbed, takePersonChat, type Pace } from "./pacing.js";
import { answerRow as answerRowOf, markReported, trackAnswer, type AnswerRow } from "./reactions.js";
import { noteAsk, type AskRecord } from "./asks.js";
import { SORRY_SENTENCE } from "../src/shared/search.js";
import { BOT_COMMANDS } from "../src/shared/discord.js";
import { eventChoices, eventCode, eventLookup, nextLookup, predictLookup, rankChoices, rankTeamChoices, rankingsLookup, site, teamChoices, teamLookup } from "./lookups.js";
import { isEnabled } from "../server/flags.js";
import { featureOffMessage } from "../src/shared/flags.js";
import { ask as askSearch, chatPost, offeredQuestion, realAskDeps, recordsTurn, type AskDeps, type AskReply } from "./ask.js";
import { takeChat, type Quota } from "./quota.js";
import { channelSubject as readChannelSubject, keep as keepThread, keepChannelSubject, learn as learnMemory, recall as recallMemory, teamsAsked, thread as readThread } from "./memory.js";
import { subjectKept } from "./subject.js";
import { fileReport, noteReport as postReportNote, wantsReport, type Filed, type Report } from "./report.js";
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";

export type Log = (m: string) => void;

export interface Lookups {
  team: (n: number) => Promise<APIEmbed>;
  /** /next: a team's next unplayed match, with its call (bot/lookups.ts). */
  next: (n: number) => Promise<APIEmbed>;
  predict: (event: string, match: number) => Promise<APIEmbed>;
  event: (code: string) => Promise<APIEmbed>;
  /** An event's code from what someone typed: its code (any case) or its exact name, for `/follow event:` typed by
   *  hand rather than picked from autocomplete. Absent: the text is taken as a code. */
  eventCode?: (input: string) => Promise<string>;
  rankings: () => Promise<APIEmbed>;
  choices: (typed: string) => Promise<{ name: string; value: string }[]>;
  /** Team choices for autocomplete, by number or name: the option is an integer, so the value is the number as text. */
  teamChoices?: (typed: string) => Promise<{ name: string; value: string }[]>;
  /** What one server asked of its follow posts (/settings, bot/settings.ts); absent: the defaults. */
  settings?: (guild: string) => Promise<GuildSettings>;
  saveSettings?: (guild: string, s: GuildSettingsPatch, by: string | null) => Promise<void>;
  /** One person's pace in one server (bot/pacing.ts): six a minute, thirty an hour. Absent: nobody is paced. */
  pace?: (guild: string, user: string) => Promise<Pace>;
  follow: (guild: string, channel: string, target: FollowTarget, by: string) => Promise<"added" | "already">;
  unfollow: (guild: string, target: FollowTarget, channel?: string | null) => Promise<number>;
  following: (guild: string) => Promise<APIEmbed>;
  /** /ask and a mention: Bruno's chat reply, else the website's search answer (bot/ask.ts); `history`: the reply
   *  thread before it; `memory`: the server's own lines for the chat (bot/memory.ts); `guild`: the server it was asked
   *  in (never who asked), for the site's failed-search queue; `channelSubject`: what the channel was asking about lately,
   *  for a message outside a reply thread. */
  ask: (question: string, history?: BrunoChatTurn[], memory?: string[], guild?: string | null, channelSubject?: string | null) => Promise<AskReply>;
  /** Every ask, for the owner console (bot/asks.ts): the words, the step, who answered, how long. */
  noteAsk?: (r: AskRecord) => Promise<void>;
  /** An answer the bot posted, with the question it answered (bot/reactions.ts): the row says what the answer was for,
   *  so a 👎 on it can report that question. Nothing is added to the answer itself. */
  trackAnswer?: (messageId: string, guild: string | null, question?: string, meta?: { source: string | null; step: string | null; ms: number | null }) => Promise<void>;
  /** The row for a message the bot posted, or null (bot/reactions.ts): a 👎 only reports a message that has one, so a
   *  reaction on somebody else's message files nothing. */
  answerRow?: (messageId: string) => Promise<AnswerRow | null>;
  /** Keeps the issue a 👎 on an answer opened, on the answer's row (bot/reactions.ts): a second 👎 later, or after a
   *  restart, answers with that issue instead of filing a duplicate. */
  rememberReport?: (messageId: string, issue: { number: number; url: string }) => Promise<void>;
  /** A comment on an issue a 👎 already opened, when somebody else reports the same answer (bot/report.ts): triage sees
   *  that more than one person hit it. */
  noteReport?: (number: number, n: { user: string; name: string | null; guild: string | null; messageId?: string | null }) => Promise<boolean>;
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
  /** The server's chat limit (bot/quota.ts): no cap by default, unless its own row gives it one; absent: none
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
  /** What a channel was asking about lately, for a follow-up that isn't in a reply thread: null when nothing recent. */
  channel: (channel: string) => Promise<string | null>;
  /** Keep what a channel is asking about now, in its server, so it can be forgotten with the rest of its data. */
  keepChannel: (channel: string, subject: string, guild: string | null) => Promise<void>;
}

export const realLookups: Lookups = {
  team: teamLookup,
  next: nextLookup,
  predict: predictLookup,
  event: eventLookup,
  eventCode,
  rankings: () => rankingsLookup(),
  choices: async (typed) => rankChoices(await eventChoices(), typed),
  teamChoices: async (typed) => rankTeamChoices(await teamChoices(), typed),
  settings: guildSettings,
  saveSettings: (guild, s, by) => setGuildSettings(guild, s, by),
  pace: takePersonChat,
  follow: addFollow,
  unfollow: removeFollow,
  following: async (guild) => followingEmbed(await listFollows(guild), site()),
  ask: async (question, history, memory, guild, channelSubject) => askSearch(question, await (askDeps ??= realAskDeps()), site(), history, memory, guild ?? null, channelSubject ?? null),
  noteAsk: (r) => noteAsk(r),
  trackAnswer: (id, guild, question, meta) => trackAnswer(id, guild, question, meta),
  answerRow: (id) => answerRowOf(id),
  rememberReport: (id, issue) => markReported(id, issue),
  noteReport: (n, r) => postReportNote(n, r),
  enabled: (flag) => isEnabled(flag),
  quota: takeChat,
  memory: { recall: recallMemory, learn: learnMemory, thread: readThread, keep: keepThread, channel: readChannelSubject, keepChannel: keepChannelSubject },
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

/** The name Discord shows for a person in a server: their nickname there, else their global display name, else their
 *  username (the @handle). `member.displayName` is discord.js's own answer — nickname first — and a raw member (an
 *  interaction's, before the guild is cached) only carries `nick`, so both are read. The name is what an answer calls
 *  them ("your name is …"), so it has to be the one their friends see, not the handle. */
export function shownName(
  user: { globalName?: string | null; username?: string | null },
  member?: { displayName?: string | null; nick?: string | null } | null,
): string | null {
  const named = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return named(member?.displayName) ?? named(member?.nick) ?? named(user.globalName) ?? named(user.username);
}

/** What this server shows for them, or `null` when the payload didn't carry their membership (the guild isn't cached):
 *  without it the only name known is Discord's global one, and writing that over a nickname already remembered would
 *  make every later answer wrong. */
function serverName(
  user: { globalName?: string | null; username?: string | null },
  member?: { displayName?: string | null; nick?: string | null } | null,
): string | null {
  return member ? shownName(user, member) : null;
}

/** Turns of a reply thread Bruno sees, at most (Control Point's cap), and the threads remembered. */
export const THREAD_TURNS = 6;
const THREADS_MAX = 2000;
const TURN_MAX = 600;
const turn = (role: BrunoChatTurn["role"], text: string): BrunoChatTurn => ({ role, text: text.trim().replace(/\s+/g, " ").slice(0, TURN_MAX) });

/** Bruno's turn as the thread keeps it: clipped to the thread's cap, but never losing the question he ended with
 *  ("… Also want 4215's record?") — a "yes" reply asks it (bot/ask.ts), and the offer sits at the end, where a plain
 *  clip cuts first. */
const brunoTurn = (text: string): BrunoChatTurn => {
  const kept = turn("bruno", text);
  const offer = offeredQuestion([{ role: "bruno", text }]);
  // The clipped head may mention the same record without asking about it: the sentence is what a "yes" needs.
  if (!offer || offeredQuestion([{ role: "bruno", text: kept.text }]) === offer) return kept;
  const tail = ` Also want ${offer}?`;
  return turn("bruno", `${kept.text.slice(0, Math.max(0, TURN_MAX - tail.length - 1))}…${tail}`);
};

/** An answer pings nobody: not the asker, not @everyone, a role or a person named in Bruno's text. */
export const NO_PINGS = { parse: [] as never[], repliedUser: false };

/** What a 👎 report says in place of the question when the answer predates answers keeping one (migration 105): the
 *  issue still shows the answer, just not what it was asked. */
export const QUESTION_UNRECORDED = "The question this answer was written for wasn't recorded (the answer predates answers keeping it).";

/** One of the bot's answers, as a reaction carries it: enough to reply under it and say what it said. */
export interface AnswerMessage {
  id: string;
  guildId?: string | null;
  channelId?: string | null;
  /** Discord sent only this message's id (an answer from before the last restart), so the report has to fetch it first. */
  partial?: boolean;
  fetch?: () => Promise<AnswerMessage>;
  /** The answer's text, which the report shows as its own turn. */
  content?: string | null;
  reply?: (opts: { embeds: APIEmbed[]; allowedMentions: { parse: never[]; repliedUser: boolean } }) => Promise<unknown>;
  channel?: { send?: (opts: { embeds: APIEmbed[]; allowedMentions: { parse: never[]; repliedUser: boolean } }) => Promise<unknown> };
}

/** The person who 👎'd an answer: their Discord id, never an email, and the name Discord shows them by there. */
export interface Reporter {
  id: string;
  bot?: boolean;
  globalName?: string | null;
  username?: string | null;
  /** Their nickname in that server, when the reaction carries their membership (it usually does). */
  displayName?: string | null;
}

/** The answer's buttons (bot/buttons.ts): a row of questions, a row of links. */
export type AnswerComponents = APIActionRowComponent<APIButtonComponent>[];

/** What one answer posts: Bruno's chat reply as text (with the records card beside it when the site's search found
 *  some), or the card (with its video link as the text), and its buttons. */
export interface AskPost { content?: string; embeds: APIEmbed[]; components?: AnswerComponents }

/** Whether an answer answered: a card, a stat, or Bruno's own words. The bot's "I couldn't" fallback (by: "scout") and
 *  a sorry card are the two that didn't, and a decline did (its words are the bot's, but it handled what was asked);
 *  the owner console counts them (bot/asks.ts). */
export const answered = (r: AskReply): boolean => (r.chat ? r.chat.by !== "scout" || !!r.declined : r.embed.title !== SORRY_SENTENCE);

/** The question a post quotes and its thread keeps: what a yes asked, or what a no declined — never the word alone. */
const quoted = (q: string, r: AskReply) => r.resolved ?? r.declined ?? q;

/** /compare's question: the two teams as search reads a head-to-head ("4215 vs 6980"), so the answer is the site's
 *  compare card rather than a command of its own. */
const compareQuestion = (i: ChatInputCommandInteraction) => `${i.options.getInteger("team", true)} vs ${i.options.getInteger("other", true)}`;

/** The command and its arguments as one line, for the cache key and the log. */
export function describe(i: Pick<ChatInputCommandInteraction, "commandName" | "options">): string {
  const args = i.options.data.map((o) => `${o.name}=${String(o.value ?? "").trim().toUpperCase().slice(0, 100)}`).sort();
  return [`/${i.commandName}`, ...args].join(" ");
}

/** The bot's own log lines a report carries (bot/report.ts): enough to see what it did for the message, no more. */
export const REPORT_LOG_LINES = 20;

/** The custom id of the modal an answer's "Something's wrong" button opens (bot/buttons.ts). */
export const REPORT_MODAL = "report:answer";

/** A report already filed for the same words in the same server, and when: a second "report this" answers the same
 *  issue rather than opening another. */
const REPORT_REPEAT_MS = 10 * 60_000;
/** How often a second 👎 on the same answer may add a comment to its issue: enough to show the report is shared, not a
 *  feed a busy channel can write. */
const REPORT_NOTE_MS = 3600_000;

export function createHandler(log: Log, lookups: Lookups = realLookups, opts: { ttlMs?: number } = {}) {
  // The last lines of the bot's own log, kept for a report: "Report this to ControlScout" files them with the issue.
  const recentLogs: string[] = [];
  const logLine: Log = (m) => { recentLogs.push(m); if (recentLogs.length > REPORT_LOG_LINES) recentLogs.shift(); log(m); };
  const filed = new Map<string, { at: number; number: number; url: string }>();
  // When each answer's issue last got a "someone else reported this too" comment (bot/report.ts noteReport).
  const noted = new Map<string, number>();
  // Reports being filed right now, by the same key: a second ask waits for the first instead of opening an issue too.
  const filing = new Map<string, Promise<Filed>>();
  const cache = new AnswerCache<APIEmbed>(opts.ttlMs ?? 60_000, 2000, (e) => e instanceof Friendly);
  // Nobody is paced per person: every message is answered (a person asking twice in a row gets both answers). Only the
  // same question within a minute is the answer already given, whoever asks.
  const asks = new AnswerCache<AskReply>(opts.ttlMs ?? 60_000, 2000);
  // The questions behind the answers' buttons (bot/buttons.ts): kept in the database, so they work after a restart.
  const buttons = new QuestionButtons(dbButtonStore());
  // The server's chat limit (bot/quota.ts): the default ceiling unless the server has its own row, and a read that
  // fails allows the chat — a database blip must never silence the bot.
  const quota = lookups.quota;
  const mayChat = async (guild: string | null | undefined): Promise<Quota> =>
    !guild || !quota ? { ok: true } : quota(guild).catch((): Quota => ({ ok: true }));
  // This person's pace in this server (bot/pacing.ts). A read that fails allows the chat, like the server cap does.
  const mayPace = async (guild: string | null | undefined, user: string | null | undefined): Promise<Pace> =>
    !guild || !user || !lookups.pace ? { ok: true } : lookups.pace(guild, user).catch((): Pace => ({ ok: true }));

  /**
   * /ask and a mention, logged with the question and how it was answered (never who asked). Cached by the whole
   * question (the log line's key is cut at 100 characters; two long questions alike that far are still two
   * questions), the same for /ask and a mention, whatever its case or spacing, and by the thread before it: a
   * follow-up in a thread is its own question.
   */
  async function askReply(question: string, key: string, history: BrunoChatTurn[] = [], memory: string[] = [], guild: string | null = null, channelSubject: string | null = null): Promise<AskReply> {
    const t0 = Date.now();
    let fresh = false;
    // The server's own lines are part of the key, and so is the channel's subject: two servers asking the same thing get
    // different answers, and two channels whose follow-ups mean different teams get their own.
    const k = [question, channelSubject ?? "", ...history.map((t) => `${t.role}:${t.text}`), ...memory].join("\u0000").trim().replace(/\s+/g, " ").toUpperCase();
    const r = await asks.get(k, () => { fresh = true; return lookups.ask(question, history, memory, guild, channelSubject); });
    const ms = Date.now() - t0;
    // Kept on the answer's meta so its row (and a 👎 report) can say how long it took.
    r.meta.ms = ms;
    // What the bot was asked (bot/asks.ts), once per question rather than once per reader: a cached repeat is the same
    // ask. Never who asked, never awaited, never able to fail an answer.
    if (fresh && lookups.noteAsk) {
      // "Bruno answered" means his chat did: the bot's own smallTalk fallback (`by: "scout"`) is a chat too, but it
      // isn't Bruno's, and counting it would put that share above the answered one.
      const brunoChat = r.meta.chat === true && r.chat?.by !== "scout";
      void lookups.noteAsk({ question, step: r.meta.step, chat: brunoChat, answered: answered(r), ms, guild }).catch(() => {});
    }
    // The bot's own fallback (bot/smallTalk.ts) is a chat too, but not Bruno's: the log says `talk`.
    const bruno = [r.chat?.by === "scout" ? "talk" : r.meta.chat ? "chat" : null, r.meta.refined ? "rewrite" : null, r.meta.sentence ? "sentence" : null].filter(Boolean).join("+") || "no";
    logLine(`${key} step=${r.meta.step} bruno=${bruno}${history.length ? ` thread=${history.length}` : ""}${r.content || r.chat?.video ? " video" : ""} ${fresh ? "" : "cached "}${ms}ms`);
    return r;
  }
  /** An answer as a post: Bruno's chat reply as text — with the records card beside it when search found the records
   *  the answer is about (`card`) — else the card with its video link as the text, and its buttons (bot/buttons.ts).
   *  `quote`: show the question (a slash command's reply doesn't; a reply to a message already does). */
  const configUnreadable = (): APIEmbed => ({
    title: "What this bot can do here",
    description: "This bot couldn't read its own setup just now. Try again in a moment.",
    color: VOLT,
    footer: FOOTER,
  });
  /** How a server asked its answers to read (/config): videos and follow-up suggestions, per server. */
  async function prefsFor(guild: string | null | undefined): Promise<GuildSettings> {
    return guild && lookups.settings ? lookups.settings(guild).catch(() => DEFAULT_SETTINGS) : DEFAULT_SETTINGS;
  }
  /** The line under an answer saying what it checked: the searches behind it, and the parts they couldn't answer. */
  const checkLine = (c: AskReply["checked"]): string => {
    if (!c) return "";
    const searches = c.searches === 1 ? "1 search" : `${c.searches} searches`;
    const missed = c.unanswered.length ? ` · couldn't check: ${c.unanswered.slice(0, 2).map((q) => q.trim().slice(0, 40)).join(", ")}` : "";
    return `✓ Checked ${searches} against Control Scout${missed}`;
  };
  const askPost = async (question: string, r: AskReply, quote: boolean, guild: string | null = null, prefs: GuildSettings = DEFAULT_SETTINGS): Promise<AskPost> => {
    // The server's own answer settings: videos off drops the clips and their links, extras off drops the next questions
    // (never the website link or the report button). A copy, since the answer itself is cached and shared.
    const shown: AskReply = {
      ...r,
      ...(prefs.extras ? {} : { next: [] }),
      ...(prefs.videos ? {} : { watch: [], content: undefined, chat: r.chat ? { ...r.chat, video: undefined } : undefined }),
    };
    // A server that turned videos off asked for no clips: a request for videos there isn't a failed lookup, so it isn't
    // reported as one.
    const checkedMeta = shown.checked
      ? { ...shown.checked, unanswered: prefs.videos ? shown.checked.unanswered : shown.checked.unanswered.filter((u) => u !== "videos") }
      : undefined;
    const check = checkLine(checkedMeta);
    const embed = shown.embed;
    const checked = check
      ? { ...embed, footer: { ...(embed.footer ?? FOOTER), text: `${embed.footer?.text ?? FOOTER.text} · ${check}` } }
      : embed;
    // The check line rides under the text, inside Discord's 2,000 characters: the answer is cut instead of the post
    // being refused.
    const withCheck = (text: string) => {
      const tail = check ? `\n-# ${check}` : "";
      return `${text.slice(0, 2000 - tail.length)}${tail}`;
    };
    const components = await answerComponents(shown, buttons, Date.now(), guild);
    const post: AskPost = shown.chat
      ? { content: withCheck(chatPost(question, shown.chat, { quote })), embeds: shown.chat.card && shown.chat.by !== "scout" ? [pride(embed)] : [] }
      : { ...(shown.content ? { content: withCheck(shown.content) } : {}), embeds: [pride(checked)] };
    return components.length ? { ...post, components } : post;
  };
  /** An answer's row, with the question it answered (bot/reactions.ts): a 👎 on the answer later reports that question.
   *  Nothing is added to the post — there is no emoji on it any more — and a stand-in without a row changes nothing. */
  function keepAnswer(sent: unknown, guild: string | null, question: string, r?: AskReply): void {
    const m = sent as { id?: string } | undefined;
    if (!m?.id) return;
    // What answered: his chat, the bot's own fallback, or the search card. A report says which, so triage knows where
    // to look first.
    const meta = r
      ? { source: r.chat ? (r.chat.by === "scout" ? "scout" : "bruno") : "card", step: r.meta.step ?? null, ms: r.meta.ms ?? null }
      : null;
    void Promise.resolve(lookups.trackAnswer?.(m.id, guild, question, meta ?? undefined)).catch(() => {});
  }
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
    // it never said (bot/smallTalk.ts). A decline is the bot's too, but it answered a question of his — the thread
    // stays as it was, so the "say the word" it offers is a yes to the decline's own post, answered as his question.
    if (!id || !r.chat) return;
    const own = r.chat.by === "scout";
    if (own && !r.declined) return;
    const turns = (own ? history : [...history, turn("user", question), brunoTurn(r.chat.text)]).slice(-THREAD_TURNS);
    if (threads.size >= THREADS_MAX) threads.delete(threads.keys().next().value!);
    threads.set(id, turns);
    // Kept past a restart (bot/memory.ts), so a reply to an answer from before a deploy still carries the thread on.
    void lookups.memory?.keep(id, turns, guild).catch(() => {});
  }
  /** The server's own lines for a chat: the teams it asks about and the name the asker goes by there (bot/memory.ts). */
  async function serverLines(guild: string | null | undefined, user: string | null | undefined, name?: string | null): Promise<string[]> {
    // A server is what makes these lines mean anything: "goes by … here" is about that server's members.
    if (!guild || !user) return [];
    const m = lookups.memory ? await lookups.memory.recall(guild, user).catch(() => null) : null;
    // The name Discord shows now, not the one first remembered: a nickname or a display name changes, and an answer to
    // "what is my name?" has to be the name their friends see today. A failed read still has the name the message
    // itself carried.
    const who = name ?? m?.name ?? null;
    return [
      m?.teams.length ? `This server asks about teams ${m.teams.join(", ")} most: when a question doesn't name a team, it means one of these, and say which one you picked.` : "",
      who ? `The person asking goes by ${who} here.` : "",
    ].filter(Boolean);
  }
  /**
   * "Report this to ControlScout": file one GitHub issue with what the bot can see (bot/report.ts) and say where it is,
   * or say plainly that it couldn't. `key` identifies the thing reported — its message, in its channel — so the same
   * message never files twice (a repeat, a second mention while the first is still being filed) while two members'
   * different reports are two issues.
   */
  async function reportIt(key: string, where: Omit<Report, "message" | "thread" | "logs">, q: string, thread: BrunoChatTurn[], post: (e: APIEmbed) => Promise<unknown>): Promise<Filed | null> {
    const at = Date.now();
    const already = filed.get(key);
    if (already && at - already.at < REPORT_REPEAT_MS) {
      await post(reportedEmbed(already));
      return null;
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
      return null;
    }
    if (filed.size > 200) filed.clear();
    filed.set(key, { at, number: r.number, url: r.url });
    logLine(`report filed: #${r.number} guild=${where.guild ?? "-"}`);
    // The issue exists now, so a reply that fails must not look like a filing that failed: a 👎 keeps the number on the
    // answer's row next, and a caller that never learned it would let a later 👎 file a duplicate.
    await post(reportedEmbed(r)).catch((e) => logLine(`report filed #${r.number} but couldn't say so: ${(e as Error)?.message ?? String(e)}`));
    return r;
  }
  /** Remember what this ask taught the server: the asker's name and the teams the message named (bot/memory.ts). */
  function learnAsk(guild: string | null | undefined, user: string, name: string | null, q: string): void {
    if (!guild || !lookups.memory) return;
    void lookups.memory.learn(guild, user, name, teamsAsked(q)).catch(() => {});
  }
  /** What this channel was asking about lately — for a message that isn't a reply to one of the bot's answers, where the
   *  reply thread's own subject is the one that counts (bot/subject.ts). Null when there's nothing recent, no memory to
   *  read, or no channel to read it for. */
  async function channelSubjectFor(channel: string | null | undefined, history: BrunoChatTurn[]): Promise<string | null> {
    if (!channel || history.length || !lookups.memory) return null;
    return lookups.memory.channel(channel).catch(() => null);
  }
  /** Leave this question as what the channel is talking about: its words, when it asked about the records without only
   *  looking back at them, so the channel's next "their record?" means this one (bot/memory.ts). */
  function keepChannel(channel: string | null | undefined, q: string, guild: string | null | undefined): void {
    if (!channel || !lookups.memory) return;
    const subject = subjectKept(q, recordsTurn);
    if (subject) void lookups.memory.keepChannel(channel, subject, guild ?? null).catch(() => {});
  }

  function answer(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const key = describe(i);
    switch (i.commandName) {
      case "team": return cache.get(key, () => lookups.team(i.options.getInteger("number", true)));
      case "next": return live(i, key, () => lookups.next(i.options.getInteger("team", true)));
      case "predict": return live(i, key, () => lookups.predict(i.options.getString("event", true), i.options.getInteger("match", true)));
      case "event": return cache.get(key, () => lookups.event(i.options.getString("code", true)));
      case "rankings": return cache.get(key, () => lookups.rankings());
      case "help": return Promise.resolve(helpEmbed());
      case "config": return configCommand(i);
      case "follow": case "unfollow": case "following": return manage(i);
      case "settings": return serverSettings(i);
      default: return Promise.reject(new Friendly("Unknown command", "This command isn't one Control Scout knows. Try /help for the list."));
    }
  }

  /** /predict and /next, unless the owner switched live predictions off (the livePredictions feature toggle): both show
   *  a match's call, so neither may post one while it is off. */
  async function live(i: ChatInputCommandInteraction, key: string, run: () => Promise<APIEmbed>): Promise<APIEmbed> {
    if (lookups.enabled && !(await lookups.enabled("livePredictions"))) throw new Friendly("Predictions are off", featureOffMessage("livePredictions"));
    return cache.get(key, run);
  }

  /** The team or event a /follow or /unfollow names: exactly one of them, or a friendly error. An event is resolved
   *  from its code or its exact name, so `/follow event:Austin Qualifier` works typed by hand as well as picked. */
  async function followTarget(i: ChatInputCommandInteraction, keepStale = false): Promise<FollowTarget> {
    const team = i.options.getInteger("team");
    const event = (i.options.getString("event") ?? "").trim();
    if (team && event) throw new Friendly("One at a time", "Follow a team or an event, not both: `/follow team:4215` or `/follow event:USTXAUQ`.");
    if (team) return { kind: "team", team };
    if (!event) throw new Friendly("Team or event?", "Say what to follow: `/follow team:4215` for a team's matches, or `/follow event:USTXAUQ` for a whole event.");
    if (!lookups.eventCode) return { kind: "event", event: event.toUpperCase() };
    try {
      return { kind: "event", event: await lookups.eventCode(event) };
    } catch (e) {
      // Unfollowing takes what was typed as a code too: a follow from an earlier season is no longer in the event list,
      // and it must still be possible to stop it.
      // Only "no such event": a database failure must say so rather than report a follow that never stopped.
      if (keepStale && e instanceof Friendly && e.title === "Event not found") return { kind: "event", event: event.toUpperCase() };
      throw e;
    }
  }

  /** The server's follows: never cached (they change), and only inside a server. */
  async function manage(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const guild = i.guildId;
    if (!guild) throw new Friendly("Servers only", "Follows belong to a server: use this in one of its channels.");
    if (i.commandName === "following") return lookups.following(guild);
    const target = await followTarget(i, i.commandName === "unfollow");
    const name = followName(target);
    const picked = i.options.getChannel("channel")?.id ?? null;
    const where = picked ? ` in <#${picked}>` : "";
    if (i.commandName === "unfollow") {
      const n = await lookups.unfollow(guild, target, picked);
      if (!n) throw new Friendly("Not following", `This server doesn't follow ${name}${where}.`);
      return { title: `Stopped following ${name}`, description: `No more automatic posts for **${name}**${where}.`, color: VOLT, footer: FOOTER };
    }
    const channel = picked ?? i.channelId;
    if (!channel) throw new Friendly("Pick a channel", `Say where to post: /follow ${target.kind === "team" ? `team:${target.team}` : `event:${target.event}`} channel:#scouting.`);
    if (!canPost(i, channel)) throw new Friendly("Can't post there", `Control Scout needs View Channel, Send Messages and Embed Links in <#${channel}>. Give its role those, or pick another channel.`);
    const r = await lookups.follow(guild, channel, target, i.user.id);
    return {
      title: r === "added" ? `Following ${name}` : `Already following ${name}`,
      description: target.kind === "team"
        ? `<#${channel}> gets posts for **${target.team}**: the evening before each event, its schedule with win odds once posted, 15 minutes before each match, each result and whether the call was right, and a recap at the end of each day. Stop with /unfollow team:${target.team}.`
        : `<#${channel}> gets posts for **${target.event}**: the evening before it starts, its schedule once posted, and a recap at the end of each day. Stop with /unfollow event:${target.event}.`,
      color: VOLT,
      footer: FOOTER,
    };
  }

  /**
   * /settings (Manage Server): what this server asked of the bot's posts, and the one place it changes them
   * (bot/settings.ts). No option given shows them; any given changes that one. Quiet hours are UTC, since Discord gives
   * the bot no server time zone and a guessed one would silence the wrong hours.
   */
  /**
   * /config: what this bot can do here, and how this server asked its answers to read — style, follow-up suggestions
   * and videos, changed one at a time. No option given shows them; `reset` puts them back. Manage Server only, and
   * private, since it describes the bot's own setup rather than a channel's (the handler defers it ephemerally).
   */
  async function configCommand(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const guild = i.guildId;
    const base: APIEmbed = lookups.config
      ? await lookups.config(guild).catch(() => configUnreadable())
      : configUnreadable();
    if (!guild || !lookups.settings) return base;
    // Never with a default in place of an unreadable row: a change written against defaults would erase what is stored.
    let now: GuildSettings;
    try { now = await lookups.settings(guild); }
    catch { throw new Friendly("Couldn't read the settings", "This bot couldn't read its own settings just now, so it won't change them blind. Try again in a moment."); }
    const styleText = i.options.getString("style");
    const extras = i.options.getBoolean("extras");
    const videos = i.options.getBoolean("videos");
    const reset = i.options.getBoolean("reset") === true;
    // Nothing asked for: show the setup and how this server's answers read today.
    if (styleText == null && extras == null && videos == null && !reset) {
      return { ...base, fields: [...(base.fields ?? []), answerField(now)] };
    }
    let style = now.style;
    if (styleText != null) {
      const parsed = parseStyle(styleText);
      if ("problem" in parsed) throw new Friendly("Answer style?", parsed.problem);
      style = parsed.style;
    }
    const next = reset
      ? { ...now, style: "default" as const, extras: true, videos: true }
      : { ...now, style, extras: extras ?? now.extras, videos: videos ?? now.videos };
    if (!lookups.saveSettings) throw new Friendly("Couldn't save the settings", "This bot couldn't save its settings just now. Try again in a moment.");
    // Only the answers' settings: the posts' (quiet hours, reminders, ping role) are /settings', and a stale or failed
    // read above must never write them back as defaults.
    await lookups.saveSettings(guild, { style: next.style, extras: next.extras, videos: next.videos }, i.user.id);
    // What was written is what this server now has: a write that failed threw, and re-reading would only add a second
    // read that a database blip could make disagree with the save that succeeded.
    const saved = next;
    return {
      ...base,
      description: `${base.description ?? ""}\n\n**Saved.** Answers here read ${saved.style === "default" ? "the default way" : `\`${saved.style}\``}${saved.extras ? ", with follow-up suggestions" : ", with no follow-up suggestions"}${saved.videos ? " and clips" : " and no clips"}.`,
      fields: [...(base.fields ?? []), answerField(saved)],
    };
  }

  async function serverSettings(i: ChatInputCommandInteraction): Promise<APIEmbed> {
    const guild = i.guildId;
    if (!guild) throw new Friendly("Servers only", "Post settings belong to a server: use this in one of its channels.");
    if (!lookups.settings) throw new Friendly("Couldn't read the settings", "This bot couldn't read its own settings just now. Try again in a moment.");
    const now = await lookups.settings(guild);
    const quietText = i.options.getString("quiet_hours");
    const reminders = i.options.getBoolean("reminders");
    const roleText = (i.options.getString("ping_role") ?? "").trim();
    // Nothing asked for: just show the settings as they are.
    if (quietText == null && reminders == null && !roleText) return settingsEmbed(now, guild);
    let quiet = now.quiet;
    if (quietText != null) {
      const parsed = parseQuiet(quietText);
      if ("problem" in parsed) throw new Friendly("Quiet hours?", parsed.problem);
      quiet = parsed.quiet;
    }
    let pingRole = now.pingRole;
    if (roleText) {
      if (/^(none|off|no)$/i.test(roleText)) pingRole = null;
      else {
        const m = /^(?:<@&)?(\d{15,22})>?$/.exec(roleText);
        if (!m) throw new Friendly("Which role?", "Give a role as a mention (`@Scouts`) or its id, or `none` to ping nobody.");
        // @everyone's role id is the server's own id, and `<@&server>` pings everyone: never accept it as "a role".
        if (m[1] === guild) throw new Friendly("Which role?", "That's this server's @everyone role. Name the role to ping, or `none` to ping nobody.");
        pingRole = m[1];
      }
    }
    if (!lookups.saveSettings) throw new Friendly("Couldn't save the settings", "This bot couldn't save its settings just now. Try again in a moment.");
    await lookups.saveSettings(guild, { quiet, reminders: reminders ?? now.reminders, pingRole }, i.user.id);
    return settingsEmbed(await lookups.settings(guild), guild);
  }

  async function command(i: ChatInputCommandInteraction): Promise<void> {
    // Switched off by the owner: a short, private note for whoever asked, and nothing else runs (follows are kept).
    if (lookups.enabled && !(await lookups.enabled("discordBot"))) {
      await i.reply({ embeds: [pride(errorEmbed(BOT_OFF_TITLE, "Control Scout's Discord bot is turned off by the owner right now. Everything on controlscout.org still works, and this server's follows are kept for when it's back."))], flags: MessageFlags.Ephemeral });
      return;
    }
    
    // /config answers privately: it describes this bot's own setup, which a channel doesn't need to read.
    // /config and /settings answer privately: both describe this bot's setup, which a channel doesn't need to read.
    await i.deferReply(i.commandName === "config" || i.commandName === "settings" ? { flags: MessageFlags.Ephemeral } : undefined);
    if (i.commandName === "ask" || i.commandName === "compare") {
      const question = i.commandName === "ask" ? i.options.getString("question", true) : compareQuestion(i);
      // A team compared with itself answers nothing: say so instead of asking search for it.
      if (i.commandName === "compare" && i.options.getInteger("team", true) === i.options.getInteger("other", true)) {
        await i.editReply({ embeds: [pride(errorEmbed("Two teams, please", "Pick two different numbers: `/compare team:4215 other:6980`."))] });
        return;
      }
      // This person's own pace (bot/pacing.ts) before the server's cap (bot/quota.ts): a chat the pace refuses never
      // happened, so it must not spend a slot of the server's allowance. Either is said plainly, before any lookup.
      const fast = await mayPace(i.guildId, i.user.id);
      if (!fast.ok) { await i.editReply({ embeds: [pride({ ...paceEmbed(fast), color: VOLT, footer: FOOTER })] }); return; }
      const over = await mayChat(i.guildId);
      if (!over.ok) { await i.editReply({ embeds: [pride(limitEmbed(over))] }); return; }
      // "Report this to ControlScout" in /ask: the same report a mention files (bot/report.ts), before the chat limit —
      // a report is not a chat, and a server at its cap should still be able to report a bug.
      if (lookups.report && wantsReport(question)) {
        const key = `${i.guildId ?? ""}|${i.channelId ?? ""}|${i.user.id}|${question.trim().toLowerCase()}`;
        await reportIt(key, { guild: i.guildId, channel: i.channelId, user: i.user.id, name: shownName(i.user, i.member) }, question, [],
          async (embed) => i.editReply({ embeds: [pride(embed)] }));
        return;
      }
      // What this server has taught the bot (bot/memory.ts): its lines for this chat, then what this question adds.
      const name = serverName(i.user, i.member);
      const prefs = await prefsFor(i.guildId);
      // The server's own answer style rides with the chat's lines: it shapes the reply and is part of the cache key.
      const lines = [...await serverLines(i.guildId, i.user.id, name), styleLine(prefs)].filter(Boolean);
      learnAsk(i.guildId, i.user.id, name, question);
      let post: AskPost;
      let r: AskReply | undefined;
      try {
        // /ask is never in a reply thread: what the channel was asking about lately is what a follow-up in it means.
        r = await askReply(question, describe(i), [], lines, i.guildId, await channelSubjectFor(i.channelId, []));
        // What was asked when a yes — or a no — answered the question Bruno offered (bot/ask.ts): the reply quotes
        // that, not the word.
        post = await askPost(quoted(question, r), r, true, i.guildId, prefs);
      } catch (e) {
        logLine(`${describe(i)} failed: ${(e as Error)?.message ?? String(e)}`);
        post = { embeds: [pride(unavailableEmbed())] };
      }
      const sent = await i.editReply({ ...post, allowedMentions: NO_PINGS });
      // Only an answer gets a row: the failure notice above is not one.
      if (r) {
        remember((sent as { id?: string } | undefined)?.id, [], quoted(question, r), r, i.guildId);
        keepChannel(i.channelId, question, i.guildId);
        keepAnswer(sent, i.guildId ?? null, quoted(question, r), r);
      }
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
      // A team option answers with teams (by number or name); every other autocompleted option is an event.
      const focused = i.options.getFocused(true) as { name: string; value: string | number };
      const typed = String(focused.value ?? "");
      const teamOption = focused.name === "number" || focused.name === "team" || focused.name === "other";
      list = teamOption
        ? await (lookups.teamChoices ?? (async () => []))(typed)
        : await lookups.choices(typed);
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
   * arrives without its text is left alone). `ambient`: a message in the server's #ask-control-scout channel, where
   * no mention is needed (bot/ambient.ts); the channel check and the intent are bot/index.ts's.
   */
  async function mention(m: MentionMessage, botId: string, ambient = false): Promise<void> {
    try {
      if (m.author.bot || !m.guildId) return;
      const replyTo = m.reference?.messageId && m.mentions?.repliedUser?.id === botId ? m.reference.messageId : null;
      // Ambient: a message in the server's #ask-control-scout channel, which is the opt-in (bot/ambient.ts). Everything
      // else still has to mention the bot or reply to one of its answers.
      if (!ambient && !new RegExp(`<@!?${botId}>`).test(m.content) && !(replyTo && m.content.trim())) return;
      // A command-looking line in the ask channel is somebody else's command, not a question for Control Scout.
      if (ambient && /^[/!]/.test(m.content.trim())) return;
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
        await reportIt(key, { guild: m.guildId, channel: m.channelId ?? null, user: m.author.id, name: shownName(m.author, m.member) }, q, history, card);
        return;
      }
      // The server's chat limit, if one is set (none is, today): said in the channel, before the typing indicator goes up.
      // After the bare-mention help: that asks nothing of Control Scout, so it never uses a chat.
      // The pace first: a chat it refuses must not spend a slot of the server's own allowance.
      const fast = await mayPace(m.guildId, m.author.id);
      if (!fast.ok) { await card({ ...paceEmbed(fast), color: VOLT, footer: FOOTER }); return; }
      const over = await mayChat(m.guildId);
      if (!over.ok) { await card(limitEmbed(over)); return; }
      // What this server has taught the bot (bot/memory.ts): its lines for this chat, then what this message adds.
      const name = serverName(m.author, m.member);
      const prefs = await prefsFor(m.guildId);
      const lines = [...await serverLines(m.guildId, m.author.id, name), styleLine(prefs)].filter(Boolean);
      learnAsk(m.guildId, m.author.id, name, q);
      // Typing lasts about 10 s and a model reply can take 45: keep it up while the chat is written.
      void m.channel.sendTyping?.().catch(() => {});
      const typing = setInterval(() => { void m.channel.sendTyping?.().catch(() => {}); }, 8_000);
      typing.unref?.();
      // A reply to one of his answers leans on that thread; anything else in the channel leans on what the channel was
      // asking about last (bot/memory.ts). Read once, after the server's own lines, before any model call.
      const channelSubject = await channelSubjectFor(m.channelId, history);
      let r: AskReply;
      try {
        r = await askReply(q, `${ambient ? "#ask" : "@mention"} question=${q.toUpperCase().slice(0, 100)}`, history, lines, m.guildId ?? null, channelSubject);
      } catch (e) {
        clearInterval(typing);
        logLine(`@mention ask failed: ${(e as Error)?.message ?? String(e)}`);
        await card(unavailableEmbed());
        return;
      }
      clearInterval(typing);
      // The reply quotes the message it answers: no need to repeat the question (a "yes" becomes the question it
      // answered, so the thread carries on from 4215's record rather than from the word).
      const sent = await send(await askPost(quoted(q, r), r, false, m.guildId ?? null, prefs));
      remember((sent as { id?: string } | undefined)?.id, history, quoted(q, r), r, m.guildId ?? null);
      keepChannel(m.channelId, q, m.guildId);
      keepAnswer(sent, m.guildId ?? null, quoted(q, r), r);
    } catch (e) {
      logLine(`mention failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  /**
   * A 👎 on one of its answers, added on purpose: that is a report, so it is filed as a GitHub issue with the question
   * the answer was written for and the answer's own words (bot/report.ts), and the person is told where it is. Only a
   * message the bot posted has a row, so a 👎 anywhere else files nothing; the issue is kept on that row and in memory,
   * so a second 👎 on it answers the same issue rather than opening another. Never throws.
   */
  async function downvoted(answer: AnswerMessage, reporter: Reporter): Promise<void> {
    try {
      if (reporter.bot || !answer?.id || !lookups.report) return;
      // Discord sends only an id for a message it has no copy of: fetched here, so the issue carries the answer's words.
      const whole = answer.partial && answer.fetch ? await answer.fetch().catch(() => answer) : answer;
      const row = await lookups.answerRow?.(whole.id).catch(() => null);
      if (!row) return;
      // Under the answer, where the 👎 was; a message it can't reply to falls back to its channel, and neither is worth
      // failing a report over.
      const post = async (embed: APIEmbed): Promise<unknown> => {
        const payload = { embeds: [pride(embed)], allowedMentions: NO_PINGS };
        const replied = whole.reply?.(payload);
        return replied ? replied.catch(() => whole.channel?.send?.(payload)) : whole.channel?.send?.(payload);
      };
      // One issue per answer, kept on its row: a 👎 a day later, or after a restart, points at the issue the first one
      // filed instead of opening a duplicate (an hour's memory alone would forget it, bot/report.ts's limits aside).
      if (row.report) {
        // Somebody else already reported this answer: say where, and (at most hourly) note it on the issue, so triage
        // sees how many people hit it.
        if (Date.now() - (noted.get(whole.id) ?? 0) > REPORT_NOTE_MS) {
          noted.set(whole.id, Date.now());
          if (noted.size > 500) noted.clear();
          void lookups.noteReport?.(row.report.number, {
            user: reporter.id,
            name: shownName(reporter, { displayName: reporter.displayName ?? null }),
            guild: whole.guildId ?? null,
            messageId: whole.id,
          }).catch(() => {});
        }
        await post(reportedEmbed(row.report));
        return;
      }
      const said = (whole.content ?? "").trim();
      const about = {
        source: row.source, step: row.step, ms: row.ms,
        url: whole.guildId && whole.channelId ? `https://discord.com/channels/${whole.guildId}/${whole.channelId}/${whole.id}` : null,
      };
      const opened = await reportIt(`answer:${whole.id}`,
        { guild: whole.guildId ?? null, channel: whole.channelId ?? null, user: reporter.id, name: shownName(reporter, { displayName: reporter.displayName ?? null }), answer: about },
        row.question ?? QUESTION_UNRECORDED, said ? [turn("bruno", said)] : [], post);
      if (opened?.ok) {
        // The issue is filed either way; if the row can't keep it, a later 👎 may file the same report again, so it is
        // said (the in-memory map only covers the next ten minutes).
        await Promise.resolve(lookups.rememberReport?.(whole.id, opened)).catch((e) =>
          logLine(`downvote: filed #${opened.number} but couldn't keep it on the answer (${(e as Error)?.message ?? String(e)}); a later 👎 may file it again`));
      }
    } catch (e) {
      logLine(`downvote failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  /**
   * A button under an answer (bot/buttons.ts): the question it offers, asked as /ask would, in the channel. The answer
   * is public (a button is a quicker way to ask, not a private one), and a button older than an hour says so instead of
   * guessing: its question lived in this process, so a restart ends it too.
   */
  async function pressed(i: ButtonInteraction): Promise<void> {
    if (lookups.enabled && !(await lookups.enabled("discordBot"))) {
      await i.reply({ embeds: [pride(errorEmbed(BOT_OFF_TITLE, "Control Scout's Discord bot is turned off by the owner right now. Everything on controlscout.org still works."))], flags: MessageFlags.Ephemeral });
      return;
    }
    // "Something's wrong" under an answer: a report of that answer, asked in a modal rather than in a phrase nobody
    // knows (bot/report.ts). It is not a chat, so it takes neither the server's cap nor the person's pace.
    if (i.customId.startsWith(REPORT_PREFIX)) { await reportQuestion(i); return; }
    const question = await buttonQuestion(buttons, i.customId);
    if (question === null) {
      await i.reply({ content: "That button's question isn't kept any more (it is from before this bot kept them). Ask it with `/ask question:`.", flags: MessageFlags.Ephemeral });
      return;
    }
    // The pace first: a button press it refuses must not spend a slot of the server's own allowance.
    const fast = await mayPace(i.guildId, i.user.id);
    if (!fast.ok) { await i.reply({ embeds: [pride({ ...paceEmbed(fast), color: VOLT, footer: FOOTER })], flags: MessageFlags.Ephemeral }); return; }
    const over = await mayChat(i.guildId);
    if (!over.ok) { await i.reply({ embeds: [pride(limitEmbed(over))], flags: MessageFlags.Ephemeral }); return; }
    await i.deferReply();
    const name = serverName(i.user, i.member);
    const prefs = await prefsFor(i.guildId);
    const lines = [...await serverLines(i.guildId, i.user.id, name), styleLine(prefs)].filter(Boolean);
    learnAsk(i.guildId, i.user.id, name, question);
    let post: AskPost;
    let r: AskReply | undefined;
    try {
              r = await askReply(question, `/ask question=${question.toUpperCase().slice(0, 100)}`, [], lines, i.guildId ?? null, await channelSubjectFor(i.channelId, []));
                post = await askPost(quoted(question, r), r, true, i.guildId ?? null, prefs);
      } catch (e) {
        logLine(`button ask failed: ${(e as Error)?.message ?? String(e)}`);
        post = { embeds: [pride(unavailableEmbed())] };
      }
      const sent = await i.editReply({ ...post, allowedMentions: NO_PINGS });
      // Only an answer gets a row: the failure notice above is not one.
      if (r) {
              remember((sent as { id?: string } | undefined)?.id, [], quoted(question, r), r, i.guildId ?? null);
      keepChannel(i.channelId, question, i.guildId);
      keepAnswer(sent, i.guildId ?? null, quoted(question, r), r);
    }
  }

  /** The modal behind an answer's "Something's wrong" button (bot/buttons.ts). */
  async function reportQuestion(i: ButtonInteraction): Promise<void> {
    if (!lookups.report) {
      await i.reply({ content: "Reporting isn't set up on this bot right now. Everything on controlscout.org still works.", flags: MessageFlags.Ephemeral });
      return;
    }
    await i.showModal({
      title: "Something's wrong",
      custom_id: REPORT_MODAL,
      components: [{
        type: ComponentType.ActionRow,
        components: [{
          type: ComponentType.TextInput, custom_id: "note", label: "What's wrong with this answer?",
          style: TextInputStyle.Paragraph, required: true, max_length: 500,
          placeholder: "A wrong number, a wrong team, out of date…",
        }],
      }],
    }).catch((e) => logLine(`report modal failed: ${(e as Error)?.message ?? String(e)}`));
  }

  /**
   * The report button's modal, filled in: the same issue a 👎 files (bot/report.ts), with the question the answer was
   * written for, what produced it, and what the person typed — so a wrong answer can be reported by the people who
   * notice it instead of only by someone who knows the report phrase.
   */
  async function reportSubmitted(i: ModalSubmitInteraction): Promise<void> {
    if (i.customId !== REPORT_MODAL) return;
    try {
      const raw = i.message;
      // Discord sends an id alone for a message it has no copy of (an answer from before the last restart).
      const whole = raw && raw.partial && raw.fetch ? await raw.fetch().catch(() => raw) : raw;
      const row = whole?.id ? await lookups.answerRow?.(whole.id).catch(() => null) : null;
      if (!whole?.id || !row) {
        await i.reply({ content: "That message isn't one of my answers, so there's nothing to report from it.", flags: MessageFlags.Ephemeral });
        return;
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      // Already reported (a 👎, or the button a moment ago): the same issue rather than another.
      if (row.report) { await i.editReply({ embeds: [pride(reportedEmbed(row.report))] }); return; }
      const note = i.fields.getTextInputValue("note").trim().slice(0, 500);
      const said = (whole.content ?? "").trim();
      const about = {
        source: row.source, step: row.step, ms: row.ms,
        url: whole.guildId && whole.channelId ? `https://discord.com/channels/${whole.guildId}/${whole.channelId}/${whole.id}` : null,
      };
      const opened = await reportIt(`answer:${whole.id}`,
        { guild: whole.guildId ?? null, channel: whole.channelId ?? null, user: i.user.id, name: shownName(i.user, i.member), answer: about, note },
        row.question ?? QUESTION_UNRECORDED, said ? [turn("bruno", said)] : [], (embed) => i.editReply({ embeds: [pride(embed)] }));
      if (opened?.ok) await Promise.resolve(lookups.rememberReport?.(whole.id, opened)).catch(() => {});
    } catch (e) {
      logLine(`report modal failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async function handle(i: Interaction): Promise<void> {
    try {
      if (i.isChatInputCommand()) await command(i);
      else if (i.isAutocomplete()) await autocomplete(i);
      else if (i.isButton()) await pressed(i);
      else if (i.isModalSubmit()) await reportSubmitted(i);
    } catch (e) {
      // Discord itself failed (the interaction expired, the network dropped): log it and stay up.
      logLine(`interaction failed: ${(e as Error)?.message ?? String(e)}`);
    }
  }
  return Object.assign(handle, { mention, downvoted, reportSubmitted });
}

/** The parts of a discord.js Message a mention answer uses (a stand-in in tests). */
export interface MentionMessage {
  /** `globalName`/`username`: what Discord calls the person; remembered by the server's memory so an answer can use it.
   *  The name the answer says is `shownName(author, member)`, which prefers the server's nickname. */
  author: { id: string; bot: boolean; globalName?: string | null; username?: string };
  /** The author's membership of this server, as the message carries it: its `displayName` (nickname first) is the name
   *  Discord shows. Absent when the guild isn't cached. */
  member?: { displayName?: string | null; nick?: string | null } | null;
  guildId: string | null;
  /** The channel's id: a report says where it happened (bot/report.ts). */
  channelId?: string | null;
  /** The message's id: a report is filed once per message, however often it is asked for. */
  id?: string;
  content: string;
  /** The message it replies to, and that message's author. */
  reference?: { messageId?: string } | null;
  mentions?: { repliedUser?: { id: string } | null };
  reply: (opts: { content?: string; embeds: APIEmbed[]; components?: AnswerComponents; allowedMentions: { parse: never[]; repliedUser: boolean } }) => Promise<unknown>;
  channel: { send?: (opts: { content?: string; embeds: APIEmbed[]; components?: AnswerComponents; allowedMentions: { parse: never[]; repliedUser: boolean } }) => Promise<unknown>; sendTyping?: () => Promise<unknown> };
}
