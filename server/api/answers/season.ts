// The one season rule (docs/search-pipeline.md, "Season default"), read by every answer that needs a season and finds
// none in the query. Three seasons are known here, from the data and today's date, never a fixed year:
//   - the CURRENT season: the competition season today is in (September to August), 2026–27 in autumn 2026;
//   - the COMPLETED season: the newest whose FIRST Championship has finished, 2025–26 until spring 2027;
//   - a TEAM's season: the latest season that team has played an official match in.
// The rule, applied the same in every intent:
//   - a team's question with no season, or "this season": the team's latest season with matches, said on the card;
//   - a question about no team (a leaderboard, a place's best match) with no season: the current season, said on the
//     card; when it has nothing yet the readers step back a season and say so (../query/relax.ts);
//   - "last season" / "last year": the latest completed season, said on the card;
//   - a season named is honoured exactly.
import { seasonLabel } from "../../../src/shared/format.js";
import { CURRENT_SEASON } from "../../data/seasons.js";
import { get } from "../../db.js";
import { CHAMPIONSHIP_TYPE, OFFICIAL_TYPES } from "./clauses.js";
import { names } from "../query/names.js";
import { normalise, queryTime } from "../query/parse.js";
import { seasonOfDate } from "../query/time.js";

const TTL_MS = 10 * 60_000;
let cached: { completed: number; current: number; at: number } | null = null;

/** The completed season from the data: the newest season with a FIRST Championship event that has ended, else (no
 *  Championship stored at all) the newest season with matches before the current one. */
async function readCompleted(today: string): Promise<number> {
  const c = await get<{ s: number | null }>("SELECT MAX(season) s FROM events WHERE type = ? AND COALESCE(end, start) < ?", [CHAMPIONSHIP_TYPE, today]);
  if (c?.s != null) return Number(c.s);
  const m = await get<{ s: number | null }>("SELECT MAX(season) s FROM team_season_stats WHERE matches > 0 AND season < ?", [seasonOfDate(today)]);
  return m?.s != null ? Number(m.s) : CURRENT_SEASON - 1;
}

/** Reads the seasons again once `TTL_MS` has passed (search calls this before it reads a query). Returns the current
 *  season. */
export async function refreshSearchSeason(now = Date.now()): Promise<number> {
  if (cached && now - cached.at < TTL_MS) return cached.current;
  const today = new Date(now).toISOString().slice(0, 10);
  const completed = await readCompleted(today);
  // The season today is in; never before the one that has finished (a clock set back).
  cached = { completed, current: Math.max(seasonOfDate(today), completed), at: now };
  return cached.current;
}

/** The current competition season (2026–27 in autumn 2026): what a question about no team reads when it names none. */
export const currentSeason = (): number => cached?.current ?? CURRENT_SEASON;

/** The latest completed season: the newest whose FIRST Championship has finished (2025–26 until spring 2027). The
 *  latest Worlds held is this season's. */
export const completedSeason = (): number => cached?.completed ?? CURRENT_SEASON - 1;

/** "Last season", "last year": the latest completed season; the one before the current when they are the same (the
 *  weeks between a Championship and the next kickoff). */
export const lastSeason = (): number => { const c = completedSeason(); return c < currentSeason() ? c : currentSeason() - 1; };

/** A relative season said ("this season", "last season") as a number for a question about no team; a season named
 *  wins; null when neither is said. A team's "this season" is its own (teamSeason). */
export function relativeSeason(relative: "this" | "last" | null | undefined, named: number | null | undefined): number | null {
  if (named != null) return named;
  return relative === "this" ? currentSeason() : relative === "last" ? lastSeason() : null;
}

/** The latest season `team` has played an official match in (a season of only scrimmages isn't one, nor one where it
 *  is only on a roster), or null when it has none. What a team's question reads when it names no season. */
export async function teamSeason(team: number): Promise<number | null> {
  const r = await get<{ s: number | null }>(
    `SELECT MAX(s.season) s FROM team_event_stats s JOIN events e ON e.season = s.season AND e.code = s.code
     WHERE s.team = ? AND s.matches > 0 AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})`, [team, ...OFFICIAL_TYPES]);
  return r?.s != null ? Number(r.s) : null;
}

/** Forgets the seasons read (tests that change the stored events). */
export function resetSearchSeason(): void { cached = null; }

/** The card's note on the season it chose, one wording per rule, so every answer says the same thing:
 *  "any": no team named, no season said (the current season); "team": a team's, no season said (its latest);
 *  "this": "this season" for a team (its latest); "this-any": "this season" for no team (the current season);
 *  "last": "last season" / "last year"; "teams": two or more teams, no season said (the latest they all played). */
export function seasonWhy(kind: "any" | "team" | "teams" | "this" | "this-any" | "last", season: number, who?: string): string {
  const S = seasonLabel(season);
  const current = season === currentSeason();
  switch (kind) {
    case "any": return `With no season named, the season is ${S}, the current season.`;
    case "this-any": return `"This season" is ${S}, the current season.`;
    case "team": return current ? `With no season named, the season is ${S}, the current season, which ${who ?? "the team"} has played in.`
      : `With no season named, the season is ${S}, the latest season ${who ?? "the team"} has played in (no ${seasonLabel(currentSeason())} matches on record yet).`;
    case "this": return current ? `"This season" is ${S}, the current season, which ${who ?? "the team"} has played in.`
      : `"This season" here is ${S}, the latest season ${who ?? "the team"} has played in (no ${seasonLabel(currentSeason())} matches on record yet).`;
    case "teams": return current ? `With no season named, the season is ${S}, the current season, which every team here has played in.`
      : `With no season named, the season is ${S}, the latest season every team here has played in.`;
    case "last": return `"Last season" is ${S}, the latest completed season.`;
  }
}

/** The answer's note on the season it chose, when the query named none and no team is asked about. */
export const searchSeasonWhy = (s = currentSeason()) => seasonWhy("any", s);

/** `q` asked about `season` instead (the answer's season picker, /search?season=): the season, game, "this/last
 *  season" or "ever" words it says are taken out and the season written as one is put in, so every reader takes the
 *  picked season the way it takes a typed one. A date window stays: its own season is the date's. A bare year is read
 *  as the parser reads it, and a stored name asked about as words keeps them (../query/parse.ts queryTime). */
export async function withSeason(q: string, season: number, now = Date.now()): Promise<string> {
  const idx = await names();
  const today = new Date(now).toISOString().slice(0, 10);
  let out = q.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) {
    const words = normalise(out).toLowerCase();
    const { time } = queryTime(words, idx, today);
    if (!time || time.kind === "window" || !time.typed) break;
    // The words as typed, whole words only (never part of a team's number), in any case, with whatever punctuation
    // was between them and a possessive ending ("this season's").
    const said = time.typed.split(/[\s-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\p{P}]*");
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${said}(?:['’]s?)?(?![\\p{L}\\p{N}])`, "iu").exec(out);
    if (!m) break;
    out = `${out.slice(0, m.index)} ${out.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").replace(/\s+([?!.,])/g, "$1").trim();
  }
  const asked = /\?\s*$/.test(out);
  const core = out.replace(/\?\s*$/, "").trim();
  return `${core} ${seasonLabel(season)}${asked ? "?" : ""}`.trim();
}
