// Engine program Part 12.4, the tuning sweep: one rating constant at a time, every value replayed from a cold
// 2023–24 start, scored on the TUNING season (2024–25) only: win-probability Brier and log loss (the served
// call: predictMatch with the fitted contextual model) and expected-score error (mean |actual − expected|
// final points per alliance (the expectation includes the opponents' fouls)). The flat-region rule picks among the values; the held-out season (2025–26)
// is judged once, afterwards, with --judge.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part12/sweep.ts growthPerWeek 0,0.01,0.02,0.03,0.05,0.07 [--base '{…}'] [--judge] [--json out.json]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook, predictMatch, type RatingParams } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { outcome, predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const [param, list] = process.argv.slice(2);
const judge = process.argv.includes("--judge");
// --base '{"growthPerWeek":0.03}': other constants already moved by an earlier coordinate of the sweep.
const base: Partial<RatingParams> = process.argv.includes("--base") ? JSON.parse(process.argv[process.argv.indexOf("--base") + 1]) : {};
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
if (!param || !list || !(param in M.rating)) throw new Error(`usage: sweep.ts <rating param> <v1,v2,…>; known: ${Object.keys(M.rating).join(", ")}`);
const values = list.split(",").map(Number);
const SCORED = judge ? 2025 : 2024;
const corpora = new Map<number, Awaited<ReturnType<typeof seasonCorpus>>>();
for (let s = 2023; s <= SCORED; s++) corpora.set(s, await seasonCorpus(s));

const results: Record<string, unknown>[] = [];
console.log(`${param} (base ${JSON.stringify(base)}; live ${(M.rating as unknown as Record<string, unknown>)[param]}), scored on ${SCORED}${judge ? " (held out)" : " (tuning)"}`);
for (const v of values) {
  const book = new RatingBook({ ...M.rating, ...base, [param]: v } as Partial<RatingParams>);
  let n = 0, br = 0, ll = 0, acc = 0, nAcc = 0, ae = 0, nAe = 0;
  for (const [s, { matches, unrated }] of corpora) {
    book.startSeason(s);
    for (const m of matches) {
      if (unrated.has(m.eventCode)) continue;
      book.setTime(m.time);
      if (s === SCORED && predictable(m)) {
        const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
        const p = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
        const y = outcome(m), q = Math.min(1 - 1e-9, Math.max(1e-9, p.pRedWin));
        n++; br += (q - y) ** 2; ll += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
        if (y !== 0.5) { nAcc++; acc += (q > 0.5 ? 1 : 0) === y ? 1 : 0; }
        ae += Math.abs(m.red.total - p.red.mean) + Math.abs(m.blue.total - p.blue.mean); nAe += 2;
      }
      book.update(m);
    }
  }
  const r = { value: v, n, brier: br / n, logLoss: ll / n, accuracy: acc / nAcc, scoreMae: ae / nAe };
  results.push(r);
  console.log(`  ${String(v).padEnd(8)} Brier ${r.brier.toFixed(5)}  logloss ${r.logLoss.toFixed(5)}  acc ${(r.accuracy * 100).toFixed(2)}%  score MAE ${r.scoreMae.toFixed(3)}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ param, base, live: (M.rating as unknown as Record<string, unknown>)[param], scored: SCORED, heldOut: judge, results }, null, 2));
