// Engine program Part 6, step 1 (measurement): the engine already rates each robot's penalties
// committed (RatingBook component `pen`) and adds the opponents' expected fouls to an alliance's
// expected score. Is that term right? Per alliance: predicted fouls given away (sum of its robots'
// pen ratings) against actual, as a calibration line (actual = a + b · predicted) and MAE, overall
// and by how foul-prone the alliance is; and what a shrunk or zero term would do to score MAE.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part6/foul-research.ts [--rating '{"penGain":0.15}']
import "../../server/env.js";
import { FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const args = process.argv.slice(2);
const override = args.includes("--rating") ? JSON.parse(args[args.indexOf("--rating") + 1]) : {};
const book = new RatingBook({ ...M.rating, ...override });
const rows: { season: number; pred: number; act: number; n: number; base: number }[] = [];
for (const s of [2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  for (const m of matches) {
    const rated = !unrated.has(m.eventCode);
    if (predictable(m) && rated && s >= 2024) {
      book.setTime(m.time);
      for (const al of [m.red, m.blue]) {
        const pred = book.withRegion(m.region, () => book.withEvent(m.eventCode, () => book.allianceExpectation(al.teams))).pen;
        rows.push({ season: s, pred, act: al.penCommitted, n: Math.min(...al.teams.map((t) => book.get(t).n)), base: book.baseline()?.pen ?? 0 });
      }
    }
    if (rated) book.update(m);
  }
}
const ols = (x: number[], y: number[]) => {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  return { slope: sxy / sxx, intercept: my - (sxy / sxx) * mx, meanPred: mx, meanAct: my };
};
const mae = (xs: number[], ys: number[]) => xs.reduce((a, x, i) => a + Math.abs(x - ys[i]), 0) / xs.length;
for (const season of [2024, 2025]) {
  const R = rows.filter((r) => r.season === season);
  const fit = ols(R.map((r) => r.pred), R.map((r) => r.act));
  console.log(`${season}: alliances ${R.length}; mean predicted fouls ${fit.meanPred.toFixed(2)}, actual ${fit.meanAct.toFixed(2)}; actual = ${fit.intercept.toFixed(2)} + ${fit.slope.toFixed(3)} · predicted`);
  console.log(`  foul-term MAE: rating ${mae(R.map((r) => r.pred), R.map((r) => r.act)).toFixed(3)}  population baseline ${mae(R.map((r) => 2 * r.base), R.map((r) => r.act)).toFixed(3)}  zero ${mae(R.map(() => 0), R.map((r) => r.act)).toFixed(3)}  median-ish (0.5·rating) ${mae(R.map((r) => 0.5 * r.pred), R.map((r) => r.act)).toFixed(3)}`);
  const sorted = [...R].sort((a, b) => a.pred - b.pred), q75 = sorted[Math.floor(0.75 * sorted.length)].pred;
  for (const [name, f] of [["top-quartile foul-prone", (r: typeof R[0]) => r.pred >= q75], ["rest", (r: typeof R[0]) => r.pred < q75], ["robots with 6+ matches", (r: typeof R[0]) => r.n >= 6]] as const) {
    const X = R.filter(f), g = ols(X.map((r) => r.pred), X.map((r) => r.act));
    console.log(`  ${name.padEnd(24)} n ${String(X.length).padStart(6)}  pred ${g.meanPred.toFixed(2)} act ${g.meanAct.toFixed(2)}  slope ${g.slope.toFixed(3)}  MAE rating ${mae(X.map((r) => r.pred), X.map((r) => r.act)).toFixed(3)} vs baseline ${mae(X.map((r) => 2 * r.base), X.map((r) => r.act)).toFixed(3)}`);
  }
}
