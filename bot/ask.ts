// /ask: a question in plain words, answered with the website's own search answer (docs/search.md), as one embed.
// The same path /search takes, in the same order, called in this process (no HTTP to the site):
//   1. searchAnswer(q, { learn: false })  deterministic, always (learn off: a Discord ask never teaches search)
//   2. refine(q)                          only when that answer is weak (did-you-mean, recovery), the bot's own
//                                         discordBruno switch is on and Bruno is configured: he rewrites the QUERY, search runs again
//   3. brunoAnswer(q)                     only where the chat below isn't wired (tests, older callers), discordBruno on and Bruno
//                                         configured: a sentence from search's facts, dropped if any number isn't in them
// Every number in the embed is search's own (or a sentence the grounded check passed). Bruno off, unconfigured,
// failing or slow: the deterministic answer still posts, with no credit line. An answer that used him says so.
//
// A chat first: with Bruno on, the message (and the reply thread before it) goes to Control Point's Bruno chat
// (/internal/bruno/discord-chat) with search's facts, and his reply is the post: plain text like a chat, the
// answer's video and a link to the website under it only when the facts answer the message. Any number in his
// reply that isn't in the facts, the message or the thread drops it, and the card above posts instead.
import type { APIEmbed } from "discord.js";
import type { SearchAnswer, SearchCardLine, SearchHit, SearchVideo } from "../src/shared/api.js";
import { watchUrl } from "../src/shared/recording.js";
import type { StatAnswer, StatBlock, StatLink, StatMatchRow } from "../src/shared/searchStat.js";
import { SEARCH_PAGE_LIMIT, SORRY_SENTENCE, hitHref } from "../src/shared/search.js";
import { FOOTER, VOLT, teamLink } from "./views.js";
import type { BrunoChatTurn } from "../server/auth/controlPoint.js";

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
  /** Bruno's chat reply (Control Point's discord-chat), or null: off, unavailable, or a number not in the facts. */
  chat?: (message: string, facts: string[], history: BrunoChatTurn[]) => Promise<ChatReply | null>;
}

/** Bruno's chat reply; `search`: the facts answer the message, so the answer's video and page go with it. */
export interface ChatReply { text: string; search: boolean }
/** Facts sent with a chat, at most (Control Point's caps: 40 lines, 8,000 characters). */
const CHAT_FACTS = 40;
const CHAT_FACTS_CHARS = 7500;

/** What one ask did, for the log (never who asked). */
export interface AskMeta { step: SearchAnswer["step"]; refined: boolean; sentence: boolean; chat?: boolean }
/**
 * `content`: the main video's YouTube link as the message's text, so Discord shows it as a player under the answer.
 * `chat`: Bruno's chat reply, posted as text (chatPost) with no embed; `embed` is then the card it stands in for.
 */
export interface AskReply { embed: APIEmbed; meta: AskMeta; content?: string; chat?: { text: string; video?: string; page?: string } }

/** How long a chat waits for Bruno before the card posts instead. */
export const CHAT_TIMEOUT_MS = 15_000;

export async function realAskDeps(): Promise<AskDeps> {
  // The search index is the site's (it builds and refreshes it); the bot only reads it, like every other table but its own.
  const [{ searchAnswer }, { refine }, { brunoAnswer, answerFacts, grounded }, { isEnabled }, { brunoAvailable, brunoDiscordChat }] = await Promise.all([
    import("../server/api/searchAnswer.js"), import("../server/api/searchBruno.js"), import("../server/api/searchBrunoAnswer.js"),
    import("../server/flags.js"), import("../server/auth/controlPoint.js"),
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
    chat: async (message, facts, history) => {
      if (!brunoAvailable() || !(await isEnabled("discordBruno").catch(() => false))) return null;
      const r = await brunoDiscordChat(message, facts, history, CHAT_TIMEOUT_MS);
      if (!r || typeof r.text !== "string" || !r.text.trim()) return null;
      // Every number his: the facts', the message's or the thread's, or nothing posts from him.
      if (!grounded(r.text, [...facts, ...history.map((t) => t.text)], message)) return null;
      return { text: r.text.trim(), search: r.search === true };
    },
  };
}

/** The website's answer to `q`, with Bruno's help where the site would use it: his chat reply first (the reply
 *  thread before it in `history`), else the card. */
export async function ask(q: string, deps: AskDeps, site: string, history: BrunoChatTurn[] = []): Promise<AskReply> {
  let answer = await deps.search(q);
  let refined = false;
  if ((answer.step === "did-you-mean" || answer.step === "recovery") && deps.available() && (await deps.enabled())) {
    const r = await deps.refine(q).catch(() => null);
    if (r) { answer = r; refined = r.step === "ai"; }
  }
  // With the chat wired, he's asked once: a chat that's off, failed, timed out or named a number not in the facts is
  // never followed by a second call for a sentence; the card posts at once (bounded by the chat's own timeout).
  const chatting = !!(deps.chat && deps.facts);
  if (chatting) {
    const reply = await chatWith(q, answer, history, deps).catch(() => null);
    if (reply) {
      const video = reply.search && deps.video ? await deps.video(answer).catch(() => undefined) : undefined;
      const watch = videoLinks(video);
      return {
        embed: askEmbed(q, answer, null, site, video),
        meta: { step: answer.step, refined, sentence: false, chat: true },
        chat: { text: reply.text, ...(watch[0] ? { video: watch[0].url } : {}), ...(reply.search ? { page: searchHref(q, site) } : {}) },
      };
    }
  }
  const sentence = !chatting && deps.available() && (await deps.enabled()) ? await deps.bruno(q).catch(() => null) : null;
  const video = deps.video ? await deps.video(answer).catch(() => undefined) : undefined;
  const watch = videoLinks(video);
  return { embed: askEmbed(q, answer, sentence, site, video), meta: { step: answer.step, refined, sentence: !!sentence }, ...(watch[0] ? { content: watch[0].url } : {}) };
}

/** Bruno's chat reply to `q`: search's facts for it (and for the thread's last question, so a follow-up like "and
 *  second place?" has the records it's about), then his reply. */
async function chatWith(q: string, answer: SearchAnswer, history: BrunoChatTurn[], deps: AskDeps): Promise<ChatReply | null> {
  const facts = await deps.facts!(answer);
  const before = [...history].reverse().find((t) => t.role === "user")?.text;
  if (!before || before.trim().toUpperCase() === q.trim().toUpperCase()) return deps.chat!(q, fit(facts, CHAT_FACTS, CHAT_FACTS_CHARS), history);
  const earlier = (await deps.search(before).then((a) => deps.facts!(a)).catch(() => [] as string[])).filter((f) => !facts.includes(f));
  // Both questions' records get a share: the new one's first half, then the earlier one's, then whatever room is left
  // for the rest of either (a broad new answer must not crowd out the records the follow-up is about).
  const half = Math.floor(CHAT_FACTS / 2), halfChars = Math.floor(CHAT_FACTS_CHARS / 2);
  const now = fit(facts, half, halfChars);
  const then = fit(earlier, CHAT_FACTS - now.length, CHAT_FACTS_CHARS - chars(now));
  const kept = [...now, ...then];
  const rest = fit([...facts.slice(now.length), ...earlier.slice(then.length)], CHAT_FACTS - kept.length, CHAT_FACTS_CHARS - chars(kept));
  return deps.chat!(q, [...now, ...rest.filter((f) => facts.includes(f)), ...then, ...rest.filter((f) => !facts.includes(f))], history);
}

/** Characters `lines` take as sent (one line each). */
const chars = (lines: string[]) => lines.reduce((n, f) => n + f.length + 1, 0);
/** The first of `lines` that fit in `max` lines and `maxChars` characters. */
function fit(lines: string[], max: number, maxChars: number): string[] {
  const kept: string[] = [];
  let size = 0;
  for (const f of lines.slice(0, Math.max(0, max))) {
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
    `-# Bruno AI · ${chat.page ? `[more on controlscout.org](<${chat.page}>)` : "controlscout.org"}`,
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
/** "/ask question:" text a reader copies to ask it (no buttons in v1). */
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
export function askEmbed(q: string, a: SearchAnswer, sentence: BrunoSentence | null, site: string, video?: SearchVideo): APIEmbed {
  const page = searchHref(q, site);
  const bruno = a.step === "ai" || !!sentence;
  const footer = { text: bruno ? `${BRUNO_CREDIT}\n${FOOTER.text}` : FOOTER.text };
  const close = `[Open this answer on controlscout.org](${page})`;

  // Nothing found, or a question search can't answer yet: said so, what was read, and searches that do answer.
  const cant = !!a.sorry || (a.step === "recovery" && !a.card && !a.stat);
  if (cant) {
    const understood = a.sorry?.understood ?? a.recovery?.understood ?? [];
    const tries = [...(a.sorry?.suggest ?? []), ...(a.suggest ?? [])].filter((x, i, all) => all.indexOf(x) === i).slice(0, 3);
    const lines = [
      understood.length ? `I read it as: ${understood.map(md).join(" · ")}` : null,
      a.recovery?.ai?.refined ? `Bruno AI read it as: **${md(a.recovery.ai.refined)}**` : null,
      ...(tries.length ? ["**Questions that work:**", ...tries.map(askable)] : []),
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
  // What to ask next, as the website offers it (the answer's related questions, else search's own suggestions).
  const next = nextQuestions(a);
  if (next.length) lines.push(`**Ask next:** ${next.map(askable).join(" · ")}`);
  // The link stays: lines are cut from the bottom of the answer, never the link to the whole of it.
  const body = fitLines(lines, DESCRIPTION_MAX - close.length - 1, READ_MAX);
  return { author: asked(q), title: title.length > 256 ? `${title.slice(0, 255)}…` : title, url: page, description: `${body ? `${body}\n` : ""}${close}`, color: VOLT, footer };
}

/** The question as asked, above the answer: everyone in the channel sees what was asked, not just "used /ask". */
export const asked = (q: string) => {
  const t = `Asked: ${q.trim().replace(/\s+/g, " ")}`;
  return { name: t.length > 256 ? `${t.slice(0, 255)}…` : t };
};

/** Up to 2 questions to ask next: the answer's related questions, else search's suggestions. */
function nextQuestions(a: SearchAnswer): string[] {
  const related = a.stat?.blocks.flatMap((b) => (b.kind === "related" ? b.queries : [])) ?? [];
  return [...related, ...(a.suggest ?? [])].filter((x, i, all) => x && all.indexOf(x) === i).slice(0, 2);
}
