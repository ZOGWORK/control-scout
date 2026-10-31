// Search's one answer for every surface (the header box, /search, the address bar's search): docs/search.md.
//
// Fixed rules, in order, every one deterministic:
//   1. A team number ("4215", "team 4215", "team-4215") is that team alone; a number with no team is the recovery state.
//   2. Two or more teams joined by "vs"/"versus" open Compare.
//   3. Otherwise the search itself (names, numbers, codes, matches, topic words: server/api/search.ts), with short forms
//      spelled out ("champs") and the name-and-topic reading taken when it fits better ("team talos" vs "team 4215").
//   4. Nothing for the whole query: each word on its own; a result matching more words ranks higher, and words that
//      match nothing are ignored.
// Before 2: a season, region, ranking or missing view read from the query (./searchIntents.ts).
// Then the step: "deterministic" when the top result fits what was typed, "did-you-mean" when it's a correction, and
// "recovery" when there's nothing, or only near matches to teams that never played (those are listed as closest).
// Learned click weights (./searchLearn.ts) may re-rank the results, never add one. Bruno AI is never asked here:
// the app asks /api/search/refine after these results are on screen (./searchBruno.ts).
import type { SearchAnswer, SearchHit, SearchRecovery } from "../../src/shared/api.js";
import { SEARCH_BROWSE, SEARCH_FILLER, SEARCH_TOPICS, TOPIC_LABEL, VERSUS, pagesFor } from "../../src/shared/search.js";
import { seasonLabel } from "../../src/shared/format.js";
import { get } from "../db.js";
import { fuzzyScore, normalize, words } from "./fuzzy.js";
import { search, searchIntent } from "./search.js";
import { rerank } from "./searchLearn.js";
import { intentAnswer, parseIntent } from "./searchIntents.js";

export const MAX_QUERY = 80;
/** A top result scoring under this against what was typed is a correction ("did you mean"), not a match. */
export const WEAK_SCORE = 0.9;

export interface AnswerOptions {
  limit?: number; prefer?: ReadonlySet<string>; learn?: boolean;
  /** Read seasons, regions and missing views (./searchIntents.ts): off for the core of an intent. */
  intents?: boolean;
  /** A season the query named in words ("last season", read by ./searchIntents.ts): as if typed as "2024-25". */
  season?: number | null;
}

/** The query as search reads it: punctuation that never means anything dropped, spaces folded, at most MAX_QUERY. */
export function cleanQuery(raw: string): string {
  return String(raw ?? "").replace(/[!?,;"<>(){}[\]|\\^*`~=+]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY).trim();
}

const SHORT_FORMS: Record<string, string> = { champs: "championship", champ: "championship", cmp: "championship", quals: "qualifier", worlds: "first championship", states: "state championship" };
const MATCH_WORDS = /\b(q|qual|m|match|f|final)\s*-?\s*\d{1,3}\b/i;
const expandShortForms = (q: string) => (MATCH_WORDS.test(q) ? q : q.split(" ").map((w) => SHORT_FORMS[w.toLowerCase()] ?? w).join(" "));

const isTopicWord = (w: string) => SEARCH_TOPICS.some(([p]) => p.split(" ").includes(w));
const nameOf = (h: SearchHit) => (h.kind === "team" ? h.title.replace(/^\d+\s+/, "") : h.title);
const key = (h: SearchHit) => `${h.kind}:${h.ref}`;
const uniq = (hs: SearchHit[]) => { const seen = new Set<string>(); return hs.filter((h) => !seen.has(key(h)) && !!seen.add(key(h))); };

/** How closely the top hit matches the name part of what was typed (1: exactly; its number counts as exact). */
export function topScore(q: string, hits: SearchHit[]): number {
  const top = hits[0];
  if (!top) return 0;
  if (top.kind === "match" || top.href) return 1;
  const rest = (searchIntent(q)?.rest ?? q).trim();
  if (top.kind === "team" && rest.split(" ").includes(top.ref)) return 1;
  if (top.kind === "event" && rest.toUpperCase().split(" ").includes(top.ref.split(":")[1])) return 1;
  return Math.max(fuzzyScore(rest, nameOf(top)), fuzzyScore(rest, top.title));
}

/** Whether a team has ever played a match (a registration alone doesn't make a partial name match a result). */
async function played(team: string): Promise<boolean> {
  return !!(await get("SELECT 1 FROM team_event_stats WHERE team = ? AND matches > 0 LIMIT 1", [Number(team)]));
}

/** A season named in the query ("2025-26", "2025–26", "2025"), and the query without it. Never inside a match query. */
function seasonOf(q: string): { season: number | null; rest: string } {
  if (MATCH_WORDS.test(q)) return { season: null, rest: q };
  const m = /(?:^|\s)(20\d\d)(?:\s*[-–/]\s*(\d\d))?(?=\s|$)/.exec(q);
  if (!m) return { season: null, rest: q };
  const s = Number(m[1]);
  if (m[2] && (s + 1) % 100 !== Number(m[2])) return { season: null, rest: q };
  const rest = (q.slice(0, m.index) + " " + q.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return rest ? { season: s, rest } : { season: null, rest: q };
}

const answer = (q: string, a: Partial<SearchAnswer> & Pick<SearchAnswer, "hits" | "step">): SearchAnswer =>
  ({ q, pages: pagesFor(q), weak: a.step === "did-you-mean" || a.step === "recovery", ...a });

const recovery = (q: string, understood: string[], closest: SearchHit[] = []): SearchAnswer =>
  answer(q, { hits: [], step: "recovery", recovery: { understood, closest, browse: SEARCH_BROWSE } satisfies SearchRecovery });

/** "hypnotic versus bad wolf history": Compare for the teams named (2–4, in number order), or null when it isn't one. */
async function versus(q: string, prefer: ReadonlySet<string>, season: number | null): Promise<SearchAnswer | null> {
  const sides = q.split(VERSUS).map((s) => s.trim()).filter(Boolean);
  if (sides.length < 2) return null;
  const found: SearchHit[] = [], missing: string[] = [];
  for (const side of sides) {
    // Topic and filler words name no team ("… history").
    const name = (searchIntent(side)?.rest ?? side).trim();
    const team = (await search(name, 5, prefer)).find((h) => h.kind === "team");
    if (team && !found.some((t) => t.ref === team.ref)) found.push(team); else if (!team) missing.push(side);
  }
  const shown = found.slice(0, 4);
  if (shown.length >= 2 && !missing.length) {
    const nums = shown.map((t) => Number(t.ref)).sort((a, b) => a - b);
    const extra = found.length > 4 ? ` (Compare holds 4: ${found.length - 4} left out)` : "";
    const top: SearchHit = {
      ...shown.find((t) => Number(t.ref) === nums[0])!, href: `/compare?teams=${nums.join(",")}${season != null ? `&season=${season}` : ""}`,
      title: nums.map((n) => shown.find((t) => Number(t.ref) === n)!.title).join(" vs "), subtitle: `Compare side by side: records, OPR and event history${extra}`,
    };
    return answer(q, { hits: [top, ...shown], step: "deterministic" });
  }
  // A side with no team: never a half-empty Compare. The teams found, and a note on the rest.
  return recovery(q, [`A comparison of ${sides.length} teams`, ...missing.map((m) => `No team found for "${m}"`)], found);
}

/** Search's answer for `raw` (docs/search.md). */
export async function searchAnswer(raw: string, opts: AnswerOptions = {}): Promise<SearchAnswer> {
  const limit = opts.limit ?? 12, prefer = opts.prefer ?? new Set<string>();
  const q = cleanQuery(raw);
  if (!q) return recovery(q, ["Nothing typed yet: try a team number, a team or event name, or a match like USNJCMP Q12"]);

  // 1. A team number, alone or as "team 4215" / "team-4215" / "#4215".
  const num = /^(?:team)?[\s#-]*(\d{1,6})[.\s]*$/i.exec(q);
  if (num) {
    const n = String(Number(num[1]));
    const found = (await search(n, 5, prefer)).find((h) => h.kind === "team" && h.ref === n);
    // A season named in words ("4215 last season"): the team opens on it, as with a typed year.
    const team = found && opts.season != null ? { ...found, linkSeason: opts.season, subtitle: [seasonLabel(opts.season), found.subtitle].filter(Boolean).join(" · ") } : found;
    return team ? answer(q, { hits: [team], step: "deterministic" }) : recovery(q, [`A team number: ${n}`, `No FTC team ${n} on record`]);
  }

  // 1b. A season, a region, a ranking or a view that doesn't exist yet: the closest real view, and what's missing.
  let it = opts.intents === false ? null : parseIntent(q);
  // A region read from a bare name ("New Jersey Championship rankings") that's really part of an event's name: the event.
  if (it?.regionBare) {
    const asEvent = await search(it.withoutRanking, 5, prefer);
    if (asEvent[0]?.kind === "event" && topScore(it.withoutRanking, asEvent) >= WEAK_SCORE) it = null;
  }
  if (it && it.core !== q) {
    const a = await intentAnswer(q, it, await searchAnswer(it.core, { ...opts, intents: false, season: it.season ?? opts.season }));
    if (a) return a;
  }

  // 2. Teams side by side (in a season, when one is named).
  // Only a season written as one ("2024-25") counts here: a bare 2000–2099 is as likely a team ("2024 vs 4215").
  const vsSeason = /(?:^|\s)20\d\d\s*[-–/]\s*\d\d(?=\s|$)/.test(q) ? seasonOf(q) : { season: null, rest: q };
  const vs = await versus(vsSeason.rest, prefer, vsSeason.season ?? opts.season ?? null);
  if (vs) return vs;

  // 3. The search, on the season-free, short-forms-expanded query; the name-and-topic reading when it fits better.
  // A season named makes a team's numbers and link that season's.
  const typed = seasonOf(expandShortForms(q));
  const rest = typed.rest, season = typed.season ?? opts.season ?? null;
  let hits = await search(rest, limit, prefer, undefined, season);
  const intent = searchIntent(rest);
  if (hits.length && intent && !intent.topic) {
    const alt = await search(intent.rest, limit, prefer, undefined, season);
    if (topScore(rest, alt) > topScore(rest, hits)) hits = alt;
  }

  // 4. Word by word: a result matching more words first; words matching nothing are ignored.
  let byWords = false;
  if (!hits.length) {
    const ws = words(rest).filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !SEARCH_FILLER.has(w) && !isTopicWord(w));
    const count = new Map<string, { h: SearchHit; n: number; first: number }>();
    for (const [i, w] of ws.entries()) for (const h of await search(w, limit, prefer, undefined, season)) {
      const c = count.get(key(h)) ?? { h, n: 0, first: i };
      c.n++; count.set(key(h), c);
    }
    hits = [...count.values()].sort((a, b) => b.n - a.n || a.first - b.first).map((c) => c.h).slice(0, limit);
    byWords = hits.length > 0;
  }

  // A season in the query: its events first, and teams open on it.
  if (season != null) {
    hits = [...hits.filter((h) => h.kind !== "event" || h.season === season), ...hits.filter((h) => h.kind === "event" && h.season !== season)]
      .map((h) => (h.kind === "team" ? { ...h, linkSeason: season, subtitle: [seasonLabel(season), h.subtitle].filter(Boolean).join(" · ") } : h));
  }

  if (!hits.length) {
    const understood = intent?.topic ? [`A question about ${TOPIC_LABEL[intent.topic].toLowerCase()}`, `No team or event matched "${intent.rest}"`] : [`No team, event or match matched "${q}"`];
    return recovery(q, understood);
  }

  const score = topScore(rest, hits);
  const exact = score >= 0.999;
  // A near match to a team that never played (a test registration, a typo'd sign-up) is a closest match, not a result.
  if (!exact && hits[0].kind === "team" && !hits[0].href && !(await played(hits[0].ref))) {
    return recovery(q, [`No exact match for "${q}"`], uniq(hits).slice(0, 5));
  }
  // Learned order, read under the same key a pick is counted under (learnQuery).
  if (opts.learn !== false) hits = await rerank(rest, hits, { pinTop: exact });
  if (score >= WEAK_SCORE && !byWords) return answer(q, { hits: uniq(hits), step: "deterministic" });
  const topic = (intent ?? searchIntent(rest, true))?.phrase;
  return answer(q, { hits: uniq(hits), step: "did-you-mean", didYouMean: `${nameOf(hits[0])}${topic ? ` ${topic}` : ""}` });
}

/** The query a pick of `raw`'s results is learned under: what the ranking read (an intent's core, short forms spelled
 *  out, the season taken off), so "champs" and "championship" teach the same order. */
export function learnQuery(raw: string): string {
  const q = cleanQuery(raw);
  const it = parseIntent(q);
  return seasonOf(expandShortForms(it && it.core !== q && it.core ? it.core : q)).rest;
}
