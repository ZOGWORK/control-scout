// FTC One Search's layered query path (docs/search-layers.md). The existing readers stay Layer 1; the layers after
// it read a query the readers missed as a set of words, so word order, filler and conversational scaffolding never
// lose a clear question. Every layer is rules and word lists (./searchCatalog.ts): no model, no AI, no guessing.
//   0  normalization   "#12345" is 12345; case is folded for the word layers only (state codes like "IN" read by case)
//   1  templates       the existing readers (searchAnswer.ts), unchanged
//   2  keywords        team + intent + scope found anywhere in the query, everything else scaffolding or filler
//   3  paraphrases     PARAPHRASES said the catalog's way, then Layers 1 and 2 again
//   4  filler          FILLER taken out (never inside a team's full name), then Layers 1 and 2 again
//   5  weak signals    a team and one word that can mean only one intent ("12345 where")
//   6  fallback        the existing answer: the team page and what wasn't answered, or the recovery state
// A filler word never decides an answer: when a query answered at Layer 1 answers differently, and also directly,
// without its filler ("what is opr please" read "please" as the team Please Don't Explode), the filler-free answer wins.
// The first layer with a direct answer wins and the answer appears once; its reading line says how it was read.
import type { SearchAnswer } from "../../src/shared/api.js";
import { regionOf } from "../../src/shared/searchEventQuery.js";
import { SEASONS } from "../data/seasons.js";
import { all, get } from "../db.js";
import { joinThousands, normalize } from "./fuzzy.js";
import { onlyTopicWords } from "../../src/shared/searchQuery.js";

/** A name compared whole: lower case, any run of punctuation and spaces one space. */
const wholeName = (n: string) => n.toLowerCase().replace(/[^\p{L}\d]+/gu, " ").trim();
import { longForm } from "./searchLongForm.js";
import { AWARDS, FILLER, FORBIDDEN, type Found, INTENTS, type Intent, LEADER_STAT_WORDS, PARAPHRASES, PHASES, PRECEDENCE, SCAFFOLD, TAIL_FILLER, WEAK_SIGNALS } from "./searchCatalog.js";

export type LayerId = "normalize" | "template" | "longform" | "keyword" | "paraphrase" | "filler" | "scope" | "fallback";
export type OutcomeResult = "answered" | "no-match" | "team-fallback" | "weak" | "name-search-only" | "empty" | "ambiguous";

/** How a top-level search was answered, for failed-search reporting (never on the answer path, never sent to the app). */
export interface SearchOutcome {
  /** The query as typed, cleaned (searchAnswer's cleanQuery). */
  typed: string;
  /** Layer 0 plus filler removal, lowercased: the key failures aggregate under. */
  normalized: string;
  layers: LayerId[];
  /** The layer whose answer was given; null when it fell through to Layer 6. */
  won: LayerId | null;
  result: OutcomeResult;
  team: string | null;
  /** Intents the keyword layer found (two or more when ambiguous). */
  intents: string[];
  /** Intents a weak word pointed at when no keyword did ("12345 based": location), answered or not. */
  weak: string[];
  scope: { season?: string; place?: string; event?: string };
  /** Filler and scaffolding words left out. */
  filler: string[];
}

const outcomes = new WeakMap<SearchAnswer, SearchOutcome>();
/** A forbidden word an answer names in its own words, so it was read, not dropped. */
// "More than 200" is said "over 200" ("Scores over 200"), "fewer than" as "under".
const SAID_AS: Record<string, RegExp> = { last: /\b(?:latest|most recent)\b/, next: /\bupcoming\b/, and: /\s\+\s/, than: /\b(?:over|above|under|below|more than|fewer than|less than)\s+\d/ };

const LAYER_NUMBER: Record<LayerId, string> = { normalize: "0", template: "1", longform: "1L", keyword: "2", paraphrase: "3", filler: "4", scope: "5", fallback: "6" };
/** An outcome as failed-search reporting's trace reads it (server/searchFailures.ts SearchTrace): layers by number,
 *  scope as its tokens, and the tied intents when it was ambiguous. */
export function traceOf(o: SearchOutcome | undefined) {
  if (!o) return null;
  return {
    // A weak word's candidates count as what was asked, so a question it couldn't answer is still reported.
    layers: o.layers.map((l) => LAYER_NUMBER[l]), won: o.won ? LAYER_NUMBER[o.won] : null, team: o.team, intents: o.intents.length ? o.intents : o.weak,
    scope: [o.scope.place, o.scope.season, o.scope.event].filter((x): x is string => !!x), filler: o.filler,
    ...(o.result === "ambiguous" ? { ambiguous: o.intents } : {}),
  };
}
/** The outcome of a top-level searchAnswer() call, read from the answer object it returned (before it's copied). */
export const searchOutcome = (a: SearchAnswer): SearchOutcome | undefined => outcomes.get(a);
/** `to`, a copy of an answer made after it was read (a spelling correction, ./spelling.ts), keeping `from`'s outcome. */
export function carryOutcome(from: SearchAnswer, to: SearchAnswer): SearchAnswer {
  const o = outcomes.get(from);
  if (o) outcomes.set(to, o);
  return to;
}

/** Test mode only (never read from a request or a setting): turn a layer off to prove the others reach every intent. */
let testLayers: { template?: boolean; keyword?: boolean } = {};
export function setLayersForTest(l: { template?: boolean; keyword?: boolean }): void {
  if (!process.env.VITEST) throw new Error("setLayersForTest is for tests only");
  testLayers = l;
}

// ---------------------------------------------------------------------------------------------------------------
// Layer 0: normalization.

/** What Layer 1 reads: the query as typed, a team number's leading "#" taken off ("#12345 opr"). Nothing else changes. */
export const normalizeQuery = (q: string): string => q.replace(/(^|\s)#+(?=\d)/g, "$1").replace(/\s+/g, " ").trim();

const SEASON_TOKEN = /^(20\d\d)[-–/](\d\d(?:\d\d)?)$/;
/** The words the later layers read: lowercased, accents and punctuation folded, "12345's" as 12345, a season ("2024-25",
 *  "2024–25") kept whole. */
export function tokens(q: string): string[] {
  const out: string[] = [];
  for (const piece of joinThousands(q).replace(/(\d)\s*[-–/]\s*(\d\d(?:\d\d)?)(?=\s|$)/g, "$1-$2").replace(/[’']s(?=\s|$)/gi, "").split(/\s+/)) {
    if (SEASON_TOKEN.test(piece)) out.push(piece.replace(/[–/]/, "-"));
    else if (piece === "&") out.push("&");
    else if (/^\d+%$/.test(piece) || piece === "%") out.push(...normalize(piece).split(" ").filter(Boolean), "%");
    else out.push(...normalize(piece.replace(/[’']/g, "")).split(" ").filter(Boolean));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Teams by name: every team's full name, read once and kept for a few minutes.

/** A name or a word as the word layers compare them: apostrophes dropped first ("Don't" is "dont", as typed either
 *  way), then accents, case and punctuation folded. */
export const nameKey = (s: string) => normalize(joinThousands(s).replace(/[’']/g, ""));

let names: { at: number; byName: Map<string, string[]>; list: [string, string][]; whole: Map<string, string> } | null = null;
export async function teamNames() {
  if (names && Date.now() - names.at < 10 * 60_000) return names;
  const rows = await all<{ number: number; name: string | null }>("SELECT number, name FROM teams WHERE name IS NOT NULL AND name <> ''");
  const byName = new Map<string, string[]>(), list: [string, string][] = [], whole = new Map<string, string>();
  for (const r of rows) {
    const n = nameKey(r.name!);
    if (!n) continue;
    byName.set(n, [...(byName.get(n) ?? []), String(r.number)]);
    list.push([n, String(r.number)]);
    whole.set(String(r.number), wholeName(r.name!));
  }
  names = { at: Date.now(), byName, list, whole };
  return names;
}
/** Forget the cached names (tests that write teams). */
export const forgetTeamNames = () => { names = null; };

export async function teamExists(n: string): Promise<boolean> {
  return !!(await get("SELECT 1 FROM teams WHERE number = ?", [Number(n)]));
}

/** The teams a run of words names: its full name exactly, or failing that one team whose name starts with those whole
 *  words ("hypnotic" for Hypnotic Robotics, 5+ letters). Several teams of one name are all returned (never one picked). */
export async function teamsNamed(ws: string[]): Promise<string[]> {
  const n = ws.join(" ");
  if (!n || /^\d+$/.test(n)) return [];
  const { byName, list, whole } = await teamNames();
  // What a question asks about ("alliances", "inspire") names a team only typed as its whole name (onlyTopicWords).
  if (onlyTopicWords(n)) return (byName.get(n) ?? []).filter((x) => whole.get(x) === wholeName(n));
  const exact = byName.get(n);
  if (exact) return exact;
  // A one-word start of a name needs 6+ letters ("hypnotic"), so a common word ("total") isn't read as a team.
  if (n.replace(/\s/g, "").length < (ws.length > 1 ? 5 : 6)) return [];
  const pre = list.filter(([name]) => name === n || name.startsWith(`${n} `));
  return pre.length === 1 ? [pre[0][1]] : [];
}

// ---------------------------------------------------------------------------------------------------------------
// Layer 2: keyword intent extraction.

type Kind = "intent" | "phase" | "award" | "lead" | "filler" | "scaffold" | "forbidden" | "join" | "season" | "place" | "weak";
interface Tok { w: string; kind?: Kind; id?: string; span?: number; phrase?: string; team?: string }

const phrases = (ws: string[]) => ws.map((p) => p.split(" "));
const LEXICON: { ws: string[]; kind: Kind; id?: string }[] = [
  ...INTENTS.flatMap((it) => phrases(it.words).map((ws) => ({ ws, kind: "intent" as Kind, id: it.id }))),
  ...Object.keys(PHASES).map((p) => ({ ws: [p], kind: "phase" as Kind, id: PHASES[p] })),
  ...AWARDS.map((a) => ({ ws: [a], kind: "award" as Kind, id: a })),
  ...phrases(FILLER).map((ws) => ({ ws, kind: "filler" as Kind })),
  ...phrases(SCAFFOLD).map((ws) => ({ ws, kind: "scaffold" as Kind })),
  ...["and", "or", "&"].map((w) => ({ ws: [w], kind: "join" as Kind })),
  ...["who wins", "appearances", "history", "results"].map((p) => ({ ws: p.split(" "), kind: "scaffold" as Kind })),
  ...Object.keys(WEAK_SIGNALS).map((w) => ({ ws: [w], kind: "weak" as Kind, id: w })),
  ...phrases(FORBIDDEN).map((ws) => ({ ws, kind: "forbidden" as Kind })),
].sort((a, b) => b.ws.length - a.ws.length);

const GAMES = SEASONS.map((s) => ({ ws: normalize(s.game).split(" "), joined: normalize(s.game).replace(/\s/g, ""), label: s.label.replace("–", "-") }));
const SEASON_WORDS = [["this", "season"], ["last", "season"], ["this", "year"], ["last", "year"], ["current", "season"], ["previous", "season"], ["past", "season"]];
const EVENT_WORDS = new Set(["championship", "championships", "qualifier", "qualifiers", "league", "meet", "division", "states", "premier", "scrimmage", "regional", "invitational", "tournament", "cup", "classic", "interleague", "super", "worlds"]);
const isYear = (w: string) => /^(?:19|20)\d\d$/.test(w);

/** A season scope at `i`: a season label, a game's name (with "year", "season" or "game" after it), or "this/last
 *  season". Returns its length and how the answers read it. */
function seasonAt(ts: string[], i: number): { n: number; as: string } | null {
  if (SEASON_TOKEN.test(ts[i])) return { n: 1, as: ts[i] };
  for (const g of GAMES) {
    const n = ts.slice(i, i + g.ws.length).join(" ") === g.ws.join(" ") ? g.ws.length : ts[i] === g.joined ? 1 : 0;
    if (n) return { n: n + (/^(?:year|season|game)$/.test(ts[i + n] ?? "") ? 1 : 0), as: g.label };
  }
  for (const s of SEASON_WORDS) if (ts.slice(i, i + 2).join(" ") === s.join(" ")) return { n: 2, as: s.join(" ") };
  return null;
}

/** A place at `i`, the longest run of up to three words that's a region. */
function placeAt(ts: string[], i: number): { n: number; name: string } | null {
  for (let n = 3; n >= 1; n--) {
    if (i + n > ts.length) continue;
    const r = regionOf(ts.slice(i, i + n));
    if (r) return { n, name: r.name };
  }
  return null;
}

/** Each word's part: the longest phrase at each position first. Unclaimed words are left for a team or event name. */
function label(ts: string[]): Tok[] {
  const out: Tok[] = ts.map((w) => ({ w }));
  for (let i = 0; i < ts.length;) {
    const s = seasonAt(ts, i);
    if (s) { for (let k = 0; k < s.n; k++) Object.assign(out[i + k], { kind: "season", phrase: s.as, span: k === 0 ? s.n : 0 }); i += s.n; continue; }
    const hit = LEXICON.find((e) => e.ws.every((w, k) => ts[i + k] === w));
    // A region before the generic words, so "in" and "me" stay words and "new jersey" is one place.
    const p = !hit || hit.kind === "scaffold" || hit.kind === "weak" ? placeAt(ts, i) : null;
    if (p && (!hit || p.n >= hit.ws.length)) { for (let k = 0; k < p.n; k++) Object.assign(out[i + k], { kind: "place", phrase: p.name, span: k === 0 ? p.n : 0 }); i += p.n; continue; }
    if (hit) { for (let k = 0; k < hit.ws.length; k++) Object.assign(out[i + k], { kind: hit.kind, id: hit.id, phrase: hit.ws.join(" "), span: k === 0 ? hit.ws.length : 0 }); i += hit.ws.length; continue; }
    i++;
  }
  return out;
}

export interface Extracted {
  teams: string[];
  intents: string[];
  /** Intents a weak signal points at (Layer 5), when no strong keyword was found. */
  weak: string[];
  found: Found;
  /** Words left out as filler or scaffolding, and forbidden words or unknown words that block an answer. */
  dropped: string[];
  forbidden: string[];
  unknown: string[];
  /** The canonical phrasing for the one intent, when there is one. */
  canonical: string | null;
  /** Any team intent the catalog doesn't list ("longest win streak of 12345"): the team first, then the other words
   *  in the order typed, filler and scaffolding left out, as Layer 1's team-first phrasings read them. */
  teamFirst: string | null;
  intent: Intent | null;
}

/** Layer 2: the team, intent and scope in a query, whatever their order. */
export async function extract(q: string): Promise<Extracted> {
  const ts = tokens(q);
  const toks = label(ts);
  const found: Found = { teams: [], extra: new Set() };
  const dropped: string[] = [], forbidden: string[] = [];
  const strong = new Set<string>(), weak = new Set<string>();
  // Numbers: a team (a year only when something else names the team or the intent can't have one).
  const nums = toks.map((t, i) => ({ t, i })).filter(({ t }) => !t.kind && /^\d{1,6}$/.test(t.w));
  for (const t of toks) {
    if (t.kind === "intent") { strong.add(t.id!); found.extra.add(t.phrase!); if (t.span && WEAK_SIGNALS[t.phrase!]) weak.add(t.phrase!); }
    else if (t.kind === "phase" && t.span) { found.phase = t.id as Found["phase"]; found.extra.add(t.w); }
    else if (t.kind === "award" && t.span) { found.award = t.id; found.extra.add(t.w); }
    else if (t.kind === "season" && t.span) found.season = t.phrase;
    else if (t.kind === "place" && t.span) found.place = t.phrase;
    else if (t.kind === "weak" && t.span) { weak.add(t.id!); found.extra.add(t.w); }
    else if ((t.kind === "filler" || t.kind === "scaffold") && t.span) { dropped.push(t.phrase!); found.extra.add(t.phrase!); }
    else if (t.kind === "forbidden" && t.span) forbidden.push(t.phrase!);
  }
  // A meaning question: the words left are the term, never a team.
  const runs: { from: number; to: number }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].kind || /^\d{1,6}$/.test(toks[i].w)) continue;
    const last = runs.at(-1);
    // Words joined by scaffolding ("hypnotic the robotics") are one run only when nothing else sits between.
    if (last && toks.slice(last.to + 1, i).every((t) => t.kind === "scaffold" || t.kind === "filler")) last.to = i;
    else runs.push({ from: i, to: i });
  }
  const unknown: string[] = [];
  const runWords = (r: { from: number; to: number }) => toks.slice(r.from, r.to + 1).map((t) => t.w);
  // Each run names a team (its whole name, scaffolding next to it tried as part of it first), else an event.
  const named: string[] = [];
  let eventRun: { from: number; to: number } | null = null;
  for (const r of runs) {
    let hit: string[] = [];
    let used = r;
    for (const [l, rr] of [[2, 2], [2, 1], [1, 2], [2, 0], [0, 2], [1, 1], [1, 0], [0, 1], [0, 0]]) {
      const from = Math.max(0, r.from - l), to = Math.min(toks.length - 1, r.to + rr);
      const span = toks.slice(from, to + 1);
      if (span.some((t, k) => (k < r.from - from || k > r.to - from) && t.kind && t.kind !== "scaffold" && t.kind !== "filler" && t.kind !== "intent" && t.kind !== "weak")) continue;
      hit = await teamsNamed(span.map((t) => t.w));
      if (hit.length) { used = { from, to }; break; }
    }
    if (hit.length === 1) {
      named.push(hit[0]);
      // Words taken into the name are the name's own, not filler or an intent.
      for (let k = used.from; k <= used.to; k++) {
        const t = toks[k];
        if (t.kind === "intent") { strong.delete(t.id!); found.extra.delete(t.phrase!); }
        if (t.kind === "scaffold" || t.kind === "filler") { const at = dropped.indexOf(t.phrase!); if (at >= 0) dropped.splice(at, 1); }
        if (t.kind === "weak") weak.delete(t.id!);
        t.kind = undefined;
        t.team = hit[0];
      }
    } else if (hit.length > 1) unknown.push(...runWords(r), `(${hit.length} teams named that)`);
    else if (!eventRun) eventRun = r;
    else unknown.push(...runWords(r));
  }
  // An event: a run with an event word in it, or one after "at", with any place right next to it as part of its name.
  if (eventRun) {
    let { from, to } = eventRun;
    while (from > 0 && toks[from - 1].kind === "place") from--;
    while (to < toks.length - 1 && toks[to + 1].kind === "place") to++;
    const ws = toks.slice(from, to + 1).map((t) => t.w);
    const atBefore = toks[from - 1]?.w === "at";
    if (ws.some((w) => EVENT_WORDS.has(w)) || atBefore) {
      found.event = ws.join(" ");
      if (toks.slice(from, to + 1).some((t) => t.kind === "place")) found.place = undefined;
    } else unknown.push(...runWords(eventRun));
  }
  // "worlds" and "states" with no team are event words for winners ("who won worlds").
  if (!found.event && strong.has("states") && !nums.length && !named.length) found.event = found.place ? `${found.place} championship` : undefined;
  // Numbers.
  const teamNums: string[] = [], years: string[] = [];
  for (const { t } of nums) (isYear(t.w) ? years : teamNums).push(String(Number(t.w)));
  for (const n of teamNums) if (await teamExists(n)) found.teams.push(n); else unknown.push(n);
  const markNumber = (n: string) => { for (const { t } of nums) if (String(Number(t.w)) === n) t.team = n; };
  found.teams.forEach(markNumber);
  // A name beside a typed number is a second team only when the query joins them ("12345 vs bad wolf"); else its
  // words are the question's ("total awards 12345" isn't two teams).
  const joined = strong.has("versus") || toks.some((t) => t.kind === "join");
  for (const n of named) {
    if (found.teams.includes(n)) continue;
    if (found.teams.length && !joined) { for (const t of toks) if (t.team === n) { t.team = undefined; unknown.push(t.w); } continue; }
    found.teams.push(n);
  }
  for (const y of years) {
    // A bare year with nothing else naming a team is the team (readTeamFact's rule), else the season.
    if (!found.teams.length && (await teamExists(y)) && !isTeamless(strong)) { found.teams.push(y); markNumber(y); }
    else if (!found.season) found.season = y;
    else unknown.push(y);
  }
  if (found.teams.length === 2 && strong.size && !strong.has("versus")) {
    // Two teams and a stat: the comparison, which shows it side by side (two-team intents first).
    found.extra.add("versus");
  }
  if (found.teams.length === 2) { strong.clear(); strong.add("versus"); if (found.extra.has("who wins") || weak.has("win")) found.extra.add("who wins"); }
  // Forbidden words a phrase didn't take ("not", "or" with one team) block the keyword reading.
  const blocking = forbidden.filter((w) => !(found.teams.length === 2 && /^(?:vs|versus|or|and|better|than)$/.test(w)));
  const joins = toks.filter((t) => t.kind === "join").map((t) => t.w);
  if (found.teams.length < 2 && joins.length) blocking.push(...joins);
  let intents = [...strong];
  // The team rule.
  intents = intents.filter((id) => { const it = INTENTS.find((x) => x.id === id)!; return it.team === "required" ? found.teams.length === 1 : it.team === "forbidden" ? !found.teams.length : true; });
  // A phase alone with a team is the phase's OPR; with no team, a leaderboard by it.
  if (!intents.length && found.phase && found.teams.length === 1) intents = ["opr"];
  // A leaderboard word with a stat word; a stat word ("opr", "wins") with no team is that stat's word, not its intent.
  if (strong.has("leaderboard") && !found.teams.length) intents = ["leaderboard"];
  if (strong.has("winners") && !found.teams.length) intents = ["winners"];
  if (strong.has("count") && !found.teams.length) intents = ["count"];
  // A definition, asked as one: "define", "meaning", or "what is …" with no team ("what is opr please").
  if (!found.teams.length && (strong.has("meaning") || (/^(?:what is|what are|whats|what s|how is|how does)$/.test(ts.slice(0, 2).join(" ")) && intents.every((id) => INTENTS.find((x) => x.id === id)!.team === "required")))) intents = ["meaning"];
  // Precedence.
  intents = intents.filter((b) => !PRECEDENCE.some(([a, x]) => x === b && intents.includes(a)));
  const it = intents.length === 1 ? INTENTS.find((x) => x.id === intents[0])! : null;
  // Scope the intent can't take is never dropped: it blocks.
  if (it) {
    if (found.season && !it.scope.includes("season")) unknown.push(found.season);
    if (found.place && !it.scope.includes("place")) unknown.push(found.place);
    if (found.event && !it.scope.includes("event")) unknown.push(found.event);
  }
  if (it?.id === "meaning") {
    const term = toks.filter((t) => t.kind !== "scaffold" && t.kind !== "filler" && !(t.kind === "intent" && t.id === "meaning")).map((t) => t.w).join(" ");
    unknown.length = 0;
    return { teams: [], intents, weak: [], found, dropped, forbidden: blocking, unknown: term ? [] : ["(no term)"], canonical: term ? `what is ${term}` : null, teamFirst: null, intent: it };
  }
  let canonical = it && !blocking.length && !unknown.length ? it.canonical(found) : null;
  if (!canonical && it?.id === "events" && found.teams.length === 1 && !blocking.length && !unknown.length) {
    // A team's events with no season: its latest season with an event (said in the answer's title).
    const s = await get<{ season: number }>("SELECT MAX(season) AS season FROM event_teams WHERE team = ?", [Number(found.teams[0])]);
    if (s?.season) canonical = `${found.teams[0]} events in ${s.season}-${String((s.season + 1) % 100).padStart(2, "0")}`;
  }
  const weakIds = !intents.length && found.teams.length === 1 ? [...new Set([...weak].flatMap((w) => WEAK_SIGNALS[w]))] : [];
  let teamFirst: string | null = null;
  if (found.teams.length === 1 && !blocking.length) {
    const rest = toks.filter((t) => !t.team && t.kind !== "filler" && (t.kind !== "scaffold" || KEPT_CONNECTORS.has(t.w))).map((t) => t.w);
    while (rest.length && KEPT_CONNECTORS.has(rest[0])) rest.shift();
    while (rest.length && KEPT_CONNECTORS.has(rest.at(-1)!)) rest.pop();
    // A team and a place or season alone asks nothing more ("hypnotic robotics texas" stays a name in a state).
    const asks = toks.some((t) => !t.team && !t.kind && !/^\d+$/.test(t.w)) || toks.some((t) => t.kind === "intent" || t.kind === "phase" || t.kind === "award" || t.kind === "weak");
    if (rest.length && asks) teamFirst = `${found.teams[0]} ${rest.join(" ")}`;
  }
  return { teams: found.teams, intents, weak: weakIds, found, dropped, forbidden: blocking, unknown, canonical, teamFirst, intent: it };
}

/** Connectors that place what follows ("highest score at worlds"): kept in the team-first phrasing. */
const KEPT_CONNECTORS = new Set(["at", "in", "on", "during", "with"]);

/** Intents that never have a team: a year in them is a season ("who won worlds 2025"). */
const isTeamless = (strong: Set<string>) => [...strong].some((id) => INTENTS.find((x) => x.id === id)?.team === "forbidden");

// ---------------------------------------------------------------------------------------------------------------
// Layers 3 and 4: paraphrases and filler.

/** Layer 3: each paraphrase said the catalog's way, on whole words. */
export function paraphrase(q: string): { q: string; used: string[] } {
  let t = ` ${tokens(q).join(" ")} `;
  const used: string[] = [];
  for (const [from, to] of PARAPHRASES) {
    const f = ` ${from} `;
    // "what does X mean": the words around the term.
    if (from === "what does mean") { const m = / what does (.+?) mean /.exec(t); if (m) { t = t.replace(m[0], ` ${m[1]} meaning `); used.push(from); } continue; }
    if (from === "when did start") { const m = / when did (.+?) (?:start|begin|get started) /.exec(t); if (m) { t = t.replace(m[0], ` ${m[1]} rookie year `); used.push(from); } continue; }
    if (t.includes(f)) { t = t.split(f).join(` ${to} `); used.push(from); }
  }
  return { q: t.trim().replace(/\s+/g, " "), used };
}

/** Layer 4: FILLER taken out, on whole words, never inside a team's full name ("Just In Time" keeps "just"). */
export async function stripFiller(q: string): Promise<{ q: string; dropped: string[] }> {
  const ws = q.split(/\s+/).filter(Boolean);
  const low = ws.map((w) => nameKey(w));
  const keep = new Set<number>();
  const { byName } = await teamNames();
  for (let n = 5; n >= 2; n--) for (let i = 0; i + n <= low.length; i++) if (byName.has(low.slice(i, i + n).join(" "))) for (let k = i; k < i + n; k++) keep.add(k);
  const fill = phrases(FILLER).sort((a, b) => b.length - a.length);
  const out: string[] = [], dropped: string[] = [];
  for (let i = 0; i < ws.length;) {
    const f = fill.find((p) => p.every((w, k) => low[i + k] === w && !keep.has(i + k)));
    if (f) { dropped.push(f.join(" ")); i += f.length; continue; }
    out.push(ws[i]); i++;
  }
  // How the answer is to be shown, at the end only (TAIL_FILLER), one phrase after another ("…, in order, with scores").
  const tail = phrases(TAIL_FILLER).sort((a, b) => b.length - a.length);
  for (let cut = true; cut;) {
    cut = false;
    const end = out.map((w) => nameKey(w));
    const t = tail.find((p) => p.length < end.length && p.every((w, k) => end[end.length - p.length + k] === w));
    if (t) { dropped.push(t.join(" ")); out.splice(out.length - t.length); cut = true; }
  }
  // A greeting or a softener alone is not a query: nothing is made from nothing.
  return out.length ? { q: out.join(" "), dropped } : { q, dropped: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// What an answer is, for the layers and for reporting.

export const FALLBACK_NOTE = "isn't answered directly yet";

/** The one team a search is for, when the query was read as that team alone ("4215", "gearview", "4215 2024-25"):
 *  the results page then answers with its highlights (server/app.ts). Never a topic about the team (a section, facts,
 *  an event pick), a question search couldn't answer, nor one a layer read as the team and more ("how many teams
 *  named gearview", read as "9848 how many"): the words left besides its number, its name and a season ask something else. */
export function loneTeamHit(ans: SearchAnswer): SearchAnswer["hits"][number] | undefined {
  const one = ans.hits.filter((x) => x.kind === "team");
  if (ans.understood?.kind !== "team" || ans.understood.label.includes(FALLBACK_NOTE) || ans.suggest?.length || ans.stat || ans.card || one.length !== 1) return undefined;
  const t = one[0];
  if (t.section || t.href || t.atEvent || t.facts?.length || t.events?.length) return undefined;
  // Its number, its name's words (a filler word dropped: "bad wolf rn" read as "bad wolf"), "team" and a season are it.
  const name = new Set(t.title.replace(/^\d+\s*\|\s*/, "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const more = (ans.understood.showing ?? "").toLowerCase().split(/\s+/)
    .filter((w) => w && w !== t.ref && w !== "team" && !name.has(w) && !/^\d{4}(?:[-–]\d{2,4})?$/.test(w));
  return more.length ? undefined : t;
}
/** The key failures aggregate under: Layer 0, lowercased, spaces folded, FILLER taken out (never inside a team's full
 *  name). Every other character stays, so a reporter's placeholders ("[email]") come through as they went in. */
export async function searchKey(q: string): Promise<string> {
  return (await stripFiller(normalizeQuery(q))).q.toLowerCase();
}

/** What an answer is: a direct answer, or which kind of failure (SearchOutcome.result). */
export function resultOf(a: SearchAnswer, asked: { team: boolean; intent: boolean }): OutcomeResult {
  const label = a.understood?.label ?? "";
  if (label.includes(FALLBACK_NOTE)) return "team-fallback";
  if (a.stat || a.card) return "answered";
  if (a.step === "recovery") return a.recovery?.closest?.length ? "weak" : "no-match";
  if (a.step === "did-you-mean") return "weak";
  if (a.understood?.kind === "names" && /^Teams, events and matches matching/.test(label) && asked.intent) return "name-search-only";
  if (!a.hits.length && !a.pages.length && asked.team) return "empty";
  return "answered";
}

/** The answer is about one team the query didn't name: not its number, not every word of its name. */
function guessedTeam(a: SearchAnswer, q: string): boolean {
  const top = a.hits[0];
  if (!top || top.kind !== "team") return false;
  const typed = new Set(tokens(q));
  if (typed.has(top.ref)) return false;
  const name = nameKey(top.title.replace(/^\d+\s*/, "")).split(" ").filter(Boolean);
  return !name.every((w) => typed.has(w));
}

/** Two answers say the same thing (the filler rule): the same card, stat or reading. */
const same = (a: SearchAnswer, b: SearchAnswer) =>
  JSON.stringify([a.stat?.title, a.stat?.headline?.value, a.card?.kind, a.card?.title, a.understood?.label, a.hits[0]?.ref, a.hits[0]?.section])
  === JSON.stringify([b.stat?.title, b.stat?.headline?.value, b.card?.kind, b.card?.title, b.understood?.label, b.hits[0]?.ref, b.hits[0]?.section]);

/** How the query was read, when a layer said it another way: the answer keeps its own label (the page's heading,
 *  which never quotes a rewritten query) and the words it was read as go on a quiet "Showing: …" line. */
function showing(a: SearchAnswer, typed: string, as: string): SearchAnswer {
  const u = a.understood ?? { kind: "names" as const, label: "" };
  return { ...a, q: typed, understood: { ...u, showing: as } };
}

// ---------------------------------------------------------------------------------------------------------------
// The layered path.

/** One layer's try: Layer 1 (`run`) on a query, then Layer 2 on it. */
type Run = (q: string) => Promise<SearchAnswer>;

/** The answer for a top-level query, through the layers. `run` is the existing reader path (Layer 1). */
export async function layeredAnswer(typed: string, reader: Run): Promise<SearchAnswer> {
  // A phrasing two layers reach ("what is endgame" is its own canonical form) is read once.
  const seen = new Map<string, Promise<SearchAnswer>>();
  const run: Run = (q) => { const k = q; if (!seen.has(k)) seen.set(k, reader(q)); return seen.get(k)!; };
  const layers: LayerId[] = ["normalize"];
  const q0 = normalizeQuery(typed);
  const x0 = await extract(q0);
  const asked = { team: x0.teams.length > 0 || !!x0.found.place || !!x0.found.event, intent: x0.intents.length > 0 || x0.weak.length > 0 || x0.found.extra.has("versus") };
  const strip = await stripFiller(q0);
  const normalized = strip.q.toLowerCase();
  const done = (a: SearchAnswer, won: LayerId | null, x: Extracted, result?: OutcomeResult, filler: string[] = []): SearchAnswer => {
    // A forbidden word an answer read past ("12345 today opr", with or without filler) is named, never silently
    // dropped. The reading line quotes the query, so only what the answer itself says counts as naming it: its card's
    // chips too ("Relaxed: this week → 2025–26" names "this week", said there once).
    const own = `${(a.understood?.label ?? "").split(" · read as ")[0]} ${a.stat?.title ?? ""} ${(a.stat?.scope ?? []).join(" ")} ${a.card?.headline ?? ""} ${a.card?.none ?? ""}`.toLowerCase();
    // An answer can name the word its own way: "when did hypnotic last play" is its "Most recent match". A long
    // question's rule reads its words itself ("when was the last time 12345 went worlds": the appearances, newest first).
    // A compound answer (./answers/compound.ts) reads every clause it joins ("… and their opr"), or isn't given.
    const consumed = won === "longform" ? x0.forbidden.filter((w) => !tokens(a.understood?.showing ?? "").includes(w)) : [];
    const unread = won && !a.intent?.kind.startsWith("stat-compound-") ? x0.forbidden.filter((w) => !own.includes(w) && !SAID_AS[w]?.test(own) && !consumed.includes(w)) : [];
    if (unread.length && a.understood) a = { ...a, understood: { ...a.understood, label: `${a.understood.label} · ${unread.map((w) => `"${w}"`).join(", ")} isn't part of this answer` } };
    const out = { ...a, q: typed };
    outcomes.set(out, {
      typed, normalized, layers: [...new Set(layers)], won, result: result ?? (won ? "answered" : resultOf(a, asked)),
      team: x.teams[0] ?? null, intents: x.intents, weak: x.weak,
      scope: { ...(x.found.season ? { season: x.found.season } : {}), ...(x.found.place ? { place: x.found.place } : {}), ...(x.found.event ? { event: x.found.event } : {}) },
      filler: [...new Set(filler)],
    });
    return out;
  };
  const template = testLayers.template !== false, keyword = testLayers.keyword !== false;
  const ok = (a: SearchAnswer) => resultOf(a, asked) === "answered";
  const keywordTry = async (q: string, x: Extracted, layer: LayerId, left: string[]) => {
    if (!keyword) return null;
    for (const as of [x.canonical, x.teamFirst]) {
      if (!as) continue;
      layers.push(layer);
      const a = await run(as);
      if (ok(a)) return done(showing(a, typed, as), layer, x, "answered", left);
    }
    return null;
  };

  // A direct answer: a card, or a stat (the dropdown's has only its intent: its blocks are built for /search alone).
  const direct = (a: SearchAnswer) => ok(a) && !!(a.stat || a.card || a.intent?.kind.startsWith("stat-"));
  // Long form: a long question said the short way, once; taken only for a direct answer.
  let longDone = false;
  const longTry = async () => {
    if (longDone) return null;
    longDone = true;
    const lf = longForm(q0);
    if (!lf) return null;
    layers.push("longform");
    const xl = await extract(lf);
    if (template) { const a = await run(lf); if (direct(a)) return done(showing(a, typed, lf), "longform", xl); }
    const kl = await keywordTry(lf, xl, "longform", xl.dropped);
    return kl && direct(kl) ? kl : null;
  };

  // Layer 1.
  let base: SearchAnswer | null = null;
  if (template) {
    layers.push("template");
    base = await run(q0);
    if (ok(base)) {
      // A filler word never decides the answer.
      if (strip.dropped.length && strip.q !== q0) {
        const bare = await run(strip.q);
        if (ok(bare) && !same(bare, base)) { layers.push("filler"); return done(showing(bare, typed, strip.q), "filler", x0, "answered", strip.dropped); }
      }
      // A definition question beats a name search (brief section 10): "what does opr mean" read "mean" as the start
      // of a team's name. Never a stat answer: "mean scoring for quioxte" is an average.
      if (x0.intent?.id === "meaning" && x0.canonical && !base.card && !base.stat) {
        const k = await keywordTry(q0, x0, "keyword", x0.dropped);
        if (k?.card) return k;
      }
      // So does a leaderboard, count or winners question with every word read, over an answer about a team the query
      // never named in full ("opr leaders texas" read "leaders" as Newgen Leaders).
      if (x0.intent?.team === "forbidden" && x0.canonical && !x0.unknown.length && !x0.forbidden.length && guessedTeam(base, q0)) {
        const k = await keywordTry(q0, x0, "keyword", x0.dropped);
        if (k && !same(k, base)) return k;
      }
      // A long question Layer 1 answered only with names ("is 12345 better than 67890 at auto": the Compare; "who has
      // 12345 played against the most": a team called "Most"): its short form's direct answer wins.
      if (!direct(base)) { const lf = await longTry(); if (lf) return lf; }
      return done(base, "template", x0);
    }
  }
  // Long form, when Layer 1 had no direct answer: the question said the short way (./searchLongForm.ts).
  { const lf = await longTry(); if (lf) return lf; }
  // Layer 2.
  const k = await keywordTry(q0, x0, "keyword", x0.dropped);
  if (k) return k;
  // Layer 3.
  const p = paraphrase(q0);
  if (p.used.length) {
    layers.push("paraphrase");
    if (template) { const a = await run(p.q); if (ok(a)) return done(showing(a, typed, p.q), "paraphrase", await extract(p.q)); }
    const xp = await extract(p.q);
    const kp = await keywordTry(p.q, xp, "paraphrase", xp.dropped);
    if (kp) return kp;
  }
  // Layer 4.
  const s = await stripFiller(p.used.length ? p.q : q0);
  if (s.dropped.length) {
    layers.push("filler");
    if (template) { const a = await run(s.q); if (ok(a)) return done(showing(a, typed, s.q), "filler", await extract(s.q), "answered", s.dropped); }
    const xs = await extract(s.q);
    const ks = await keywordTry(s.q, xs, "filler", [...s.dropped, ...xs.dropped]);
    if (ks) return ks;
  }
  // Layer 5: a weak signal pointing at one intent.
  const xw = p.used.length ? await extract(p.q) : x0;
  const weakIt = xw.weak.length === 1 ? INTENTS.find((i) => i.id === xw.weak[0])! : null;
  // Scope the weak word's intent can't take blocks it, as for a strong one ("12345 based 2024-25" isn't the listing).
  const fits = (it: Intent, f: Found) => (!f.season || it.scope.includes("season")) && (!f.place || it.scope.includes("place")) && (!f.event || it.scope.includes("event"));
  if (keyword && weakIt && fits(weakIt, xw.found) && !xw.intents.length && !xw.forbidden.length && !xw.unknown.length) {
    const it = weakIt;
    const canonical = it.canonical({ ...xw.found, extra: new Set(xw.found.extra) });
    if (canonical) {
      layers.push("scope");
      const a = await run(canonical);
      if (ok(a)) return done(showing(a, typed, canonical), "scope", { ...xw, intents: [it.id] }, "answered", xw.dropped);
    }
  }
  // Layer 6: the existing answer, with the candidates named when two intents fit equally.
  layers.push("fallback");
  const fallback = base ?? (await run(q0));
  // Only when every word was read: a query with words nobody read isn't two clear readings.
  const clean = (x: Extracted) => !x.unknown.length && !x.forbidden.length && x.teams.length === 1;
  const cands = x0.intents.length > 1 && clean(x0) ? x0.intents : xw.weak.length > 1 && clean(xw) ? xw.weak : [];
  if (cands.length > 1) {
    const u = fallback.understood ?? { kind: "team" as const, label: "" };
    // Said as a question, never as the parser's own words (no "read as" on the page: the search results guide §7).
    const line = `${x0.teams[0]}: ${cands.join(" or ")}? Say which`;
    return done({ ...fallback, understood: { ...u, label: u.label ? `${u.label} · ${line}` : line } }, null, { ...x0, intents: cands }, "ambiguous");
  }
  return done(fallback, null, x0);
}
