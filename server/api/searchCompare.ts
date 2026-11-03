// "hypnotic versus bad wolf history": Compare for the teams named (2–4), as its own kind of result (never a team).
//
// Each side names a team by number, or by name. A name several teams share exactly ("Ultraviolet": 18304, 20245,
// 23268) is resolved by fixed rules, in order, the same on every surface:
//   1. the visitor's own teams (my team, tracked, shortlisted: `prefer`)
//   2. teams that have played a match (a registration alone names nothing)
//   3. the newest season played
//   4. the same state or province as a team another side named ("ultraviolet vs hypnotic": Hypnotic is in NJ, so the
//      Ultraviolet from Hackettstown, NJ)
// Every team with exactly that name is a candidate (from the teams table, never cut by a display limit), and the pick
// is recorded with its rule (`compare.resolved`). Still tied: no team is guessed. With one side tied, one Compare per
// candidate (all of them), each naming its team's place, for the visitor to pick; with several sides tied, the
// question for each, and no Compare until they're picked.
// Trailing words never break the versus: topic words ("history", "record", "stats") are dropped, and when a side
// still names no team, its last words are dropped one at a time until it does ("6980 please" → 6980).
import type { SearchAnswer, SearchCompareSide, SearchHit } from "../../src/shared/api.js";
import { SEARCH_BROWSE, VERSUS, pagesFor } from "../../src/shared/search.js";
import { cleanTeamName, searchTeamTitle, teamWords } from "../../src/shared/teamTitle.js";
import { all } from "../db.js";
import { normalize } from "./fuzzy.js";
import { search, searchIntent } from "./search.js";

interface TeamFacts { number: number; name: string; city: string | null; state: string | null; country: string | null; lastPlayed: number | null }

async function teamFacts(nums: number[]): Promise<Map<number, TeamFacts>> {
  if (!nums.length) return new Map();
  const rows = await all<any>(`SELECT t.number, t.name, t.city, t.state, t.country,
      (SELECT MAX(s.season) FROM team_event_stats s WHERE s.team = t.number AND s.matches > 0) lastPlayed
    FROM teams t WHERE t.number IN (${nums.map(() => "?").join(",")})`, nums);
  return new Map(rows.map((r) => [Number(r.number), { number: Number(r.number), name: r.name ?? "", city: r.city, state: r.state, country: r.country, lastPlayed: r.lastPlayed == null ? null : Number(r.lastPlayed) }]));
}

const placeOf = (t: TeamFacts) => [t.city, t.state].filter(Boolean).join(", ") || t.country || "";
const sideOf = (t: TeamFacts): SearchCompareSide => ({ number: t.number, name: cleanTeamName(t.number, t.name) ?? "", place: placeOf(t) });

/** What one side of a versus names: a team, several equally (a shared name), or nothing. */
type Side = { typed: string; team: TeamFacts | null; tied: TeamFacts[]; rule?: string; candidates: number[] };

/** Every team named exactly `name` (FIRST's stored name, a number inside it left out; accents, case, punctuation and
 *  spacing as search folds them), whatever search would show. Candidates come from the search index (which folds the
 *  same way, "cafe" finds "Café") and a plain name match, then the same equality decides. */
async function exactNamed(name: string): Promise<number[]> {
  const viaIndex = (await search(name, 50, new Set(), new Set(["team"]))).filter((h) => h.kind === "team").map((h) => Number(h.ref));
  const viaName = (await all<{ number: number }>("SELECT number FROM teams WHERE name LIKE ?", [`%${name.replace(/[%_]/g, "")}%`])).map((r) => Number(r.number));
  const nums = [...new Set([...viaIndex, ...viaName])];
  if (!nums.length) return [];
  const rows = await all<{ number: number; name: string }>(`SELECT number, name FROM teams WHERE number IN (${nums.map(() => "?").join(",")})`, nums);
  return rows.filter((r) => normalize(cleanTeamName(Number(r.number), r.name) ?? "") === normalize(name)).map((r) => Number(r.number)).sort((x, y) => x - y);
}

/** The team (or teams, tied) one side names, from its words as typed. */
async function sideTeams(name: string, prefer: ReadonlySet<string>, best: boolean): Promise<{ exact: number[] } | { best: number } | null> {
  if (/^\d+$/.test(name)) return (await teamFacts([Number(name)])).has(Number(name)) ? { exact: [Number(name)] } : null;
  const exact = await exactNamed(name);
  if (exact.length) return { exact };
  if (!best) return null;
  const top = (await search(name, 5, prefer)).find((h) => h.kind === "team");
  return top ? { best: Number(top.ref) } : null;
}

async function readSide(typed: string, prefer: ReadonlySet<string>): Promise<Side> {
  // Topic and filler words name no team ("… history").
  const words = (searchIntent(typed)?.rest ?? typed).trim().split(/\s+/).filter(Boolean);
  // The whole side first, then without its last words ("6980 please" → "6980"): an exact name or number, then
  // search's best team.
  let found: Awaited<ReturnType<typeof sideTeams>> = null;
  for (const best of [false, true]) {
    for (let n = words.length; n >= 1 && !found; n--) found = await sideTeams(words.slice(0, n).join(" "), prefer, best);
    if (found) break;
  }
  const none: Side = { typed, team: null, tied: [], candidates: [] };
  if (!found) return none;
  const typedNumber = /^\d+$/.test(words.join(" "));
  const nums = "best" in found ? [found.best] : found.exact;
  const all = [...(await teamFacts(nums)).values()].sort((a, b) => a.number - b.number);
  const candidates = all.length > 1 ? all.map((t) => t.number) : [];
  const pick = (team: TeamFacts, rule?: string): Side => ({ typed, team, tied: [], ...(rule ? { rule } : {}), candidates });
  // 1. Your own team, played or not.
  const mine = all.filter((t) => prefer.has(`team:${t.number}`));
  if (mine.length === 1) return pick(mine[0], all.length > 1 ? "your team" : undefined);
  let cands = mine.length > 1 ? mine : all;
  // 2. A team that has played: a registration alone names nothing (a typed number still names its team).
  const played = cands.filter((t) => t.lastPlayed != null);
  if (!played.length) return mine.length > 1 ? { typed, team: null, tied: mine, candidates } : typedNumber && all.length === 1 ? pick(all[0]) : none;
  if (played.length === 1) return pick(played[0], all.length > 1 ? "the only one that has played" : undefined);
  cands = played;
  // 3. The newest season played.
  const newest = Math.max(...cands.map((t) => t.lastPlayed!));
  const recent = cands.filter((t) => t.lastPlayed === newest);
  if (recent.length === 1) return pick(recent[0], "the one that played most recently");
  return { typed, team: null, tied: recent, candidates };
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

const teamHit = (t: TeamFacts, hits: Map<string, SearchHit>): SearchHit =>
  hits.get(String(t.number)) ?? { kind: "team", ref: String(t.number), title: searchTeamTitle(t.number, t.name), subtitle: [t.city, t.state, t.country].filter(Boolean).join(", "), season: t.lastPlayed };

/** The answer for a versus query, or null when `q` isn't one. */
export async function versusAnswer(q: string, prefer: ReadonlySet<string>, season: number | null): Promise<SearchAnswer | null> {
  const typedSides = q.split(VERSUS).map((s) => s.trim()).filter(Boolean);
  if (typedSides.length < 2) return null;
  const sides = await Promise.all(typedSides.map((s) => readSide(s, prefer)));
  // Rule 4: a shared name goes to the team in the same state as a team another side named.
  for (const side of sides) {
    if (side.team || !side.tied.length) continue;
    // Only a real state on both sides: two teams with none stored aren't "in the same state".
    const states = new Set(sides.filter((o) => o !== side && o.team?.state).map((o) => `${o.team!.country}:${o.team!.state}`));
    const local = side.tied.filter((t) => t.state && states.has(`${t.country}:${t.state}`));
    if (local.length === 1) { side.team = local[0]; side.rule = `the one in the same state as the other team (${local[0].state})`; side.tied = []; }
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
    const which = (side: Side) => `Which "${side.typed}"? ${side.tied.length} teams have that name: ${side.tied.map((t) => `${t.number} (${placeOf(t)})`).join(", ")}`;
    const others = known.slice(0, 3);
    const hits = ambiguous.length === 1 && others.length ? ambiguous[0].tied.map((c) => compareHit([...others, c], q, season, resolved, "")) : [];
    return {
      q, hits: [...hits, ...others.map((t) => teamHit(t, teamRows)), ...ambiguous.flatMap((s) => s.tied.map((t) => teamHit(t, teamRows)))], pages: pagesFor(q), step: "deterministic", weak: false,
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
