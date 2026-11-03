// Research R7 (Nov 2026): calibration, properly measured.
//  1. Platt vs isotonic as the GLOBAL final calibration (Part 12.5's method, verbatim: rolling monthly origins
//     Oct 2024 – Jul 2026, each fitted on the 365 days before it on the engine's chance BEFORE its final stretch,
//     ties as half-wins in the fit), now scored on DECISIVE matches only, per rolled season.
//  2. A binned Murphy decomposition (REL, RES, UNC, BS − REL) of the live engine per season and per match type,
//     and of the walk-forward Platt and isotonic outputs, with event-bootstrap 95% intervals and a bin sensitivity.
//
//   npx tsx scripts/research/r7-calibration.ts <live rows.json.gz> <pre-stretch rows.json.gz> <scores.json.gz> [--out <file.json>] [--draws 1000]
// live rows: engine-slices --rows; pre-stretch rows: engine-slices --champion '{"rating":{},"recalibration":false}' --rows
import { writeFileSync } from "node:fs";
import { fit, logit, sig } from "../part9/lib.js";
import { WINDOW, loadRows, metrics, murphy, murphyBoot, origins, paired, passes, rolledSeasons, type Row } from "./r67-lib.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRAWS = Number(flag("--draws") ?? 1000);
const live = loadRows(args[0], args[2]);
const pre = loadRows(args[1], args[2], true); // ties kept for the fit (as 12.5); scoring is decisive only
const out: Record<string, unknown> = { generated: new Date().toISOString(), engine: "3.3.0", bins: "20 equal-width bins of P(red wins), plus 10 and 50 as sensitivity" };
const champ = (r: Row) => r.pred.champion.p;
const marginOf = (r: Row) => r.pred.champion.muR - r.pred.champion.muB;

/** Part 12.5's symmetric isotonic map (pool-adjacent-violators on |z|, anchored at 0.5, interpolated). */
function isotonic(train: Row[]): (z: number) => number {
  const pts = train.map((r) => { const z = logit(champ(r)); return { x: Math.abs(z), y: z >= 0 ? r.y : 1 - r.y }; }).sort((a, b) => a.x - b.x);
  const blocks: { sx: number; sy: number; n: number }[] = [];
  for (let i = 0; i < pts.length; ) {
    let j = i, sy = 0;
    while (j < pts.length && pts[j].x === pts[i].x) sy += pts[j++].y;
    blocks.push({ sx: pts[i].x * (j - i), sy, n: j - i });
    i = j;
    while (blocks.length > 1 && blocks[blocks.length - 2].sy / blocks[blocks.length - 2].n >= blocks[blocks.length - 1].sy / blocks[blocks.length - 1].n) {
      const b = blocks.pop()!, a = blocks[blocks.length - 1]; a.sx += b.sx; a.sy += b.sy; a.n += b.n;
    }
  }
  const xs = [0, ...blocks.map((b) => b.sx / b.n)], ys = [0.5, ...blocks.map((b) => Math.max(0.5, b.sy / b.n))];
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1]);
  return (z: number) => {
    const x = Math.abs(z); let q: number;
    if (x >= xs[xs.length - 1]) q = ys[ys.length - 1];
    else { let i = 1; while (xs[i] < x) i++; const t = (x - xs[i - 1]) / Math.max(1e-12, xs[i] - xs[i - 1]); q = ys[i - 1] + t * (ys[i] - ys[i - 1]); }
    q = Math.min(1 - 1e-4, q);
    return z >= 0 ? q : 1 - q;
  };
}

// ---- Part 1: Platt vs isotonic, walk-forward, decisive scoring ----------------------------------------------
const platt = new Map<string, number>(), iso = new Map<string, number>();
const fits: unknown[] = [];
for (const [t0, t1] of origins()) {
  const train = pre.filter((r) => r.time < t0 && r.time >= t0 - WINDOW), test = pre.filter((r) => r.time >= t0 && r.time < t1);
  if (test.length < 50 || train.length < 2000) continue;
  const X: number[][] = [], Y: number[] = [];
  for (const r of train) { const z = logit(champ(r)); X.push([z], [-z]); Y.push(r.y, 1 - r.y); }
  const [a] = fit(X, Y, [1e-4], [1]);
  const f = isotonic(train);
  for (const r of test) { const z = logit(champ(r)); platt.set(r.key, sig(a * z)); iso.set(r.key, f(z)); }
  fits.push({ origin: new Date(t0).toISOString().slice(0, 10), train: train.length, test: test.length, plattSlope: +a.toFixed(4) });
}
out.fits = fits;
const fmt = (m: ReturnType<typeof murphy>) => `BS ${m.brier.toFixed(4)} REL ${(1e4 * m.rel).toFixed(2)}e-4 (debiased ${(1e4 * m.relDebiased).toFixed(2)}) RES ${m.res.toFixed(4)} UNC ${m.unc.toFixed(4)} BS−REL ${m.bsMinusRel.toFixed(4)} UNC−RES ${m.binRecal.toFixed(4)} PAV ${m.pav.toFixed(5)} MCB ${(1e4 * m.mcb).toFixed(2)}e-4 DSC ${m.dsc.toFixed(4)} resid ${(1e4 * m.residual).toFixed(2)}e-4`;
const comparison: Record<string, unknown> = {};
for (const { season, label } of rolledSeasons) {
  const R = pre.filter((r) => r.season === season && r.y !== 0.5 && platt.has(r.key));
  const pair = (b: Map<string, number>) => R.map((r) => ({ event: r.event, y: r.y, margin: r.margin, a: platt.get(r.key)!, b: b.get(r.key)!, ma: marginOf(r), mb: marginOf(r) }));
  const d = paired(pair(iso));
  const as = (p: (r: Row) => number) => R.map((r) => ({ event: r.event, y: r.y, p: p(r) }));
  const none = murphy(as(champ)), mp = murphy(as((r) => platt.get(r.key)!)), mi = murphy(as((r) => iso.get(r.key)!));
  comparison[label] = {
    n: R.length, isotonicMinusPlatt: d, isotonicPasses: passes(d),
    metrics: { noStretch: metrics(R.map((r) => ({ event: r.event, y: r.y, p: champ(r), m: marginOf(r), margin: r.margin }))), platt: metrics(R.map((r) => ({ event: r.event, y: r.y, p: platt.get(r.key)!, m: marginOf(r), margin: r.margin }))), isotonic: metrics(R.map((r) => ({ event: r.event, y: r.y, p: iso.get(r.key)!, m: marginOf(r), margin: r.margin }))) },
    murphy: { noStretch: none, platt: mp, isotonic: mi },
    murphy95: { platt: murphyBoot(as((r) => platt.get(r.key)!), 20, DRAWS), isotonic: murphyBoot(as((r) => iso.get(r.key)!), 20, DRAWS) },
  };
  console.log(`== ${label} decisive n ${R.length}: isotonic − platt ΔBrier ${(1e4 * d.brier).toFixed(2)}e-4 [${(1e4 * d.brier95[0]).toFixed(2)}, ${(1e4 * d.brier95[1]).toFixed(2)}] Δacc ${d.accuracyPp.toFixed(2)} [${d.accuracy95[0].toFixed(2)}, ${d.accuracy95[1].toFixed(2)}] Δlogloss ${(1e4 * d.logLoss).toFixed(2)}e-4`);
  console.log(`  none     ${fmt(none)}\n  platt    ${fmt(mp)}\n  isotonic ${fmt(mi)}`);
}
out.plattVsIsotonic = comparison;

// ---- Part 2: Murphy decomposition of the live engine --------------------------------------------------------
const decomp: Record<string, unknown> = {};
for (const s of [2023, 2024, 2025]) {
  for (const [part, keep] of [["all", () => true], ["qual", (r: Row) => r.level !== "playoff"], ["playoff", (r: Row) => r.level === "playoff"]] as const) {
    const R = live.filter((r) => r.season === s && keep(r)).map((r) => ({ event: r.event, y: r.y, p: champ(r) }));
    const m20 = murphy(R, 20);
    decomp[`${s} ${part}`] = { ...m20, ci95: murphyBoot(R, 20, DRAWS), bins10: murphy(R, 10), bins50: murphy(R, 50) };
    console.log(`${s} ${part.padEnd(7)} n ${R.length} ${fmt(m20)}  sharpness ${m20.sharpness.toFixed(4)}`);
  }
}
out.liveDecomposition = decomp;
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(out, null, 1));
