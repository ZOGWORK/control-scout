// Research topic R5 (Nov 2026): margin-of-victory Elo (the FiveThirtyEight approach) adapted to 2-robot alliances,
// standalone and as an extra input next to the live engine. Research only: nothing here feeds the engine.
//
//   npx tsx scripts/research/r5-mov-elo.ts <components.json.gz> <slices-rows.json.gz> [--out <file.json>]
//
// The rating (per robot R, newcomers start at 1500 + offset; each season starts R ← 1500 + ρ·(R − 1500)):
//   alliance rating = R_a + R_b;  d = red − blue;  P(red) = 1 / (1 + 10^(−d/400))
//   after a rated match: Δ = K · M · (y − P) · (playoff weight), each partner gets ±K_t/2 · M · (y − P) (equal split)
//   K_t = max(K0/3, K0 / (1 + n_t/n0)) with n_t the robot's rated matches this season (n0 = ∞: constant K0)
//   M (the margin multiplier, with FiveThirtyEight's autocorrelation correction):
//     none      M = 1 (plain Elo: learns from win/loss only)
//     538       M = ln(|MOV| + 1) · 2.2 / (c · d_w + 2.2),            d_w = the winner's pre-match rating edge
//     538norm   M = ln(10·|MOV| / A + 1) · 2.2 / (c · d_w + 2.2),     A = running mean |margin| (causal; game-scale free)
//   ties update with M = 1. Scrimmages are predicted, never rated (the backtest's rule). 3-robot lineups are skipped.
// Margin prediction: margin = β·d, β least squares through the origin on the prior 365 days.
// Calibration: P is restretched by a slope σ(a·logit P) fitted on the prior 365 days (no intercept).
// Settings are chosen on 2024–25 (tuning) by rolled Brier; 2025–26 (DECODE) is judged once, labelled reused.
// Hybrids next to the live engine (forward-only, prior 365 days):
//   H1  P = σ(a·logit(p_champion) + γ·e),  e = d·ln10/400 (the Elo log-odds)
//   H2  the contextual model refitted (research learner) with e as a 23rd input, against the same refit without it
//   margin hybrid  margin = b1·(champion margin) + b2·d
import { writeFileSync } from "node:fs";
import { contextualRaw, fit, fitContextual } from "../part9/lib.js";
import { gate, gateLine, loadRows, logit, readGz, rolling, score, sig, slopeFit, type CompRow, type Gate, type Row } from "./lib.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const comp = readGz<CompRow[]>(args[0]).sort((a, b) => a.time - b.time); // stable: the replay's order within a timestamp
const rows = loadRows(args[0], args[1]);
const at = new Map(rows.map((r, i) => [r.key, i]));
const folds = [...rolling(rows)];
const SEASONS = [2024, 2025] as const;
console.log(`replay rows ${comp.length}, scored rows ${rows.length}, origins ${folds.length}`);

type Mov = "none" | "538" | "538norm";
interface EloParams { mov: Mov; k0: number; n0: number; carry: number; offset: number; c: number; playoff: number }

/** Replays the corpus once; returns d (red − blue, pre-match) for every scored row. */
function replay(p: EloParams): Float64Array {
  const R = new Map<number, number>(), n = new Map<number, number>();
  const d = new Float64Array(rows.length).fill(NaN);
  let season = -1, A = 60;
  const rating = (t: number) => { let r = R.get(t); if (r == null) { r = 1500 + p.offset; R.set(t, r); } return r; };
  for (const m of comp) {
    if (m.season !== season) { for (const [t, r] of R) R.set(t, 1500 + p.carry * (r - 1500)); n.clear(); season = m.season; }
    const dr = rating(m.red[0]) + rating(m.red[1]) - rating(m.blue[0]) - rating(m.blue[1]);
    const i = at.get(m.key);
    if (i != null) d[i] = dr;
    if (!m.rated) continue;
    const P = 1 / (1 + 10 ** (-dr / 400)), y = m.y;
    const mov = Math.abs(m.act.red.total - m.act.blue.total);
    let M = 1;
    if (p.mov !== "none" && y !== 0.5) {
      const dw = y === 1 ? dr : -dr;
      const base = p.mov === "538" ? Math.log(mov + 1) : Math.log((10 * mov) / A + 1);
      M = (base * 2.2) / Math.max(0.5, p.c * dw + 2.2);
    }
    if (y !== 0.5) A += 0.002 * (mov - A);
    const w = m.level === "playoff" ? p.playoff : 1;
    for (const [teams, sgn] of [[m.red, 1], [m.blue, -1]] as const) for (const t of teams) {
      const nt = n.get(t) ?? 0;
      const K = Number.isFinite(p.n0) ? Math.max(p.k0 / 3, p.k0 / (1 + nt / p.n0)) : p.k0;
      R.set(t, rating(t) + (sgn * K * M * w * (y - P)) / 2);
      n.set(t, nt + 1);
    }
  }
  return d;
}

const LN10 = Math.log(10) / 400;
interface Eval { p: Map<number, number>; m: Map<number, number>; slope: number[]; beta: number[] }
/** Rolling calibration and margin slope for one replay. */
function evaluate(d: Float64Array): Eval {
  const p = new Map<number, number>(), m = new Map<number, number>(), slope: number[] = [], beta: number[] = [];
  for (const f of folds) {
    const a = slopeFit(f.train.map((i) => d[i] * LN10), f.train.map((i) => rows[i].y));
    let sxy = 0, sxx = 0; for (const i of f.train) { sxy += d[i] * rows[i].margin; sxx += d[i] * d[i]; }
    const b = sxx ? sxy / sxx : 0;
    for (const i of f.test) { p.set(i, sig(a * d[i] * LN10)); m.set(i, b * d[i]); }
    slope.push(+a.toFixed(4)); beta.push(+b.toFixed(5));
  }
  return { p, m, slope, beta };
}
const seasonIdx = (s: number, e: Map<number, number>) => [...e.keys()].filter((i) => rows[i].season === s);
const sc = (s: number, e: Eval) => { const idx = seasonIdx(s, e.p); return score(idx.map((i) => e.p.get(i)!), idx.map((i) => rows[i].y), { pred: idx.map((i) => e.m.get(i)!), actual: idx.map((i) => rows[i].margin) }); };

// ---- Tuning grid on 2024–25.
const grid: EloParams[] = [];
const K: Record<Mov, number[]> = { none: [32, 64, 128, 192, 256], "538": [8, 16, 32, 48, 64], "538norm": [8, 16, 32, 48, 64, 96] };
for (const mov of ["none", "538", "538norm"] as Mov[]) for (const k0 of K[mov]) for (const n0 of [Infinity, 10]) for (const carry of [0.3, 0.5, 0.7, 0.9]) for (const offset of [0, -100]) for (const c of mov === "none" ? [0] : [0.001, 0.0025, 0.005])
  grid.push({ mov, k0, n0, carry, offset, c, playoff: 0.5 });
const tuned: { params: EloParams; brier2024: number; acc2024: number }[] = [];
for (const g of grid) { const s = sc(2024, evaluate(replay(g))); tuned.push({ params: g, brier2024: s.brier, acc2024: s.accuracy }); }
tuned.sort((a, b) => a.brier2024 - b.brier2024);
const best = (mov: Mov) => tuned.find((t) => t.params.mov === mov)!;
console.log("best per variant on 2024-25:", JSON.stringify((["none", "538", "538norm"] as Mov[]).map((v) => best(v))));

const out: Record<string, unknown> = { grid: grid.length, tuned: tuned.slice(0, 15).map((t) => ({ ...t, params: { ...t.params, n0: Number.isFinite(t.params.n0) ? t.params.n0 : "inf" } })) };
// The champion on the same rows.
const champ = (s: number) => { const idx = seasonIdx(s, new Map(folds.flatMap((f) => f.test.map((i) => [i, 0] as [number, number])))); return score(idx.map((i) => rows[i].pc), idx.map((i) => rows[i].y), { pred: idx.map((i) => rows[i].muGap), actual: idx.map((i) => rows[i].margin) }); };
out.champion = Object.fromEntries(SEASONS.map((s) => [s, champ(s)]));
const gateOf = (s: number, b: Map<number, number>, mb?: Map<number, number>): Gate =>
  gate(s, seasonIdx(s, b).map((i) => ({ event: rows[i].event, y: rows[i].y, tags: rows[i].tags, a: rows[i].pc, b: b.get(i)!, ma: rows[i].muGap, mb: mb?.get(i) ?? rows[i].muGap, margin: rows[i].margin })));
const slim = (g: Gate) => ({ n: g.n, champion: g.champion, challenger: g.challenger, dBrier: g.paired.brier, dBrier95: g.paired.brier95, dLogLoss: g.paired.logLoss, dAccPp: g.paired.accuracyPp, dAcc95: g.paired.accuracy95, marginMAE: g.marginMAE, cal5080: g.cal5080, regressions: g.regressions, pass: g.pass });

const variants: Record<string, unknown> = {};
const ds: Record<string, Float64Array> = {};
for (const mov of ["none", "538", "538norm"] as Mov[]) {
  const b = best(mov), d = replay(b.params), e = evaluate(d);
  ds[mov] = d;
  const gates = Object.fromEntries(SEASONS.map((s) => [s, gateOf(s, e.p, e.m)]));
  for (const s of SEASONS) console.log(`standalone ${mov}: ${gateLine(gates[s])}`);
  variants[mov] = { params: { ...b.params, n0: Number.isFinite(b.params.n0) ? b.params.n0 : "inf" }, gates: Object.fromEntries(SEASONS.map((s) => [s, slim(gates[s])])), calibrationSlope: e.slope, marginBeta: e.beta };
}
out.standalone = variants;

// ---- H1: the champion's log-odds plus the Elo log-odds (two weights, prior 365 days).
const hybrids: Record<string, unknown> = {};
// H0, the control: the champion restretched by its own rolling slope (H1 with γ = 0). H1's gain over H0 is the Elo's.
const h0 = new Map<number, number>();
for (const f of folds) { const a = slopeFit(f.train.map((i) => logit(rows[i].pc)), f.train.map((i) => rows[i].y)); for (const i of f.test) h0.set(i, sig(a * logit(rows[i].pc))); }
hybrids["H0 champion restretched"] = { gates: Object.fromEntries(SEASONS.map((s) => { const g = gateOf(s, h0); console.log(`H0: ${gateLine(g)}`); return [s, slim(g)]; })) };
const vsH0 = (s: number, b: Map<number, number>) => gate(s, seasonIdx(s, b).map((i) => ({ event: rows[i].event, y: rows[i].y, tags: rows[i].tags, a: h0.get(i)!, b: b.get(i)! })));
for (const mov of ["none", "538", "538norm"] as Mov[]) {
  const d = ds[mov], p = new Map<number, number>(), mh = new Map<number, number>(), w: number[][] = [];
  for (const f of folds) {
    const X = f.train.map((i) => [logit(rows[i].pc), d[i] * LN10]);
    const c = fit(X, f.train.map((i) => rows[i].y), [1e-4, 1e-4], [1, 0]);
    // Margin hybrid: least squares of the margin on (champion margin, d), no intercept.
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    for (const i of f.train) { const u = rows[i].muGap, v = d[i], y = rows[i].margin; a11 += u * u; a12 += u * v; a22 += v * v; b1 += u * y; b2 += v * y; }
    const det = a11 * a22 - a12 * a12, k1 = (b1 * a22 - b2 * a12) / det, k2 = (a11 * b2 - a12 * b1) / det;
    for (const i of f.test) { p.set(i, sig(c[0] * logit(rows[i].pc) + c[1] * d[i] * LN10)); mh.set(i, k1 * rows[i].muGap + k2 * d[i]); }
    w.push([+c[0].toFixed(4), +c[1].toFixed(4), +k1.toFixed(4), +k2.toFixed(6)]);
  }
  const gates = Object.fromEntries(SEASONS.map((s) => [s, gateOf(s, p)]));
  const mg = Object.fromEntries(SEASONS.map((s) => [s, gateOf(s, p, mh).marginMAE]));
  for (const s of SEASONS) console.log(`H1 ${mov}: ${gateLine(gates[s])}  margin hybrid dMAE ${mg[s]!.mae.toFixed(3)} [${mg[s]!.mae95.map((v) => v.toFixed(3)).join(", ")}]`);
  const overH0 = Object.fromEntries(SEASONS.map((s) => { const g = vsH0(s, p); console.log(`H1 ${mov} vs H0: ${gateLine(g)}`); return [s, slim(g)]; }));
  hybrids[`H1 ${mov}`] = { gates: Object.fromEntries(SEASONS.map((s) => [s, slim(gates[s])])), vsH0: overH0, marginHybrid: mg, weights: w };
}

// ---- H2: refitted contextual model with and without the Elo input (MOV-Elo, 538norm, and plain Elo).
{
  const arms: [string, Float64Array | null][] = [["refit 22", null], ["refit 22 + plain Elo", ds.none], ["refit 22 + MOV-Elo", ds["538"]], ["refit 22 + MOV-Elo norm", ds["538norm"]]];
  const preds = new Map<string, Map<number, number>>(arms.map(([n]) => [n, new Map()]));
  for (const f of folds) {
    for (const [name, d] of arms) {
      const X = f.train.map((i) => (d ? [...rows[i].x, d[i] * LN10] : rows[i].x));
      const m = fitContextual(X, f.train.map((i) => rows[i].L), f.train.map((i) => rows[i].y));
      const a = slopeFit(X.map((x, j) => logit(contextualRaw(m, x, rows[f.train[j]].L))), f.train.map((i) => rows[i].y));
      for (const i of f.test) preds.get(name)!.set(i, sig(a * logit(contextualRaw(m, d ? [...rows[i].x, d[i] * LN10] : rows[i].x, rows[i].L))));
    }
    console.log(`H2 origin ${new Date(f.origin).toISOString().slice(0, 7)}`);
  }
  const base = preds.get("refit 22")!;
  for (const [name] of arms) {
    const vsChampion = Object.fromEntries(SEASONS.map((s) => [s, slim(gateOf(s, preds.get(name)!))]));
    const vsRefit = name === "refit 22" ? null : Object.fromEntries(SEASONS.map((s) => {
      const g = gate(s, seasonIdx(s, base).map((i) => ({ event: rows[i].event, y: rows[i].y, tags: rows[i].tags, a: base.get(i)!, b: preds.get(name)!.get(i)! })));
      console.log(`H2 ${name} vs refit 22: ${gateLine(g)}`);
      return [s, slim(g)];
    }));
    for (const s of SEASONS) console.log(`H2 ${name} vs champion: dBrier ${(1e4 * (vsChampion[s] as any).dBrier).toFixed(2)}e-4`);
    hybrids[`H2 ${name}`] = { vsChampion, vsRefit };
  }
}
out.hybrids = hybrids;
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(out, null, 1) + "\n");
