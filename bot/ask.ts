// /ask: a question in plain words, answered with the website's own search answer (docs/search.md), as one embed.
// The same path /search takes, in the same order, called in this process (no HTTP to the site):
//   1. searchAnswer(q, { learn: false })  deterministic, always (learn off: a Discord ask never teaches search)
//   2. refine(q)                          only when that answer is weak (did-you-mean, recovery), the brunoSearch
//                                         switch is on and Bruno is configured: he rewrites the QUERY, search runs again
//   3. brunoAnswer(q)                     only for a question (isBrunoQuestion), the brunoAnswers switch on and Bruno
//                                         configured: a sentence from search's facts, dropped if any number isn't in them
// Every number in the embed is search's own (or a sentence the grounded check passed). Bruno off, unconfigured,
// failing or slow: the deterministic answer still posts, with no credit line. An answer that used him says so.
import type { APIEmbed } from "discord.js";
import type { SearchAnswer, SearchCardLine, SearchHit } from "../src/shared/api.js";
import type { StatAnswer, StatBlock, StatLink, StatMatchRow } from "../src/shared/searchStat.js";
import { SEARCH_PAGE_LIMIT, SORRY_SENTENCE, hitHref, isBrunoQuestion } from "../src/shared/search.js";
import { FOOTER, VOLT, teamLink } from "./views.js";

/** The credit an answer Bruno helped with carries, in the footer above Control Scout's own line. */
export const BRUNO_CREDIT = "Bruno AI, from Control Point";
/** Discord's caps: an embed's description, and all of one message's text. */
export const DESCRIPTION_MAX = 4096;
export const EMBED_MAX = 6000;
/** Rows of one list block shown before "…and N more on the website". */
const ROWS = 5;
/** Top results listed when the card doesn't already cover them. */
const HITS = 5;

export interface BrunoSentence { text: string; points: string[] }

/** What /ask needs from the site (the real functions in askDeps; stand-ins in tests). */
export interface AskDeps {
  search: (q: string) => Promise<SearchAnswer>;
  refine: (q: string) => Promise<SearchAnswer | null>;
  bruno: (q: string) => Promise<BrunoSentence | null>;
  enabled: (flag: "brunoSearch" | "brunoAnswers") => Promise<boolean>;
  available: () => boolean;
}

/** What one ask did, for the log (never who asked). */
export interface AskMeta { step: SearchAnswer["step"]; refined: boolean; sentence: boolean }
export interface AskReply { embed: APIEmbed; meta: AskMeta }

export async function realAskDeps(): Promise<AskDeps> {
  // The search index is the site's (it builds and refreshes it); the bot only reads it, like every other table but its own.
  const [{ searchAnswer }, { refine }, { brunoAnswer }, { isEnabled }, { brunoAvailable }] = await Promise.all([
    import("../server/api/searchAnswer.js"), import("../server/api/searchBruno.js"), import("../server/api/searchBrunoAnswer.js"),
    import("../server/flags.js"), import("../server/auth/controlPoint.js"),
  ]);
  return {
    search: (q) => searchAnswer(q, { learn: false, limit: SEARCH_PAGE_LIMIT }),
    refine: (q) => refine(q, { learn: false, limit: SEARCH_PAGE_LIMIT }),
    bruno: (q) => brunoAnswer(q, { limit: SEARCH_PAGE_LIMIT }),
    enabled: (f) => isEnabled(f).catch(() => false),
    available: brunoAvailable,
  };
}

/** The website's answer to `q`, with Bruno's help where the site would use it. */
export async function ask(q: string, deps: AskDeps, site: string): Promise<AskReply> {
  let answer = await deps.search(q);
  let refined = false;
  if ((answer.step === "did-you-mean" || answer.step === "recovery") && deps.available() && (await deps.enabled("brunoSearch"))) {
    const r = await deps.refine(q).catch(() => null);
    if (r) { answer = r; refined = r.step === "ai"; }
  }
  const sentence = isBrunoQuestion(q) && deps.available() && (await deps.enabled("brunoAnswers")) ? await deps.bruno(q).catch(() => null) : null;
  return { embed: askEmbed(q, answer, sentence, site), meta: { step: answer.step, refined, sentence: !!sentence } };
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
  const who = [r.partners?.length ? `with ${teams(r.partners, site)}` : null, r.opponents?.length ? `vs ${teams(r.opponents, site)}` : null].filter(Boolean).join(" ");
  return `${r.rank ? `${r.rank}. ` : ""}${link(r.label, r.href, site)} ${score} ${r.result} · ${statLink(r.event, site)} (${r.season})${who ? ` · ${who}` : ""}${r.note ? ` · ${md(r.note)}` : ""}${r.unofficial ? ` · *${md(r.unofficial)}*` : ""}`;
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

function statLines(s: StatAnswer, site: string): string[] {
  const lines: string[] = [];
  if (s.headline) {
    const h = s.headline;
    lines.push(`**${link(h.value, h.href, site)}** ${md(h.label)}${h.sub ? ` · ${md(h.sub)}` : ""}${h.teams?.length ? ` · ${teams(h.teams, site)}` : ""}`);
  }
  if (s.none) lines.push(md(s.none));
  for (const b of s.blocks) lines.push(...blockLines(b, site));
  if (s.source) lines.push(`*${md(s.source)}*`);
  return lines;
}

const hitLine = (h: SearchHit, site: string) => `${link(h.title, hitHref(h), site)}${h.subtitle ? ` · ${md(h.subtitle)}` : ""}${h.facts?.length ? ` · ${h.facts.map((f) => `${md(f.label)} **${md(f.value)}**`).join(", ")}` : ""}`;

/** The lines that fit in `max` characters, cut from the bottom ("…more on the website" when any were cut). */
export function fitLines(lines: string[], max: number): string {
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i++) {
    const add = (out.length ? 1 : 0) + lines[i].length;
    const tail = "\n…more on the website".length;
    if (used + add + (i < lines.length - 1 ? tail : 0) > max) { out.push("…more on the website"); break; }
    out.push(lines[i]);
    used += add;
  }
  return out.join("\n");
}

/** The website's answer as one embed. */
export function askEmbed(q: string, a: SearchAnswer, sentence: BrunoSentence | null, site: string): APIEmbed {
  const page = searchHref(q, site);
  const bruno = a.step === "ai" || !!sentence;
  const footer = { text: bruno ? `${BRUNO_CREDIT}\n${FOOTER.text}` : FOOTER.text };
  const close = `[Open this answer on controlscout.org](${page})`;

  // Nothing found, or a question search can't answer yet: said so, what was read, and searches that do answer.
  const cant = !!a.sorry || (a.step === "recovery" && !a.card && !a.stat);
  if (cant) {
    const understood = a.sorry?.understood ?? a.recovery?.understood ?? [];
    const tries = [...(a.sorry?.suggest ?? []), ...(a.suggest ?? [])].filter((x, i, all) => all.indexOf(x) === i).slice(0, 4);
    const lines = [
      understood.length ? `I read it as: ${understood.map(md).join(" · ")}` : null,
      a.recovery?.ai?.refined ? `Bruno AI read it as: **${md(a.recovery.ai.refined)}**` : null,
      ...(tries.length ? ["**Questions that work:**", ...tries.map(askable)] : []),
      ...(a.recovery?.closest?.length ? ["**Closest matches:**", ...a.recovery.closest.slice(0, HITS).map((h) => hitLine(h, site))] : []),
      (a.recovery?.browse ?? []).map((b) => link(b.title, b.href, site)).join(" · ") || null,
      close,
    ].filter((x): x is string => !!x);
    return { title: SORRY_SENTENCE, url: page, description: fitLines(lines, DESCRIPTION_MAX), color: VOLT, footer };
  }

  const lines: string[] = [];
  if (a.step === "did-you-mean" && a.didYouMean) lines.push(`Did you mean **${md(a.didYouMean)}**?`);
  if (a.step === "ai" && a.refined) lines.push(`Bruno AI read it as: **${md(a.refined)}**`);
  if (a.verdict) lines.push(`**${a.verdict.answer}** · ${md(a.verdict.label)}`);
  if (sentence) lines.push(...[sentence.text, ...sentence.points.map((p) => `• ${p}`)].map((s) => `> ${md(s)}`));
  let title: string;
  if (a.stat) {
    title = a.stat.heading ?? a.stat.title;
    lines.push(...statLines(a.stat, site));
  } else if (a.card) {
    const c = a.card;
    title = `${c.title}${c.team ? ` · ${c.team.number}${c.team.name ? ` ${c.team.name}` : ""}` : ""}`;
    if (c.headline) lines.push(`**${md(c.headline)}**`);
    lines.push(...c.lines.slice(0, 10).map((l) => `• ${lineOf(l, site)}`), ...more(c.lines.length - 10));
    if (c.none) lines.push(md(c.none));
    if (c.closest?.length) lines.push("**Closest records:**", ...c.closest.slice(0, ROWS).map((l) => `• ${lineOf(l, site)}`));
  } else {
    title = a.hits[0] ? a.hits[0].title : q;
  }
  // The top results, when the answer didn't already cover them.
  if (!a.stat && !a.card) lines.push(...a.hits.slice(0, HITS).map((h) => `• ${hitLine(h, site)}`), ...more(a.hits.length - HITS));
  if (a.suggest?.length && !a.stat && !a.card) lines.push("**Also answers:**", ...a.suggest.slice(0, 3).map(askable));
  // The link stays: lines are cut from the bottom of the answer, never the link to the whole of it.
  const body = fitLines(lines, DESCRIPTION_MAX - close.length - 1);
  return { title: title.length > 256 ? `${title.slice(0, 255)}…` : title, url: page, description: `${body ? `${body}\n` : ""}${close}`, color: VOLT, footer };
}
