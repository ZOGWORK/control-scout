// Engine program Part 12.5 (research): is isotonic regression a better GLOBAL final calibration than the shipped
// Platt-family stretch? Same rolling origins as Part 9 (each month's mapping is fitted on the 365 days before it
// and scored on that month), on the engine's probability BEFORE its final stretch (rows from
//   engine-slices --champion '{"rating":{},"recalibration":false}' --rows <file>).
// Mappings, all colour-symmetric (p(−z) = 1 − p(z); ties are half-wins):
//   platt     p' = σ(a·z), the shipped form (slope only)
//   isotonic  a non-decreasing step map of |z| fitted by pool-adjacent-violators on the mirrored favourite's
//             outcome, linearly interpolated between block centres
// The brief's gate: isotonic must win held-out calibration error in the 55–85% bands (favourite's stated chance,
// 5-point bins, match-weighted |stated − won|), not just global Brier.
//
//   npx tsx scripts/part12/isotonic.ts <rows.json.gz> [--out <file.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pairedMetrics, rng, type PairedRow } from "../slices/report.js";
import { fit, logit, sig } from "../part9/lib.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const WINDOW = 365 * 864e5;
interface Row { key: string; season: number; event: string; time: number; y: number; rated: boolean; pred: Record<string, { p: number }> }
const rows: Row[] = JSON.parse(gunzipSync(readFileSync(args[0])).toString()).filter((r: Row) => r.rated).sort((a: Row, b: Row) => a.time - b.time);

/** Symmetric isotonic map: fit P(favourite wins | |z|) by PAV, then p'(z) = sign-mirrored. */
function isotonic(train: Row[]): (z: number) => number {
  const pts = train.map((r) => { const z = logit(r.pred.champion.p); return { x: Math.abs(z), y: z >= 0 ? r.y : 1 - r.y }; }).sort((a, b) => a.x - b.x);
  const blocks: { sx: number; sy: number; n: number }[] = [];
  for (const p of pts) {
    blocks.push({ sx: p.x, sy: p.y, n: 1 });
    while (blocks.length > 1 && blocks[blocks.length - 2].sy / blocks[blocks.length - 2].n >= blocks[blocks.length - 1].sy / blocks[blocks.length - 1].n) {
      const b = blocks.pop()!, a = blocks[blocks.length - 1]; a.sx += b.sx; a.sy += b.sy; a.n += b.n;
    }
  }
  // Anchor |z| = 0 at 0.5 (a coin flip stays a coin flip), then interpolate between block centres.
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

const months: number[] = [];
for (let d = new Date(Date.UTC(2024, 9, 1)); d < new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime());
const pred = { platt: new Map<string, number>(), isotonic: new Map<string, number>() };
const fits: unknown[] = [];
for (let i = 0; i < months.length - 1; i++) {
  const t0 = months[i], t1 = months[i + 1];
  const train = rows.filter((r) => r.time < t0 && r.time >= t0 - WINDOW), test = rows.filter((r) => r.time >= t0 && r.time < t1);
  if (test.length < 50 || train.length < 2000) continue;
  const X: number[][] = [], Y: number[] = [];
  for (const r of train) { const z = logit(r.pred.champion.p); X.push([z], [-z]); Y.push(r.y, 1 - r.y); }
  const [a] = fit(X, Y, [1e-4], [1]);
  const iso = isotonic(train);
  for (const r of test) { const z = logit(r.pred.champion.p); pred.platt.set(r.key, sig(a * z)); pred.isotonic.set(r.key, iso(z)); }
  fits.push({ origin: new Date(t0).toISOString().slice(0, 10), train: train.length, test: test.length, plattSlope: +a.toFixed(4) });
}

/** Calibration error in the favourite's 55–85% range, 5-point bins, match-weighted. */
function cal5585(R: Row[], p: (r: Row) => number) {
  const bins = new Map<number, { n: number; s: number; w: number }>();
  for (const r of R) {
    const q = p(r), fav = Math.max(q, 1 - q), won = q >= 0.5 ? r.y : 1 - r.y;
    if (fav < 0.55 || fav >= 0.85) continue;
    const b = Math.floor(fav * 20); const x = bins.get(b) ?? { n: 0, s: 0, w: 0 }; x.n++; x.s += fav; x.w += won; bins.set(b, x);
  }
  let n = 0, e = 0; const table: Record<string, { n: number; stated: number; won: number }> = {};
  for (const [b, x] of [...bins].sort((u, v) => u[0] - v[0])) { n += x.n; e += Math.abs(x.s - x.w); table[`${b * 5}-${b * 5 + 5}`] = { n: x.n, stated: +(100 * x.s / x.n).toFixed(2), won: +(100 * x.w / x.n).toFixed(2) }; }
  return { error: e / n, table };
}
/** Event bootstrap of the 55–85% calibration-error difference (isotonic − platt). */
function calBoot(R: Row[], draws = 1000) {
  const byEv = new Map<string, Row[]>(); for (const r of R) { const l = byEv.get(r.event) ?? []; l.push(r); byEv.set(r.event, l); }
  const evs = [...byEv.values()]; const rnd = rng(7);
  const d: number[] = [];
  for (let k = 0; k < draws; k++) { const S = Array.from({ length: evs.length }, () => evs[Math.floor(rnd() * evs.length)]).flat(); d.push(cal5585(S, (r) => pred.isotonic.get(r.key)!).error - cal5585(S, (r) => pred.platt.get(r.key)!).error); }
  d.sort((x, y) => x - y);
  return [d[Math.floor(draws * 0.025)], d[Math.floor(draws * 0.975)]];
}

const result: Record<string, unknown> = { fits };
for (const [name, season] of [["2024-25 rolled (Oct 2024–Aug 2025)", 2024], ["2025-26 rolled, reused", 2025]] as const) {
  const R = rows.filter((r) => r.season === season && pred.platt.has(r.key));
  const pair: PairedRow[] = R.map((r) => ({ event: r.event, y: r.y, a: pred.platt.get(r.key)!, b: pred.isotonic.get(r.key)!, tags: {} }));
  const m = pairedMetrics(pair);
  const cp = cal5585(R, (r) => pred.platt.get(r.key)!), ci = cal5585(R, (r) => pred.isotonic.get(r.key)!), cn = cal5585(R, (r) => r.pred.champion.p);
  const ci95 = calBoot(R);
  result[name] = { n: R.length, isotonicMinusPlatt: m, cal5585: { none: cn, platt: cp, isotonic: ci, diff95: ci95 } };
  console.log(`== ${name}: n ${R.length}`);
  console.log(`  isotonic − platt: Brier ${(1e4 * m.brier).toFixed(2)}e-4 [${(1e4 * m.brier95[0]).toFixed(2)}, ${(1e4 * m.brier95[1]).toFixed(2)}]  logloss ${(1e4 * m.logLoss).toFixed(2)}e-4 [${(1e4 * m.logLoss95[0]).toFixed(2)}, ${(1e4 * m.logLoss95[1]).toFixed(2)}]  acc ${m.accuracyPp.toFixed(2)}pp`);
  console.log(`  55–85% calibration error: none ${(100 * cn.error).toFixed(2)}  platt ${(100 * cp.error).toFixed(2)}  isotonic ${(100 * ci.error).toFixed(2)} pts  (isotonic − platt 95% [${(100 * ci95[0]).toFixed(2)}, ${(100 * ci95[1]).toFixed(2)}])`);
  console.log(`  platt bins ${JSON.stringify(cp.table)}`);
  console.log(`  iso   bins ${JSON.stringify(ci.table)}`);
}
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(result, null, 1));
