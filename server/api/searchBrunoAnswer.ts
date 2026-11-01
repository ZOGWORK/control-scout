// Bruno's answer on /search (docs/search.md): a question gets a sentence or three from Bruno AI on top of search's own
// results. Scout sends the question and the facts search found for it (the card's records, the top results, the main
// team's season numbers), each a line of plain text; Bruno writes from those lines only (Control Point's POST
// /internal/bruno/search-answer). Every number in his answer must be one of the facts' (or the question's): an
// answer with any other number is dropped, so a made-up stat never reaches the page. Asked only for a question
// (isBrunoQuestion), only by /search after its results are on screen (GET /api/search/bruno), and cached; off (the
// brunoAnswers switch), unconfigured, failing or slow: no answer, and the page keeps what it has.
// Streamed to a page that asks for it (?stream=1): the answer shows as he writes it, each part checked the same way
// before it's sent (previewOf), and ends at the same answer; the model call, prompt and cache are the same.
import type { SearchAnswer, SearchCardLine } from "../../src/shared/api.js";
import { seasonLabel } from "../../src/shared/format.js";
import { isBrunoQuestion } from "../../src/shared/search.js";
import { brunoAvailable, brunoSearchAnswer, brunoSearchAnswerStream } from "../auth/controlPoint.js";
import { get } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { isEnabled } from "../flags.js";
import { normalize } from "./fuzzy.js";
import { cleanQuery, searchAnswer, type AnswerOptions } from "./searchAnswer.js";

export const BRUNO_ANSWER_TIMEOUT_MS = 12_000;
/** At most this many facts, and this much text in all: a small, fast prompt. */
export const MAX_FACTS = 40;
export const MAX_FACTS_CHARS = 6000;
const CACHE_MAX = 2000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** `text`: the answer in a sentence; `points`: one short line per record behind it (often none). */
export interface BrunoAnswer { text: string; points: string[] }

/** Answers by normalized question (null: Bruno had nothing to say, or his answer failed the check). Failures aren't kept. */
const cache = new Map<string, { at: number; answer: BrunoAnswer | null }>();
/** What a page sees of an answer while Bruno writes it: the checked part so far, or null (nothing to show yet, or withdrawn). */
export type BrunoPreview = (p: BrunoAnswer | null) => void;
/**
 * Questions being answered right now: a second ask while one is in flight shares it (one model call), and a streamed
 * ask joins its preview where it stands. `preview`: the latest one sent; `watchers`: the streamed asks sharing it.
 */
interface Flight { answer: Promise<BrunoAnswer | null>; preview: BrunoAnswer | null; watchers: Set<BrunoPreview> }
const pending = new Map<string, Flight>();
export const resetBrunoAnswerCache = () => { cache.clear(); pending.clear(); };

const lineText = (l: SearchCardLine) => {
  const more = [l.detail, ...(l.results ?? [])].filter(Boolean).join(" · ");
  return more ? `${l.text}: ${more}` : l.text;
};

/** The facts search found for `a` (its answer to the question), as plain lines for Bruno. */
export async function answerFacts(a: SearchAnswer): Promise<string[]> {
  const facts: string[] = [];
  // What the event records cover (the events table's own range, not the seasons the site lists).
  const first = (await get<{ s: number | null }>("SELECT MIN(season) s FROM events"))?.s ?? CURRENT_SEASON;
  facts.push(`Control Scout's event records start with the ${seasonLabel(first)} FTC season; nothing earlier is recorded.`);
  if (a.card) {
    const c = a.card;
    const who = c.team ? ` for team ${`${c.team.number} ${c.team.name ?? ""}`.trim()}` : "";
    facts.push(`${c.title}${who}: ${c.lines.length} found${c.count ? ` (${c.count} ${c.count === 1 ? "time" : "times"})` : ""}.`);
    for (const l of c.lines) facts.push(`- ${lineText(l)}`);
    if (c.none) facts.push(c.none);
    for (const l of c.closest ?? []) facts.push(`- Closest record: ${lineText(l)}`);
  }
  for (const h of a.hits.slice(0, 5)) {
    const extra = (h.facts ?? []).map((f) => `${f.label} ${f.value}`).join("; ");
    facts.push(`Result: ${h.title}${h.subtitle ? ` (${h.subtitle})` : ""}${extra ? `: ${extra}` : ""}`);
  }
  // The main team's latest season, so "how good are they" has numbers to go on.
  const team = a.card?.team?.number ?? (a.hits[0]?.kind === "team" ? Number(a.hits[0].ref) : null);
  if (team) {
    const s = await get<{ season: number; opr_np: number | null; rank_np: number | null; ranked_teams: number | null; wins: number | null; losses: number | null; ties: number | null }>(
      "SELECT season, opr_np, rank_np, ranked_teams, wins, losses, ties FROM team_season_stats WHERE team = ? ORDER BY season DESC LIMIT 1", [team]);
    if (s) {
      const bits = [s.wins != null && s.losses != null ? `record ${s.wins}-${s.losses}-${s.ties ?? 0}` : "", s.opr_np != null ? `OPR ${s.opr_np.toFixed(1)}` : "", s.rank_np != null && s.ranked_teams ? `OPR rank ${s.rank_np} of ${s.ranked_teams}` : ""].filter(Boolean);
      if (bits.length) facts.push(`Team ${team} in ${seasonLabel(s.season)}: ${bits.join(", ")}.`);
    }
  }
  // Bounded: the first lines are the ones that answer.
  const out: string[] = [];
  let size = 0;
  for (const f of facts.slice(0, MAX_FACTS)) {
    if (size + f.length > MAX_FACTS_CHARS) break;
    out.push(f);
    size += f.length + 1;
  }
  return out;
}

/** The numbers in `s`, each whole as written: "101.6", "2025", a record "26-6-0" and a season "2023-24" are one each
 *  (so a "6" can't borrow from a record), with thousands separators dropped and every dash read as "-". */
const numbers = (s: string) => (s.replace(/[–—]/g, "-").replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)*/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, ""));

/** Whether every number in `text` is one the facts or the question have (counting words like "three" don't count as numbers). */
export function grounded(text: string, facts: string[], question: string): boolean {
  const known = new Set(numbers([question, ...facts].join(" ")));
  return numbers(text).every((n) => known.has(n) || known.has(n.replace(/\.0+$/, "")));
}

/**
 * Bruno's answer to the question `raw`, or null (not a question, off, unconfigured, nothing to say, failed the
 * check). `opts`: the page's own search choices (its preferred teams, its limit), so he reads the results it shows.
 */
export async function brunoAnswer(raw: string, opts: Pick<AnswerOptions, "prefer" | "limit"> = {}, now = Date.now(), onPreview?: BrunoPreview): Promise<BrunoAnswer | null> {
  // A question by its "?" too ("hypnotic opr?"): read before cleaning, which drops it.
  const q = cleanQuery(raw);
  if (!q || !isBrunoQuestion(raw.trim().slice(0, 200))) return null;
  if (!(await isEnabled("brunoAnswers").catch(() => false)) || !brunoAvailable()) return null;
  const k = `${normalize(q)}|${[...(opts.prefer ?? [])].sort().join(",")}`;
  const hit = cache.get(k);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.answer;
  let flight = pending.get(k);
  if (!flight) {
    const f: Flight = { answer: null!, preview: null, watchers: new Set() };
    // Streamed only while a page watches it; the model call is the same either way.
    const show: BrunoPreview = (p) => { f.preview = p; for (const w of f.watchers) w(p); };
    // Only its own entry: a reset while it ran may have let a newer ask take the key.
    f.answer = ask(q, opts, k, now, onPreview ? show : undefined).finally(() => { if (pending.get(k) === f) pending.delete(k); f.watchers.clear(); });
    pending.set(k, f);
    flight = f;
  } else if (onPreview && flight.preview) onPreview(flight.preview);
  if (onPreview) flight.watchers.add(onPreview);
  return flight.answer;
}

/** A JSON string's value from its opening quote at `s[i]`, as far as it's written: its text, and where it ended (-1: not yet). */
function readString(s: string, i: number): { value: string; end: number } {
  let value = "";
  for (let j = i + 1; j < s.length;) {
    const c = s[j];
    if (c === '"') return { value, end: j + 1 };
    if (c !== "\\") { value += c; j++; continue; }
    const e = s[j + 1];
    if (e === undefined) break;
    if (e === "u") {
      const hex = s.slice(j + 2, j + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16));
      j += 6;
      continue;
    }
    value += ({ n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" } as Record<string, string>)[e] ?? e;
    j += 2;
  }
  return { value, end: -1 };
}

/**
 * What Bruno's reply says so far, read from the start of the agreed JSON ({"text": "…", "points": ["…", …]}) as it's
 * written: the sentence and the points begun, and whether the last of them is still being written (`open`).
 */
export function partialAnswer(raw: string): { text: string; points: string[]; open: boolean } {
  const none = { text: "", points: [], open: true };
  const t = /"text"\s*:\s*/.exec(raw);
  if (!t || raw[t.index + t[0].length] !== '"') return none;
  const text = readString(raw, t.index + t[0].length);
  if (text.end < 0) return { text: text.value, points: [], open: true };
  const points: string[] = [];
  const p = /^\s*,\s*"points"\s*:\s*\[\s*/.exec(raw.slice(text.end));
  if (!p) return { text: text.value, points, open: true };
  let i = text.end + p[0].length;
  for (;;) {
    if (raw[i] !== '"') return { text: text.value, points, open: raw[i] !== "]" };
    const s = readString(raw, i);
    points.push(s.value);
    if (s.end < 0) return { text: text.value, points, open: true };
    i = s.end + (/^\s*,?\s*/.exec(raw.slice(s.end))?.[0].length ?? 0);
  }
}

const tidy = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The part of a reply so far that can be shown while he writes: tidied as the answer is, with a number still being
 * written held back (its next digit could change it), and checked like the answer. undefined: a number in it isn't
 * in the facts (the answer will be dropped, so nothing more of it is shown).
 */
export function previewOf(raw: string, facts: string[], question: string): BrunoAnswer | null | undefined {
  const p = partialAnswer(raw);
  const pieces = [p.text, ...p.points];
  if (p.open) pieces[pieces.length - 1] = pieces[pieces.length - 1].replace(/[\d.,\-–—]+$/, "");
  const [text, ...points] = pieces.map((s, i) => tidy(s, i ? 200 : 600));
  if (!text) return null;
  const shown = { text, points: points.filter(Boolean).slice(0, 6) };
  return grounded([shown.text, ...shown.points].join(" "), facts, question) ? shown : undefined;
}

async function ask(q: string, opts: Pick<AnswerOptions, "prefer" | "limit">, k: string, now: number, show?: BrunoPreview): Promise<BrunoAnswer | null> {
  const facts = await answerFacts(await searchAnswer(q, { ...opts, learn: true }));
  let answer: BrunoAnswer | null = null;
  try {
    // Streamed for a page that watches: each new checked part goes to it; once a part fails the check, the page is
    // told to drop what it has, and sees nothing more until the answer (which the same check drops too).
    let last = "";
    let withdrawn = false;
    const onRaw = (raw: string) => {
      if (withdrawn) return;
      const p = previewOf(raw, facts, q);
      if (p === undefined) { withdrawn = true; if (last) show!(null); return; }
      const key = p ? JSON.stringify(p) : "";
      if (key && key !== last) { last = key; show!(p); }
    };
    const r = show ? await brunoSearchAnswerStream(q, facts, BRUNO_ANSWER_TIMEOUT_MS, onRaw) : await brunoSearchAnswer(q, facts, BRUNO_ANSWER_TIMEOUT_MS);
    const clean = tidy(r.text, 600);
    // Points are checked with the sentence: one number not in the facts drops the whole answer.
    const points = (Array.isArray(r.points) ? r.points : []).map((p) => tidy(p, 200)).filter(Boolean).slice(0, 6);
    if (clean && grounded([clean, ...points].join(" "), facts, q)) answer = { text: clean, points };
    else if (clean) console.warn("[search] Bruno's answer named a number not in the facts: dropped");
  } catch (e) {
    console.warn("[search] Bruno answer unavailable:", (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message?.slice(0, 120));
    return null;
  }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(k, { at: now, answer });
  return answer;
}
