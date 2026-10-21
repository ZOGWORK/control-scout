// Match views: rows + lineups + the prediction that goes with each match.
//
// Which prediction is shown, in order of honesty:
//   played  → the live call logged before the match, else the backtest call
//             (walk-forward replay; labelled as such);
//   unplayed → the live call already logged, else one computed now.
// A played match never shows a prediction computed after the fact.
import { all, get } from "../db.js";
import type { EventDetail, MatchDetail, MatchPredictionView, MatchView } from "../../src/shared/api.js";
import { eventDetail } from "./events.js";
import { liveForecaster } from "../predict/engine.js";
import { localToUtcMs } from "../data/time.js";
import { isLegacy } from "../data/seasons.js";
import { pairHistory } from "../../src/shared/pairHistory.js";

const score = (r: any, p: "red" | "blue") => r[`${p}_np`] == null ? null : {
  total: Number(r[`${p}_total`]), np: Number(r[`${p}_np`]), auto: Number(r[`${p}_auto`] ?? 0),
  teleop: Number(r[`${p}_teleop`] ?? 0), endgame: Number(r[`${p}_endgame`] ?? 0), pen: Number(r[`${p}_pen`] ?? 0),
  ...(r[`${p}_tips`] != null ? { tips: Number(r[`${p}_tips`]) } : {}),
};

export interface MatchFilter { season: number; code?: string; team?: number; keys?: string[] }

/** Matches with lineups and predictions. */
/** A probability to 4 places, kept off a flat 0 or 1 (it's a call, not a result). */
export const stableP = (p: number) => Math.min(0.9999, Math.max(0.0001, Math.round(p * 1e4) / 1e4));

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
  const forecaster = opts.predictUnplayed && !isLegacy(f.season) ? await liveForecaster(f.season).catch(() => null) : null;
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
      ...(x.no_score_basis ? { noScoreBasis: true as const } : {}),
    });
    if (p?.live) prediction = fromRow(p.live, "live");
    else if (r.played && p?.backtest) prediction = fromRow(p.backtest, "backtest");
    else if (!r.played && forecaster) {
      const red = l.red.filter((t) => t.onField).map((t) => t.number), blue = l.blue.filter((t) => t.onField).map((t) => t.number);
      if (red.length === 2 && blue.length === 2) {
        const x = forecaster.explain(f.season, red, blue, r.level, r.code);
        // A live event's page polls this every 30 s and should mostly get a 304, so the body must not
        // change unless the data did: no predictedAt (a call from today's ratings isn't logged at a
        // moment), and pRed to 4 places (the ratings decay with the clock, moving it ~1e-9 per read).
        if (x) prediction = { pRed: stableP(x.winProbA), redMean: x.predictedScoreA, blueMean: x.predictedScoreB, tier: x.confidence.tier, kind: "now", predictedAt: null, factors: x.factors, ...(x.partnership ? { history: pairHistory(x.partnership) } : {}), ...(noScoreBasis ? { noScoreBasis: true } : {}) };
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

const BONUS_LABELS: Record<number, [string, string, string]> = {
  2025: ["Movement", "Goal", "Pattern"],
  2026: ["Swarm", "Pollinator 1", "Pollinator 2"],
};

/** One match and its context: names, event standing and OPR, season OPR rank, bonus RPs, stations. */
/** `event`: the event's detail when the caller already has it (it isn't cached: never build it twice). */
export async function matchDetail(season: number, code: string, key: string, event?: EventDetail | null): Promise<MatchDetail | null> {
  const [level, series, number] = key.split(":");
  if (!level || series == null || number == null) return null;
  const d = event !== undefined ? event : await eventDetail(season, code);
  const i = d?.matches.findIndex((m) => m.key === key) ?? -1;
  if (!d || i < 0) return null;
  const match = d.matches[i];
  const numbers = [...match.red.teams, ...match.blue.teams].map((t) => t.number);
  const ph = numbers.map(() => "?").join(",") || "NULL";
  const [row, lineup, seasonStats, teamRows] = await Promise.all([
    get<any>("SELECT description, red_bonus, blue_bonus FROM matches WHERE season = ? AND code = ? AND level = ? AND series = ? AND number = ?", [season, code, level, Number(series), Number(number)]),
    all<any>("SELECT team, station FROM match_teams WHERE season = ? AND code = ? AND level = ? AND series = ? AND number = ?", [season, code, level, Number(series), Number(number)]),
    all<any>(`SELECT team, opr_np, rank_np, ranked_teams FROM team_season_stats WHERE season = ? AND team IN (${ph})`, [season, ...numbers]),
    all<any>(`SELECT number, name, city, state FROM teams WHERE number IN (${ph})`, numbers),
  ]);
  const bools = (s: string | null): [boolean, boolean, boolean] | null => {
    if (!s) return null;
    const b = JSON.parse(s) as { movement: boolean; goal: boolean; pattern: boolean };
    return [!!b.movement, !!b.goal, !!b.pattern];
  };
  const labels = BONUS_LABELS[season];
  const fieldBy = new Map(d.field.map((f) => [f.team, f]));
  const seasonBy = new Map(seasonStats.map((s) => [Number(s.team), s]));
  const infoBy = new Map(teamRows.map((t) => [Number(t.number), t]));
  const teams: MatchDetail["teams"] = {};
  for (const n of numbers) {
    const f = fieldBy.get(n), s = seasonBy.get(n), t = infoBy.get(n);
    teams[n] = {
      name: f?.name ?? t?.name ?? null, city: f?.city ?? t?.city ?? null, state: f?.state ?? t?.state ?? null,
      event: f ? { rank: f.rank, rp: f.rp, wins: f.wins, losses: f.losses, ties: f.ties, qualPlayed: f.qualPlayed, opr: f.opr, rating: f.rating } : null,
      season: s ? { opr: s.opr_np ?? null, rank: s.rank_np ?? null, of: s.ranked_teams ?? null } : null,
    };
  }
  const near = (m: MatchView | undefined) => (m ? { key: m.key, label: m.label } : null);
  return {
    event: { season, code, name: d.event.name, status: d.event.status },
    match,
    description: row?.description ?? null,
    stations: Object.fromEntries(lineup.filter((l) => l.station != null).map((l) => [Number(l.team), Number(l.station)])),
    bonus: labels && (row?.red_bonus || row?.blue_bonus) ? { labels, red: bools(row.red_bonus), blue: bools(row.blue_bonus) } : null,
    teams,
    prev: near(d.matches[i - 1]),
    next: near(d.matches[i + 1]),
  };
}
