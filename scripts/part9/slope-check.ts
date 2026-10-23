// Part 9: the global recalibration with its intercept fixed at 0 (no alliance-colour term), rolled forward
// like recalibration.ts: at each month start fitted on the 730 days before it, scored on that month.
//   npx tsx scripts/part9/slope-check.ts <rows.json.gz>
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pairedMetrics, sliceReport } from "../slices/report.js";
import { fit, logit, sig } from "./lib.js";

interface Row { season: number; event: string; time: number; y: number; rated: boolean; pred: { champion: { p: number } } }
const rows = (JSON.parse(gunzipSync(readFileSync(process.argv[2])).toString()) as Row[]).filter((r) => r.rated).sort((a, b) => a.time - b.time);
const months: number[] = [];
for (let d = new Date(Date.UTC(2024, 9, 1)); d < new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime());
const p0 = new Map<Row, number>(), p1 = new Map<Row, number>();
for (let o = 0; o < months.length - 1; o++) {
  const train = rows.filter((r) => r.time < months[o] && r.time >= months[o] - 730 * 864e5), test = rows.filter((r) => r.time >= months[o] && r.time < months[o + 1]);
  if (test.length < 50 || train.length < 2000) continue;
  const slopeOnly = fit(train.map((r) => [logit(r.pred.champion.p), 1]), train.map((r) => r.y), [1e-4, 1e12], [1, 0]);
  const full = fit(train.map((r) => [logit(r.pred.champion.p), 1]), train.map((r) => r.y), [1e-4, 1e-4], [1, 0]);
  for (const r of test) { p0.set(r, sig(slopeOnly[0] * logit(r.pred.champion.p))); p1.set(r, sig(full[0] * logit(r.pred.champion.p) + full[1])); }
}
for (const s of [2024, 2025]) {
  const R = [...p0.keys()].filter((r) => r.season === s);
  for (const [name, P] of [["slope only", p0], ["slope + intercept", p1]] as const) {
    const m = pairedMetrics(R.map((r) => ({ event: r.event, y: r.y, a: r.pred.champion.p, b: P.get(r)!, tags: {} })));
    const c = sliceReport(R.map((r) => ({ p: P.get(r)!, y: r.y, tags: {} })), []).calibration.filter((b) => ["50-60", "60-70", "70-80"].includes(b.band));
    console.log(s, name.padEnd(18), `dBrier ${(1e4 * m.brier).toFixed(2)} [${(1e4 * m.brier95[0]).toFixed(2)}, ${(1e4 * m.brier95[1]).toFixed(2)}]  dLL ${(1e4 * m.logLoss).toFixed(2)} [${(1e4 * m.logLoss95[0]).toFixed(2)}, ${(1e4 * m.logLoss95[1]).toFixed(2)}]  dAcc ${m.accuracyPp.toFixed(2)} [${m.accuracy95.map((v) => v.toFixed(2)).join(", ")}]  cal50-80 ${(100 * c.reduce((a, b) => a + b.n * b.error, 0) / c.reduce((a, b) => a + b.n, 0)).toFixed(2)}`);
  }
}
