// Records tables (stats job): one row per team per event, per team per
// season and per played match, with every filterable stat precomputed, so
// /api/records can filter and sort a whole season with one scan of one table.
//
// Score stats are over the team's qualification matches (every match it was
// listed for, except as a surrogate), the way FIRST counts matches played and
// FTC Scout's records compute them; OPR is least squares over every played
// qualification match (server/stats/opr.ts). Values are stored at full
// precision so filters compare exact values. Control Scout's
// exclusives come from the engine: average pre-match win probability and
// predicted score from the walk-forward ledger (calls made before each match,
// without hindsight; never blended with live calls), and advancement odds
// from the pre-event forecast (ratings frozen the day before the event).
import type { InStatement } from "@libsql/client";
import { ADVANCING_TYPES, normType, type EventInput } from "@control-scout/predict-engine";
import { all, writeBatch } from "../db.js";
import { teleopAsReported } from "../data/seasons.js";
import { solveLeastSquares } from "./opr.js";
import { forecasterFor } from "../predict/engine.js";
import type { DbEvent, DbMatch } from "./load.js";
import { AGGREGATES, SCORE_STATS, type Aggregate, type ScoreStatBase } from "../../src/shared/statCatalog.js";

type Log = (m: string) => void;

/** Score part → column prefix in the records tables (`<prefix>_<aggregate>`). */
export const SCORE_COLUMN: Record<ScoreStatBase, string> = {
  totalPoints: "total", totalPointsNp: "np", autoPoints: "auto", dcPoints: "dc", endgamePoints: "endgame",
  penaltyPointsCommitted: "pen", penaltyPointsByOpp: "opp_pen",
};
export const scoreColumn = (base: ScoreStatBase, agg: Aggregate) => `${SCORE_COLUMN[base]}_${agg.toLowerCase()}`;

const PARTS = SCORE_STATS.map((s) => s.base);
const SCORE_COLS = PARTS.flatMap((b) => AGGREGATES.map((a) => scoreColumn(b, a)));

/** Stored at full precision (filters compare exact values, like FTC Scout); the API rounds for display. */
const fin = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : x);

type Side = NonNullable<DbMatch["redScore"]>;
/** One alliance's values in SCORE_STATS order. */
function values(season: number, own: Side, opp: Side): number[] {
  return [own.total, own.np, own.auto, teleopAsReported(season, own), own.endgame, own.pen, opp.pen];
}

/** TOT, AVG, MIN, MAX, DEV (population) per part; OPR is filled separately. */
function aggregate(samples: number[][]): Record<Aggregate, number | null>[] {
  return PARTS.map((_, p) => {
    const xs = samples.map((s) => s[p]);
    if (!xs.length) return { Tot: null, Avg: null, Opr: null, Min: null, Max: null, Dev: null };
    const tot = xs.reduce((a, b) => a + b, 0), avg = tot / xs.length;
    const dev = Math.sqrt(xs.reduce((a, b) => a + (b - avg) ** 2, 0) / xs.length);
    return { Tot: tot, Avg: avg, Opr: null, Min: Math.min(...xs), Max: Math.max(...xs), Dev: dev };
  });
}

const scoreArgs = (aggs: Record<Aggregate, number | null>[]) => aggs.flatMap((a) => AGGREGATES.map((g) => fin(a[g])));

interface TeamMeta { name: string | null; home_region: string | null; rookie_year: number | null; school: string | null }
interface Ranking { rank: number | null; rp: number | null; tbp: number | null; wins: number | null; losses: number | null; ties: number | null; qual_played: number | null }

/** Rewrite a season's records from its loaded events (after computeSeasonStats). */
export async function computeRecords(season: number, events: DbEvent[], log: Log = () => {}): Promise<void> {
  const [teamRows, rankRows] = await Promise.all([
    all<any>("SELECT number, name, home_region, rookie_year, school FROM teams WHERE number IN (SELECT team FROM event_teams WHERE season = ?)", [season]),
    all<any>("SELECT code, team, rank, rp, tbp, wins, losses, ties, qual_played FROM event_teams WHERE season = ?", [season]),
  ]);
  const teams = new Map<number, TeamMeta>(teamRows.map((t) => [Number(t.number), t]));
  const ranks = new Map<string, Ranking>(rankRows.map((r) => [`${r.code}|${r.team}`, r]));
  const num = (x: unknown) => (x == null ? null : Number(x));

  const evStmts: InStatement[] = [{ sql: "DELETE FROM team_event_records WHERE season = ?", args: [season] }];
  const seasonAcc = new Map<number, { samples: number[][]; events: number; played: number; w: number; l: number; t: number; bestOpr: (number | null)[] }>();
  const evCols = ["season", "code", "team", "event_name", "event_type", "event_region", "event_start", "event_end", "team_name", "home_region", "rookie_year", "school",
    "rank", "rp", "tb1", "played", "wins", "losses", "ties", ...SCORE_COLS];
  const evSql = `INSERT INTO team_event_records (${evCols.join(", ")}) VALUES (${evCols.map(() => "?").join(", ")})`;

  for (const e of events) {
    if (e.remote) continue; // one robot per "alliance": no alliance stats (same rule as team_event_stats)
    const perTeam = new Map<number, { samples: number[][]; w: number; l: number; t: number }>();
    const oprRows: { teams: number[]; values: number[] }[] = [];
    for (const m of e.matches) {
      if (m.level !== "qual" || !m.played || !m.redScore || !m.blueScore) continue;
      for (const [side, own, opp] of [[m.red, m.redScore, m.blueScore], [m.blue, m.blueScore, m.redScore]] as const) {
        const v = values(season, own, opp);
        if (side.length) oprRows.push({ teams: side.map((t) => t.team), values: v });
        for (const t of side) {
          // Every listed non-surrogate team counts, on the field or not (a no-show plays its alliance's score), as FIRST and FTC Scout count matches played.
          if (t.surrogate) continue;
          let a = perTeam.get(t.team); if (!a) { a = { samples: [], w: 0, l: 0, t: 0 }; perTeam.set(t.team, a); }
          a.samples.push(v);
          if (own.total > opp.total) a.w++; else if (own.total < opp.total) a.l++; else a.t++;
        }
      }
    }
    if (!perTeam.size) continue;
    const opr = oprRows.length ? solveLeastSquares(oprRows) : null;
    const oprOf = new Map<number, number[]>(opr ? opr.teams.map((t, i) => [t, opr.solution[i]]) : []);
    for (const [team, a] of perTeam) {
      const aggs = aggregate(a.samples);
      const o = oprOf.get(team);
      aggs.forEach((g, p) => { g.Opr = o ? o[p] : null; });
      const rk = ranks.get(`${e.code}|${team}`);
      const meta = teams.get(team);
      // Official ranking numbers when FIRST published them; otherwise counted from the matches.
      const wins = num(rk?.wins) ?? a.w, losses = num(rk?.losses) ?? a.l, ties = num(rk?.ties) ?? a.t, played = num(rk?.qual_played) ?? a.samples.length;
      evStmts.push({
        sql: evSql,
        args: [season, e.code, team, e.name, e.type, e.region, e.start, e.end, meta?.name ?? null, meta?.home_region ?? null, num(meta?.rookie_year), meta?.school ?? null,
          num(rk?.rank), fin(num(rk?.rp)), fin(num(rk?.tbp)), played, wins, losses, ties, ...scoreArgs(aggs)],
      });
      let s = seasonAcc.get(team);
      if (!s) { s = { samples: [], events: 0, played: 0, w: 0, l: 0, t: 0, bestOpr: PARTS.map(() => null) }; seasonAcc.set(team, s); }
      s.samples.push(...a.samples); s.events++; s.played += played; s.w += wins; s.l += losses; s.t += ties;
      // Season OPR: the best event OPR, as the season ranks use (fewest penalties committed is best).
      if (o) s.bestOpr = s.bestOpr.map((b, p) => (b == null ? o[p] : PARTS[p] === "penaltyPointsCommitted" ? Math.min(b, o[p]) : Math.max(b, o[p])));
    }
  }
  await writeBatch(evStmts);

  const ssCols = ["season", "team", "team_name", "home_region", "rookie_year", "school", "events", "played", "wins", "losses", "ties", ...SCORE_COLS];
  const ssSql = `INSERT INTO team_season_records (${ssCols.join(", ")}) VALUES (${ssCols.map(() => "?").join(", ")})`;
  const ssStmts: InStatement[] = [{ sql: "DELETE FROM team_season_records WHERE season = ?", args: [season] }];
  for (const [team, s] of seasonAcc) {
    const aggs = aggregate(s.samples);
    aggs.forEach((g, p) => { g.Opr = s.bestOpr[p]; });
    const meta = teams.get(team);
    ssStmts.push({ sql: ssSql, args: [season, team, meta?.name ?? null, meta?.home_region ?? null, num(meta?.rookie_year), meta?.school ?? null, s.events, s.played, s.w, s.l, s.t, ...scoreArgs(aggs)] });
  }
  await writeBatch(ssStmts);

  // Match records: every played match with both scores, at in-person events.
  const mrCols = ["season", "code", "level", "series", "number", "label", "time", "event_name", "event_type", "event_region", "event_start", "event_end", "red_teams", "blue_teams",
    "red_total", "red_np", "red_auto", "red_dc", "red_endgame", "red_pen", "blue_total", "blue_np", "blue_auto", "blue_dc", "blue_endgame", "blue_pen", "margin", "high", "combined"];
  const mrSql = `INSERT INTO match_records (${mrCols.join(", ")}) VALUES (${mrCols.map(() => "?").join(", ")})`;
  const mrStmts: InStatement[] = [{ sql: "DELETE FROM match_records WHERE season = ?", args: [season] }];
  for (const e of events) {
    if (e.remote) continue;
    for (const m of e.matches) {
      const red = m.redScore, blue = m.blueScore;
      if (!m.played || !red || !blue) continue;
      const side = (s: Side) => [s.total, s.np, s.auto, teleopAsReported(season, s), s.endgame, s.pen];
      mrStmts.push({
        sql: mrSql,
        args: [season, e.code, m.level, m.series, m.number, m.label, m.time, e.name, e.type, e.region, e.start, e.end,
          m.red.map((t) => t.team).join(" "), m.blue.map((t) => t.team).join(" "), ...side(red), ...side(blue),
          Math.abs(red.total - blue.total), Math.max(red.total, blue.total), red.total + blue.total],
      });
    }
  }
  await writeBatch(mrStmts, 5000);
  log(`${season}: records for ${evStmts.length - 1} team-events, ${seasonAcc.size} team-seasons, ${mrStmts.length - 1} matches`);
}

/**
 * Average pre-match win probability and predicted score per team-event and
 * team-season, from the walk-forward ledger (run after the backtest). Calls
 * made before the season had a scoring basis count for win odds only.
 */
export async function fillRecordPredictions(season: number, log: Log = () => {}): Promise<void> {
  const sql = (by: string) => `SELECT ${by}, AVG(CASE WHEN mt.alliance = 'red' THEN p.p_red ELSE 1 - p.p_red END) w,
      AVG(CASE WHEN p.no_score_basis = 0 THEN CASE WHEN mt.alliance = 'red' THEN p.red_mean ELSE p.blue_mean END END) s
    FROM predictions p JOIN match_teams mt ON mt.season = p.season AND mt.code = p.code AND mt.level = p.level AND mt.series = p.series AND mt.number = p.number
    WHERE p.kind = 'backtest' AND p.season = ? AND p.level = 'qual' AND mt.surrogate = 0
    GROUP BY ${by}`;
  const pct = (x: unknown) => (x == null ? null : Number(x) * 100);
  const [ev, ss] = await Promise.all([all<any>(sql("mt.code, mt.team"), [season]), all<any>(sql("mt.team"), [season])]);
  await writeBatch([
    { sql: "UPDATE team_event_records SET pred_win_avg = NULL, pred_score_avg = NULL WHERE season = ?", args: [season] },
    ...ev.map((r): InStatement => ({ sql: "UPDATE team_event_records SET pred_win_avg = ?, pred_score_avg = ? WHERE season = ? AND code = ? AND team = ?", args: [pct(r.w), fin(r.s), season, r.code, r.team] })),
  ]);
  await writeBatch([
    { sql: "UPDATE team_season_records SET pred_win_avg = NULL, pred_score_avg = NULL WHERE season = ?", args: [season] },
    ...ss.map((r): InStatement => ({ sql: "UPDATE team_season_records SET pred_win_avg = ?, pred_score_avg = ? WHERE season = ? AND team = ?", args: [pct(r.w), fin(r.s), season, r.team] })),
  ]);
  await writeBatch([
    { sql: "UPDATE match_records SET red_pred_win = NULL WHERE season = ?", args: [season] },
    {
      sql: `UPDATE match_records SET red_pred_win = p.p_red * 100 FROM predictions p
            WHERE match_records.season = ? AND p.kind = 'backtest' AND p.season = match_records.season AND p.code = match_records.code
              AND p.level = match_records.level AND p.series = match_records.series AND p.number = match_records.number`,
      args: [season],
    },
  ]);
  log(`${season}: predicted win % and score for ${ev.length} team-events`);
}

/** Simulation runs per event for the records' advancement odds (the event page's forecast uses 2000). */
export const ADVANCEMENT_RUNS = 500;

/**
 * Pre-event advancement odds for every team at every event that advances
 * teams: the forecast as it would have been made the day before the event
 * (ratings from earlier matches only, the event's own results stripped).
 */
export async function fillAdvancementOdds(season: number, log: Log = () => {}, runs = ADVANCEMENT_RUNS): Promise<void> {
  const f = await forecasterFor(season);
  const inputs: EventInput[] = f.seasonEvents(season).filter((e) => ADVANCING_TYPES.has(normType(e.type))).map((e) => ({
    season, code: e.code, type: e.type, start: e.start, end: e.end,
    field: e.teams.map((t) => ({ teamNumber: t, rank: null })),
    alliances: [],
    matches: e.matches.filter((m) => m.level === "qual").map((m) => ({
      key: `${m.level}:${m.series}:${m.number}`, label: "", level: m.level, series: m.series, number: m.number, time: null, played: false,
      red: { teams: m.red.teams.map((t) => ({ number: t, surrogate: !!m.red.surrogates?.includes(t) })), score: null },
      blue: { teams: m.blue.teams.map((t) => ({ number: t, surrogate: !!m.blue.surrogates?.includes(t) })), score: null },
    })),
  }));
  const stmts: InStatement[] = [{ sql: "UPDATE team_event_records SET adv_odds = NULL WHERE season = ?", args: [season] }];
  let n = 0;
  for (const [code, fc] of f.preEventForecasts(season, inputs, runs)) {
    if (!fc) continue;
    n++;
    // Teams that had already advanced elsewhere can't advance from here: no odds (null), not 0%.
    const pre = new Set(fc.prequalified);
    for (const t of fc.teams) if (!pre.has(t.team)) stmts.push({ sql: "UPDATE team_event_records SET adv_odds = ? WHERE season = ? AND code = ? AND team = ?", args: [t.pAdvance * 100, season, code, t.team] });
    if (n % 25 === 0) await new Promise<void>((r) => setImmediate(r)); // keep the server responsive
  }
  await writeBatch(stmts);
  log(`${season}: pre-event advancement odds for ${n} events`);
}
