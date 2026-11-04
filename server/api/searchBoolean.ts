// Boolean operators in search (docs/search-boolean.md): AND ("and", "&"), OR ("or", "|") and NOT ("not", or "-" before
// a term) between teams, and an exact phrase in double quotes. NOT binds tightest, then AND, then OR; no parentheses.
// What the query asks is read first (a match list, or a stat side by side), then the operators say which teams it
// covers. Fixed rules, no model: a match list is filtered from the teams' stored matches (./answers/matchSet.ts), a
// stat is each team's own stored answer. A full team name that holds an operator word ("Nuts and Bolts") stays a name.
//   "4215 and 6980", "4215 & 6980 matches"   the matches both teams played in, on either alliance, newest first
//   "4215 or 6980", "4215 | 6980"            the matches either team played in, each once
//   "4215 not 6980", "4215 -6980"            4215's matches without 6980 in them
//   "4215 and 6980 opr", "4215 or 6980 opr"  both teams' OPR side by side ("4215 vs 6980 opr")
//   "4215 not 6980 opr"                      4215's OPR
//   "\"Raider Robotics\""                    the teams named exactly that, then names holding the phrase
// "vs", "compare", "who wins" and "have … and … played" keep their own readings (./searchCoverage.ts, ./answers/read.ts).
import type { SearchAnswer, SearchHit } from "../../src/shared/api.js";
import type { LeaderboardRow, StatAnswer, StatBlock } from "../../src/shared/searchStat.js";
import { reportedTeleopIncludesEndgame } from "../data/seasons.js";
import { all } from "../db.js";
import { SEARCH_BROWSE, pagesFor } from "../../src/shared/search.js";
import { seasonLabel } from "../../src/shared/format.js";
import { teamNameOf } from "../../src/shared/teamTitle.js";
import { inScope, scopeChips, scopePhrase, type Scope } from "./answers/clauses.js";
import { matchRow, teamHref, teamLinks, teamMatches, type TeamMatch } from "./answers/matchSet.js";
import { readScope, readTwoTeam } from "./answers/read.js";
import { sourceOf, whoOf, type AnswerTeam } from "./answers/families/matches.js";
import { nameKey, teamExists, teamNames, teamsNamed } from "./searchLayers.js";
import { search } from "./search.js";

/** Matches listed at most, teams an expression may name at most, words a protected name may span. */
const LIST_CAP = 25, MAX_TEAMS = 8, NAME_SPAN = 8;
/** Names a quoted phrase is looked for in. */
const PHRASE_POOL = 200;
/** What a boolean query may ask besides its teams: the match list (nothing else asked, or "matches"). */
const MATCH_WORDS = /^(?:(?:shared|common|joint)\s+)?(?:matches|match|games|game|match list|match history|results)?(?:\s+(?:together|played|in common))?$/;
/** Words that ask a question the operators don't: left to the readers that answer it. */
const OWN_READING = /\b(?:vs\.?|versus|v|head to head|h2h|compare|comparison|who|which|better|stronger|win|wins|winning|beat|beats|faced|met|each other|against)\b/;

type Op = "and" | "or" | "not";
type Tok = { op: Op } | { word: string } | { phrase: string };
/** A literal: a team, or (negated) not that team. An expression is OR of AND groups. */
interface Lit { team: number; neg: boolean }
export interface BoolQuery { groups: Lit[][]; rest: string; ops: Op[]; phrase?: string }

const isOp = (t: Tok): t is { op: Op } => "op" in t;

/** The query's tokens: quoted phrases whole, "&" and "|" as operators wherever they stand, "-" before a term as NOT. */
function tokenize(raw: string): Tok[] {
  const out: Tok[] = [];
  const re = /"([^"]*)"|([^\s"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    if (m[1] != null) { if (m[1].trim()) out.push({ phrase: m[1].trim() }); continue; }
    for (const piece of m[2].split(/([&|])/).filter(Boolean)) {
      if (piece === "&") out.push({ op: "and" });
      else if (piece === "|") out.push({ op: "or" });
      else {
        const w = piece.toLowerCase().replace(/^[#]+(?=\d)/, "").replace(/[?!,;.]+$/, "");
        if (!w) continue;
        if (w === "and" || w === "or" || w === "not") out.push({ op: w });
        else if (/^-[^-]/.test(w)) out.push({ op: "not" }, { word: w.slice(1) });
        else out.push({ word: w });
      }
    }
  }
  return out;
}

/** Runs of words that spell a team's full name with an operator word inside ("nuts and bolts", "wingus & dingus"):
 *  one name, never an operator. Longest first, left to right. */
async function protectNames(toks: Tok[]): Promise<Tok[]> {
  if (!toks.some(isOp)) return toks;
  const { byName } = await teamNames();
  const text = (t: Tok) => (isOp(t) ? (t.op === "and" ? "and" : t.op === "or" ? "or" : "not") : "word" in t ? t.word : null);
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    let took = 0, name = "";
    for (let n = Math.min(NAME_SPAN, toks.length - i); n >= 3; n--) {
      const span = toks.slice(i, i + n);
      if (isOp(span[0]) || isOp(span[n - 1]) || !span.slice(1, -1).some(isOp)) continue;
      const ws = span.map(text);
      if (ws.some((w) => w == null)) continue;
      // "&" is folded away by the name key, as it is in the stored name ("Nuts & Bolts" is "nuts bolts").
      const said = ws.join(" "), amp = span.map((t, j) => (isOp(t) && t.op === "and" ? "&" : ws[j])).join(" ");
      // Kept as it matched, so the term reads back as that name.
      if (byName.has(nameKey(said))) { took = n; name = said; break; }
      if (byName.has(nameKey(amp))) { took = n; name = amp; break; }
    }
    if (took) { out.push({ phrase: name }); i += took - 1; }
    else out.push(toks[i]);
  }
  return out;
}

/** The one team a term names (a number on record, or one full name), or null. */
async function teamOf(t: Tok | Tok[]): Promise<number | null> {
  const ts = Array.isArray(t) ? t : [t];
  if (ts.length === 1 && "phrase" in ts[0]) {
    const named = (await teamNames()).byName.get(nameKey(ts[0].phrase)) ?? [];
    return named.length === 1 ? Number(named[0]) : null;
  }
  const ws = ts.map((x) => ("word" in x ? x.word : null));
  if (ws.some((w) => w == null)) return null;
  if (ws.length === 1 && /^\d{1,6}$/.test(ws[0]!)) return (await teamExists(ws[0]!)) ? Number(ws[0]) : null;
  // Read as one name: a word that folds to nothing ("-" in "Raider Robotics - Gold") leaves no gap.
  const named = await teamsNamed(nameKey(ws.join(" ")).split(" ").filter(Boolean));
  return named.length === 1 ? Number(named[0]) : null;
}

/** The boolean expression `raw` is (the query as typed, quotes and all), or null: no operator between two teams, a
 *  term that isn't one team, or words before the teams (a question the readers answer: "compare 4215 and 6980"). */
export async function readBoolean(raw: string): Promise<BoolQuery | null> {
  const toks = await protectNames(tokenize(String(raw ?? "").slice(0, 120)));
  if (!toks.some(isOp)) return null;
  // Runs of words, and the operators joining each to the one before: "and", "or", "not", "and not", "or not".
  const runs: Tok[][] = [], joins: Op[][] = [];
  let pend: Op[] = [];
  for (const t of toks) {
    if (isOp(t)) { if (!runs.length) return null; pend.push(t.op); continue; }
    if (!runs.length || pend.length) { if (runs.length) joins.push(pend); runs.push([t]); pend = []; }
    else runs[runs.length - 1].push(t);
  }
  if (pend.length || runs.length < 2) return null;
  if (!joins.every((j) => j.length === 1 || (j.length === 2 && j[0] !== "not" && j[1] === "not"))) return null;
  const terms: number[] = [];
  for (const r of runs.slice(0, -1)) { const n = await teamOf(r); if (n == null) return null; terms.push(n); }
  // The last run: the longest start that names a team, the rest is what's asked ("6980 opr").
  const last = runs[runs.length - 1];
  let rest = "", lastTeam: number | null = null;
  for (let k = last.length; k >= 1 && lastTeam == null; k--) {
    lastTeam = await teamOf(last.slice(0, k));
    if (lastTeam != null) rest = last.slice(k).map((t) => ("word" in t ? t.word : `"${(t as { phrase: string }).phrase}"`)).join(" ");
  }
  if (lastTeam == null) return null;
  terms.push(lastTeam);
  // A year beside a team number is a season, as search reads "4215 and 2024" (never two teams).
  const year = (n: number) => n >= 1990 && n <= 2099;
  if (terms.some(year) && !terms.every(year)) return null;
  // Groups: OR starts one, AND and NOT join the term to it; NOT marks the term after it.
  const groups: Lit[][] = [[{ team: terms[0], neg: false }]];
  joins.forEach((j, i) => {
    if (j[0] === "or") groups.push([]);
    groups[groups.length - 1].push({ team: terms[i + 1], neg: j.includes("not") });
  });
  const ops = joins.flat();
  const teams = new Set(terms);
  if (teams.size < 2 || teams.size > MAX_TEAMS) return null;
  // Every group needs a team it's about ("or not 6980" alone isn't a list), and no team both wanted and not.
  if (groups.some((g) => !g.some((l) => !l.neg) || g.some((l) => !l.neg && g.some((x) => x.neg && x.team === l.team)))) return null;
  if (OWN_READING.test(rest)) return null;
  return { groups, rest, ops: [...new Set(ops)] };
}

const keyOf = (m: TeamMatch) => `${m.season}|${m.code}|${m.level}|${m.series}|${m.number}`;
/** The teams on the field in a match, read from one team's side of it. */
const onField = (m: TeamMatch, team: number) => new Set([...(m.onField ? [team] : []), ...m.partners, ...m.opponents]);
/** Newest first: events by their first day (a match's own time never moves it out of its event), then the event's own
 *  order backwards: playoffs before qualifications, the final (series 0) first, then by series and number. */
function newestFirst(ms: TeamMatch[]): (a: TeamMatch, b: TeamMatch) => number {
  const day = new Map<string, string>();
  for (const m of ms) { const k = `${m.season}|${m.code}`, d = (m.date ?? "").slice(0, 10); if (!day.has(k) || d < day.get(k)!) day.set(k, d); }
  const dayOf = (m: TeamMatch) => day.get(`${m.season}|${m.code}`) ?? "";
  return (a, b) => dayOf(b).localeCompare(dayOf(a)) || b.season - a.season || b.code.localeCompare(a.code)
    || Number(b.level === "playoff") - Number(a.level === "playoff") || Number(b.level === "playoff" && b.series === 0) - Number(a.level === "playoff" && a.series === 0) || b.series - a.series || b.number - a.number;
}

/** The expression in words: "4215 and 6980", "4215 or 6980", "4215 without 6980". */
function said(groups: Lit[][]): string {
  return groups.map((g) => {
    const pos = g.filter((l) => !l.neg).map((l) => String(l.team)), neg = g.filter((l) => l.neg).map((l) => String(l.team));
    return `${pos.join(" and ")}${neg.length ? ` without ${neg.join(" or ")}` : ""}`;
  }).join(" or ");
}

const RULE = "A match counts when the team's robot was on the field, on either alliance, at an official event (qualifiers, league play, championships and premier events; never scrimmages). AND: every team named is in the match; OR: any of them is (each match listed once); NOT: the team after it isn't. NOT is read first, then AND, then OR.";

/** The match list for an expression: every match that satisfies it, newest first, capped. */
async function matchListAnswer(b: BoolQuery, scope: Scope, who: Map<number, AnswerTeam>): Promise<StatAnswer> {
  const sets = new Map<number, TeamMatch[]>();
  for (const t of new Set(b.groups.flat().map((l) => l.team))) { const keep = inScope(scope); sets.set(t, (await teamMatches(t)).filter((m) => m.onField && keep(m))); }
  const seen = new Set<string>(), hits: { m: TeamMatch; team: number }[] = [];
  for (const g of b.groups) {
    // A group's matches are among its first team's.
    const lead = g.find((l) => !l.neg)!.team;
    for (const m of sets.get(lead) ?? []) {
      const on = onField(m, lead);
      if (!g.every((l) => on.has(l.team) !== l.neg) || seen.has(keyOf(m))) continue;
      seen.add(keyOf(m)); hits.push({ m, team: lead });
    }
  }
  const order = newestFirst(hits.map((h) => h.m));
  hits.sort((x, y) => order(x.m, y.m));
  const where = scopePhrase(scope);
  const and2 = b.groups.length === 1 && b.groups[0].length === 2 && b.groups[0].every((l) => !l.neg);
  const title = `${b.groups.length === 1 && !b.groups[0].some((l) => l.neg) ? `Matches with ${b.groups[0].map((l) => l.team).join(" and ")}` : `Matches: ${said(b.groups)}`}${where}`;
  const base = { family: "two-team" as const, intent: `boolean-${b.groups.length > 1 ? "or" : b.groups[0].some((l) => l.neg) ? "not" : "and"}`, title, scope: scopeChips(scope), definition: RULE, source: sourceOf(hits.map((h) => h.m)) };
  const teams = [...sets.keys()];
  const counts: StatBlock = { kind: "kpis", items: teams.map((t) => ({ label: whoOf(who.get(t) ?? { number: t, name: null }), value: String(sets.get(t)!.length), sub: `match${sets.get(t)!.length === 1 ? "" : "es"}${where}`, href: teamHref(t, scope.season) })) };
  if (!hits.length) {
    // An empty AND says so plainly, with each team's own count to re-scope from ("4215 or 6980").
    const anyOr = teams.join(" or ");
    const none = and2 ? `${whoOf(who.get(teams[0])!)} and ${whoOf(who.get(teams[1])!)} have no shared matches${where}.`
      : b.groups.length === 1 && b.groups[0].every((l) => !l.neg) ? `No match${where} has all of ${teams.join(", ")} in it.`
      : `No matches${where} for ${said(b.groups)}.`;
    return { ...base, none, blocks: [counts, { kind: "links", title: "Try instead", items: [{ label: `Matches with ${anyOr}`, href: `/search?q=${encodeURIComponent(anyOr)}` }] }] };
  }
  const shown = hits.slice(0, LIST_CAP);
  const links = await teamLinks(shown.flatMap((h) => [h.team, ...h.m.partners, ...h.m.opponents]));
  const rows = shown.map((h) => matchRow(h.m, links, h.team));
  let label = `match${hits.length === 1 ? "" : "es"}${where}`;
  if (and2) {
    const [a, c] = b.groups[0].map((l) => l.team);
    const together = hits.filter((h) => h.m.partners.includes(c) || (h.team === c && h.m.partners.includes(a))).length;
    label = `${label}: ${together} as partners, ${hits.length - together} as opponents`;
  }
  const newest = hits[0].m;
  return {
    ...base,
    headline: { value: String(hits.length), label, sub: `Latest: ${newest.label} at ${newest.event}, ${seasonLabel(newest.season)}`, href: rows[0].href },
    blocks: [{ kind: "matches", title: "Matches, newest first", rows, ...(hits.length > LIST_CAP ? { more: `Showing ${LIST_CAP} of ${hits.length}` } : {}) }, counts],
  };
}

type Reader = (q: string) => Promise<SearchAnswer>;

/** One team's own answer to what's asked, when it is a stat answer about that team. */
async function ownStat(read: Reader, team: number, rest: string, full: boolean): Promise<SearchAnswer | null> {
  let a = await read(`${team} ${rest}`);
  // A stat search answers on its own only with a scope ("4215 record" is the team's card): this season, said so.
  const { scope } = readScope(` ${rest} `);
  if (!a.intent?.kind.startsWith("stat-") && scope.season == null && !scope.latest && !scope.ever && !scope.championship && !scope.states) a = await read(`${team} ${rest} this season`);
  if (a.step === "recovery" || !a.intent?.kind.startsWith("stat-")) return null;
  if (full && (!a.stat || a.stat.team?.number !== team)) return null;
  return a;
}

/** A boolean query's answer, or null when `raw` isn't one (./searchAnswer.ts tries this before the layers). `read` is
 *  Layer 1 for a query; `full`: the page's answer (the dropdown's leaves the blocks out). */
export async function booleanAnswer(raw: string, read: Reader, full: boolean): Promise<SearchAnswer | null> {
  const phrase = await phraseAnswer(raw, read);
  if (phrase) return phrase;
  const q = String(raw ?? "").replace(/\s+/g, " ").trim();
  const b = await readBoolean(raw);
  if (!b) return notStatAnswer(raw, q, read, full);
  const wanted = [...new Set(b.groups.flat().filter((l) => !l.neg).map((l) => l.team))];
  const left = [...new Set(b.groups.flat().filter((l) => l.neg).map((l) => l.team))].filter((t) => !wanted.includes(t));
  const { scope: rs, rest } = readScope(` ${b.rest} `);
  const hitsOf = async (ts: number[]) => (await Promise.all(ts.map(async (t) => (await read(String(t))).hits.find((h) => h.kind === "team" && h.ref === String(t))))).filter((h): h is SearchHit => !!h && !h.href);
  // A match list opens each team's matches; a stat keeps the section its own answer opens.
  const base = (hits: SearchHit[], label: string, kind: string, section?: SearchHit["section"]): SearchAnswer => ({
    q, hits: hits.map((h) => ({ ...h, ...(section ? { section } : {}), facts: undefined, events: undefined })), pages: pagesFor(q), step: "deterministic", weak: false,
    understood: { kind: "question", label }, intent: { kind, pattern: `[team] ${b.ops.join(" ")} [team]`, met: true, understood: [label] },
  });

  // The match list: nothing else asked, or "matches", with a season or a match type at most.
  if (MATCH_WORDS.test(rest) && !rs.at && !rs.alliance) {
    const all = [...new Set(b.groups.flat().map((l) => l.team))];
    const hits = await hitsOf(all);
    if (hits.length !== all.length) return null;
    const who = new Map(hits.map((h) => [Number(h.ref), { number: Number(h.ref), name: teamNameOf(h.title) || null }]));
    const scope: Scope = { season: rs.season, championship: rs.championship, states: rs.states, level: rs.level ?? undefined };
    // "This season": the newest season any of the teams played.
    if (rs.latest && scope.season == null) {
      const seasons = (await Promise.all(wanted.map((t) => teamMatches(t)))).flat().map((m) => m.season);
      scope.season = seasons.length ? Math.max(...seasons) : null;
    }
    const label = `Matches: ${b.groups.map((g) => g.filter((l) => !l.neg).map((l) => whoOf(who.get(l.team)!)).join(" and ") + (g.some((l) => l.neg) ? ` without ${g.filter((l) => l.neg).map((l) => whoOf(who.get(l.team)!)).join(" or ")}` : "")).join(" or ")}, either alliance${scopePhrase(scope)}`;
    const a = base(hits.filter((h) => wanted.includes(Number(h.ref))), label, `boolean-${b.ops.includes("or") ? "or" : b.ops.includes("not") ? "not" : "and"}`, "matches");
    return full ? { ...a, stat: await matchListAnswer(b, scope, who) } : a;
  }

  // A stat: each team's own, side by side; a team after NOT is left out.
  const teams = wanted.filter((t) => !left.includes(t));
  if (!b.rest || teams.length > MAX_TEAMS) return null;
  const note = left.length ? ` · ${left.join(", ")} left out ("not")` : "";
  if (teams.length === 1) {
    const a = await ownStat(read, teams[0], b.rest, full);
    return a && { ...a, q, understood: a.understood && { ...a.understood, label: `${a.understood.label}${note}` } };
  }
  // Two teams' OPR or prediction rating: the side-by-side answer itself ("4215 vs 6980 opr").
  if (teams.length === 2) {
    const vs = `${teams[0]} vs ${teams[1]} ${b.rest}`;
    const two = readTwoTeam(vs);
    if (two && two.id !== "head-to-head") {
      const a = await read(vs);
      if (a.intent?.kind === `stat-${two.id}` && (!full || a.stat)) return { ...a, q, understood: a.understood && { ...a.understood, label: `${a.understood.label} · read as "${vs}"${note}` } };
    }
  }
  // Any other stat: each team's own answer, its headline in one table, read as each team's own search reads it (a
  // total keeps every season). An answer about one season that came out for different seasons (each team's own
  // latest) is read again for the latest season every team played, so the values compare.
  const kindsOk = (xs: (SearchAnswer | null)[]) => !xs.some((x) => !x) && new Set(xs.map((x) => x!.intent!.kind)).size === 1;
  let own = await Promise.all(teams.map((t) => ownStat(read, t, b.rest, full)));
  if (!kindsOk(own)) return null;
  const seasons = () => [...new Set(own.map((x) => x!.understood?.season ?? null))];
  let shared: number | null = seasons().length === 1 ? seasons()[0] : null;
  if (seasons().length > 1) {
    shared = await sharedSeason(teams);
    if (shared == null) return null;
    const asked = `${b.rest.replace(/\b(?:this|current|the current|last|previous|past)\s+(?:season|year)\b/g, " ").replace(/\s+/g, " ").trim()} ${shared}-${String((shared + 1) % 100).padStart(2, "0")}`;
    own = await Promise.all(teams.map((t) => ownStat(read, t, asked, full)));
    if (!kindsOk(own)) return null;
  }
  const hits = own.map((a) => a!.hits.find((h) => h.kind === "team")!).filter(Boolean);
  if (hits.length !== teams.length) return null;
  const what = own[0]!.stat?.title ?? own[0]!.intent!.understood[own[0]!.intent!.understood.length - 1] ?? b.rest;
  const label = `${what}: ${teams.join(" vs ")}${note}`;
  const a = base(hits, label, `boolean-compare`);
  if (!full) return a;
  const stats = own.map((x) => x!.stat!);
  return { ...a, stat: await sideBySide(what, teams, stats, shared ?? (await sharedSeason(teams))) };
}

/** The latest season every team has matches in, or null. */
async function sharedSeason(teams: number[]): Promise<number | null> {
  const rows = await all<{ team: number; season: number }>(`SELECT team, season FROM team_season_stats WHERE team IN (${teams.map(() => "?").join(",")}) AND matches > 0`, teams);
  const seasons = [...new Set(rows.map((r) => Number(r.season)))].sort((x, y) => y - x);
  return seasons.find((x) => teams.every((t) => rows.some((r) => Number(r.team) === t && Number(r.season) === x))) ?? null;
}

const RECORD_TEXT = /^(\d+)-(\d+)-(\d+)$/;
/** A headline's number for sorting: a record's win share, else the number in it, else none. */
function numberOf(v: string | undefined): number | null {
  if (!v) return null;
  const r = RECORD_TEXT.exec(v);
  if (r) { const n = Number(r[1]) + Number(r[2]) + Number(r[3]); return n ? (Number(r[1]) + 0.5 * Number(r[3])) / n : null; }
  // A margin's minus is the typographic one ("−10.0").
  const x = Number.parseFloat(v.replace(/[−–]/g, "-").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : null;
}

/** Any other stat side by side: each team as the search's team table draws it (season OPR, its phases, penalties and
 *  record: the stored season numbers each team page shows), the stat asked as its own column, sorted by it. The
 *  season is the one named, else the latest every team played. */
async function sideBySide(what: string, teams: number[], stats: StatAnswer[], named: number | null): Promise<StatAnswer> {
  const rows = await all<any>(
    `SELECT s.team, s.season, t.name, t.city, t.state, t.country, s.opr_np, s.opr_auto, s.opr_teleop, s.opr_endgame, s.opr_pen, s.wins, s.losses, s.ties
     FROM team_season_stats s JOIN teams t ON t.number = s.team WHERE s.team IN (${teams.map(() => "?").join(",")}) AND s.matches > 0 ORDER BY s.season DESC`, teams);
  const has = (t: number, season: number) => rows.find((r) => Number(r.team) === t && Number(r.season) === season);
  const season = named ?? rows.map((r) => Number(r.season)).find((x) => teams.every((t) => has(t, x))) ?? null;
  const num = (x: unknown) => (x == null ? null : Number(x));
  const board: LeaderboardRow[] = teams.map((t, i) => {
    const r = season != null ? has(t, season) : undefined, s = stats[i];
    return {
      rank: i + 1, team: { label: `${t}${r?.name ? ` ${r.name}` : ""}`, href: teamHref(t, season) },
      location: r ? [r.city, r.state, r.country && r.country !== "USA" ? r.country : null].filter(Boolean).join(", ") || null : null,
      record: r ? `${r.wins}-${r.losses}-${r.ties}` : "–", opr: num(r?.opr_np), value: numberOf(s.headline?.value), display: s.headline?.value ?? "–",
      parts: r ? { auto: num(r.opr_auto), teleop: num(r.opr_teleop), endgame: num(r.opr_endgame), pen: num(r.opr_pen) } : null,
    };
  });
  const when = season != null ? seasonLabel(season) : "no season every team played";
  return {
    family: "two-team", intent: "boolean-compare", title: `${what}: ${teams.join(" vs ")}`, scope: stats[0].scope,
    headline: { value: board.map((r) => r.display).join(" vs "), label: `${what}: ${teams.join(" vs ")}` },
    definition: `${what} is each team's own answer, as its own search gives it (${stats.map((x, i) => `${teams[i]}: ${x.headline?.label ?? x.none ?? "none"}`).join("; ")}). The other columns are each team's stored ${when} season numbers, as its team page shows them. ${stats[0].definition}`,
    source: stats.map((x, i) => `${teams[i]}: ${x.source}`).join(" · "),
    blocks: [
      { kind: "leaderboard", title: `${what}, side by side`, stat: { id: "boolean-compare", label: what }, note: season != null ? `${when} season numbers` : when, rows: board,
        ...(season != null && reportedTeleopIncludesEndgame(season) ? { teleopWithEndgame: true } : {}) },
      { kind: "links", title: "Try it", items: [{ label: "Compare side by side", href: `/compare?teams=${[...teams].sort((x, y) => x - y).join(",")}${season != null ? `&season=${season}` : ""}` }] },
    ],
  };

}

/** A query that opens with one quoted phrase (`"Raider Robotics"`): the teams named exactly that first, then the names
 *  that hold the phrase word for word; never a name that only has the words apart, and when none holds it, that said
 *  plainly (the quotes are never dropped). With what's asked after it (`"bad wolf" opr`), the one team named exactly
 *  that is answered; a name several teams share lists them, asking which. A quoted question (`"4215 opr"`) is read as
 *  the question. */
async function phraseAnswer(raw: string, read: Reader): Promise<SearchAnswer | null> {
  const toks = tokenize(String(raw ?? "").slice(0, 120));
  if (!toks.length || !("phrase" in toks[0]) || toks.some(isOp) || toks.slice(1).some((t) => "phrase" in t)) return null;
  const phrase = toks[0].phrase, key = nameKey(phrase), q = String(raw ?? "").replace(/\s+/g, " ").trim();
  const rest = toks.slice(1).map((t) => ("word" in t ? t.word : "")).join(" ");
  const exact = (await teamNames()).byName.get(key) ?? [];
  if (rest && exact.length === 1) {
    const a = await read(`${exact[0]} ${rest}`);
    if (a.step !== "recovery") return { ...a, q, understood: a.understood && { ...a.understood, label: `${a.understood.label} · "${phrase}" read as the exact name` } };
  }
  const a = await read(phrase);
  // A question answered as one (the page's stat or card, the dropdown's reading of it) is that question's.
  if (!rest && (a.stat || a.card || a.intent || a.understood?.kind === "question" || a.understood?.kind === "compare")) return null;
  const holds = (h: SearchHit) => h.ref === key || ` ${nameKey(h.kind === "team" ? teamNameOf(h.title) : h.title)} `.includes(` ${key} `);
  const isExact = (h: SearchHit) => h.kind === "team" && exact.includes(h.ref);
  // The phrase is looked for in a wide list of names (PHRASE_POOL), never only in the caller's few: a name with the words
  // apart can rank above one that holds them.
  const pool = [...a.hits, ...(await search(phrase, PHRASE_POOL))];
  const missing = exact.filter((n) => !pool.some((h) => h.kind === "team" && h.ref === n));
  const extra = (await Promise.all(missing.slice(0, 25).map(async (n) => (await read(n)).hits.find((h) => h.kind === "team" && h.ref === n)))).filter((h): h is SearchHit => !!h);
  const seen = new Set<string>();
  const kept = [...pool, ...extra].filter((h) => holds(h) && !seen.has(`${h.kind}:${h.ref}`) && !!seen.add(`${h.kind}:${h.ref}`));
  const unread = rest ? ` · "${rest}" isn't read: ${exact.length > 1 ? `${exact.length} teams are named "${phrase}", so say which by its number` : `no team is named exactly "${phrase}"`}` : "";
  if (!kept.length) {
    const none = `No team or event name holds "${phrase}" word for word${unread}`;
    return { q, hits: [], pages: pagesFor(q), step: "recovery", weak: true, understood: { kind: "names", label: none },
      recovery: { understood: [none], closest: a.hits.slice(0, 5).map((h) => ({ ...h, match: "fuzzy" as const })), browse: SEARCH_BROWSE } };
  }
  const hits = [...kept.filter(isExact), ...kept.filter((h) => !isExact(h))].map((h) => ({ ...h, match: "exact" as const }));
  const label = exact.length ? `Exact name "${phrase}": ${exact.length} team${exact.length === 1 ? "" : "s"} named exactly that${hits.length > exact.length ? ", then names holding the phrase" : ""}` : `Names holding "${phrase}" word for word`;
  return { q, hits, pages: pagesFor(q), step: "deterministic", weak: false, understood: { kind: "names", label: `${label}${unread}` } };
}

/** "4215 not opr": NOT before a word that isn't a team. NOT leaves a team out of a list; it can't leave out a stat, so
 *  the answer says so plainly and offers what was likely meant, never the team page as if it had answered. */
async function notStatAnswer(raw: string, q: string, read: Reader, full: boolean): Promise<SearchAnswer | null> {
  const toks = await protectNames(tokenize(String(raw ?? "").slice(0, 120)));
  const at = toks.findIndex(isOp);
  if (at < 1 || !isOp(toks[at]) || toks[at].op !== "not" || toks.slice(at + 1).some(isOp) || toks.length === at + 1) return null;
  const team = await teamOf(toks.slice(0, at));
  const after = toks.slice(at + 1);
  if (team == null || (await teamOf(after)) != null || after.some((t) => !("word" in t))) return null;
  const words = after.map((t) => (t as { word: string }).word).join(" ");
  const hit = (await read(String(team))).hits.find((h) => h.kind === "team" && h.ref === String(team));
  if (!hit || hit.href) return null;
  const who = whoOf({ number: team, name: teamNameOf(hit.title) || null });
  const line = `"not" leaves a team out ("${team} not 6980"); "${words}" isn't a team, so nothing was left out`;
  const a: SearchAnswer = {
    q, hits: [{ ...hit, facts: undefined, events: undefined }], pages: pagesFor(q), step: "deterministic", weak: false,
    understood: { kind: "question", label: `${who} · ${line}` }, intent: { kind: "boolean-not", pattern: "[team] not [word]", met: false, understood: [`Team ${who}`, line] },
  };
  if (!full) return a;
  const ask = (x: string) => ({ label: x, href: `/search?q=${encodeURIComponent(x)}` });
  const stat: StatAnswer = {
    family: "stat", intent: "boolean-not", title: `${team} not ${words}`, team: { number: team, name: teamNameOf(hit.title) || null }, scope: [],
    none: `"Not" leaves a team out of a list, as in "${team} not 6980" (${team}'s matches without 6980). "${words}" isn't a team, so there's nothing to leave out.`,
    definition: RULE, source: "No numbers read: the query names no team after \"not\"",
    blocks: [{ kind: "links", title: "Did you mean", items: [ask(`${team} ${words}`), ask(`${team} matches`)] }],
  };
  return { ...a, stat };
}
