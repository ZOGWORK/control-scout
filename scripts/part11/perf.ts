// Engine program Part 11, performance check: the cost of the live prediction path (explainMatch with the
// live options a match page and the live ledger use, the 2.0 shadow model included; bonus-RP odds, which need
// the season's bonus fit, are left out and add a small fixed cost to qualification calls) and of a full season replay, on the final engine and on
// 2.6.0's settings (regional starts, event form, overlap, slow fouls off; same code), on this machine.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part11/perf.ts
import "../../server/env.js";
import { FITTED_MODEL, RatingBook, explainMatch, type RatingParams } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const OLD: Partial<RatingParams> = { rho1: 0.6, regionKappa: 0, eventLambdaAuto: 0, eventLambdaTeleop: 0, eventLambdaEndgame: 0, penGain: 1, overlapAuto: 0, overlapTeleop: 0, overlapEndgame: 0 };
const corpus = await seasonCorpus(2025);
const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6;
for (const [name, over] of [["final", {}], ["2.6.0 settings", OLD]] as const) {
  // Full-season replay: predict every predictable rated match (explainMatch, as the backtest does), then fold it in.
  const book = new RatingBook({ ...M.rating, ...over });
  book.startSeason(2025);
  const calls: { red: number[]; blue: number[]; ctx: { level: "qual" | "playoff"; event: string; region?: string } }[] = [];
  const t0 = process.hrtime.bigint();
  for (const m of corpus.matches) {
    if (corpus.unrated.has(m.eventCode)) continue;
    if (predictable(m)) {
      book.setTime(m.time);
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      explainMatch(book, m.red.teams, m.blue.teams, { noise: M.noise, calibration: M.calibration, contextual: M.contextual, context: ctx, band: M.band, shadow: M.contextual!.fallback });
      if (calls.length < 5000) calls.push({ red: m.red.teams, blue: m.blue.teams, ctx });
    }
    book.update(m);
  }
  const replay = ms(t0);
  // Per-call latency at season end (the busiest book), median of 5 passes over 5,000 lineups.
  const per: number[] = [];
  for (let pass = 0; pass < 5; pass++) {
    const t1 = process.hrtime.bigint();
    for (const c of calls) explainMatch(book, c.red, c.blue, { noise: M.noise, calibration: M.calibration, contextual: M.contextual, context: c.ctx, band: M.band, shadow: M.contextual!.fallback });
    per.push((ms(t1) * 1000) / calls.length);
  }
  per.sort((a, b) => a - b);
  console.log(`${name.padEnd(15)} 2025-26 replay (predict + fold, ${corpus.matches.length} matches): ${(replay / 1000).toFixed(2)} s; explainMatch median ${per[2].toFixed(1)} µs/call (5 × ${calls.length})`);
}
