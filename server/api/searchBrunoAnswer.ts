// Bruno's answer on /search (docs/search.md): a question gets a sentence or three from Bruno AI on top of search's own
// results. Scout sends the question and the facts search found for it (the card's records, the top results, the main
// team's season numbers), each a line of plain text; Bruno writes from those lines only (Control Point's POST
// /internal/bruno/search-answer). Every number in his answer must be one of the facts' (or the question's): an
// answer with any other number is dropped, so a made-up stat never reaches the page. Asked only for a question
// (isBrunoQuestion), only by /search after its results are on screen (GET /api/search/bruno), and cached; off (the
// brunoAnswers switch), unconfigured, failing or slow: no answer, and the page keeps what it has.
import type { SearchAnswer, SearchCardLine } from "../../src/shared/api.js";
import { seasonLabel } from "../../src/shared/format.js";
import { isBrunoQuestion } from "../../src/shared/search.js";
import { brunoAvailable, brunoSearchAnswer } from "../auth/controlPoint.js";
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
/** Questions being answered right now: a second ask while one is in flight shares it (one model call). */
const pending = new Map<string, Promise<BrunoAnswer | null>>();
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
    const who = `${c.team.number} ${c.team.name ?? ""}`.trim();
    facts.push(`${c.title} for team ${who}: ${c.lines.length} found${c.count ? ` (${c.count} ${c.count === 1 ? "time" : "times"})` : ""}.`);
    for (const l of c.lines) facts.push(`- ${lineText(l)}`);
    if (c.none) facts.push(c.none);
    for (const l of c.closest ?? []) facts.push(`- Closest record: ${lineText(l)}`);
  }
  for (const h of a.hits.slice(0, 5)) {
    const extra = (h.facts ?? []).map((f) => `${f.label} ${f.value}`).join("; ");
    facts.push(`Result: ${h.title}${h.subtitle ? ` (${h.subtitle})` : ""}${extra ? `: ${extra}` : ""}`);
  }
  // The main team's latest season, so "how good are they" has numbers to go on.
  const team = a.card?.team.number ?? (a.hits[0]?.kind === "team" ? Number(a.hits[0].ref) : null);
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
export async function brunoAnswer(raw: string, opts: Pick<AnswerOptions, "prefer" | "limit"> = {}, now = Date.now()): Promise<BrunoAnswer | null> {
  // A question by its "?" too ("hypnotic opr?"): read before cleaning, which drops it.
  const q = cleanQuery(raw);
  if (!q || !isBrunoQuestion(raw.trim().slice(0, 200))) return null;
  if (!(await isEnabled("brunoAnswers").catch(() => false)) || !brunoAvailable()) return null;
  const k = `${normalize(q)}|${[...(opts.prefer ?? [])].sort().join(",")}`;
  const hit = cache.get(k);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.answer;
  const inFlight = pending.get(k);
  if (inFlight) return inFlight;
  // Only its own entry: a reset while it ran may have let a newer ask take the key.
  const p: Promise<BrunoAnswer | null> = ask(q, opts, k, now).finally(() => { if (pending.get(k) === p) pending.delete(k); });
  pending.set(k, p);
  return p;
}

async function ask(q: string, opts: Pick<AnswerOptions, "prefer" | "limit">, k: string, now: number): Promise<BrunoAnswer | null> {
  const facts = await answerFacts(await searchAnswer(q, { ...opts, learn: true }));
  let answer: BrunoAnswer | null = null;
  try {
    const r = await brunoSearchAnswer(q, facts, BRUNO_ANSWER_TIMEOUT_MS);
    const tidy = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
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
