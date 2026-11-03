// Research topic R3 (Nov 2026): which components predict wins, and with what weight? Walk-forward, decisive matches.
//
//   npx tsx scripts/research/r3-component-importance.ts <components.json.gz> <slices-rows.json.gz> [--out <file.json>] [--quick]
//
// Inputs: scripts/research/component-rows.ts (phase expectations) and engine-slices.ts --rows --features (the
// champion's 22 contextual inputs), both on a copy of the pinned snapshot, seasons 2023–2025.
//
// Groups (each is removed or permuted as a whole):
//   auto, teleop, endgame, fouls   the phase's expected gap inside the score gap (so in L) and its own input (D1, D2, D3)
//   form                           D18 in-event form, D20 momentum
//   reliability                    D13–D17 bias / variance / failure, D21 last match collapsed, D22 recovery
//   partner balance                D4 partner spread
//   experience                     D5 log matches, D6 days since last match
//   data certainty                 D7 uncertainty, D9 L / (1 + fewest matches / 5), D10 gap, D11 unknown robots, D19 event sample
//   match context                  D8 playoff, D12 total strength
// Four measurements, every one forward-only on monthly origins October 2024 – July 2026:
//   A. live engine, permutation importance: shuffle the group within the test month (3 repeats), no refit
//   B. live engine, zero-out ablation: set the group to its neutral value (0: every input is red − blue), no refit
//   C. drop-column with refit: the contextual model refitted (research learner, prior 365 days) with and without the group
//   D. a per-component logistic model (phase gaps / S plus the other groups' main inputs, no L): standardized
//      coefficients, drop-column refit and permutation importance
// Then the reweighting candidate: the champion plus refitted phase weights (prior 365 days), through the gate.
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, contextualProbability, phi } from "@control-scout/predict-engine";
import { contextualRaw, fitContextual } from "../part9/lib.js";
import { DAY, gate, gateLine, loadRows, logit9, logit, rolling, rng, score, shuffled, sig, slopeFit, type Gate, type Phases, type Row } from "./lib.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const QUICK = args.includes("--quick");
const rows = loadRows(args[0], args[1]);
const M = FITTED_MODEL.contextual!;
const SEASONS = [2024, 2025] as const;
console.log(`rows ${rows.length} (rated, decisive, with contextual inputs)`);

// The champion is recomputed from (L, x): it must be the served number.
let worst = 0;
for (const r of rows) worst = Math.max(worst, Math.abs(contextualProbability(M, r.L, r.x) - r.pc));
if (worst > 1e-9) throw new Error(`champion recompute differs by ${worst}`);
let gapErr = 0;
for (const r of rows) gapErr = Math.max(gapErr, Math.abs(r.gap.auto + r.gap.teleop + r.gap.endgame + r.gap.pen - r.muGap));
console.log(`champion recompute max |Δp| ${worst.toExponential(2)}; phase decomposition max |Σ phases − expected margin| ${gapErr.toFixed(3)} pts`);

const LX = [7, 8, 9, 10, 11, 15, 16, 18]; // inputs of the form L × f (D8–D12, D16, D17, D19)
type Phase = keyof Phases;
interface Group { name: string; phase?: Phase; d: number[] }
const GROUPS: Group[] = [
  { name: "auto", phase: "auto", d: [0] }, { name: "teleop", phase: "teleop", d: [] }, { name: "endgame", phase: "endgame", d: [1] }, { name: "fouls", phase: "pen", d: [2] },
  { name: "form", d: [17, 19] }, { name: "reliability", d: [12, 13, 14, 15, 16, 20, 21] }, { name: "partner balance", d: [3] },
  { name: "experience", d: [4, 5] }, { name: "data certainty", d: [6, 8, 9, 10, 18] }, { name: "match context", d: [7, 11] },
];
const Phi = (u: number) => Math.min(1 - 1e-9, Math.max(1e-9, phi(u)));
const fOf = (r: Row, k: number) => (Math.abs(r.L) > 1e-9 ? r.x[k] / r.L : 0);

/** The row's (L, x, expected margin) with group g removed (donor undefined) or taken from the donor row. */
function variant(r: Row, g: Group, donor?: Row): { L: number; x: number[]; mu: number } {
  let L = r.L, mu = r.muGap;
  if (g.phase) {
    const G = r.muGap, v = donor ? (donor.gap[g.phase] / donor.S) * r.S : 0;
    const G2 = G - r.gap[g.phase] + v;
    L = r.L + logit9(Phi(G2 / r.S)) - logit9(Phi(G / r.S));
    mu = G2;
  }
  const x = r.x.slice();
  if (L !== r.L) for (const k of LX) x[k] = fOf(r, k) * L;
  for (const k of g.d) x[k] = !donor ? 0 : LX.includes(k) ? fOf(donor, k) * L : donor.x[k];
  return { L, x, mu };
}

const seasonRows = (s: number, idx: number[]) => idx.filter((i) => rows[i].season === s);
const testIdx: number[] = [];
const folds = [...rolling(rows)];
for (const f of folds) testIdx.push(...f.test);
console.log(`origins ${folds.length}, scored ${testIdx.length}`);
const gateOf = (s: number, b: Map<number, number>, mb?: Map<number, number>, a?: Map<number, number>): Gate =>
  gate(s, seasonRows(s, [...b.keys()]).map((i) => ({ event: rows[i].event, y: rows[i].y, tags: rows[i].tags, a: a?.get(i) ?? rows[i].pc, b: b.get(i)!, ma: rows[i].muGap, mb: mb?.get(i) ?? rows[i].muGap, margin: rows[i].margin })));
const brief = (g: Gate) => ({ n: g.n, dBrier: g.paired.brier, dBrier95: g.paired.brier95, dAccPp: g.paired.accuracyPp, dAcc95: g.paired.accuracy95, dMarginMAE: g.marginMAE?.mae ?? 0, dMarginMAE95: g.marginMAE?.mae95 ?? [0, 0], dLogLoss: g.paired.logLoss });
const out: Record<string, unknown> = {};

// ---- Champion alone on the scored rows.
const champ: Record<number, unknown> = {};
for (const s of SEASONS) {
  const idx = seasonRows(s, testIdx);
  champ[s] = score(idx.map((i) => rows[i].pc), idx.map((i) => rows[i].y), { pred: idx.map((i) => rows[i].muGap), actual: idx.map((i) => rows[i].margin) });
}
out.champion = champ;
console.log("champion", JSON.stringify(champ));

// ---- Correlations (context only: correlation is not importance).
const corr = (a: number[], b: number[]) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };
out.correlations = Object.fromEntries(SEASONS.map((s) => {
  const idx = seasonRows(s, testIdx), y = idx.map((i) => rows[i].y);
  const ph = (p: Phase) => corr(idx.map((i) => rows[i].gap[p] / rows[i].S), y);
  return [s, { auto: ph("auto"), teleop: ph("teleop"), endgame: ph("endgame"), fouls: ph("pen"), ...Object.fromEntries([3, 4, 6, 12, 13, 14, 17].map((k) => [`D${k + 1}`, corr(idx.map((i) => rows[i].x[k]), y)])) }];
}));

// ---- The champion's implied per-point weights (final log-odds per unit of expected gap / S, relative to TeleOp).
// Per row: a phase gap moves L (by dL/d(gap/S)), every input of the form L × f with it (D8–D12, D16, D17, D19),
// and its own input (D1 auto, D2 endgame, D3 fouls). Averaged over 2025–26 rows; the calibration gain folds in.
{
  const gain = (M.recalibration?.slope ?? 1) * M.calibration.slope;
  const idx = seasonRows(2025, testIdx);
  const own: Record<string, number | null> = { auto: 0, teleop: null, endgame: 1, fouls: 2 };
  const sums: Record<string, number> = { auto: 0, teleop: 0, endgame: 0, fouls: 0 };
  let kSum = 0, lxSum = 0;
  for (const i of idx) {
    const r = rows[i], u = r.muGap / r.S, P = Phi(u), k = phi1(u) / (P * (1 - P));
    const lx = LX.reduce((t, j) => t + (M.coefficients[j] / M.scale[j]) * fOf(r, j), 0); // dz/dL beyond 1
    kSum += k; lxSum += 1 + lx;
    for (const [n, j] of Object.entries(own)) sums[n] += gain * (k * (1 + lx) + (j == null ? 0 : M.coefficients[j] / M.scale[j]));
  }
  const w = Object.fromEntries(Object.entries(sums).map(([n, v]) => [n, v / idx.length])) as Record<string, number>;
  out.championWeights = { dLdGapOverS: kSum / idx.length, dzdL: lxSum / idx.length, gain, perUnitGapOverS: w, relativeToTeleop: Object.fromEntries(Object.entries(w).map(([n, v]) => [n, v / w.teleop])) };
  console.log("champion implied weights", JSON.stringify(out.championWeights));
}
function phi1(u: number) { return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI); }

// ---- A + B: live engine, permutation and zero-out (no refit).
const A: Record<string, unknown> = {}, B: Record<string, unknown> = {};
const REPEATS = QUICK ? 1 : 3;
for (const g of GROUPS) {
  const zp = new Map<number, number>(), zm = new Map<number, number>();
  for (const i of testIdx) { const v = variant(rows[i], g); zp.set(i, contextualProbability(M, v.L, v.x)); zm.set(i, v.mu); }
  B[g.name] = Object.fromEntries(SEASONS.map((s) => [s, brief(gateOf(s, zp, zm))]));
  const rep: Record<number, ReturnType<typeof brief>[]> = { 2024: [], 2025: [] };
  for (let k = 0; k < REPEATS; k++) {
    const rand = rng(1000 + k), pp = new Map<number, number>(), pm = new Map<number, number>();
    for (const f of folds) { const perm = shuffled(f.test.length, rand); f.test.forEach((i, j) => { const v = variant(rows[i], g, rows[f.test[perm[j]]]); pp.set(i, contextualProbability(M, v.L, v.x)); pm.set(i, v.mu); }); }
    for (const s of SEASONS) rep[s].push(brief(gateOf(s, pp, pm)));
  }
  A[g.name] = Object.fromEntries(SEASONS.map((s) => [s, avgBrief(rep[s])]));
  console.log(`A/B ${g.name}: perm 2025 ${(1e4 * (A[g.name] as any)[2025].dBrier).toFixed(2)}e-4, zero 2025 ${(1e4 * (B[g.name] as any)[2025].dBrier).toFixed(2)}e-4 [${(B[g.name] as any)[2025].dBrier95.map((v: number) => (1e4 * v).toFixed(2)).join(", ")}]`);
}
function avgBrief(xs: ReturnType<typeof brief>[]) {
  const m = (f: (x: ReturnType<typeof brief>) => number) => xs.reduce((s, x) => s + f(x), 0) / xs.length;
  return { n: xs[0].n, repeats: xs.length, dBrier: m((x) => x.dBrier), dBrier95: [m((x) => x.dBrier95[0]), m((x) => x.dBrier95[1])], dAccPp: m((x) => x.dAccPp), dAcc95: [m((x) => x.dAcc95[0]), m((x) => x.dAcc95[1])], dMarginMAE: m((x) => x.dMarginMAE), dMarginMAE95: [m((x) => x.dMarginMAE95[0]), m((x) => x.dMarginMAE95[1])] };
}
out.permutation = A; out.zeroOut = B;

// ---- C: drop-column with refit (the contextual model's research learner, prior 365 days, slope recalibration).
const C: Record<string, unknown> = {};
{
  const arms: (Group | null)[] = [null, ...GROUPS];
  const preds = new Map<string, Map<number, number>>(arms.map((g) => [g?.name ?? "full", new Map()]));
  const coefs: { origin: string; coefficients: number[] }[] = [];
  const design = (r: Row, g: Group | null) => { if (!g) return { L: r.L, x: r.x }; const v = variant(r, g); return { L: v.L, x: v.x.filter((_, k) => !g.d.includes(k)) }; };
  for (const f of folds) {
    const train = f.train.filter((i) => rows[i].y !== 0.5);
    for (const g of arms) {
      const tr = train.map((i) => design(rows[i], g));
      const m = fitContextual(tr.map((d) => d.x), tr.map((d) => d.L), train.map((i) => rows[i].y));
      const a = slopeFit(tr.map((d) => logit(contextualRaw(m, d.x, d.L))), train.map((i) => rows[i].y));
      for (const i of f.test) { const d = design(rows[i], g); preds.get(g?.name ?? "full")!.set(i, sig(a * logit(contextualRaw(m, d.x, d.L)))); }
      if (!g) coefs.push({ origin: new Date(f.origin).toISOString().slice(0, 7), coefficients: m.coefficients.map((c) => +c.toFixed(4)) });
    }
    console.log(`C origin ${new Date(f.origin).toISOString().slice(0, 7)} train ${train.length}`);
  }
  const full = preds.get("full")!;
  C.fullRefitVsChampion = Object.fromEntries(SEASONS.map((s) => [s, brief(gateOf(s, full))]));
  for (const g of GROUPS) {
    const mu = new Map<number, number>(); for (const i of testIdx) mu.set(i, variant(rows[i], g).mu);
    C[g.name] = Object.fromEntries(SEASONS.map((s) => [s, brief(gateOf(s, preds.get(g.name)!, mu, full))]));
  }
  C.coefficients = coefs;
}
out.dropColumnRefit = C;

// ---- D: a per-component logistic model (standalone, no L): standardized coefficients and importances.
const D: Record<string, unknown> = {};
{
  const NAMES = ["auto gap / S", "TeleOp gap / S", "endgame gap / S", "fouls gap / S", "D4 partner spread", "D5 experience", "D6 days since last", "D7 uncertainty", "D13 bias", "D14 variance", "D15 failure", "D18 in-event form", "D20 momentum", "D21 last collapsed", "D22 recovery"];
  const GD: [string, number[]][] = [["auto", [0]], ["teleop", [1]], ["endgame", [2]], ["fouls", [3]], ["partner balance", [4]], ["experience", [5, 6]], ["data certainty", [7]], ["reliability", [8, 9, 10, 13, 14]], ["form", [11, 12]]];
  const feat = (r: Row) => [r.gap.auto / r.S, r.gap.teleop / r.S, r.gap.endgame / r.S, r.gap.pen / r.S, r.x[3], r.x[4], r.x[5], r.x[6], r.x[12], r.x[13], r.x[14], r.x[17], r.x[19], r.x[20], r.x[21]];
  const F = rows.map(feat);
  const arms: [string, number[]][] = [["full", []], ...GD];
  const preds = new Map<string, Map<number, number>>(arms.map(([n]) => [n, new Map()]));
  const perm = new Map<string, Map<number, number>>(GD.map(([n]) => [n, new Map()]));
  const fits: { origin: string; season: number; standardized: number[]; perPoint: number[] }[] = [];
  for (const f of folds) {
    const train = f.train;
    for (const [name, drop] of arms) {
      const keep = (v: number[]) => v.filter((_, k) => !drop.includes(k));
      const X = train.map((i) => keep(F[i]));
      const m = fitContextual(X, X.map(() => 0), train.map((i) => rows[i].y));
      const a = slopeFit(X.map((x) => logit(contextualRaw(m, x, 0))), train.map((i) => rows[i].y));
      const pr = (x: number[]) => sig(a * logit(contextualRaw(m, x, 0)));
      for (const i of f.test) preds.get(name)!.set(i, pr(keep(F[i])));
      if (name === "full") {
        fits.push({ origin: new Date(f.origin).toISOString().slice(0, 7), season: rows[f.test[0]].season, standardized: m.coefficients.map((c) => +(a * c).toFixed(4)), perPoint: m.coefficients.slice(0, 4).map((c, k) => +((a * c) / m.scale[k]).toFixed(4)) });
        // Permutation importance of the fitted full model (no refit), 1 shuffle per group per origin.
        const rand = rng(77 + f.origin / DAY);
        for (const [gname, cols] of GD) { const p = shuffled(f.test.length, rand); f.test.forEach((i, j) => { const x = F[i].slice(); const dn = F[f.test[p[j]]]; for (const k of cols) x[k] = dn[k]; perm.get(gname)!.set(i, pr(x)); }); }
      }
    }
  }
  const full = preds.get("full")!;
  D.names = NAMES;
  D.vsChampion = Object.fromEntries(SEASONS.map((s) => [s, brief(gateOf(s, full))]));
  D.alone = Object.fromEntries(SEASONS.map((s) => { const idx = seasonRows(s, [...full.keys()]); return [s, score(idx.map((i) => full.get(i)!), idx.map((i) => rows[i].y))]; }));
  D.dropColumn = Object.fromEntries(GD.map(([n]) => [n, Object.fromEntries(SEASONS.map((s) => [s, brief(gateOf(s, preds.get(n)!, undefined, full))]))]));
  D.permutation = Object.fromEntries(GD.map(([n]) => [n, Object.fromEntries(SEASONS.map((s) => [s, brief(gateOf(s, perm.get(n)!, undefined, full))]))]));
  const mean = (s: number, f: (x: (typeof fits)[number]) => number[]) => { const xs = fits.filter((x) => x.season === s).map(f); return xs[0].map((_, k) => +(xs.reduce((t, v) => t + v[k], 0) / xs.length).toFixed(4)); };
  D.standardizedMean = Object.fromEntries(SEASONS.map((s) => [s, Object.fromEntries(NAMES.map((n, k) => [n, mean(s, (x) => x.standardized)[k]]))]));
  D.perPointMean = Object.fromEntries(SEASONS.map((s) => { const v = mean(s, (x) => x.perPoint); return [s, { auto: v[0], teleop: v[1], endgame: v[2], fouls: v[3], relativeToTeleop: { auto: v[0] / v[1], endgame: v[2] / v[1], fouls: v[3] / v[1] } }]; }));
  D.fits = fits;
  console.log("D logistic vs champion", JSON.stringify(D.vsChampion), "per point", JSON.stringify(D.perPointMean));
}
out.componentLogistic = D;


// ---- The reweighting candidate: champion + refitted phase weights, forward-only, through the gate.
//   R3a  Δ on D1–D3 only (auto, endgame, fouls inputs): a model.json coefficient change, nothing else
//   R3b  Δ on all four phase gaps / S (TeleOp included: needs one new input)
const cand: Record<string, unknown> = {};
{
  const gain = (M.recalibration?.slope ?? 1) * M.calibration.slope;
  const specs: [string, (r: Row) => number[]][] = [["R3a D1-D3", (r) => [r.x[0], r.x[1], r.x[2]]], ["R3b four phases", (r) => [r.gap.auto / r.S, r.gap.teleop / r.S, r.gap.endgame / r.S, r.gap.pen / r.S]]];
  for (const [name, f] of specs) {
    const p = new Map<number, number>(), deltas: { origin: string; delta: number[] }[] = [];
    let last: ReturnType<typeof fitContextual> | null = null;
    for (const fo of folds) {
      const X = fo.train.map((i) => f(rows[i]));
      const m = fitContextual(X, fo.train.map((i) => logit(rows[i].pc)), fo.train.map((i) => rows[i].y));
      for (const i of fo.test) p.set(i, contextualRaw(m, f(rows[i]), logit(rows[i].pc)));
      deltas.push({ origin: new Date(fo.origin).toISOString().slice(0, 7), delta: m.coefficients.map((c, k) => +(c / m.scale[k]).toFixed(4)) });
    }
    // The value that would ship: fitted on the last 365 days of the snapshot.
    const tEnd = rows[rows.length - 1].time, lastIdx = rows.map((r, i) => (r.time > tEnd - 365 * DAY ? i : -1)).filter((i) => i >= 0);
    last = fitContextual(lastIdx.map((i) => f(rows[i])), lastIdx.map((i) => logit(rows[i].pc)), lastIdx.map((i) => rows[i].y));
    const perUnit = last.coefficients.map((c, k) => c / last!.scale[k]);
    const gates = Object.fromEntries(SEASONS.map((s) => [s, gateOf(s, p)]));
    for (const s of SEASONS) console.log(`${name} ${gateLine(gates[s])}`);
    cand[name] = {
      gates, deltas, shippedFit: { window: "last 365 days of the snapshot", perUnit,
        ...(name.startsWith("R3a") ? { engineCoefficientChange: perUnit.map((d, k) => ({ input: `D${k + 1}`, from: M.coefficients[k], to: M.coefficients[k] + (d * M.scale[k]) / gain })) } : {}) },
    };
  }
}
out.candidates = cand;

if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(out, null, 1) + "\n");
