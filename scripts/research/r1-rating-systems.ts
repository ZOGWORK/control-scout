// Research R1: rating systems beyond Elo (Massey, TrueSkill, Glicko-2) against the live engine, walk-forward.
//
//   1. Champion rows, on a COPY of the pinned snapshot:
//        DATABASE_URL=file:snap.db npx tsx scripts/engine-slices.ts --seasons 2023,2024,2025 --rows champion-rows.json.gz
//   2. DATABASE_URL=file:snap.db npx tsx scripts/research/r1-rating-systems.ts champion-rows.json.gz [--out r1.json] [--quick]
//
// Protocol (identical for every model):
// - Every challenger replays the backtest corpus (scripts/slices/corpus.ts: same loader, exclusions and order as the
//   engine), predicting each match from earlier rated matches only, and updating on rated events only.
// - Rolling origins as in Part 9 / 12.5: each month from Oct 2024 to Jun 2026 is predicted with mappings fitted on the
//   365 days before it (Platt slope on the challenger's z; margin slope for methods without a native margin; the
//   hybrids' weights). Nothing is fitted on the month it scores.
// - Scored rows: rated events, decisive matches (ties left out), joined to the champion's rows by match key, so every
//   model scores the identical match set. The champion's probability and margin are the served ones (engine 3.3.0).
// - Hyperparameters: a small grid per method, chosen on 2024–25 rolled Brier (the tuning season) only. 2025–26 is
//   reported as reused.
// - Deltas are model minus champion with 95% intervals from resampling whole events (2000 draws).
import "../../server/env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { MatchRecord } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { matchKey, predictable, seasonCorpus } from "../slices/corpus.js";
import { rng } from "../slices/report.js";
import { fit, logit, sig } from "../part9/lib.js";
import { Glicko2, Massey, TrueSkill, type Rater, type RaterCall } from "./r1-raters.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const QUICK = args.includes("--quick");
const SEASONS = [2023, 2024, 2025];
const WINDOW = 365 * 864e5;

interface Pred { p: number; muR: number; muB: number }
interface ChampRow { key: string; season: number; event: string; level: string; time: number; y: number; rated: boolean; data: { teamMatches: string; eventMatch: string; level: string }; pred: Record<string, Pred> }
const champRows: ChampRow[] = JSON.parse(gunzipSync(readFileSync(args[0])).toString());

await migrate();
const corpora: { season: number; matches: MatchRecord[]; unrated: Set<string> }[] = [];
for (const s of SEASONS) { const c = await seasonCorpus(s); corpora.push({ season: s, matches: c.matches, unrated: c.unrated }); }
const margins = new Map<string, number>();
for (const c of corpora) for (const m of c.matches) margins.set(matchKey(c.season, m.eventCode, m.level, m.series, m.number), m.red.total - m.blue.total);

/** Replay one rater over the corpus exactly as the engine is replayed: predict every predictable match, update on rated events. */
function replay(r: Rater): Map<string, RaterCall> {
  const out = new Map<string, RaterCall>();
  for (const c of corpora) {
    r.startSeason(c.season);
    for (const m of c.matches) {
      if (predictable(m)) { r.setTime(m.time); out.set(matchKey(c.season, m.eventCode, m.level, m.series, m.number), r.predict(m)); }
      // The raters are written for 2-robot alliances; the few rated matches listing another count (under 1%) are skipped.
      if (!c.unrated.has(m.eventCode) && predictable(m)) r.update(m);
    }
  }
  return out;
}

// Scored set: rated, decisive. Rows of all seasons feed the rolling fits; 2024 and 2025 rows in test months are scored.
const rows = champRows.filter((r) => r.rated && r.y !== 0.5).sort((a, b) => a.time - b.time);
for (const r of rows) if (!margins.has(r.key)) throw new Error(`no result for ${r.key}`);
const months: number[] = [];
for (let d = new Date(Date.UTC(2024, 9, 1)); d < new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime());
const folds: { train: ChampRow[]; test: ChampRow[]; origin: number }[] = [];
for (let i = 0; i < months.length - 1; i++) {
  const t0 = months[i], t1 = months[i + 1];
  const train = rows.filter((r) => r.time < t0 && r.time >= t0 - WINDOW), test = rows.filter((r) => r.time >= t0 && r.time < t1);
  if (test.length >= 50 && train.length >= 2000) folds.push({ train, test, origin: t0 });
}

interface Scored { p: number; m: number }
type Model = Map<string, Scored>;
const champMargin = (r: ChampRow) => r.pred.champion.muR - r.pred.champion.muB;

/** Mirrored ridge logistic on feature vectors (no intercept: colour-symmetric), as the shipped calibration is fitted. */
function logistic(train: ChampRow[], x: (r: ChampRow) => number[], prior?: number[]): number[] {
  const X: number[][] = [], Y: number[] = [];
  for (const r of train) { const v = x(r); X.push(v, v.map((a) => -a)); Y.push(r.y, 1 - r.y); }
  const k = X[0].length;
  return fit(X, Y, new Array(k).fill(1e-4), prior ?? new Array(k).fill(0));
}
/** Least squares through the origin of the realised margin on features (symmetric by construction). */
function lsq(train: ChampRow[], x: (r: ChampRow) => number[]): number[] {
  const k = x(train[0]).length, A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  for (const r of train) { const v = x(r), y = margins.get(r.key)!; for (let a = 0; a < k; a++) { A[a][k] += v[a] * y; for (let b = 0; b < k; b++) A[a][b] += v[a] * v[b]; } }
  for (let i = 0; i < k; i++) { A[i][i] += 1e-6; for (let j = 0; j < k; j++) if (j !== i) { const f = A[j][i] / A[i][i]; for (let c = i; c <= k; c++) A[j][c] -= f * A[i][c]; } }
  return A.map((row, i) => row[k] / row[i]);
}
const dot = (w: number[], x: number[]) => w.reduce((s, v, i) => s + v * x[i], 0);

/** The challenger alone: Platt slope on z, margin native (Massey) or a fitted slope on the points-scaled difference. */
function rolled(calls: Map<string, RaterCall>, phases = false): { model: Model; slopes: number[]; weights: number[][] } {
  const model: Model = new Map(), slopes: number[] = [], weights: number[][] = [];
  const feat = (r: ChampRow) => { const c = calls.get(r.key)!; return phases ? c.phases! : [c.z]; };
  for (const f of folds) {
    const w = logistic(f.train, feat, phases ? [1, 1, 1, 1] : [1]);
    const native = calls.get(f.train[0].key)!.nativeMargin;
    const b = native ? [1] : lsq(f.train, (r) => [calls.get(r.key)!.margin]);
    slopes.push(w[0]); weights.push(w.map((v) => +v.toFixed(4)));
    for (const r of f.test) { const c = calls.get(r.key)!; model.set(r.key, { p: sig(dot(w, feat(r))), m: b[0] * c.margin }); }
  }
  return { model, slopes, weights };
}
/** Champion with its final slope (and a margin slope) re-fitted on the same rolling windows: the control for the hybrids. */
function championRefit(): Model {
  const model: Model = new Map();
  for (const f of folds) {
    const [a] = logistic(f.train, (r) => [logit(r.pred.champion.p)], [1]), [b] = lsq(f.train, (r) => [champMargin(r)]);
    for (const r of f.test) model.set(r.key, { p: sig(a * logit(r.pred.champion.p)), m: b * champMargin(r) });
  }
  return model;
}
/** Hybrid: the champion's logit plus the challenger's z and an uncertainty interaction; margin = fitted blend of both margins. */
function hybrid(calls: Map<string, RaterCall>): { model: Model; weights: number[][] } {
  const model: Model = new Map(), weights: number[][] = [];
  const feat = (r: ChampRow) => { const c = calls.get(r.key)!, L = logit(r.pred.champion.p); return [L, c.z, L * c.u]; };
  for (const f of folds) {
    const w = logistic(f.train, feat, [1, 0, 0]);
    const b = lsq(f.train, (r) => [champMargin(r), calls.get(r.key)!.margin]);
    weights.push(w.map((v) => +v.toFixed(4)));
    for (const r of f.test) model.set(r.key, { p: sig(dot(w, feat(r))), m: dot(b, [champMargin(r), calls.get(r.key)!.margin]) });
  }
  return { model, weights };
}

// ---------------------------------------------------------------- metrics

const clip = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const acc = (p: number, y: number) => (p === 0.5 ? 0.5 : (p > 0.5) === (y === 1) ? 1 : 0);
function absolute(R: ChampRow[], get: (r: ChampRow) => Scored) {
  let b = 0, l = 0, a = 0, e = 0;
  for (const r of R) { const s = get(r), p = clip(s.p); b += (p - r.y) ** 2; l -= r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p); a += acc(s.p, r.y); e += Math.abs(s.m - margins.get(r.key)!); }
  const n = R.length;
  return { n, brier: b / n, logLoss: l / n, accuracy: a / n, marginMae: e / n };
}
/** Model minus champion, event bootstrap. Brier and log loss raw (×10⁻⁴ in the text), accuracy in points, MAE in points. */
function paired(R: ChampRow[], get: (r: ChampRow) => Scored, base: (r: ChampRow) => Scored, draws = 2000) {
  const ev = new Map<string, number[]>();
  for (const r of R) {
    const a = base(r), b = get(r), pa = clip(a.p), pb = clip(b.p), y = r.y, mm = margins.get(r.key)!;
    const x = ev.get(r.event) ?? [0, 0, 0, 0, 0];
    x[0]++; x[1] += (pb - y) ** 2 - (pa - y) ** 2;
    x[2] += -(y * Math.log(pb) + (1 - y) * Math.log(1 - pb)) + (y * Math.log(pa) + (1 - y) * Math.log(1 - pa));
    x[3] += acc(b.p, y) - acc(a.p, y); x[4] += Math.abs(b.m - mm) - Math.abs(a.m - mm);
    ev.set(r.event, x);
  }
  const E = [...ev.values()], tot = [0, 0, 0, 0, 0];
  for (const x of E) for (let i = 0; i < 5; i++) tot[i] += x[i];
  const rand = rng(20261103), bs: number[][] = [[], [], [], []];
  for (let d = 0; d < draws; d++) {
    const s = [0, 0, 0, 0, 0];
    for (let j = 0; j < E.length; j++) { const x = E[Math.floor(rand() * E.length)]; for (let i = 0; i < 5; i++) s[i] += x[i]; }
    bs[0].push(s[1] / s[0]); bs[1].push(s[2] / s[0]); bs[2].push((100 * s[3]) / s[0]); bs[3].push(s[4] / s[0]);
  }
  const ci = (xs: number[]) => { xs.sort((u, v) => u - v); return [xs[Math.floor(0.025 * xs.length)], xs[Math.min(xs.length - 1, Math.floor(0.975 * xs.length))]]; };
  const n = tot[0];
  return { n, events: E.length, brier: tot[1] / n, brier95: ci(bs[0]), logLoss: tot[2] / n, logLoss95: ci(bs[1]), accuracyPp: (100 * tot[3]) / n, accuracy95: ci(bs[2]), marginMae: tot[4] / n, marginMae95: ci(bs[3]) };
}

const SLICES: [string, (r: ChampRow) => boolean][] = [
  ["all", () => true],
  ["robots with 0-5 rated matches (fewest on the field)", (r) => r.data.teamMatches === "0-5"],
  ["early event: quals 1-10", (r) => r.data.eventMatch === "q1-10"],
  ["playoffs", (r) => r.level === "playoff"],
];
const SEASON_LABEL: Record<number, string> = { 2024: "2024-25 (tuning)", 2025: "2025-26 (reused)" };
const scoredKeys = new Set(folds.flatMap((f) => f.test.map((r) => r.key)));
const bySeason = (s: number) => rows.filter((r) => r.season === s && scoredKeys.has(r.key));
const champ = (r: ChampRow): Scored => ({ p: r.pred.champion.p, m: champMargin(r) });
const legacy = (r: ChampRow): Scored => ({ p: r.pred.legacy.p, m: r.pred.legacy.muR - r.pred.legacy.muB });

function evaluate(name: string, model: Model) {
  const out: Record<string, unknown> = {};
  for (const s of [2024, 2025]) {
    const R = bySeason(s), get = (r: ChampRow) => model.get(r.key)!;
    out[SEASON_LABEL[s]] = Object.fromEntries(SLICES.map(([label, keep]) => {
      const X = R.filter(keep);
      return [label, { model: absolute(X, get), champion: absolute(X, champ), delta: paired(X, get, champ) }];
    }));
  }
  const a = (out[SEASON_LABEL[2024]] as any).all, b = (out[SEASON_LABEL[2025]] as any).all;
  const f = (d: any) => `ΔBrier ${(1e4 * d.brier).toFixed(1)}e-4 [${(1e4 * d.brier95[0]).toFixed(1)}, ${(1e4 * d.brier95[1]).toFixed(1)}]  Δacc ${d.accuracyPp.toFixed(2)}pp  ΔMAE ${d.marginMae.toFixed(2)}`;
  console.log(`${name.padEnd(22)} 24-25 Brier ${a.model.brier.toFixed(4)} ${f(a.delta)} | 25-26 Brier ${b.model.brier.toFixed(4)} ${f(b.delta)}`);
  return out;
}
/** Tuning criterion: 2024–25 rolled Brier of the challenger alone. */
function tuneBrier(calls: Map<string, RaterCall>): number {
  const { model } = rolled(calls); const R = bySeason(2024);
  return R.reduce((s, r) => s + (clip(model.get(r.key)!.p) - r.y) ** 2, 0) / R.length;
}

// ---------------------------------------------------------------- grids (chosen on 2024–25 only)

const grids: { method: string; make: (p: any) => Rater; grid: Record<string, number>[] }[] = [
  { method: "massey", make: (p) => new Massey(p), grid: cross({ lambda: QUICK ? [4] : [2, 4, 8], rho: QUICK ? [0.6] : [0.4, 0.7] }) },
  { method: "trueskill", make: (p) => new TrueSkill(p), grid: cross({ sigma0: [1], beta: QUICK ? [1] : [0.5, 1, 2], tau: QUICK ? [0.03] : [0.01, 0.03, 0.1], rho: QUICK ? [0.6] : [0.4, 0.7], drawRate: [0.01] }) },
  { method: "glicko2", make: (p) => new Glicko2(p), grid: cross({ phi0: QUICK ? [1] : [0.5, 1, 2], sigma0: [0.06], tau: QUICK ? [0.5] : [0.2, 0.5], rho: QUICK ? [0.6] : [0.4, 0.7] }) },
];
function cross(o: Record<string, number[]>): Record<string, number>[] {
  return Object.entries(o).reduce<Record<string, number>[]>((acc, [k, vs]) => acc.flatMap((a) => vs.map((v) => ({ ...a, [k]: v }))), [{}]);
}

const result: Record<string, any> = {
  meta: {
    generated: new Date().toISOString().slice(0, 10), championRows: args[0].replace(/.*[\\/]/, ""), scoredRows: { "2024-25": bySeason(2024).length, "2025-26": bySeason(2025).length },
    protocol: "rolling monthly origins Oct 2024-Jun 2026, 365-day fit windows; rated events, decisive matches; deltas model minus champion (engine 3.3.0, served p and margin); event bootstrap 2000 draws",
  },
  context: {} as Record<string, unknown>, tuning: {}, methods: {},
};
console.log(`scored rows: 2024-25 ${bySeason(2024).length}, 2025-26 ${bySeason(2025).length}; folds ${folds.length}`);
for (const s of [2024, 2025]) {
  const R = bySeason(s);
  result.context[SEASON_LABEL[s]] = { champion: absolute(R, champ), legacyPre2_0: absolute(R, legacy) };
}
const refit = championRefit();
result.context.championRefit = evaluate("champion (refit slope)", refit);

for (const g of grids) {
  const t0 = Date.now(); const tried: Record<string, unknown>[] = [];
  let best: { params: Record<string, number>; calls: Map<string, RaterCall>; brier: number } | null = null;
  for (const params of g.grid) {
    const rater = g.make(params), t1 = Date.now(), calls = replay(rater), brier = tuneBrier(calls);
    tried.push({ params, brier2024: +brier.toFixed(5), seconds: Math.round((Date.now() - t1) / 1000), ...(rater instanceof Massey ? { solverIterations: rater.sweeps } : {}) });
    console.log(`  ${g.method} ${JSON.stringify(params)}: 2024-25 Brier ${brier.toFixed(5)}`);
    if (!best || brier < best.brier) best = { params, calls, brier };
  }
  console.log(`${g.method}: ${g.grid.length} settings in ${((Date.now() - t0) / 1000).toFixed(0)} s, best ${JSON.stringify(best!.params)} (2024-25 Brier ${best!.brier.toFixed(5)})`);
  result.tuning[g.method] = { chosen: best!.params, tried };
  const alone = rolled(best!.calls), hy = hybrid(best!.calls);
  result.methods[g.method] = { alone: evaluate(g.method, alone.model), plattSlopes: alone.slopes.map((v) => +v.toFixed(4)), hybrid: evaluate(`${g.method} hybrid`, hy.model), hybridWeights: hy.weights, hybridVsRefit: hybridVsRefit(hy.model) };
  if (g.method === "massey") {
    const ph = rolled(best!.calls, true);
    result.methods["massey-phases"] = { alone: evaluate("massey per phase", ph.model), phaseWeightsByFold: ph.weights };
  }
}
/** The hybrid against the champion with its own slope re-fitted on the same windows: the gain that is not just recalibration. */
function hybridVsRefit(model: Model) {
  return Object.fromEntries([2024, 2025].map((s) => [SEASON_LABEL[s], paired(bySeason(s), (r) => model.get(r.key)!, (r) => refit.get(r.key)!)]));
}
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(result, (k, v) => (typeof v === "number" && !Number.isInteger(v) ? +v.toPrecision(6) : v), 1) + "\n");
