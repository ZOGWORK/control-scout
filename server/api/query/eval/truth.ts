// What the data says, read straight from the tables (docs/search-pipeline.md, "Eval"): the eval checks search's cards
// against these, not against another reading of search's own code. The rules are the cards' stated ones
// (answers/families/matches.ts SCORE_RULE, HIGH_RULE, RESULT_RULE): scores from matches the team was on the field for,
// at official events, with penalties; the highest and lowest picked by the alliance's points without penalties; the
// record as FIRST's rankings keep it (a qualification no-show counts, a surrogate match doesn't, a playoff only on the
// field).
import { all, get } from "../../../db.js";
import { OFFICIAL_TYPES } from "../../answers/clauses.js";

export interface TeamTruth { wins: number; losses: number; ties: number; matches: number; avg: number; high: number[]; low: number[] }

/** A team's season, as the cards should state it. Null: no official matches that season. */
export async function teamTruth(team: number, season: number): Promise<TeamTruth | null> {
  const listed = await all<{ own: number; opp: number; np: number | null; surrogate: number | null; on_field: number | null; level: string }>(
    `SELECT CASE x.alliance WHEN 'red' THEN m.red_total ELSE m.blue_total END own, CASE x.alliance WHEN 'red' THEN m.blue_total ELSE m.red_total END opp,
       CASE x.alliance WHEN 'red' THEN m.red_np ELSE m.blue_np END np, x.surrogate, x.on_field, m.level
     FROM match_teams x JOIN matches m ON m.season = x.season AND m.code = x.code AND m.level = x.level AND m.series = x.series AND m.number = x.number
       JOIN events e ON e.season = m.season AND e.code = m.code
     WHERE x.team = ? AND x.season = ? AND m.played = 1 AND m.red_total IS NOT NULL AND m.blue_total IS NOT NULL
       AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")})`, [team, season, ...OFFICIAL_TYPES]);
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

/** Teams with official matches in `season`, with their names and whether another team shares the name. */
export async function teamsPlayed(season: number): Promise<{ number: number; name: string | null; state: string | null; country: string | null; unique: boolean }[]> {
  const rows = await all<{ number: number; name: string | null; state: string | null; country: string | null; same: number }>(
    `SELECT t.number, t.name, t.state, t.country, (SELECT COUNT(*) FROM teams u WHERE LOWER(u.name) = LOWER(t.name)) same
     FROM teams t WHERE t.number IN (SELECT DISTINCT x.team FROM match_teams x JOIN events e ON e.season = x.season AND e.code = x.code
       WHERE x.season = ? AND e.type IN (${OFFICIAL_TYPES.map(() => "?").join(", ")}))`, [season, ...OFFICIAL_TYPES]);
  return rows.map((r) => ({ number: Number(r.number), name: r.name, state: r.state, country: r.country, unique: Number(r.same) === 1 }));
}

/** Two teams that met (on opposite alliances) in `season`, for the matchup questions. */
export async function opponentsOf(team: number, season: number): Promise<number | null> {
  const r = await get<{ team: number }>(
    `SELECT y.team FROM match_teams x JOIN match_teams y ON y.season = x.season AND y.code = x.code AND y.level = x.level AND y.series = x.series AND y.number = x.number
     WHERE x.team = ? AND x.season = ? AND y.alliance <> x.alliance ORDER BY y.team LIMIT 1`, [team, season]);
  return r ? Number(r.team) : null;
}
