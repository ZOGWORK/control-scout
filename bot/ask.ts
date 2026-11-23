// /ask and a mention: a chat first, then the website's own search answer (docs/search.md) as one post.
//   1. searchAnswer(q, { learn: false })  the facts he reads, deterministic and always (learning off: a Discord ask
//                                         never teaches search). Its answer is also the card that stands in for him.
//      the bot's lookups (bot/tools.ts)  a message that asks several things ("best team rn, where are they from and
//                                         what's their auto opr") has each part searched on its own, and every part's
//                                         facts go with the message's — the tools an agent would call, run for him.
//   2. Bruno's chat                       whenever the chat is wired (discordBruno on and Control Point configured):
//                                         the message and the reply thread before it go to /internal/bruno/discord-chat
//                                         with search's facts, and his reply is the post: plain text like a chat, with the
//                                         records search found as the site's own card beside it (video and "ask next"
//                                         buttons included) when the facts answer it, and a link to the website.
//   3. refine(q) / brunoAnswer(q)         only when that chat gives nothing: search's own answer, with his rewrite of
//                                         a weak query and (older callers) his one sentence, as the website posts it.
// Every number in a post is search's own or passed the grounded check. The chat leads; a chat that's off,
// unconfigured, failing, slow or naming a number not in the facts falls back to the card, and says why in the log
// (`[bot] chat off: …`, `[bot] chat failed: …`), so a deployment can be diagnosed from the bot's journal.
//
// A question the bot couldn't answer that was about the records — a record number in it, or a records word with no build
// word in it — is also fed to the site's failed-search queue (server/searchFailures.ts, bot/asks.ts's recordsMiss), so
// the phrasings people use in Discord improve the website's search too: those words never reach the search box.
import type { APIEmbed } from "discord.js";
import type { SearchAnswer, SearchCardLine, SearchHit, SearchVideo } from "../src/shared/api.js";
import { watchUrl } from "../src/shared/recording.js";
import type { StatAnswer, StatBlock, StatLink, StatMatchRow } from "../src/shared/searchStat.js";
import { SEARCH_PAGE_LIMIT, SORRY_SENTENCE, hitHref } from "../src/shared/search.js";
import { FOOTER, VOLT, teamLink } from "./views.js";
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";
import { answerScope, answerStyle, brunoMethod, brunoPersona, productFacts, zogModeReply } from "./productFacts.js";
import { RECORD_NUMBER, WORKING, smallTalk } from "./smallTalk.js";
import { CHAT_OFF_SWITCH, CHAT_OFF_UNCONFIGURED } from "./chatState.js";
import { lookupFacts, splitAsk, type Lookup } from "./tools.js";

/** The credit an answer Bruno helped with carries, in the footer above Control Scout's own line. */
export const BRUNO_CREDIT = "Bruno AI, from Control Point";
/** Discord's caps: an embed's description, and all of one message's text. */
export const DESCRIPTION_MAX = 4096;
export const EMBED_MAX = 6000;
/** How much of an answer a reader sees in the channel (links counted as their text): a phone screen or so. The rest
 *  is one tap away on the website, so a long answer never becomes a wall in the channel. */
export const READ_MAX = 500;
/** What a reader sees of a line: a link's text, not its address. */
const readLen = (s: string) => s.replace(/\]\([^)]*\)/g, "]").length;
/** Rows of one list block shown before "…and N more on the website". */
const ROWS = 3;
/** Top results listed when the card doesn't already cover them. */
const HITS = 3;

export interface BrunoSentence { text: string; points: string[] }

/** What /ask needs from the site (the real functions in askDeps; stand-ins in tests). */
export interface AskDeps {
  search: (q: string) => Promise<SearchAnswer>;
  refine: (q: string) => Promise<SearchAnswer | null>;
  bruno: (q: string) => Promise<BrunoSentence | null>;
  /** The bot's own Bruno switch (discordBruno). The website's brunoSearch / brunoAnswers never affect /ask. */
  enabled: () => Promise<boolean>;
  available: () => boolean;
  /** The answer's match videos, as the website finds them (public ones only: never a video people added). */
  video?: (a: SearchAnswer) => Promise<SearchVideo | undefined>;
  /** Search's facts for an answer, as Bruno reads them (server/api/searchBrunoAnswer.ts answerFacts). */
  facts?: (a: SearchAnswer) => Promise<string[]>;
  /** Bruno's chat reply (Control Point's discord-chat), or null: off, unavailable, or a number not in the facts.
   *  `memory`: what the server has taught the bot (bot/memory.ts) — its teams, the asker's name — sent with the facts. */
  chat?: (message: string, facts: string[], history: BrunoChatTurn[], memory?: string[]) => Promise<ChatReply | null>;
  /** The facts of a message's parts, when it asks several things (bot/tools.ts): each part searched on its own, its
   *  facts returned with the site's own answer to the first part it could answer (never throws, never past the cap). */
  lookups?: (q: string) => Promise<Lookup>;
  /** A records question search couldn't answer: the site's failed-search queue (server/searchFailures.ts), given the
   *  answer and the server it was asked in (never who asked). Synchronous, never awaited, never throws. */
  miss?: (q: string, a: SearchAnswer, guild: string | null) => void;
}

/** Bruno's chat reply; `search`: the facts answer the message, so the answer's video and page go with it. `unknown`:
 *  numbers in his text that neither the facts, the message nor the thread have — a record claim in a records answer,
 *  an explanation's own numbers in a chat (see ask, below). */
export interface ChatReply { text: string; search: boolean; unknown?: string[] }
/** Facts sent with a chat, at most (Control Point's caps: 40 lines of at most 400 characters, 8,000 in all). One
 *  longer line and it refuses the whole packet with a 400, so every line is cut to its cap (clip, below). */
const CHAT_FACTS = 40;
const CHAT_FACTS_CHARS = 7500;
const CHAT_FACT_CHARS = 400;

/** What one ask did, for the log (never who asked). */
export interface AskMeta { step: SearchAnswer["step"]; refined: boolean; sentence: boolean; chat?: boolean }
/**
 * `content`: the main video's YouTube link as the message's text, so Discord shows it as a player under the answer.
 * `chat`: a chat reply, posted as text (chatPost); `card`: post `embed` with it too, when the records search found for
 * the message (or the part of it that answered) stand beside his words. `by`: whose words they are — Bruno's, or the
 * bot's own when it answers a greeting without a model (bot/smallTalk.ts). `next`: the questions the answer offers as
 * buttons (bot/buttons.ts); `watch`: the videos, as link buttons.
 */
export interface AskReply { embed: APIEmbed; meta: AskMeta; content?: string;   chat?: { text: string; video?: string; page?: string; card?: boolean; by?: "bruno" | "scout" }; next?: string[]; watch?: { label: string; url: string }[];
  /** What was actually asked, when a yes answered the question Bruno offered ("yes" after "Also want 4215's record?"):
   *  the post quotes it and the thread keeps it, not the word "yes". */
  resolved?: string;
  /** The question a "no" declined: the bot says so in its own words, quoting what was turned down. Kept apart from
   *  `resolved` so a decline counts as handled and keeps the offer thread, while a scout fallback does neither. */
  declined?: string }

/** Whether an answer has records to show — a card, a stat or results, never the sorry a message-level search gives
 *  when it can't read the whole question. A chat beside no records posts its words alone. */
export const showsRecords = (a: SearchAnswer) =>
  !a.sorry && !(a.step === "recovery" && !a.card && !a.stat) && !!(a.card || a.stat || a.hits.length);

/** The words that say yes on their own. "Thanks" and "good" aren't here: neither answers an offer. */
const YES = new Set(["yes", "yeah", "yep", "yup", "yea", "ya", "sure", "ok", "okay", "absolutely", "definitely", "please", "pls"]);
/** The words that may ride along with one ("yes thanks", "ok then", "of course yes"); none of them is a yes alone, and
 *  "not" isn't one — "not sure", "definitely not" and "absolutely not" decline the offer. */
const YES_FILLER = new Set(["do", "it", "go", "ahead", "why", "sounds", "good", "thanks", "then", "of", "course"]);
/** A whole phrase that is a yes without one of YES. */
const YES_PHRASES = [/^(?:go ahead|do it|why not|sounds good|of course)$/];

/** A message that only says yes ("yes", "yeah please", "go ahead"): the answer to the question Bruno ended his last
 *  reply with, never a search of its own — searching "yes" answers with whatever team or name is nearest it. A
 *  message that merely thanks him or says "good" is not one. */
export function affirmative(q: string): boolean {
  // A number names a team ("yes 6980"): that's a question of its own, not a yes to the one he offered.
  if (/\d/.test(q)) return false;
  const said = q.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!said) return false;
  if (YES_PHRASES.some((re) => re.test(said))) return true;
  const words = said.split(" ");
  return words.some((w) => YES.has(w)) && words.every((w) => YES.has(w) || YES_FILLER.has(w));
}

/** What Bruno offers at the end of a turn: "…at the Bedford Qualifier. Also want 4215's record?" is "4215's record". */
const OFFER = /(?:also\s+)?(?:want|would you like|do you want|should i (?:get|pull|look up))\s+([^?.!\n]{2,80})\?/gi;

/** The question Bruno offered at the end of his last turn in the thread — the last one he asked — or null when he
 *  offered none. */
export function offeredQuestion(history: BrunoChatTurn[]): string | null {
  const said = [...history].reverse().find((t) => t.role === "bruno")?.text ?? "";
  // Read back from the end: a turn can make an offer and then end with another ("Want 1111's record? Also want 4215's
  // record?"), and a yes answers the last one.
  for (const sentence of said.split(/(?<=[.!?])\s+/).reverse()) {
    const found = [...sentence.matchAll(new RegExp(OFFER.source, "gi"))];
    if (found.length) return found.at(-1)![1].trim();
  }
  return null;
}

/** A whole message that declines the offer: "no", "no thanks", "not now", "maybe later". */
const NO_PHRASES = [
  /^(?:no|nope|nah|naw)$/, /^no (?:thanks|thank you)$/, /^not (?:right )?now$/, /^(?:maybe )?later$/, /^not today$/,
  /^(?:i'?m|im) (?:good|fine|ok|okay)(?: thanks| thank you)?$/, /^(?:we'?re|were) good(?: thanks)?$/, /^no need(?: thanks)?$/,
  /^don'?t bother$/, /^skip(?: it)?$/, /^pass$/,
];

/** Whether a message only declines the question Bruno offered: a decline answers it, while searching the word "no"
 *  answers with whatever team or person the index has nearest it, the way "yes" did. A no with a question after it
 *  ("no, what about 6980") asks that question, and "not sure" neither accepts nor declines. */
export function declined(q: string): boolean {
  if (/\d/.test(q)) return false;
  // A phone writes "I’m" and "don’t" with a curly apostrophe: read as the straight one, not as a space.
  const said = q.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();
  return !!said && NO_PHRASES.some((re) => re.test(said));
}

/** A no to the offer, said politely and left for later, with nothing searched. `by: "scout"`: the bot's own words, not
 *  a reply of Bruno's, so it is never remembered as one of his turns. */
function declinedReply(offer: string): AskReply {
  const text = `No problem — I'll leave ${offer} for now. Ask me anything else, or say the word and I'll pull it up.`;
  return {
    embed: { title: "No problem", description: text, color: VOLT, footer: FOOTER },
    meta: { step: "deterministic", refined: false, sentence: false, chat: true },
    chat: { text, by: "scout" },
    declined: offer,
  };
}

/** How long a chat waits for Bruno before the card posts instead. Generous: a model reply takes a while (Control
 *  Point's one-sentence answers take about 11 s on the live deployment, and a structured explanation of a few
 *  paragraphs takes longer), and the mention's typing indicator stays up while it's written. */
export const CHAT_TIMEOUT_MS = 45_000;

export async function realAskDeps(): Promise<AskDeps> {
  // The search index is the site's (it builds and refreshes it); the bot only reads it, like every other table but its own.
  const [{ searchAnswer }, { refine }, { brunoAnswer, answerFacts, ungrounded }, { isEnabled }, { brunoAvailable, brunoDiscordChat }, { noteBotSearch, outcomeTrace }] = await Promise.all([
    import("../server/api/searchAnswer.js"), import("../server/api/searchBruno.js"), import("../server/api/searchBrunoAnswer.js"),
    import("../server/flags.js"), import("../server/auth/controlPoint.js"), import("../server/searchFailures.js"),
  ]);
  const { answerVideo } = await import("../server/api/answers/video.js");
  return {
    search: (q) => searchAnswer(q, { learn: false, limit: SEARCH_PAGE_LIMIT }),
    refine: (q) => refine(q, { learn: false, limit: SEARCH_PAGE_LIMIT }, "discordBruno"),
    // /ask is a question however it's typed ("hi bruno", "4215 highlights"): asked as one, so Bruno writes the short answer.
    bruno: (q) => brunoAnswer(q.trim().endsWith("?") ? q : `${q.trim()}?`, { limit: SEARCH_PAGE_LIMIT, learn: false }, Date.now(), undefined, "discordBruno"),
    enabled: () => isEnabled("discordBruno").catch(() => false),
    available: brunoAvailable,
    // No viewer: only the site's own match clips and recordings, as a page drawn for everyone gets.
    video: (a) => answerVideo(a),
    facts: (a) => answerFacts(a),
    chat: async (message, facts, history, memory = []) => {
      // Why a chat didn't happen is logged (never the message or the key): a deployment is diagnosed from these lines.
      if (!brunoAvailable()) {
        console.info(`[bot] chat off: ${CHAT_OFF_UNCONFIGURED}`);
        return null;
      }
      if (!(await isEnabled("discordBruno").catch(() => false))) {
        console.info(`[bot] chat off: ${CHAT_OFF_SWITCH}`);
        return null;
      }
      // Product knowledge first, every line inside Control Point's per-fact cap: one longer line and it refuses the
      // whole packet (400 `facts[i]`), which used to fall back to the card with nothing in the log.
      const context = chatContext(facts, memory);
      let r: { text: string; search: boolean };
      try { r = await brunoDiscordChat(message, context, history, CHAT_TIMEOUT_MS); }
      catch (e) {
        // "Control Point answered 404", "timeout", a network error: enough to fix a deployment, and no secret in it.
        console.info(`[bot] chat failed: ${(e as Error)?.message ?? String(e)}`);
        return null;
      }
      if (!r || typeof r.text !== "string" || !r.text.trim()) { console.info("[bot] chat empty: Bruno sent no reply"); return null; }
      // Every number his must be the facts', the message's or the thread's — reported (never dropped here: ask knows
      // whether a number could be a record at all), so a reply the check does refuse is traced to the number that failed.
      const unknown = ungrounded(r.text, [...context, ...history.map((t) => t.text)], message);
      return { text: r.text.trim(), search: r.search === true, unknown };
    },
    // The bot's lookups (bot/tools.ts): a message asking several things has each part searched on its own, and every
    // part's facts go to him with the message's own. One part: nothing extra, since the message's facts are its own.
    lookups: async (q) => {
      const parts = splitAsk(q);
      if (parts.length < 2) return { facts: [] };
      return lookupFacts(parts, {
        search: (p) => searchAnswer(p, { learn: false, limit: SEARCH_PAGE_LIMIT }).catch(() => null),
        facts: (a) => answerFacts(a),
      });
    },
    // The site's own failed-search queue (server/searchFailures.ts): the words people actually use, which the website's
    // search box never sees. In-memory and synchronous; the bot flushes it once a minute (bot/index.ts). A failure here
    // never touches the answer: reporting is never on the path.
    miss: (q, a, guild) => {
      try { noteBotSearch(q, a, `discord:${guild ?? "dm"}`, outcomeTrace(a)); } catch { /* never breaks an answer */ }
    },
  };
}

/** What a chat is sent: who he is and how to work a question out (`brunoPersona`, `brunoMethod`), the product and
 *  answer guidance, what the server has taught the bot, then search's facts — every line inside Control Point's
 *  per-fact cap, and as many facts as its line and character caps leave room for. */
export const chatContext = (facts: string[], memory: string[] = []): string[] => {
  const head = [...productFacts(), brunoPersona(), brunoMethod(), answerStyle(), answerScope(), ...memory].map(clip);
  return [...head, ...fit(facts, CHAT_FACTS - head.length, CHAT_FACTS_CHARS - chars(head))];
};

/** The website's answer to `q`, with Bruno's help where the site would use it: his chat reply first (the reply
 *  thread before it in `history`), else the card. `memory`: the server's own lines for the chat (bot/memory.ts);
 *  `guild`: the server it was asked in (never who asked), for the site's failed-search queue. */
/**
 * /ask and a mention: the message's answer, with a "yes" to the question Bruno ended his last reply with asked as that
 * question (`resolved`: what was asked, so the post quotes it and the thread keeps it), never as the word "yes"; a
 * "no" to it declines it politely, with nothing searched.
 */
export async function ask(q: string, deps: AskDeps, site: string, history: BrunoChatTurn[] = [], memory: string[] = [], guild: string | null = null): Promise<AskReply> {
  const offered = offeredQuestion(history);
  if (offered && declined(q)) return declinedReply(offered);
  const subject = offered && affirmative(q) ? offered : null;
  const r = await answerAsk(subject ?? q, deps, site, history, memory, guild);
  return subject ? { ...r, resolved: subject } : r;
}

async function answerAsk(q: string, deps: AskDeps, site: string, history: BrunoChatTurn[], memory: string[], guild: string | null): Promise<AskReply> {
  const zog = zogModeReply(q);
  if (zog) return {
    embed: { title: "Zog Mode", description: zog, footer: FOOTER },
    meta: { step: "deterministic", refined: false, sentence: false },
  };
  let answer = await deps.search(q);
  // A number in the question, or anything found for it: a number in Bruno's reply could then be a record (asksRecords
  // below), and the question could be one search should learn from.
  const records = asksRecords(q, answer, history);
  // AI first: with the chat wired, the model answers the message before search's own rewrite is asked for. A chat
  // that's off, failed, timed out or named a number not in the facts is never followed by a second call to him for a
  // sentence; the deterministic answer then posts, bounded by the chat's own timeout.
  const chatting = !!(deps.chat && deps.facts);
  if (chatting) {
    const talked = await chatWith(q, answer, history, deps, memory).catch(() => null);
    const reply = talked?.reply ?? null;
    // His numbers are checked against the facts, the message and the thread — where a number could be a record: an
    // answer with records behind it, or a message (or thread) that names one. A message that asked nothing of the
    // records is a chat: search found nothing for it and it has no number, so "a 1:1 gear" in an explanation is not a
    // stat, and dropping that reply is exactly what turned a good answer into "I can't chat right now".
    if (reply && records && reply.unknown?.length) {
      // Logged (the numbers only, never who asked) so a dropped reply can be traced to the number that failed.
      console.info(`[bot] chat dropped: numbers not in the facts: ${reply.unknown.slice(0, 8).join(", ")}`);
    } else if (reply && talked) {
      // The records beside his words: the part of a multi-part message whose answer search could read (its card or its
      // stats), else the message's answer. A part's answer with nothing to show never replaces the message's — its link
      // and buttons would point at a question search couldn't answer. His text keeps its shape; the embed is what the
      // same question gives on controlscout.org/search, with its video and its own "ask next" buttons, and the footer
      // link goes to the same answer rather than the whole message search.
      const part = talked.card && showsRecords(talked.card) ? talked.card : undefined;
      const shown = part ?? answer;
      const pageQ = part ? part.q : q;
      const keep = reply.search && showsRecords(shown);
      const video = reply.search && deps.video ? await deps.video(shown).catch(() => undefined) : undefined;
      const watch = videoLinks(video);
      return {
        embed: askEmbed(q, shown, null, site, video, pageQ),
        meta: { step: answer.step, refined: false, sentence: false, chat: true },
        chat: { text: reply.text, ...(keep ? { card: true } : {}), ...(watch[0] ? { video: watch[0].url } : {}), ...(reply.search ? { page: searchHref(pageQ, site) } : {}) },
        next: askNext(shown),
        ...(watch.length ? { watch } : {}),
      };
    }
  }
  // No chat, or it had nothing to say: the website's answer, with his rewrite where it would use one.
  let refined = false;
  if ((answer.step === "did-you-mean" || answer.step === "recovery") && deps.available() && (await deps.enabled())) {
    const r = await deps.refine(q).catch(() => null);
    if (r) { answer = r; refined = r.step === "ai"; }
  }
  // Search found nothing and no chat answered either: one honest line rather than "Sorry — I can't answer that yet"
  // with the closest matches. Only a greeting or a working question reaches here (bot/smallTalk.ts).
  const empty = !answer.hits.length && !answer.card && !answer.stat;
  // Why no chat: a chat that's wired, configured and still on gave nothing about this one message (a reply with a
  // number the facts haven't, an empty one, a failure), and saying its AI is unreachable would contradict the answer
  // it just posted in the same channel. Only a chat that's actually off is reported as off.
  const talk = empty ? smallTalk(q, chatting && deps.available() && (await deps.enabled().catch(() => false))) : null;
  // What nothing answered, and that is a question about the records, is a real miss: the site's failed-search queue
  // gets the phrasing. A records question is one even with no number in it ("who won decode", "how did our alliance do
  // at austin"), and those count even where the bot answers with its one plain line — the line is not an answer. A build
  // question's "team" or "match" is about the robot, so it isn't one, and neither is a greeting (recordsMiss); the
  // question's own words decide, not the thread's, and an answer search gave teaches the queue nothing.
  if (empty && recordsMiss(q)) deps.miss?.(q, answer, guild);
  if (talk) return {
    embed: askEmbed(q, answer, null, site),
    meta: { step: answer.step, refined, sentence: false, chat: true },
    chat: { text: talk, by: "scout", page: searchHref(q, site) },
    next: askNext(answer),
  };
  const sentence = !chatting && deps.available() && (await deps.enabled()) ? await deps.bruno(q).catch(() => null) : null;
  const video = deps.video ? await deps.video(answer).catch(() => undefined) : undefined;
  const watch = videoLinks(video);
  return {
    embed: askEmbed(q, answer, sentence, site, video),
    meta: { step: answer.step, refined, sentence: !!sentence },
    ...(watch[0] ? { content: watch[0].url } : {}),
    next: askNext(answer),
    ...(watch.length ? { watch } : {}),
  };
}

/** Whether a message could be about the records at all: search found something for it, or it (or the thread before it)
 *  names a record number (not a ratio or a measurement, bot/smallTalk.ts's RECORD_NUMBER). Only then can a number in
 *  Bruno's reply be a record (an OPR, a season, a score) rather than the explanation a chat message asked for: the
 *  screenshot's "should I use a 42:15 gear reduction" was refused as a record claim only because it had digits in it. */
const asksRecords = (q: string, a: SearchAnswer, history: BrunoChatTurn[]) =>
  RECORD_NUMBER.test(q) || history.some((t) => RECORD_NUMBER.test(t.text)) || !!(a.hits.length || a.card || a.stat);

/** The words that make an unanswered message a question about the records even with no number in it. Filing only: the
 *  reply is unchanged, and a greeting or a build question has none of these. */
const RECORD_WORDS = /\b(?:teams?|alliances?|partners?|events?|matches?|quals?|qualifiers?|playoffs?|oprs?|ranks?|rankings?|scores?|records?|won|wins?|lost|losses?|tied?|seasons?|worlds|championships?|divisions?|awards?|schedules?|standings?)\b/i;

/** Whether an unanswered message is a question about the records, and so belongs in the site's failed-search queue: a
 *  record number in it, or a records word — and not a build question, whose "team" or "match" is about the robot. */
const recordsMiss = (q: string) => !WORKING.test(q) && (RECORD_NUMBER.test(q) || RECORD_WORDS.test(q));

/** Bruno's chat reply to `q`: search's facts for it (and for the thread's last question, so a follow-up like "and
 *  second place?" has the records it's about), then his reply. */
async function chatWith(q: string, answer: SearchAnswer, history: BrunoChatTurn[], deps: AskDeps, memory: string[] = []): Promise<{ reply: ChatReply | null; card?: SearchAnswer } | null> {
  // The message's own facts, then its parts' (bot/tools.ts): a question with several parts has each one's records.
  const own = await deps.facts!(answer);
  const looked = deps.lookups ? await deps.lookups(q).catch(() => ({ facts: [] } as Lookup)) : { facts: [] };
  const facts = [...own, ...looked.facts.filter((f) => !own.includes(f))];
  // The part's own answer, when one answered: it is the card the post shows beside his words.
  const card = looked.answer;
  const before = [...history].reverse().find((t) => t.role === "user")?.text;
  if (!before || before.trim().toUpperCase() === q.trim().toUpperCase()) return { reply: await deps.chat!(q, fit(facts, CHAT_FACTS, CHAT_FACTS_CHARS), history, memory), card };
  const earlier = (await deps.search(before).then((a) => deps.facts!(a)).catch(() => [] as string[])).filter((f) => !facts.includes(f));
  // Both questions' records get a share: the new one's first half, then the earlier one's, then whatever room is left
  // for the rest of either (a broad new answer must not crowd out the records the follow-up is about).
  const half = Math.floor(CHAT_FACTS / 2), halfChars = Math.floor(CHAT_FACTS_CHARS / 2);
  const now = fit(facts, half, halfChars);
  const then = fit(earlier, CHAT_FACTS - now.length, CHAT_FACTS_CHARS - chars(now));
  const kept = [...now, ...then];
  const rest = fit([...facts.slice(now.length), ...earlier.slice(then.length)], CHAT_FACTS - kept.length, CHAT_FACTS_CHARS - chars(kept));
  return { reply: await deps.chat!(q, [...now, ...rest.filter((f) => facts.includes(f)), ...then, ...rest.filter((f) => !facts.includes(f))], history, memory), card };
}

/** Characters `lines` take as sent (one line each). */
const chars = (lines: string[]) => lines.reduce((n, f) => n + f.length + 1, 0);
/** One fact line inside Control Point's cap: longer, and it refuses the whole chat packet. */
const clip = (s: string) => s.trim().slice(0, CHAT_FACT_CHARS);
/** The first of `lines` that fit in `max` lines and `maxChars` characters, each clipped to Control Point's cap. */
function fit(lines: string[], max: number, maxChars: number): string[] {
  const kept: string[] = [];
  let size = 0;
  for (const line of lines.slice(0, Math.max(0, max))) {
    const f = clip(line);
    if (!f) continue;
    if (size + f.length + 1 > maxChars) break;
    kept.push(f);
    size += f.length + 1;
  }
  return kept;
}

/**
 * A chat reply as the message's text: the question quoted when asked (a slash command's reply doesn't show it),
 * Bruno's words, the answer's video (Discord plays it under the text) and a small line crediting him, with the
 * website link Discord shows no preview for.
 */
export function chatPost(q: string, chat: NonNullable<AskReply["chat"]>, opts: { quote: boolean }): string {
  const question = q.trim().replace(/\s+/g, " ");
  const lines = [
    opts.quote ? `> **${md(question.length > 200 ? `${question.slice(0, 199)}…` : question)}**` : null,
    chat.text,
    chat.video ?? null,
    `-# ${chat.by === "scout" ? "Control Scout" : "Bruno AI"} · ${chat.page ? `[more on controlscout.org](<${chat.page}>)` : "controlscout.org"}`,
  ].filter((x): x is string => !!x);
  const text = lines.join("\n");
  return text.length > 2000 ? `${text.slice(0, 1999)}…` : text;
}

/** The answer's videos as links, the main one first, then the listed matches' clips: at most 3. */
export function videoLinks(v: SearchVideo | undefined): { label: string; url: string }[] {
  if (!v) return [];
  const first = v.main ?? v.watch;
  const items = [...(first ? [first] : []), ...Object.entries(v.rows ?? {}).filter(([href]) => href !== v.mainRow).map(([, i]) => i)];
  const seen = new Set<string>();
  return items.filter((i) => i.kind !== "contributor" && !seen.has(`${i.videoId}:${i.t}`) && seen.add(`${i.videoId}:${i.t}`))
    .slice(0, 3).map((i) => ({ label: i.match ?? (i.kind === "stream" ? "Stream" : "Recording"), url: watchUrl(i.videoId, i.t) }));
}

// ---------------------------------------------------------------------------
// The embed: the website's answer, description first, every team a link, inside Discord's limits.
// ---------------------------------------------------------------------------

const md = (s: string) => s.replace(/([\\*_`~[\]])/g, "\\$1");
const link = (label: string, href: string | undefined, site: string) => (href ? `[${md(label)}](${href.startsWith("/") ? site + href : href})` : md(label));
const statLink = (l: StatLink, site: string) => link(l.label, l.href, site);
/** A team StatLink ("4215", "4215 Hypnotic Robotics") linked to its page. */
const teams = (ls: StatLink[] | undefined, site: string) => (ls ?? []).map((l) => statLink(l, site)).join(" & ");
const more = (n: number) => (n > 0 ? [`…and ${n} more on the website`] : []);
/** "/ask question:" text for an answer's own related list. The card's own suggestions are buttons instead
 *  (bot/buttons.ts): this is the one place search's own suggestions are read as text. */
const askable = (q: string) => `\`/ask question: ${q.replace(/`/g, "'")}\``;
export const searchHref = (q: string, site: string) => `${site}/search?q=${encodeURIComponent(q)}`;

function lineOf(l: SearchCardLine, site: string): string {
  const extra = [l.detail, ...(l.results ?? [])].filter(Boolean).join(" · ");
  return `${l.tag ? `**${md(l.tag)}** ` : ""}${link(l.text, l.href, site)}${extra ? ` · ${md(extra)}` : ""}`;
}

function matchRow(r: StatMatchRow, site: string): string {
  const score = r.result === "W" ? `**${r.own}**–${r.opp}` : r.result === "L" ? `${r.own}–**${r.opp}**` : `${r.own}–${r.opp}`;
  return `${r.rank ? `${r.rank}. ` : ""}${link(r.label, r.href, site)} ${score} ${r.result} · ${statLink(r.event, site)} (${r.season})${r.unofficial ? ` · *${md(r.unofficial)}*` : ""}`;
}

/** One stat block as lines (lists capped at ROWS, the rest left to the website). */
export function blockLines(b: StatBlock, site: string): string[] {
  const head = (t?: string) => (t ? [`**${md(t)}**`] : []);
  switch (b.kind) {
    case "kpis": return [b.items.map((k) => `${md(k.label)} **${link(k.value, k.href, site)}**${k.sub ? ` (${md(k.sub)})` : ""}`).join(" · ")];
    case "record": return [...head(b.title), `${b.wins}–${b.losses}–${b.ties} (W–L–T)${b.split ? ` · quals ${b.split.quals.wins}–${b.split.quals.losses}–${b.split.quals.ties}, playoffs ${b.split.playoffs.wins}–${b.split.playoffs.losses}–${b.split.playoffs.ties}` : ""}`];
    case "matches": return [...head(b.title), ...b.rows.slice(0, ROWS).map((r) => matchRow(r, site)), ...more(b.rows.length - ROWS)];
    case "table": {
      const cols = b.columns.slice(0, 4);
      const rows = b.rows.slice(0, ROWS).map((r) => {
        const [first, ...rest] = cols.map((c) => r.cells[c.key]).map((v) => (v == null ? "—" : String(v)));
        const sides = r.teams ? ` · ${teams(r.teams.red, site)} vs ${teams(r.teams.blue, site)}` : "";
        return `${link(first ?? "", r.href, site)}${rest.length ? ` · ${rest.map(md).join(" · ")}` : ""}${sides}`;
      });
      return [...head(b.title), ...rows, ...more(b.rows.length - ROWS)];
    }
    case "leaderboard": return [...head(b.title), ...b.rows.slice(0, ROWS).map((r) => `${r.rank}. ${statLink(r.team, site)} **${md(r.display)}**${r.record ? ` · ${md(r.record)}` : ""}`), ...more(b.rows.length - ROWS), md(b.note)];
    case "compare": return [...head(b.title), `${teams(b.teams, site).replace(/ & /g, " vs ")}`, ...b.rows.slice(0, ROWS).map((r) => `${md(r.label)}: ${r.values.map((v, i) => (r.best === i ? `**${md(v)}**` : md(v))).join(" vs ")}${r.gap ? ` (${md(r.gap)})` : ""}`), ...more(b.rows.length - ROWS)];
    case "league": return [...head(b.title), ...b.rows.slice(0, ROWS).map((r) => `${r.rank}. ${teamLink(r.team, site)}${r.name ? ` ${md(r.name)}` : ""}${r.wins != null ? ` · ${r.wins}–${r.losses ?? 0}–${r.ties ?? 0}` : ""}${r.rs != null ? ` · RS ${r.rs}` : ""}`), ...more(b.rows.length - ROWS), statLink(b.more, site)];
    case "links": return b.items.length ? [...head(b.title), b.items.slice(0, 10).map((l) => statLink(l, site)).join(" · ")] : b.none ? [md(b.none)] : [];
    case "related": return [...head(b.title), ...b.queries.slice(0, 3).map(askable)];
    case "chance": return [`${md(b.label)}: **${Math.round(b.p * 100) === 0 && !b.decided ? "1%" : Math.round(b.p * 100) === 100 && !b.decided ? "99%" : `${Math.round(b.p * 100)}%`}** ${md(b.who)}${b.note ? ` · ${md(b.note)}` : ""}${b.action ? ` · ${statLink(b.action, site)}` : ""}`];
    case "series": return [...head(b.title), b.points.filter((p) => p.y != null).slice(-ROWS).map((p) => `${md(p.x)} ${p.y}${b.unit ? ` ${md(b.unit)}` : ""}`).join(" · ")];
    case "bars": return [...head(b.title), ...b.groups.slice(0, ROWS).map((g) => `${md(g.label)}: ${g.items.map((i) => `${md(i.label)} ${i.value ?? "—"}`).join(" · ")}`)];
    case "videos": return b.tiles.length ? [...head(b.title), ...b.tiles.slice(0, ROWS).map((t) => `${link(t.label, t.href, site)} ${t.redScore}–${t.blueScore}${t.event ? ` · ${md(t.event)}` : ""}`), ...more(b.tiles.length - ROWS)] : b.empty ? [link(b.empty.text, b.empty.href, site)] : [];
  }
}

/** The short answer: the headline when there is one (it is the answer), else the first block that says anything.
 *  Everything else (more blocks, the source) is one tap away on the website. */
function statLines(s: StatAnswer, site: string): string[] {
  if (s.headline) {
    const h = s.headline;
    return [`**${link(h.value, h.href, site)}** ${md(h.label)}${h.sub ? ` · ${md(h.sub)}` : ""}${h.teams?.length ? ` · ${teams(h.teams, site)}` : ""}`];
  }
  if (s.none) return [md(s.none)];
  for (const b of s.blocks) {
    const lines = blockLines(b, site).filter(Boolean);
    if (lines.length) return lines;
  }
  return [];
}

const hitLine = (h: SearchHit, site: string) => `${link(h.title, hitHref(h), site)}${h.subtitle ? ` · ${md(h.subtitle)}` : ""}${h.facts?.length ? ` · ${h.facts.map((f) => `${md(f.label)} **${md(f.value)}**`).join(", ")}` : ""}`;

/** The lines that fit in `max` characters (and `read` as a reader sees them), cut from the bottom ("…more on the
 *  website" when any were cut). */
export function fitLines(lines: string[], max: number, read = Infinity): string {
  const out: string[] = [];
  let used = 0, seen = 0;
  const tail = "\n…more on the website".length;
  for (let i = 0; i < lines.length; i++) {
    const add = (out.length ? 1 : 0) + lines[i].length, look = (out.length ? 1 : 0) + readLen(lines[i]);
    const room = i < lines.length - 1 ? tail : 0;
    if (used + add + room > max || seen + look + room > read) { out.push("…more on the website"); break; }
    out.push(lines[i]);
    used += add;
    seen += look;
  }
  return out.join("\n");
}

/** The website's answer as one embed. */
export function askEmbed(q: string, a: SearchAnswer, sentence: BrunoSentence | null, site: string, video?: SearchVideo, pageQuery = q): APIEmbed {
  const page = searchHref(pageQuery, site);
  const bruno = a.step === "ai" || !!sentence;
  const footer = { text: bruno ? `${BRUNO_CREDIT}\n${FOOTER.text}` : FOOTER.text };
  const close = `[Open this answer on controlscout.org](${page})`;

  // Nothing found, or a question search can't answer yet: said so, what was read, and searches that do answer.
  const cant = !!a.sorry || (a.step === "recovery" && !a.card && !a.stat);
  if (cant) {
    const understood = a.sorry?.understood ?? a.recovery?.understood ?? [];
    const lines = [
      understood.length ? `I read it as: ${understood.map(md).join(" · ")}` : null,
      a.recovery?.ai?.refined ? `Bruno AI read it as: **${md(a.recovery.ai.refined)}**` : null,
      ...(a.recovery?.closest?.length ? ["**Closest matches:**", ...a.recovery.closest.slice(0, HITS).map((h) => hitLine(h, site))] : []),
      (a.recovery?.browse ?? []).map((b) => link(b.title, b.href, site)).join(" · ") || null,
    ].filter((x): x is string => !!x);
    // The link to the whole answer stays: lines are cut from the bottom, never it.
    return { author: asked(q), title: SORRY_SENTENCE, url: page, description: `${fitLines(lines, DESCRIPTION_MAX - close.length - 1, READ_MAX)}\n${close}`, color: VOLT, footer };
  }

  const lines: string[] = [];
  if (a.step === "did-you-mean" && a.didYouMean) lines.push(`Did you mean **${md(a.didYouMean)}**?`);
  if (a.step === "ai" && a.refined) lines.push(`Bruno AI read it as: **${md(a.refined)}**`);
  if (a.verdict) lines.push(`**${a.verdict.answer}** · ${md(a.verdict.label)}`);
  // His one sentence only: his points repeat the answer below it, and Discord gets the short answer.
  if (sentence) lines.push(`> ${md(sentence.text)}`);
  let title: string;
  if (a.stat) {
    title = a.stat.heading ?? a.stat.title;
    lines.push(...statLines(a.stat, site));
  } else if (a.card) {
    const c = a.card;
    title = `${c.title}${c.team ? ` · ${c.team.number}${c.team.name ? ` ${c.team.name}` : ""}` : ""}`;
    if (c.headline) lines.push(`**${md(c.headline)}**`);
    lines.push(...c.lines.slice(0, ROWS).map((l) => `• ${lineOf(l, site)}`), ...more(c.lines.length - ROWS));
    if (c.none) lines.push(md(c.none));
    if (c.closest?.length && !c.lines.length) lines.push("**Closest records:**", ...c.closest.slice(0, ROWS).map((l) => `• ${lineOf(l, site)}`));
  } else {
    title = a.hits[0] ? a.hits[0].title : q;
  }
  // The top results, when the answer didn't already cover them.
  if (!a.stat && !a.card) lines.push(...a.hits.slice(0, HITS).map((h) => `• ${hitLine(h, site)}`), ...more(a.hits.length - HITS));
  // The videos, as the website plays them: watched on YouTube.
  const vids = videoLinks(video);
  if (vids.length) lines.push(`▶ Watch: ${vids.map((v) => `[${md(v.label)}](${v.url})`).join(" · ")}`);
  // What to ask next is not text here: the answer's buttons carry it (bot/buttons.ts, askNext below).
  // The link stays: lines are cut from the bottom of the answer, never the link to the whole of it.
  const body = fitLines(lines, DESCRIPTION_MAX - close.length - 1, READ_MAX);
  return { author: asked(q), title: title.length > 256 ? `${title.slice(0, 255)}…` : title, url: page, description: `${body ? `${body}\n` : ""}${close}`, color: VOLT, footer };
}

/** The question as asked, above the answer: everyone in the channel sees what was asked, not just "used /ask". */
export const asked = (q: string) => {
  const t = `Asked: ${q.trim().replace(/\s+/g, " ")}`;
  return { name: t.length > 256 ? `${t.slice(0, 255)}…` : t };
};

/**
 * The questions the answer offers as buttons (bot/buttons.ts): up to 3 that work for a question it couldn't answer
 * (search's own suggestions), else up to 2 of the answer's related questions. Deduplicated, in the site's order.
 */
export function askNext(a: SearchAnswer): string[] {
  const cant = !!a.sorry || (a.step === "recovery" && !a.card && !a.stat);
  const related = a.stat?.blocks.flatMap((b) => (b.kind === "related" ? b.queries : [])) ?? [];
  const all = cant ? [...(a.sorry?.suggest ?? []), ...(a.suggest ?? []), ...related] : [...related, ...(a.suggest ?? [])];
  return all.filter((x, i, l): x is string => !!x && l.indexOf(x) === i).slice(0, cant ? 3 : 2);
}
