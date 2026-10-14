// Match views: rows + lineups + the prediction that goes with each match.
//
// Which prediction is shown, in order of honesty:
//   played  → the live call logged before the match, else the backtest call
//             (walk-forward replay; labelled as such);
//   unplayed → the live call already logged, else one computed now.
// A played match never shows a prediction computed after the fact.
import { all } from "../db.js";
import type { MatchPredictionView, MatchView } from "../../src/shared/api.js";
import { forecasterFor } from "../predict/engine.js";
import { localToUtcMs } from "../data/time.js";

const score = (r: any, p: "red" | "blue") => r[`${p}_np`] == null ? null : {
  total: Number(r[`${p}_total`]), np: Number(r[`${p}_np`]), auto: Number(r[`${p}_auto`] ?? 0),
  teleop: Number(r[`${p}_teleop`] ?? 0), endgame: Number(r[`${p}_endgame`] ?? 0), pen: Number(r[`${p}_pen`] ?? 0),
};

export interface MatchFilter { season: number; code?: string; team?: number; keys?: string[] }

/** Matches with lineups and predictions. */
export async function matchViews(f: MatchFilter, opts: { predictUnplayed?: boolean } = {}): Promise<MatchView[]> {
  const where: string[] = ["m.season = ?"];
  const args: (string | number)[] = [f.season];
  if (f.code) { where.push("m.code = ?"); args.push(f.code); }
  if (f.team) { where.push("(m.code, m.level, m.series, m.number) IN (SELECT code, level, series, number FROM match_teams WHERE team = ? AND season = ?)"); args.push(f.team, f.season); }
  const rows = await all<any>(`SELECT m.*, e.timezone FROM matches m JOIN events e ON e.season = m.season AND e.code = m.code WHERE ${where.join(" AND ")} ORDER BY m.time, m.code, m.level DESC, m.series, m.number`, args);
  if (!rows.length) return [];
  const codes = [...new Set(rows.map((r) => r.code as string))];
  const ph = codes.map(() => "?").join(",");
  const [lineups, preds] = await Promise.all([
    all<any>(`SELECT code, level, series, number, team, alliance, station, surrogate, dq, on_field FROM match_teams WHERE season = ? AND code IN (${ph}) ORDER BY station, team`, [f.season, ...codes]),
    all<any>(`SELECT * FROM predictions WHERE season = ? AND code IN (${ph})`, [f.season, ...codes]),
  ]);
  const lu = new Map<string, { red: MatchView["red"]["teams"]; blue: MatchView["blue"]["teams"] }>();
  for (const t of lineups) {
    const k = `${t.code}|${t.level}:${t.series}:${t.number}`;
    let l = lu.get(k); if (!l) { l = { red: [], blue: [] }; lu.set(k, l); }
    (t.alliance === "red" ? l.red : l.blue).push({ number: Number(t.team), surrogate: !!t.surrogate, dq: !!t.dq, onField: !!t.on_field });
  }
  const pmap = new Map<string, { live?: any; backtest?: any }>();
  for (const p of preds) {
    const k = `${p.code}|${p.level}:${p.series}:${p.number}`;
    const e = pmap.get(k) ?? {};
    e[p.kind as "live" | "backtest"] = p;
    pmap.set(k, e);
  }
  const forecaster = opts.predictUnplayed ? await forecasterFor(f.season).catch(() => null) : null;
  // No rated matches this season yet (e.g. only scrimmages, which the engine skips):
  // ratings are carried over without a scoring baseline, so win odds stand but point predictions don't.
  const noScoreBasis = !!forecaster && !forecaster.seasonEvents(f.season).length;
  const out: MatchView[] = [];
  for (const r of rows) {
    const key = `${r.level}:${r.series}:${r.number}`;
    const l = lu.get(`${r.code}|${key}`) ?? { red: [], blue: [] };
    const p = pmap.get(`${r.code}|${key}`);
    let prediction: MatchPredictionView | null = null;
    const fromRow = (x: any, kind: "live" | "backtest"): MatchPredictionView => ({
      pRed: x.p_red, redMean: x.red_mean, blueMean: x.blue_mean, tier: x.tier, kind, predictedAt: kind === "live" ? x.predicted_at : null,
      ...(x.factors ? { factors: JSON.parse(x.factors) } : {}),
    });
    if (p?.live) prediction = fromRow(p.live, "live");
    else if (r.played && p?.backtest) prediction = fromRow(p.backtest, "backtest");
    else if (!r.played && forecaster) {
      const red = l.red.filter((t) => t.onField).map((t) => t.number), blue = l.blue.filter((t) => t.onField).map((t) => t.number);
      if (red.length === 2 && blue.length === 2) {
        const x = forecaster.explain(f.season, red, blue);
        if (x) prediction = { pRed: x.winProbA, redMean: x.predictedScoreA, blueMean: x.predictedScoreB, tier: x.confidence.tier, kind: "now", predictedAt: new Date().toISOString(), factors: x.factors, ...(noScoreBasis ? { noScoreBasis: true } : {}) };
      }
    }
    out.push({
      season: f.season, code: r.code, key, level: r.level, series: Number(r.series), number: Number(r.number), label: r.label, time: r.time,
      startsAt: ((ms) => (ms == null ? null : new Date(ms).toISOString()))(localToUtcMs(r.time, r.timezone)), played: !!r.played,
      red: { teams: l.red, score: r.played ? score(r, "red") : null },
      blue: { teams: l.blue, score: r.played ? score(r, "blue") : null },
      video: r.video ?? null,
      prediction,
    });
  }
  return out;
}
