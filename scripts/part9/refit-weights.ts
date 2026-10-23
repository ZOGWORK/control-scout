// Engine program Part 9, step 2 (research): would refitting the contextual model's weights on newer
// data beat the frozen weights going forward? Rolling monthly origins, forward-only:
//   frozen   the shipped weights + a global recalibration fitted on the 730 days before the origin
//   refit    weights refitted (research learner) on every match before origin − 56 days, then a global
//            recalibration on the 730 days before the origin
// Also reports how the refitted weights compare with the frozen ones (sign flips = monotonicity flags).
//
//   npx tsx scripts/part9/refit-weights.ts <rows.json.gz from engine-slices --rows --features> [--out <file.json>]
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { FITTED_MODEL } from "@control-scout/predict-engine";
import { pairedMetrics, sliceReport, type PairedRow } from "../slices/report.js";
import { contextualRaw, fit, fitContextual, logit, sig } from "./lib.js";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
interface Row { key: string; season: number; event: string; time: number; y: number; rated: boolean; x: number[]; pRaw: number; data: Record<string, string>; pred: { champion: { p: number } } }
const rows: Row[] = (JSON.parse(gunzipSync(readFileSync(args[0])).toString()) as Row[]).filter((r) => r.rated && r.x && r.x.every(Number.isFinite)).sort((a, b) => a.time - b.time);
const L = rows.map((r) => logit(r.pRaw));
const frozen = FITTED_MODEL.contextual!;
const DAY = 864e5, CAL = 730 * DAY, GAP = 56 * DAY;

const recal = (idx: number[], p: (i: number) => number) => fit(idx.map((i) => [logit(p(i)), 1]), idx.map((i) => rows[i].y), [1e-4, 1e-4], [1, 0]);
const months: number[] = [];
for (let d = new Date(Date.UTC(2024, 9, 1)); d < new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime());
const pF = new Map<number, number>(), pR = new Map<number, number>();
const fits: { origin: string; coefficients: number[] }[] = [];
for (let o = 0; o < months.length - 1; o++) {
  const t0 = months[o], t1 = months[o + 1];
  const test = rows.map((r, i) => (r.time >= t0 && r.time < t1 ? i : -1)).filter((i) => i >= 0);
  if (test.length < 50) continue;
  const calIdx = rows.map((r, i) => (r.time >= t0 - CAL && r.time < t0 ? i : -1)).filter((i) => i >= 0);
  const fitIdx = rows.map((r, i) => (r.time < t0 - GAP ? i : -1)).filter((i) => i >= 0);
  const gF = recal(calIdx, (i) => rows[i].pred.champion.p);
  const m = fitContextual(fitIdx.map((i) => rows[i].x), fitIdx.map((i) => L[i]), fitIdx.map((i) => rows[i].y));
  const cal = frozen.calibration;
  // The refitted weights get the frozen model's calibration shape first, then the same global recalibration step.
  const refitP = (i: number) => sig(cal.slope * logit(contextualRaw(m, rows[i].x, L[i])) + cal.intercept);
  const gR = recal(calIdx, refitP);
  for (const i of test) { pF.set(i, sig(gF[0] * logit(rows[i].pred.champion.p) + gF[1])); pR.set(i, sig(gR[0] * logit(refitP(i)) + gR[1])); }
  fits.push({ origin: new Date(t0).toISOString().slice(0, 10), coefficients: m.coefficients.map((c) => +c.toFixed(4)) });
  console.log(new Date(t0).toISOString().slice(0, 7), "fit", fitIdx.length, "test", test.length);
}

const out: Record<string, unknown> = { fits };
for (const [name, season] of [["2024-25 rolled", 2024], ["2025-26 rolled, reused", 2025]] as const) {
  const idx = [...pF.keys()].filter((i) => rows[i].season === season);
  const pr: PairedRow[] = idx.map((i) => ({ event: rows[i].event, y: rows[i].y, a: pF.get(i)!, b: pR.get(i)!, tags: {} }));
  const m = pairedMetrics(pr);
  const cal = (p: Map<number, number>) => { const c = sliceReport(idx.map((i) => ({ p: p.get(i)!, y: rows[i].y, tags: {} })), []).calibration.filter((b) => ["50-60", "60-70", "70-80"].includes(b.band)); return c.reduce((s, b) => s + b.n * b.error, 0) / c.reduce((s, b) => s + b.n, 0); };
  out[name] = { n: idx.length, refitMinusFrozen: m, cal5080: { frozen: cal(pF), refit: cal(pR) } };
  console.log(`== ${name}: n ${idx.length}  refit − frozen: dBrier ${(1e4 * m.brier).toFixed(2)}e-4 [${(1e4 * m.brier95[0]).toFixed(2)}, ${(1e4 * m.brier95[1]).toFixed(2)}]  dLL ${(1e4 * m.logLoss).toFixed(2)}e-4 [${(1e4 * m.logLoss95[0]).toFixed(2)}, ${(1e4 * m.logLoss95[1]).toFixed(2)}]  dAcc ${m.accuracyPp.toFixed(2)}pp [${m.accuracy95.map((v) => v.toFixed(2)).join(", ")}]  cal50-80 frozen ${(100 * (out[name] as any).cal5080.frozen).toFixed(2)} refit ${(100 * (out[name] as any).cal5080.refit).toFixed(2)}`);
}
// Sign flips of the last refit against the frozen weights (a non-monotone change is a bug report about the fit).
const last = fits[fits.length - 1].coefficients;
out.signFlips = last.map((c, j) => ({ input: `D${j + 1}`, frozen: frozen.coefficients[j], refit: c })).filter((d) => Math.sign(d.frozen) !== Math.sign(d.refit) && Math.abs(d.frozen) > 1e-3);
console.log("sign flips vs frozen (last origin):", JSON.stringify(out.signFlips));
if (flag("--out")) writeFileSync(flag("--out")!, JSON.stringify(out, null, 1));
