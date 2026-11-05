// What the data says, read straight from the tables (docs/search-pipeline.md, "Eval"): the eval checks search's cards
// against these, not against another reading of search's own code. The rules are the cards' stated ones
// (answers/families/matches.ts SCORE_RULE, HIGH_RULE, RESULT_RULE) and the matches they read (answers/matchSet.ts):
// a played match with both scores without penalties on record, at an official event held in person (never a remote
// one); scores from matches the team was on the field for, with penalties; the highest and lowest picked by the alliance's points without penalties; the
// record as FIRST's rankings keep it (a qualification no-show counts, a surrogate match doesn't, a playoff only on the
// field).
import { all, get } from "../../../db.js";
import { fold } from "../names.js";
import { OFFICIAL_TYPES } from "../../answers/clauses.js";

export interface TeamTruth { wins: number; losses: number; ties: number; matches: number; avg: number; high: number[]; low: number[] }

const ELIGIBLE = `m.played = 1 AND m.red_np IS NOT NULL AND m.blue_np IS NOT NULL AND COALESCE(e.remote, 0) = 0
       AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})`;

/** The newest season a team has a counted match in: where an answer over every season ("highest score", each season a
 *  different game) takes its number from. */
export async function newestSeason(team: number): Promise<number | null> {
  const r = await get<{ s: number | null }>(
    `SELECT MAX(x.season) s FROM match_teams x JOIN matches m ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
       JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE x.team = ? AND COALESCE(x.on_field, 1) = 1 AND ${ELIGIBLE}`, [team, ...OFFICIAL_TYPES]);
  return r?.s == null ? null : Number(r.s);
}

/** A team's season, as the cards should state it. Null: no official matches that season. */
export async function teamTruth(team: number, season: number): Promise<TeamTruth | null> {
  const rows0 = await all<{ own: number | null; opp: number | null; np: number | null; surrogate: number | null; on_field: number | null; level: string }>(
    `SELECT CASE x.alliance WHEN 'red' THEN m.red_total ELSE m.blue_total END own, CASE x.alliance WHEN 'red' THEN m.blue_total ELSE m.red_total END opp,
       CASE x.alliance WHEN 'red' THEN m.red_np ELSE m.blue_np END np, x.surrogate, x.on_field, m.level
     FROM match_teams x JOIN matches m ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
       JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE x.team = ? AND x.season = ? AND ${ELIGIBLE}`, [team, season, ...OFFICIAL_TYPES]);
  // A total missing with its points on record counts as 0, as the match list shows it.
  const listed = rows0.map((r) => ({ ...r, own: Number(r.own) || 0, opp: Number(r.opp) || 0 }));
  const onField = (r: { on_field: number | null }) => Number(r.on_field ?? 1) === 1;
  const rows = listed.filter(onField);
  if (!rows.length) return null;
  const rec = listed.filter((r) => (r.level === "qual" ? !Number(r.surrogate) : onField(r)));
  const nps = rows.map((r) => Number(r.np ?? r.own));
  const hi = Math.max(...nps), lo = Math.min(...nps);
  return {
    wins: rec.filter((r) => r.own > r.opp).length, losses: rec.filter((r) => r.own < r.opp).length, ties: rec.filter((r) => r.own === r.opp).length,
    matches: rows.length, avg: rows.reduce((s, r) => s + Number(r.own), 0) / rows.length,
    // Every official score whose points without penalties tie for the highest (or lowest): any of them is right.
    high: rows.filter((_, i) => nps[i] === hi).map((r) => Number(r.own)), low: rows.filter((_, i) => nps[i] === lo).map((r) => Number(r.own)),
  };
}

/** Teams with official matches in `season`, with their names and whether another team shares the name as search
 *  compares names (folded: case, accents and punctuation aside). */
export async function teamsPlayed(season: number): Promise<{ number: number; name: string | null; state: string | null; country: string | null; unique: boolean }[]> {
  const rows = await all<{ number: number; name: string | null; state: string | null; country: string | null }>(
    `SELECT t.number, t.name, t.state, t.country FROM teams t WHERE t.number IN (SELECT DISTINCT x.team FROM match_teams x JOIN events e ON e.season = x.season AND e.code = x.code
       WHERE x.season = ? AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")}))`, [season, ...OFFICIAL_TYPES]);
  const names = new Map<string, number>();
  for (const r of await all<{ name: string | null }>("SELECT name FROM teams WHERE name IS NOT NULL")) { const k = fold(r.name ?? ""); if (k) names.set(k, (names.get(k) ?? 0) + 1); }
  return rows.map((r) => ({ number: Number(r.number), name: r.name, state: r.state, country: r.country, unique: !!r.name && names.get(fold(r.name)) === 1 }));
}

/** A team this one met (on opposite alliances) in `season`, both with a prediction rating that season, for the
 *  matchup questions: a pair with no rating gets a card saying so, which is right but isn't a forecast to check. */
export async function opponentsOf(team: number, season: number): Promise<number | null> {
  const r = await get<{ team: number }>(
    `SELECT y.team FROM match_teams x JOIN match_teams y ON y.season = x.season AND y.code = x.code AND y.level = x.level AND y.series = x.series AND y.number = x.number
       JOIN team_season_stats a ON a.season = x.season AND a.team = x.team AND a.rating_np IS NOT NULL
       JOIN team_season_stats b ON b.season = y.season AND b.team = y.team AND b.rating_np IS NOT NULL
     WHERE x.team = ? AND x.season = ? AND y.alliance <> x.alliance ORDER BY y.team LIMIT 1`, [team, season]);
  return r ? Number(r.team) : null;
}

/** Every team name, folded as search compares them: the typo cases are picked against these, not against search's
 *  own nearest-name reader. */
export async function allNames(): Promise<{ number: number; name: string }[]> {
  const rows = await all<{ number: number; name: string | null }>("SELECT number, name FROM teams WHERE name IS NOT NULL");
  return rows.map((r) => ({ number: Number(r.number), name: fold(r.name ?? "") })).filter((r) => r.name);
}

/** Edit distance, stopping early once it is over `max` (then max + 1). */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...cur) > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** A misspelling a reader could tell apart: one edit from this team's name and more than one from every other's. */
export const unambiguousTypo = (typo: string, team: number, names: { number: number; name: string }[]): boolean => {
  const t = fold(typo);
  return names.every((n) => (n.number === team ? editDistance(t, n.name, 1) <= 1 : editDistance(t, n.name, 1) > 1));
};
