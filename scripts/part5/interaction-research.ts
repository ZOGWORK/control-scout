// Engine program Part 5, step 1 (the research gate; it may close the part): do alliances whose two
// robots are strong in the same phase score less than their ratings add up to ("two robots, one
// spot"), or complementary pairs more? For 2-robot alliances whose robots both have 6+ rated matches,
// each phase's miss (actual − the additive expectation) is regressed on the smaller partner's
// expected contribution in that phase (overlap), controlling for the alliance's expected total in
// that phase. A negative, stable overlap slope in both seasons = non-additivity worth modelling.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part5/interaction-research.ts
import "../../server/env.js";
import { FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const book = new RatingBook(M.rating);
const PH = ["auto", "teleop", "endgame"] as const;
type Ph = (typeof PH)[number];
const rows: { season: number; exp: Record<Ph, number>; minP: Record<Ph, number>; miss: Record<Ph, number>; npMiss: number }[] = [];
for (const s of [2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  for (const m of matches) {
    if (unrated.has(m.eventCode)) continue;
    book.setTime(m.time);
    if (s >= 2024 && m.level === "qual") for (const al of [m.red, m.blue]) {
      if (al.teams.length !== 2) continue;
      const [a, b] = al.teams.map((t) => book.withRegion(m.region, () => book.get(t)));
      if (a.n < 6 || b.n < 6) continue;
      const exp = { auto: a.auto + b.auto, teleop: a.teleop + b.teleop, endgame: a.endgame + b.endgame };
      rows.push({ season: s, exp, minP: { auto: Math.min(a.auto, b.auto), teleop: Math.min(a.teleop, b.teleop), endgame: Math.min(a.endgame, b.endgame) },
        miss: { auto: al.auto - exp.auto, teleop: al.teleop - exp.teleop, endgame: al.endgame - exp.endgame }, npMiss: al.np - (exp.auto + exp.teleop + exp.endgame) });
    }
    book.update(m);
  }
}
/** OLS of y on [1, x1, x2] with standard errors. */
function ols2(x1: number[], x2: number[], y: number[]) {
  const n = y.length, X = x1.map((v, i) => [1, v, x2[i]]);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { v[a] += X[i][a] * y[i]; for (let b = 0; b < 3; b++) A[a][b] += X[i][a] * X[i][b]; }
  const inv = invert3(A), beta = [0, 1, 2].map((a) => inv[a][0] * v[0] + inv[a][1] * v[1] + inv[a][2] * v[2]);
  let rss = 0; for (let i = 0; i < n; i++) rss += (y[i] - (beta[0] + beta[1] * X[i][1] + beta[2] * X[i][2])) ** 2;
  const s2 = rss / (n - 3);
  return { n, beta, se: [0, 1, 2].map((a) => Math.sqrt(s2 * inv[a][a])) };
}
function invert3(m: number[][]): number[][] {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  return [[A, -(b * i - c * h), b * f - c * e], [B, a * i - c * g, -(a * f - c * d)], [C, -(a * h - b * g), a * e - b * d]].map((r) => r.map((x) => x / det));
}
for (const season of [2024, 2025]) {
  const R = rows.filter((r) => r.season === season);
  console.log(`${season}: ${R.length} alliances (both robots 6+ matches)`);
  for (const p of PH) {
    const f = ols2(R.map((r) => r.exp[p]), R.map((r) => r.minP[p]), R.map((r) => r.miss[p]));
    const meanMin = R.reduce((a, r) => a + r.minP[p], 0) / R.length;
    console.log(`  ${p.padEnd(8)} overlap slope ${f.beta[2].toFixed(3)} ± ${(1.96 * f.se[2]).toFixed(3)}  (per point of the smaller partner's ${p}; mean overlap ${meanMin.toFixed(1)} pts → effect ${(f.beta[2] * meanMin).toFixed(2)} pts)  exp slope ${f.beta[1].toFixed(3)}`);
  }
  // Overall: does the total miss depend on overlap in any phase (sum of min shares)?
  const f = ols2(R.map((r) => r.exp.auto + r.exp.teleop + r.exp.endgame), R.map((r) => r.minP.auto + r.minP.teleop + r.minP.endgame), R.map((r) => r.npMiss));
  console.log(`  NP total overlap slope ${f.beta[2].toFixed(3)} ± ${(1.96 * f.se[2]).toFixed(3)}`);
}
