// Shared helpers for the Nov 2026 research topics (R3 component importance, R5 MOV-Elo): the joined row set,
// the rolling-origin calendar and the scoring every challenger and the champion get identically.
//
// Protocol (Part 9 / 12.5): monthly origins from October 2024 to July 2026; anything fitted is fitted on the 365 days
// before the origin only and scored on that month. Rated events, pre-match state only, decisive matches (ties left
// out of fits and scores). 2024–25 is the tuning season; 2025–26 (DECODE) is judged and labelled reused.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pairedReport, rng, sliceReport, type PairedMetrics, type PairedRow } from "../slices/report.js";

export { rng };
import { FITTED_MODEL } from "@control-scout/predict-engine";
import { fit, logit, sig } from "../part9/lib.js";
import { probBand } from "../slices/tags.js";

export { logit, sig };
export const DAY = 864e5;
export const WINDOW = 365 * DAY;
/** The engine's own logit (contextual.ts): clamped at 1e-9, not the research learner's 1e-6. */
export const logit9 = (p: number) => { const q = Math.min(1 - 1e-9, Math.max(1e-9, p)); return Math.log(q / (1 - q)); };

export interface Phases { auto: number; teleop: number; endgame: number; pen: number }
/** One component row (scripts/research/component-rows.ts). */
export interface CompRow {
  key: string; season: number; event: string; level: "qual" | "playoff"; time: number; y: number; rated: boolean;
  red: number[]; blue: number[]; exp: { red: Phases; blue: Phases }; S: number; muR: number; muB: number; pRaw: number; p: number;
  act: { red: Phases & { total: number }; blue: Phases & { total: number } };
  /** The contextual model's inputs as the served call read them (null: lineup unsupported); the model id that served it. */
  x: number[] | null; model: string;
}
/** One slices-harness row (`engine-slices.ts --rows`), the fields used here (its data tags). */
export interface SliceRow { key: string; season: number; event: string; level: string; time: number; y: number; rated: boolean; x?: number[]; pRaw?: number; data: Record<string, unknown>; vol?: string; pred: { champion: { p: number; muR: number; muB: number } } }
/** The joined row: champion call, its 22 contextual inputs, its phase expectations and the result. */
export interface Row extends CompRow { x: number[]; L: number; pc: number; tags: Record<string, string>; margin: number; muGap: number; gap: Phases }

export const readGz = <T>(f: string): T => JSON.parse(gunzipSync(readFileSync(f)).toString()) as T;

/** Rated, decisive, predicted matches in time order that the contextual model served, with the slices harness's data tags. */
export function loadRows(componentsFile: string, slicesFile?: string): Row[] {
  const comp = readGz<CompRow[]>(componentsFile);
  const sl = slicesFile ? new Map(readGz<SliceRow[]>(slicesFile).map((r) => [r.key, r])) : null;
  const out: Row[] = [];
  for (const c of comp) {
    if (!c.rated || c.y === 0.5) continue;
    const s = sl?.get(c.key);
    if (sl && !s) throw new Error(`no slices row for ${c.key}`);
    if (!c.x || !c.x.every(Number.isFinite) || c.model !== FITTED_MODEL.contextual!.id) continue;
    if (s && Math.abs(s.pred.champion.p - c.p) > 1e-12) throw new Error(`champion call differs between the two replays at ${c.key}`);
    const gap: Phases = {
      auto: c.exp.red.auto - c.exp.blue.auto, teleop: c.exp.red.teleop - c.exp.blue.teleop, endgame: c.exp.red.endgame - c.exp.blue.endgame,
      pen: c.exp.blue.pen - c.exp.red.pen, // fouls blue is expected to commit are points for red
    };
    const d = s?.data ?? {};
    // The slices harness's data tags, its volatility tag and the champion's probability band (gate dimensions).
    const tags: Record<string, string> = { ...Object.fromEntries(["level", "eventMatch", "teamEvent", "experience", "teamMatches", "density", "eventSize", "eventType"].map((k) => [k, String(d[k] ?? "")])), volatility: String(s?.vol ?? ""), probBand: probBand(c.p) };
    out.push({ ...c, x: c.x, L: logit9(c.pRaw), pc: c.p, tags, margin: c.act.red.total - c.act.blue.total, muGap: c.muR - c.muB, gap });
  }
  return out.sort((a, b) => a.time - b.time);
}

/** Month starts: origins October 2024 … July 2026, plus the end of July 2026. */
export function origins(): number[] {
  const m: number[] = [];
  for (let d = new Date(Date.UTC(2024, 9, 1)); d <= new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) m.push(d.getTime());
  return m;
}

/** For each origin with at least `minTest` matches: the training rows (prior 365 days) and the test rows (that month). */
export function* rolling<T extends { time: number }>(rows: T[], minTest = 50, minTrain = 2000): Generator<{ origin: number; train: number[]; test: number[] }> {
  const o = origins();
  for (let i = 0; i < o.length - 1; i++) {
    const t0 = o[i], t1 = o[i + 1];
    const train: number[] = [], test: number[] = [];
    rows.forEach((r, j) => { if (r.time >= t0 - WINDOW && r.time < t0) train.push(j); else if (r.time >= t0 && r.time < t1) test.push(j); });
    if (test.length >= minTest && train.length >= minTrain) yield { origin: t0, train, test };
  }
}

/** Slope-only recalibration σ(a·logit p) on a training set (no intercept: never a colour term). */
export function slopeFit(z: number[], y: number[]): number {
  return fit(z.map((v) => [v]), y, [1e-4], [1])[0];
}

const clip = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));
export interface Score { n: number; brier: number; accuracy: number; logLoss: number; marginMAE: number | null }
/** Brier, accuracy (a 50% call counts half), log loss and margin MAE over decisive rows. */
export function score(ps: number[], ys: number[], margins?: { pred: number[]; actual: number[] }): Score {
  let b = 0, a = 0, l = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = clip(ps[i]), y = ys[i];
    b += (p - y) ** 2; l += -(y * Math.log(p) + (1 - y) * Math.log(1 - p)); a += p === 0.5 ? 0.5 : (p > 0.5) === (y === 1) ? 1 : 0;
  }
  const n = ps.length;
  const mae = margins ? margins.pred.reduce((s, m, i) => s + Math.abs(m - margins.actual[i]), 0) / n : null;
  return { n, brier: b / n, accuracy: a / n, logLoss: l / n, marginMAE: mae };
}

/** Paired margin-MAE change (b − a) with a 95% event-bootstrap interval. */
export function pairedMAE(rows: { event: string; actual: number; a: number; b: number }[], draws = 2000, seed = 20261103): { mae: number; mae95: [number, number] } {
  const ev = new Map<string, { n: number; d: number }>();
  for (const r of rows) { const x = ev.get(r.event) ?? { n: 0, d: 0 }; x.n++; x.d += Math.abs(r.b - r.actual) - Math.abs(r.a - r.actual); ev.set(r.event, x); }
  const E = [...ev.values()];
  const rand = rng(seed), bs: number[] = [];
  for (let i = 0; i < draws; i++) { let d = 0, n = 0; for (let j = 0; j < E.length; j++) { const x = E[Math.floor(rand() * E.length)]; d += x.d; n += x.n; } bs.push(d / n); }
  bs.sort((x, y) => x - y);
  const tot = E.reduce((t, x) => ({ n: t.n + x.n, d: t.d + x.d }), { n: 0, d: 0 });
  return { mae: tot.d / tot.n, mae95: [bs[Math.floor(0.025 * draws)], bs[Math.floor(0.975 * draws)]] };
}

/** The slice dimensions every gate checks: the same as engine-slices.ts --challenger (data tags, volatility, the champion's probability band). */
export const DIMS = ["level", "eventMatch", "teamEvent", "experience", "teamMatches", "density", "volatility", "eventSize", "eventType", "probBand"];

/** Calibration error in the 50–80% bands, match-weighted (the gates' decision bands). */
export function cal5080(ps: number[], ys: number[]): number {
  const c = sliceReport(ps.map((p, i) => ({ p, y: ys[i], tags: {} })), []).calibration.filter((b) => ["50-60", "60-70", "70-80"].includes(b.band));
  return c.reduce((s, b) => s + b.n * b.error, 0) / c.reduce((s, b) => s + b.n, 0);
}

export interface Gate { season: number; n: number; champion: Score; challenger: Score; paired: PairedMetrics; marginMAE: { mae: number; mae95: [number, number] } | null; cal5080: { champion: number; challenger: number }; regressions: string[]; pass: boolean }
/** The gate on one season: challenger (b) minus champion (a) on identical decisive matches, every slice checked. */
export function gate(season: number, rows: { event: string; y: number; tags: Record<string, string>; a: number; b: number; ma?: number; mb?: number; margin?: number }[]): Gate {
  const pr: PairedRow[] = rows.map((r) => ({ event: r.event, y: r.y, a: r.a, b: r.b, tags: r.tags }));
  const rep = pairedReport(pr, DIMS);
  const regressions = Object.entries(rep.dims).flatMap(([dim, d]) => Object.entries(d).filter(([, m]) => m.regression).map(([v, m]) => `${dim}: ${v}${m.lowConfidence ? " (low n)" : ""}`));
  const ys = rows.map((r) => r.y);
  const hasM = rows.every((r) => r.ma != null && r.mb != null && r.margin != null);
  const mm = hasM ? pairedMAE(rows.map((r) => ({ event: r.event, actual: r.margin!, a: r.ma!, b: r.mb! }))) : null;
  const sc = (k: "a" | "b", mk: "ma" | "mb") => score(rows.map((r) => r[k]), ys, hasM ? { pred: rows.map((r) => r[mk]!), actual: rows.map((r) => r.margin!) } : undefined);
  const paired = rep.all;
  const champion = sc("a", "ma"), challenger = sc("b", "mb");
  const cal = { champion: cal5080(rows.map((r) => r.a), ys), challenger: cal5080(rows.map((r) => r.b), ys) };
  return {
    season, n: rows.length, champion, challenger, paired, marginMAE: mm, cal5080: cal, regressions,
    // Brier better with the interval excluding zero; accuracy and margin MAE not worse beyond noise; no slice
    // regression; 50–80% calibration error no worse (the documented gate, docs/engine/README.md).
    pass: paired.brier95[1] < 0 && !(paired.accuracy95[1] < 0) && !(mm && mm.mae95[0] > 0) && regressions.length === 0 && cal.challenger <= cal.champion + 1e-12,
  };
}

export const fmt4 = (x: number) => (1e4 * x).toFixed(2);
export const ci4 = (c: [number, number]) => `[${fmt4(c[0])}, ${fmt4(c[1])}]`;
export function gateLine(g: Gate): string {
  const m = g.marginMAE ? `  dMAE ${g.marginMAE.mae.toFixed(3)} [${g.marginMAE.mae95.map((v) => v.toFixed(3)).join(", ")}]` : "";
  return `${g.season}: n ${g.n}  Brier ${g.champion.brier.toFixed(5)} -> ${g.challenger.brier.toFixed(5)}  dBrier ${fmt4(g.paired.brier)}e-4 ${ci4(g.paired.brier95)}  dAcc ${g.paired.accuracyPp.toFixed(2)}pp [${g.paired.accuracy95.map((v) => v.toFixed(2)).join(", ")}]${m}  cal50-80 ${(100 * g.cal5080.champion).toFixed(2)} -> ${(100 * g.cal5080.challenger).toFixed(2)}  regressions ${g.regressions.length ? g.regressions.join("; ") : "none"}  ${g.pass ? "PASS" : "fail"}`;
}

export function shuffled(n: number, rand: () => number): number[] {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
