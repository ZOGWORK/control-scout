// Engine follow-up to Part 12.7: the 80% score ranges cover 84–86% of real scores under the live engine (the
// expected scores got sharper in 2.7–2.11; the band, fitted for 2.2, was never refitted). Refit FITTED_MODEL.band
// the way 2.2 fitted it: the 80% interval score (width + 2/α × distance outside) on 2024–25, every 2-robot alliance
// score walk-forward, whole-point ranges, inside = lo ≤ score ≤ hi; judged once on 2025–26.
// Each alliance's band inputs are read exactly as predictMatch reads them (regional start, event form, overlap),
// and checked against the served range on every row.
//
// "live" is whatever band the built engine ships: docs/engine/part12/bands-2026-10-23.json was produced on engine
// 3.1.0 (the 2.2 band); on 3.2.0+ the live and candidate columns describe the refitted band.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part12/band-refit.ts [--candidate '{"playoff":0.72}'] [--json out.json]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook, allianceScoreDistribution, gameVariance, predictMatch, scoreBand, type BandParams } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const LIVE: BandParams = M.band!;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
interface Row { season: number; playoff: boolean; mean: number; consistency: number; minMatches: number; uncertainty: number; actual: number }
const rows: Row[] = [];
const book = new RatingBook(M.rating);
let checked = 0;
for (const s of [2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  for (const m of matches) {
    if (unrated.has(m.eventCode)) continue;
    book.setTime(m.time);
    if (predictable(m)) {
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const p = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx, band: LIVE });
      const ds = book.withRegion(ctx.region, () => book.withEvent(ctx.event, () => [allianceScoreDistribution(book, m.red.teams, m.blue.teams, M.noise, LIVE, ctx), allianceScoreDistribution(book, m.blue.teams, m.red.teams, M.noise, LIVE, ctx)]));
      for (const [d, served, actual] of [[ds[0], p.red.band, m.red.total], [ds[1], p.blue.band, m.blue.total]] as const) {
        const b = scoreBand(d.mean, d.sd, LIVE.level);
        if (b.lo !== served.lo || b.hi !== served.hi) throw new Error(`band inputs differ from the served range at ${m.eventCode} ${m.level} ${m.number}`);
        checked++;
        rows.push({ season: s, playoff: m.level === "playoff", mean: d.mean, consistency: d.consistency, minMatches: d.minMatches, uncertainty: d.ratingVar / LIVE.rating, actual });
      }
    }
    book.update(m);
  }
}
console.log(`${rows.length} alliance scores; ${checked} band inputs match the served range exactly`);

const ALPHA = 1 - LIVE.level;
function evaluate(R: Row[], band: BandParams) {
  let inside = 0, below = 0, score = 0, width = 0;
  for (const r of R) {
    const sd = Math.sqrt(gameVariance(r.mean, r.consistency, r.minMatches, M.noise, band, { level: r.playoff ? "playoff" : "qual" }) + band.rating * r.uncertainty);
    const { lo, hi } = scoreBand(r.mean, sd, band.level);
    width += hi - lo;
    if (r.actual < lo) { below++; score += hi - lo + (2 / ALPHA) * (lo - r.actual); }
    else if (r.actual > hi) score += hi - lo + (2 / ALPHA) * (r.actual - hi);
    else { inside++; score += hi - lo; }
  }
  const n = R.length;
  return { n, coverage: inside / n, below: below / n, above: (n - inside - below) / n, intervalScore: score / n, width: width / n };
}

// Coordinate descent on the tuning season, multiplicative steps, until no step improves the interval score.
const TUNE = rows.filter((r) => r.season === 2024), TEST = rows.filter((r) => r.season === 2025);
const KEYS = ["scale", "consistencyPower", "smallSample", "playoff", "rating"] as const;
let best: BandParams = { ...LIVE }, bestScore = evaluate(TUNE, best).intervalScore;
for (let step = 0.2; step > 0.005; step /= 2) {
  for (let improved = true; improved; ) {
    improved = false;
    for (const k of KEYS) for (const f of [1 + step, 1 / (1 + step)]) {
      const c = { ...best, [k]: +(best[k] * f).toFixed(4) };
      const sc = evaluate(TUNE, c).intervalScore;
      if (sc < bestScore - 1e-9) { best = c; bestScore = sc; improved = true; }
    }
  }
}
// The 2.2 rule: round to the precision the 2.2 band was stated in.
const fitted: BandParams = { level: LIVE.level, scale: +best.scale.toFixed(2), consistencyPower: +best.consistencyPower.toFixed(2), smallSample: +best.smallSample.toFixed(2), playoff: +best.playoff.toFixed(2), rating: +best.rating.toFixed(2) };

// --candidate '{…}': a hand-set band (e.g. the fit with playoff ranges kept as wide as today) judged the same way.
const cand: BandParams | null = process.argv.includes("--candidate") ? { ...fitted, ...JSON.parse(process.argv[process.argv.indexOf("--candidate") + 1]) } : null;
const out: Record<string, unknown> = { live: LIVE, fitted, candidate: cand, rowsChecked: checked };
const fmt = (e: ReturnType<typeof evaluate>) => `coverage ${(100 * e.coverage).toFixed(1)}% (below ${(100 * e.below).toFixed(1)}, above ${(100 * e.above).toFixed(1)}), interval score ${e.intervalScore.toFixed(2)}, mean width ${e.width.toFixed(1)}`;
console.log(`live   ${JSON.stringify(LIVE)}\nfitted ${JSON.stringify(fitted)}`);
for (const [name, R] of [["2023–24", rows.filter((r) => r.season === 2023)], ["2024–25 (tuning)", TUNE], ["2025–26 (held out)", TEST]] as const) {
  const a = evaluate(R, LIVE), b = evaluate(R, fitted);
  const q = [...R].map((r) => r.mean).sort((x, y) => x - y), cut = [0.2, 0.4, 0.6, 0.8].map((p) => q[Math.floor(p * q.length)]);
  const quint = [0, 1, 2, 3, 4].map((i) => R.filter((r) => (i === 0 || r.mean > cut[i - 1]) && (i === 4 || r.mean <= cut[i])));
  const part = (f: (r: Row) => boolean) => ({ live: evaluate(R.filter(f), LIVE), fitted: evaluate(R.filter(f), fitted) });
  const res = { live: a, fitted: b, byExpectedScoreQuintile: quint.map((Q) => ({ live: evaluate(Q, LIVE).coverage, fitted: evaluate(Q, fitted).coverage })), quals: part((r) => !r.playoff), playoffs: part((r) => r.playoff), fewMatches: part((r) => r.minMatches < 6), manyMatches: part((r) => r.minMatches >= 6) };
  const c = cand ? { all: evaluate(R, cand), quals: evaluate(R.filter((r) => !r.playoff), cand), playoffs: evaluate(R.filter((r) => r.playoff), cand), fewMatches: evaluate(R.filter((r) => r.minMatches < 6), cand), manyMatches: evaluate(R.filter((r) => r.minMatches >= 6), cand) } : null;
  out[name] = { ...res, candidate: c };
  console.log(`\n${name}: n ${a.n}\n  live   ${fmt(a)}\n  fitted ${fmt(b)}`);
  console.log(`  by expected score (low → high), live → fitted: ${res.byExpectedScoreQuintile.map((x) => `${(100 * x.live).toFixed(1)}→${(100 * x.fitted).toFixed(1)}`).join("  ")}`);
  if (c) console.log(`  candidate ${fmt(c.all)}; quals ${(100 * c.quals.coverage).toFixed(1)}% (${c.quals.intervalScore.toFixed(2)}), playoffs ${(100 * c.playoffs.coverage).toFixed(1)}% (${c.playoffs.intervalScore.toFixed(2)}), few ${(100 * c.fewMatches.coverage).toFixed(1)}%, many ${(100 * c.manyMatches.coverage).toFixed(1)}%`);
  for (const k of ["quals", "playoffs", "fewMatches", "manyMatches"] as const) console.log(`  ${k.padEnd(11)} ${(100 * res[k].live.coverage).toFixed(1)}% → ${(100 * res[k].fitted.coverage).toFixed(1)}%  (interval score ${res[k].live.intervalScore.toFixed(2)} → ${res[k].fitted.intervalScore.toFixed(2)})`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
