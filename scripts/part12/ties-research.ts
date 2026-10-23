// Engine program Part 12.6, step 1 (measure): how often do qualification matches tie, and does one "tie width"
// w (P(tie) = w · density of the predicted final-score margin at 0) predict it, overall and in close matches?
// The margin's distribution is the served one: mean = red − blue expected total, sd = √(sdR² + sdB²) from
// predictMatch. Also reports what the binary model costs RP odds today: the expected win-and-tie RPs it states
// against the ones alliances actually earned, overall and in close matches.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part12/ties-research.ts [--json out.json]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook, predictMatch, winRankingPoints } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
interface Q { season: number; f: number; p: number; tie: boolean; redWin: boolean }
const rows: Q[] = [];
const book = new RatingBook(M.rating);
for (const s of [2019, 2021, 2022, 2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  for (const m of matches) {
    if (unrated.has(m.eventCode)) continue;
    book.setTime(m.time);
    if (m.level === "qual" && predictable(m)) {
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const pc = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
      const mu = pc.red.mean - pc.blue.mean, sd = Math.sqrt(pc.red.sd ** 2 + pc.blue.sd ** 2);
      rows.push({ season: s, f: phi(mu / sd) / sd, p: pc.pRedWin, tie: m.red.total === m.blue.total, redWin: m.red.total > m.blue.total });
    }
    book.update(m);
  }
}
const out: Record<string, unknown>[] = [];
const fitW = (R: Q[]) => R.filter((r) => r.tie).length / R.reduce((a, r) => a + r.f, 0);
const wAll = fitW(rows.filter((r) => r.season >= 2021 && r.season <= 2024));
console.log(`one width fitted on 2021–2024: w = ${wAll.toFixed(3)} points`);
for (const s of [2019, 2021, 2022, 2023, 2024, 2025]) {
  const R = rows.filter((r) => r.season === s), ties = R.filter((r) => r.tie).length, w = fitW(R);
  // Closeness bins by predicted tie density (quintiles): stated P(tie) with the 2021–24 width vs observed.
  const sorted = [...R].sort((a, b) => a.f - b.f), bins = [0, 1, 2, 3, 4].map((k) => sorted.slice(Math.floor((k * R.length) / 5), Math.floor(((k + 1) * R.length) / 5)));
  const binStats = bins.map((B) => ({ n: B.length, stated: B.reduce((a, r) => a + Math.min(1, wAll * r.f), 0) / B.length, observed: B.filter((r) => r.tie).length / B.length }));
  // RP misallocation today (win RP × p) vs the three-way form, against actual win+tie RPs, per alliance-match.
  const { win, tie } = winRankingPoints(s);
  const closest = bins[4];
  const rp = (B: Q[], threeWay: boolean) => {
    let stated = 0, actual = 0;
    for (const r of B) {
      const pt = threeWay ? Math.min(wAll * r.f, 2 * Math.min(r.p, 1 - r.p)) : 0;
      stated += win * (r.p - pt / 2) + tie * pt + win * (1 - r.p - pt / 2) + tie * pt;
      actual += r.tie ? 2 * tie : win;
    }
    return { stated: stated / (2 * B.length), actual: actual / (2 * B.length) };
  };
  const res = { season: s, n: R.length, ties, tieRate: ties / R.length, w, bins: binStats, rpAll: { binary: rp(R, false), threeWay: rp(R, true) }, rpClosest: { binary: rp(closest, false), threeWay: rp(closest, true) } };
  out.push(res);
  console.log(`${s}: ${R.length} quals, ${ties} ties (${(100 * res.tieRate).toFixed(2)}%), season width ${w.toFixed(3)}`);
  console.log(`  by closeness quintile (stated with w ${wAll.toFixed(2)} / observed %): ${binStats.map((b) => `${(100 * b.stated).toFixed(2)}/${(100 * b.observed).toFixed(2)}`).join("  ")}`);
  console.log(`  win+tie RP per alliance: binary states ${res.rpAll.binary.stated.toFixed(4)}, three-way ${res.rpAll.threeWay.stated.toFixed(4)}, actual ${res.rpAll.binary.actual.toFixed(4)}; closest fifth: binary ${res.rpClosest.binary.stated.toFixed(4)}, three-way ${res.rpClosest.threeWay.stated.toFixed(4)}, actual ${res.rpClosest.binary.actual.toFixed(4)}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ widthFit2021to2024: wAll, seasons: out }, null, 2));
