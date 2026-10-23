// Engine program Part 9, step 1 (research): does a final calibration layer,
// global or per slice, make the live engine's probabilities truer going
// forward? Rolling origins: at each month start, every mapping is fitted on
// the matches before it only and scored on that month.
//
//   npx tsx scripts/part9/recalibration.ts <rows.json.gz from engine-slices --rows> [--window-days 365] [--out <file.json>]
//
// Mappings (all on z = logit of the engine's probability; ties are half-wins):
//   none     the engine as shipped
//   global   p' = σ(a·z + b)
//   slice    p' = σ((a + a_s)·z + (b + b_s)), one (a_s, b_s) per slice cell, ridge-shrunk toward the global mapping
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pairedMetrics, sliceReport, type PairedRow } from "../slices/report.js";
import { fit, logit, sig } from "./lib.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const WINDOW = Number(flag("--window-days") ?? 365) * 864e5;
const LAMBDA = Number(flag("--ridge") ?? 200);
const CELLS = (flag("--cells") ?? "level,density").split(",");

interface Row { key: string; season: number; event: string; level: string; time: number; y: number; rated: boolean; data: Record<string, string>; pred: Record<string, { p: number }> }
const rows: Row[] = JSON.parse(gunzipSync(readFileSync(args[0])).toString()).filter((r: Row) => r.rated).sort((a: Row, b: Row) => a.time - b.time);
const cellOf = (r: Row) => CELLS.map((c) => r.data[c]).join("|");

const months: number[] = [];
for (let d = new Date(Date.UTC(2024, 9, 1)); d < new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime());
const out: Record<string, { p: number }> = {};
const pred = { global: new Map<string, number>(), slice: new Map<string, number>() };
const fits: unknown[] = [];
for (let i = 0; i < months.length - 1; i++) {
  const t0 = months[i], t1 = months[i + 1];
  const train = rows.filter((r) => r.time < t0 && r.time >= t0 - WINDOW), test = rows.filter((r) => r.time >= t0 && r.time < t1);
  if (test.length < 50 || train.length < 2000) continue;
  const cells = [...new Set(train.map(cellOf))].sort();
  const g = fit(train.map((r) => [logit(r.pred.champion.p), 1]), train.map((r) => r.y), [1e-4, 1e-4], [1, 0]);
  // Per-slice deviations from the global mapping, ridge-penalised toward 0 (i.e. toward global).
  const X = train.map((r) => { const z = logit(r.pred.champion.p), c = cells.indexOf(cellOf(r)); const x = [z, 1]; for (let j = 0; j < cells.length; j++) x.push(j === c ? z : 0, j === c ? 1 : 0); return x; });
  const pen = [1e-4, 1e-4, ...cells.flatMap(() => [LAMBDA, LAMBDA])], prior = [g[0], g[1], ...cells.flatMap(() => [0, 0])];
  const w = fit(X, train.map((r) => r.y), pen, prior);
  for (const r of test) {
    const z = logit(r.pred.champion.p), c = cells.indexOf(cellOf(r));
    pred.global.set(r.key, sig(g[0] * z + g[1]));
    pred.slice.set(r.key, c < 0 ? sig(w[0] * z + w[1]) : sig((w[0] + w[2 + 2 * c]) * z + w[1] + w[3 + 2 * c]));
  }
  fits.push({ origin: new Date(t0).toISOString().slice(0, 10), train: train.length, test: test.length, global: g.map((x) => +x.toFixed(4)),
    cells: Object.fromEntries(cells.map((c, j) => [c, [+(w[0] + w[2 + 2 * j]).toFixed(3), +(w[1] + w[3 + 2 * j]).toFixed(3)]])) });
}
void out;

const segs: [string, (r: Row) => boolean][] = [
  ["2024-25 rolled (Oct 2024–Aug 2025)", (r) => r.season === 2024 && pred.global.has(r.key)],
  ["2025-26 rolled, reused", (r) => r.season === 2025 && pred.global.has(r.key)],
];
const result: Record<string, unknown> = { window_days: WINDOW / 864e5, ridge: LAMBDA, cells: CELLS, fits };
for (const [name, keep] of segs) {
  const R = rows.filter(keep);
  const tagged = (p: (r: Row) => number) => R.map((r) => ({ p: p(r), y: r.y, tags: { level: r.data.level, density: r.data.density, eventMatch: r.data.eventMatch, teamEvent: r.data.teamEvent, eventType: r.data.eventType } }));
  const rep = { none: sliceReport(tagged((r) => r.pred.champion.p), []), global: sliceReport(tagged((r) => pred.global.get(r.key)!), []), slice: sliceReport(tagged((r) => pred.slice.get(r.key)!), []) };
  const pair = (b: (r: Row) => number): PairedRow[] => R.map((r) => ({ event: r.event, y: r.y, a: r.pred.champion.p, b: b(r), tags: {} }));
  const cal = (x: typeof rep.none) => x.calibration.filter((b) => ["50-60", "60-70", "70-80"].includes(b.band)).reduce((s, b) => s + b.n * b.error, 0) / x.calibration.filter((b) => ["50-60", "60-70", "70-80"].includes(b.band)).reduce((s, b) => s + b.n, 0);
  const sliceDelta = (b: (r: Row) => number, dim: string) => {
    const vals = [...new Set(R.map((r) => r.data[dim]))].sort();
    return Object.fromEntries(vals.map((v) => { const m = pairedMetrics(R.filter((r) => r.data[dim] === v).map((r) => ({ event: r.event, y: r.y, a: r.pred.champion.p, b: b(r), tags: {} }))); return [v, `${(1e4 * m.brier).toFixed(2)} [${(1e4 * m.brier95[0]).toFixed(2)}, ${(1e4 * m.brier95[1]).toFixed(2)}]`]; }));
  };
  result[name] = {
    n: R.length,
    brier: { none: rep.none.all.brier, global: rep.global.all.brier, slice: rep.slice.all.brier },
    cal5080: { none: cal(rep.none), global: cal(rep.global), slice: cal(rep.slice) },
    pairedGlobal: pairedMetrics(pair((r) => pred.global.get(r.key)!)), pairedSlice: pairedMetrics(pair((r) => pred.slice.get(r.key)!)),
    sliceVsNone: Object.fromEntries(["level", "density", "eventMatch", "teamEvent"].map((d) => [d, sliceDelta((r) => pred.slice.get(r.key)!, d)])),
    calibrationTables: { none: rep.none.calibration, global: rep.global.calibration, slice: rep.slice.calibration },
  };
  const x = result[name] as any;
  console.log(`== ${name}: n ${R.length}`);
  console.log(`  Brier none ${x.brier.none.toFixed(5)} global ${x.brier.global.toFixed(5)} slice ${x.brier.slice.toFixed(5)}  | 50-80 cal err none ${(100 * x.cal5080.none).toFixed(2)} global ${(100 * x.cal5080.global).toFixed(2)} slice ${(100 * x.cal5080.slice).toFixed(2)}`);
  for (const k of ["pairedGlobal", "pairedSlice"]) console.log(`  ${k}: dBrier ${(1e4 * x[k].brier).toFixed(2)}e-4 [${(1e4 * x[k].brier95[0]).toFixed(2)}, ${(1e4 * x[k].brier95[1]).toFixed(2)}]  dAcc ${x[k].accuracyPp.toFixed(2)}pp`);
  console.log("  slice vs none by slice:", JSON.stringify(x.sliceVsNone));
}
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(result, null, 1));
