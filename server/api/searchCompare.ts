// "hypnotic versus bad wolf history": Compare for the teams named (2–4), as its own kind of result (never a team).
//
// Each side names a team by number, or by name. A name several teams share exactly ("Ultraviolet": 18304, 20245,
// 23268) is resolved by fixed rules, in order, the same on every surface:
//   1. the visitor's own teams (my team, tracked, shortlisted: `prefer`)
//   2. teams that have played a match (a registration alone names nothing)
//   3. the newest season played
//   4. the same state or province as a team another side named ("ultraviolet vs hypnotic": Hypnotic is in NJ, so the
//      Ultraviolet from Hackettstown, NJ)
// Still tied: no team is guessed. The answer lists one Compare per candidate, each naming its team's place, for the
// visitor to pick. Trailing words ("history", "record", "stats") never break the versus: they're topic words.
import type { SearchAnswer, SearchCompareSide, SearchHit } from "../../src/shared/api.js";
import { SEARCH_BROWSE, VERSUS, pagesFor } from "../../src/shared/search.js";
import { cleanTeamName, searchTeamTitle, teamNameOf, teamWords } from "../../src/shared/teamTitle.js";
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
type Side = { typed: string; team: TeamFacts | null; tied: TeamFacts[]; rule?: string };

async function readSide(typed: string, prefer: ReadonlySet<string>): Promise<Side> {
  // Topic and filler words name no team ("… history").
  const name = (searchIntent(typed)?.rest ?? typed).trim();
  const hits = (await search(name, 10, prefer)).filter((h) => h.kind === "team");
  if (/^\d+$/.test(name)) {
    const t = (await teamFacts([Number(name)])).get(Number(name));
    return { typed, team: hits.some((h) => h.ref === name) && t ? t : null, tied: [] };
  }
  // Every team whose name is exactly what was typed; otherwise search's best team.
  const exact = hits.filter((h) => normalize(teamNameOf(h.title)) === normalize(name));
  const facts = await teamFacts((exact.length ? exact : hits.slice(0, 1)).map((h) => Number(h.ref)));
  let cands = [...facts.values()].filter((t) => t.lastPlayed != null); // rule 2: a team that never played names nothing
  if (cands.length <= 1) return { typed, team: cands[0] ?? null, tied: [] };
  const mine = cands.filter((t) => prefer.has(`team:${t.number}`));
  if (mine.length === 1) return { typed, team: mine[0], tied: [], rule: "your team" };
  if (mine.length > 1) cands = mine;
  const newest = Math.max(...cands.map((t) => t.lastPlayed!));
  const recent = cands.filter((t) => t.lastPlayed === newest);
  if (recent.length === 1) return { typed, team: recent[0], tied: [], rule: "the one that played most recently" };
  return { typed, team: null, tied: recent.sort((a, b) => a.number - b.number) };
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
    const states = new Set(sides.filter((o) => o !== side && o.team).map((o) => `${o.team!.country}:${o.team!.state}`));
    const local = side.tied.filter((t) => states.has(`${t.country}:${t.state}`));
    if (local.length === 1) { side.team = local[0]; side.rule = `the one in the same state as the other team (${local[0].state})`; side.tied = []; }
  }
  const resolved = sides.filter((s) => s.team && s.rule).map((s) => ({ typed: s.typed, number: s.team!.number, rule: s.rule!, candidates: [] as number[] }));
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
    // Still tied under the rules: one Compare per candidate of the first shared name, each naming its team's place.
    const side = ambiguous[0];
    const others = known.slice(0, 3);
    const hits = side.tied.slice(0, 4).map((c) => compareHit([...others, c], q, season, [], ""));
    const label = `Which "${side.typed}"? ${side.tied.length} teams have that name: ${side.tied.map((t) => `${t.number} (${placeOf(t)})`).join(", ")}`;
    return {
      q, hits: [...hits, ...others.map((t) => teamHit(t, teamRows)), ...side.tied.map((t) => teamHit(t, teamRows))], pages: pagesFor(q), step: "deterministic", weak: false,
      understood: { kind: "compare", label },
    };
  }
  const shown = known.slice(0, 4);
  if (shown.length < 2) return null;
  const extra = known.length > 4 ? ` (Compare holds 4: ${known.length - 4} left out)` : "";
  // The candidates a shared name had, for the record of which team was picked and why.
  for (const r of resolved) {
    const name = (searchIntent(r.typed)?.rest ?? r.typed).trim();
    const hits = (await search(name, 10, prefer)).filter((h) => h.kind === "team" && normalize(teamNameOf(h.title)) === normalize(name));
    r.candidates = hits.map((h) => Number(h.ref)).sort((a, b) => a - b);
  }
  const top = compareHit(shown, q, season, resolved, extra);
  const label = `Compare: ${understoodTeams([...shown].sort((a, b) => a.number - b.number))}`;
  return { q, hits: [top, ...shown.map((t) => teamHit(t, teamRows))], pages: pagesFor(q), step: "deterministic", weak: false, understood: { kind: "compare", label } };
}
