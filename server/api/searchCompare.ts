// "hypnotic versus bad wolf history": Compare for the teams named (2–4), as its own kind of result (never a team).
//
// Each side names a team by number, or by name. A name several teams share exactly ("Ultraviolet": 18304, 20245,
// 23268) is resolved by the parser's fixed rules (./query/shared.ts), the same on every surface: the visitor's own
// team, the same state or province as a team another side named ("ultraviolet vs hypnotic": Hypnotic is in NJ, so the
// Ultraviolet from Hackettstown, NJ), the only one that has played, the only one still playing, the clearly stronger.
// Every team with exactly that name is a candidate (from the teams table, never cut by a display limit), and the pick
// is recorded with its rule (`compare.resolved`). Still tied: no team is guessed. With one side tied, one Compare per
// candidate (all of them), each naming its team's place, for the visitor to pick; with several sides tied, the
// question for each, and no Compare until they're picked.
// Trailing words never break the versus: topic words ("history", "record", "stats") are dropped, and when a side
// still names no team, its last words are dropped one at a time until it does ("67890 please" → 67890).
import type { SearchAnswer, SearchCompareSide, SearchHit } from "../../src/shared/api.js";
import { SEARCH_BROWSE, VERSUS, pagesFor } from "../../src/shared/search.js";
import { cleanTeamName, searchTeamTitle, teamWords } from "../../src/shared/teamTitle.js";
import { hasTeamPage, teamPageSql } from "../../src/shared/teamPages.js";
import { seasonLabel } from "../../src/shared/format.js";
import { all, get } from "../db.js";
import { normalize } from "./fuzzy.js";
import { search, searchIntent } from "./search.js";
import { pickShared } from "./query/shared.js";
import { onlyOrdinary } from "./query/ordinary.js";

interface TeamFacts { number: number; name: string; city: string | null; state: string | null; country: string | null; lastPlayed: number | null; strength: number | null }

async function teamFacts(nums: number[]): Promise<Map<number, TeamFacts>> {
  if (!nums.length) return new Map();
  const rows = await all<any>(`SELECT t.number, t.name, t.city, t.state, t.country,
      (SELECT MAX(s.season) FROM team_event_stats s WHERE s.team = t.number AND s.matches > 0) lastPlayed,
      (SELECT MAX(1.0 - CAST(x.rank_np AS REAL) / x.ranked_teams) FROM (SELECT rank_np, ranked_teams FROM team_season_stats y
        WHERE y.team = t.number AND y.rank_np IS NOT NULL AND y.ranked_teams > 0 ORDER BY y.season DESC LIMIT 2) x) strength
    FROM teams t WHERE t.number IN (${nums.map(() => "?").join(",")})`, nums);
  return new Map(rows.map((r) => [Number(r.number), { number: Number(r.number), name: r.name ?? "", city: r.city, state: r.state, country: r.country, lastPlayed: r.lastPlayed == null ? null : Number(r.lastPlayed), strength: r.strength == null ? null : Number(r.strength) }]));
}

const placeOf = (t: TeamFacts) => [t.city, t.state].filter(Boolean).join(", ") || t.country || "";
const sideOf = (t: TeamFacts): SearchCompareSide => ({ number: t.number, name: cleanTeamName(t.number, t.name) ?? "", place: placeOf(t) });

/** What one side of a versus names: a team, several equally (a shared name), or nothing. `pool`: a shared name's
 *  teams, read again once the other sides are (./query/shared.ts: another side's state comes before the name's own). */
type Side = { typed: string; team: TeamFacts | null; tied: TeamFacts[]; rule?: string; candidates: number[]; pool?: TeamFacts[] };

/** Every team named exactly `name` (FIRST's stored name, a number inside it left out; accents, case, punctuation and
 *  spacing as search folds them), whatever search would show. Candidates come from the search index (which folds the
 *  same way, "cafe" finds "Café") and a plain name match, then the same equality decides. */
async function exactNamed(name: string): Promise<number[]> {
  const viaIndex = (await search(name, 50, new Set(), new Set(["team"]))).filter((h) => h.kind === "team").map((h) => Number(h.ref));
  const viaName = (await all<{ number: number }>("SELECT number FROM teams WHERE name LIKE ?", [`%${name.replace(/[%_]/g, "")}%`])).map((r) => Number(r.number));
  const nums = [...new Set([...viaIndex, ...viaName])];
  if (!nums.length) return [];
  const rows = await all<{ number: number; name: string }>(`SELECT number, name FROM teams WHERE number IN (${nums.map(() => "?").join(",")}) AND ${teamPageSql("number", "name")}`, nums);
  return rows.filter((r) => normalize(cleanTeamName(Number(r.number), r.name) ?? "") === normalize(name)).map((r) => Number(r.number)).sort((x, y) => x - y);
}

/** The team (or teams, tied) one side names, from its words as typed. */
async function sideTeams(name: string, prefer: ReadonlySet<string>, best: boolean): Promise<{ exact: number[] } | { best: number } | null> {
  // Only teams with a page: never a stand-in number (202300005) or a placeholder registration, which /compare refuses.
  if (/^\d+$/.test(name)) { const t = (await teamFacts([Number(name)])).get(Number(name)); return t && hasTeamPage(t.number, t.name) ? { exact: [t.number] } : null; }
  const exact = await exactNamed(name);
  if (exact.length) return { exact };
  if (!best) return null;
  const top = (await search(name, 5, prefer)).find((h) => h.kind === "team" && hasTeamPage(Number(h.ref)));
  return top ? { best: Number(top.ref) } : null;
}

/** Words that say how or when, never which team: a side made only of them is no team's name. */
const COMMON_WORDS = /^(?:when|where|what|how|if|they|them|their|it|its|we|us|our|you|he|she|do|does|did|is|are|was|were|the|a|an|in|at|by|of|lose|loses|losing|lost|loss|losses|win|wins|winning|won|beat|beats|beaten|best|worst|better|worse|good|bad|high|low|score|scores|scored|average|play|plays|played|matches|match)$/;

async function readSide(typed: string, prefer: ReadonlySet<string>): Promise<Side> {
  // Topic and filler words name no team ("… history").
  const words = (searchIntent(typed)?.rest ?? typed).trim().split(/\s+/).filter(Boolean);
  // The whole side first, then without its last words ("67890 please" → "67890"): an exact name or number, then
  // search's best team.
  let found: Awaited<ReturnType<typeof sideTeams>> = null;
  // A side of only question, result and ordinary words ("when they lose", "at worlds head to head") names a team only
  // by that exact name, all of it: never by search's closest one ("Raiders of the Lost Bot", "Faker for Worlds") nor
  // by a few of its words.
  const plain = words.length > 0 && (words.every((w) => COMMON_WORDS.test(w.toLowerCase())) || onlyOrdinary(words.join(" ")));
  if (plain) found = await sideTeams(words.join(" "), prefer, false);
  else for (const best of [false, true]) {
    for (let n = words.length; n >= 1 && !found; n--) found = await sideTeams(words.slice(0, n).join(" "), prefer, best);
    if (found) break;
  }
  const none: Side = { typed, team: null, tied: [], candidates: [] };
  if (!found) return none;
  const typedNumber = /^\d+$/.test(words.join(" "));
  const nums = "best" in found ? [found.best] : found.exact;
  const all = [...(await teamFacts(nums)).values()].sort((a, b) => a.number - b.number);
  const candidates = all.length > 1 ? all.map((t) => t.number) : [];
  const pick = (team: TeamFacts, rule?: string): Side => ({ typed, team, tied: [], ...(rule ? { rule } : {}), candidates, ...(all.length > 1 ? { pool: all } : {}) });
  if (all.length === 1) {
    // A registration alone names nothing, a number typed or the visitor's own team aside.
    return all[0].lastPlayed != null || typedNumber || prefer.has(`team:${all[0].number}`) ? pick(all[0]) : none;
  }
  if (!all.length) return none;
  const r = settle(all, prefer, []);
  if ("team" in r) return pick(r.team, r.rule);
  // Nothing played and none the visitor's: no team.
  if (!all.some((t) => t.lastPlayed != null) && !r.tied.some((t) => prefer.has(`team:${t.number}`))) return none;
  return { typed, team: null, tied: r.tied, candidates, pool: all };
}

/** The shared rules (./query/shared.ts) for one side's teams, `others` the teams the other sides settled on. */
function settle(all: TeamFacts[], prefer: ReadonlySet<string>, others: TeamFacts[]): { team: TeamFacts; rule: string } | { tied: TeamFacts[] } {
  const r = pickShared(all, { mine: (n) => prefer.has(`team:${n}`), others });
  // Said as Compare has always said it.
  return "team" in r && r.rule.startsWith("the one in the same region") ? { team: r.team, rule: `the one in the same state as the other team (${r.team.state})` } : r;
}

/** The question a still-tied side asks. */
const whichOf = (side: Side) => `Which "${side.typed}"? ${side.tied.length} teams have that name: ${side.tied.map((t) => `${t.number} (${placeOf(t)})`).join(", ")}`;

/** The team `typed` names, by the same fixed rules as a Compare side (a number, an exact name, your team, one that has
 *  played, the newest), or the teams still tied and the question to ask. Never a guess. */
export async function namedTeam(typed: string, prefer: ReadonlySet<string>): Promise<{ team: number } | { tied: number[]; question: string } | null> {
  const side = await readSide(typed, prefer);
  if (side.team) return { team: side.team.number };
  return side.tied.length ? { tied: side.tied.map((t) => t.number), question: whichOf(side) } : null;
}

/** Compare's hit for these teams (number order). */
function compareHit(teams: TeamFacts[], q: string, season: number | null, resolved: { typed: string; number: number; rule: string; candidates: number[] }[], extra = ""): SearchHit {
  const sorted = [...teams].sort((a, b) => a.number - b.number);
  const nums = sorted.map((t) => t.number);
  // "… awards": Compare opened on its events-and-awards section.
  const awards = /\bawards?\b/i.test(q);
  return {
    kind: "compare", ref: nums.join(","), season,
    href: `/compare?teams=${nums.join(",")}${season != null ? `&season=${season}` : ""}${awards ? "#awards" : ""}`,
    title: sorted.map((t) => teamWords(searchTeamTitle(t.number, t.name))).join(" vs "),
    subtitle: `${awards ? "Compare their events and awards side by side" : "Compare side by side: records, OPR and event history"}${extra}`,
    compare: { teams: sorted.map(sideOf), ...(resolved.length ? { resolved } : {}) },
  };
}

const uniqTeams = (ts: TeamFacts[]) => [...new Map(ts.map((t) => [t.number, t])).values()];

const teamHit = (t: TeamFacts, hits: Map<string, SearchHit>): SearchHit =>
  hits.get(String(t.number)) ?? { kind: "team", ref: String(t.number), title: searchTeamTitle(t.number, t.name), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season: t.lastPlayed };

/** A versus whose one side is a number no FTC team has ("12345 vs 99 opr", "99 vs 12345 record"): the question about
 *  the other side's team alone (the number and its "vs" taken out), and the number, or null. Only a number typed alone
 *  as the side's first word: a name that matches no team is still a comparison's (its recovery names it). */
export async function versusLoneTeam(q: string, prefer: ReadonlySet<string>): Promise<{ q: string; missing: number } | null> {
  const typedSides = q.split(VERSUS).map((s) => s.trim()).filter(Boolean);
  if (typedSides.length !== 2) return null;
  const firsts = typedSides.map((s) => /^\d{1,5}$/.exec(s.split(/\s+/)[0])?.[0] ?? null);
  const unknown = await Promise.all(firsts.map(async (n) => n != null && !(await teamFacts([Number(n)])).size));
  if (unknown.filter(Boolean).length !== 1) return null;
  const i = unknown.indexOf(true), n = firsts[i]!;
  // The other side a team: its number typed first, or its name.
  if (firsts[1 - i] == null && !(await readSide(typedSides[1 - i], prefer)).team) return null;
  const vs = VERSUS.source;
  const rest = (i === 1 ? q.replace(new RegExp(`${vs}${n}(?=\\s|$)`, "i"), " ") : q.replace(new RegExp(`(?:^|\\s)${n}${vs}`, "i"), " ")).replace(/\s+/g, " ").trim();
  return rest === q.trim() ? null : { q: rest, missing: Number(n) };
}

/** The answer for a versus query, or null when `q` isn't one. */
export async function versusAnswer(q: string, prefer: ReadonlySet<string>, season: number | null): Promise<SearchAnswer | null> {
  const typedSides = q.split(VERSUS).map((s) => s.trim()).filter(Boolean);
  if (typedSides.length < 2) return null;
  const sides = await Promise.all(typedSides.map((s) => readSide(s, prefer)));
  // A shared name read again beside the teams the other sides named: the one in the same state as one of them comes
  // before the rules that look only at the name's own teams (still playing, stronger). The visitor's own team stays.
  // A side that names one team, or a shared name its own teams settled (your team, the only one playing, the stronger):
  // never one settled only by another side, so two shared names can't settle each other.
  // Each side's team as first read is the anchor: a side moved by this loop never moves another, whatever the order.
  const firm = new Map(sides.filter((o) => o.team && (!o.pool || o.rule)).map((o) => [o, o.team!]));
  const moved = new Set<Side>();
  for (const side of sides) {
    if (!side.pool || side.rule === "your team") continue;
    // Only a real state on both sides.
    const others = sides.filter((o) => o !== side && firm.get(o)?.state).map((o) => firm.get(o)!);
    if (!others.length) continue;
    const r = settle(side.pool, prefer, others);
    if (!("team" in r)) continue;
    side.team = r.team; side.rule = r.rule; side.tied = [];
    if (r.rule.startsWith("the one in the same state")) moved.add(side);
  }
  // Two shared names can move past each other (one to the other's first state, the other away from it): a side moved to
  // be beside another team that is no longer beside it asks which, never a pick that says "the same state" and isn't.
  const beside = (a: TeamFacts, b: TeamFacts) => a.state === b.state && a.country === b.country;
  const apart = [...moved].filter((side) => !sides.some((o) => o !== side && o.team && beside(o.team, side.team!)));
  for (const side of apart) {
    // The name's teams that have played (a registration alone is never a choice), else every one.
    const played = side.pool!.filter((t) => t.lastPlayed != null);
    side.tied = played.length ? played : side.pool!; side.team = null; side.rule = undefined;
  }
  const resolved = sides.filter((s) => s.team && s.rule).map((s) => ({ typed: s.typed, number: s.team!.number, rule: s.rule!, candidates: s.candidates }));
  const known = [...new Map(sides.filter((s) => s.team).map((s) => [s.team!.number, s.team!])).values()];
  const missing = sides.filter((s) => !s.team && !s.tied.length).map((s) => s.typed);
  // Hits search already built for these teams (with their subtitles), so team rows look as they do everywhere.
  const teamRows = new Map<string, SearchHit>();
  for (const t of [...known, ...sides.flatMap((x) => x.tied)]) for (const h of await search(String(t.number), 1, prefer)) if (h.kind === "team") teamRows.set(h.ref, h);
  const ambiguous = sides.filter((s) => !s.team && s.tied.length);
  const understoodTeams = (ts: TeamFacts[]) => ts.map((t) => `${cleanTeamName(t.number, t.name) ?? "Team"} (${t.number})`).join(" vs ");

  if (missing.length) {
    // A side with no team: never a half-empty Compare. The teams found, and a note on the rest.
    return {
      q, hits: [], pages: pagesFor(q), step: "recovery", weak: true,
      recovery: { understood: [`A comparison of ${typedSides.length} teams`, ...missing.map((m) => `No team found for "${m}"`)], closest: known.map((t) => teamHit(t, teamRows)), browse: SEARCH_BROWSE },
    };
  }
  if (ambiguous.length) {
    // Still tied under the rules. One side tied: one Compare per candidate (every one), each with the teams the other
    // sides named. Several sides tied: the question for each, and the candidates to open; no Compare is guessed.
    const which = whichOf;
    const others = known.slice(0, 3);
    // A candidate another side already named is no choice: it would be that team against itself.
    const choices = ambiguous.length === 1 ? ambiguous[0].tied.filter((c) => !others.some((o) => o.number === c.number)) : [];
    const hits = others.length ? choices.map((c) => compareHit([...others, c], q, season, resolved, "")) : [];
    return {
      q, hits: [...hits, ...uniqTeams([...others, ...ambiguous.flatMap((s) => s.tied)]).map((t) => teamHit(t, teamRows))], pages: pagesFor(q), step: "deterministic", weak: false,
      understood: { kind: "compare", label: ambiguous.map(which).join(" · ") },
    };
  }
  const shown = known.slice(0, 4);
  if (shown.length < 2) return null;
  const extra = known.length > 4 ? ` (Compare holds 4: ${known.length - 4} left out)` : "";
  const top = compareHit(shown, q, season, resolved, extra);
  const label = `Compare: ${understoodTeams([...shown].sort((a, b) => a.number - b.number))}`;
  return { q, hits: [top, ...shown.map((t) => teamHit(t, teamRows))], pages: pagesFor(q), step: "deterministic", weak: false, understood: { kind: "compare", label } };
}

/** "compare 7149", "7149 compare": one team, Compare asked for (the word itself: a bare "vs 7149" is a versus with a side missing). A comparison needs a second team, so: Compare opened
 *  with this one in it, to add others to, and two or three comparisons from its own numbers (`suggest`), each a search
 *  that answers. Null when it isn't one team alone (two named, "compare 7149 and 6980", is the versus's). */
const COMPARE_ONE = /^(?:compare|comparison)\s+(.+)$|^(.+?)\s+(?:compare|comparison|compared)$/i;
export async function compareOneAnswer(q: string, prefer: ReadonlySet<string>, season0: number | null): Promise<SearchAnswer | null> {
  const m = COMPARE_ONE.exec(q.trim());
  let typed = (m?.[1] ?? m?.[2] ?? "").trim();
  if (!typed || VERSUS.test(` ${typed} `) || /(?:^|\s)(?:and|with|to|&)(?:\s|$)|,/i.test(typed)) return null;
  // A bare year after the team ("compare 4215 2024") is its season, as it is after a team elsewhere in search.
  let season = season0;
  // Only while the words before it name a team themselves: "team 2024" is the team numbered 2024.
  const yr = season == null ? /^(.+?)\s+(?:in\s+)?(20\d\d)$/i.exec(typed) : null;
  const before = yr && !/^(?:the\s+)?(?:ftc\s+)?(?:team|robot|#|no\.?|number)$/i.test(yr[1].trim()) ? await readSide(yr[1], prefer) : null;
  if (before?.team) { season = Number(yr![2]); typed = yr![1]; }
  const side = before?.team ? before : await readSide(typed, prefer);
  if (!side.team) return null;
  const t = side.team;
  const resolved = side.rule ? [{ typed, number: t.number, rule: side.rule, candidates: side.candidates }] : [];
  const hit = compareHit([t], q, season, resolved);
  const top = { ...hit, title: `Compare ${hit.title}`, subtitle: "Compare opens with them in it: add up to three teams" };
  const teamRows = new Map<string, SearchHit>();
  for (const h of await search(String(t.number), 1, prefer)) if (h.kind === "team") teamRows.set(h.ref, h);
  const { season: picked, teams: rivals } = await closestRated(t, season);
  return {
    q, hits: [top, teamHit(t, teamRows)], pages: pagesFor(q), step: "deterministic", weak: false,
    understood: { kind: "compare", label: `Compare: ${cleanTeamName(t.number, t.name) ?? "Team"} (${t.number})` },
    // The season the rivals were picked in (the one named, else the team's latest rated one) stays with each
    // comparison, so it compares that season.
    ...(rivals.length && picked != null ? { suggest: rivals.map((r) => `${t.number} vs ${r} ${seasonLabel(picked).replace("–", "-")}`) } : {}),
  };
}

/** The teams rated nearest `t` in its state (its country when its state has too few), in the season asked or the
 *  latest one it was rated in (3+ matches): its closest rivals, at most three. */
async function closestRated(t: TeamFacts, season: number | null): Promise<{ season: number | null; teams: number[] }> {
  const own = await get<{ season: number; rating: number }>(`SELECT season, rating_np rating FROM team_season_stats
    WHERE team = ? AND rating_np IS NOT NULL AND rating_matches >= 3 ${season != null ? "AND season = ?" : ""} ORDER BY season DESC LIMIT 1`,
    season != null ? [t.number, season] : [t.number]);
  if (!own) return { season: null, teams: [] };
  const near = (where: string, args: string[]) => all<{ team: number }>(`SELECT s.team FROM team_season_stats s JOIN teams x ON x.number = s.team
    WHERE s.season = ? AND s.team <> ? AND s.rating_np IS NOT NULL AND s.rating_matches >= 3 AND ${teamPageSql("s.team", "x.name")} AND ${where}
    ORDER BY ABS(s.rating_np - ?), s.team LIMIT 3`, [own.season, t.number, ...args, own.rating]);
  const inState = t.state && t.country ? await near("x.state = ? AND x.country = ?", [t.state, t.country]) : [];
  const rows = inState.length >= 2 || !t.country ? inState : await near("x.country = ?", [t.country]);
  return { season: Number(own.season), teams: rows.map((r) => Number(r.team)) };
}
