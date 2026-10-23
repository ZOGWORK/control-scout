// Engine program Part 12.3, step 1 (measure; it may close the item): do young teams improve during a season
// faster than the engine already allows? For every predicted, rated match, each alliance's miss per phase
// (actual − the live engine's expectation, read exactly as a prediction reads it: regional start, event form,
// the between-event growth factor all included) is split evenly between its two robots and bucketed by each
// robot's experience band (rookie / year 2 / veteran) and its rated matches so far this season. A trajectory the
// engine misses shows up as misses that grow with matches played for rookies and year-2 teams.
// Per band, the slope of the miss on matches played (n ≤ 48) is reported with a 95% interval; robots in the
// same alliance share a miss, so the interval is a little optimistic.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part12/growth-research.ts [--json out.json]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { predictable, rookieYears, seasonCorpus } from "../slices/corpus.js";
import { experienceOf } from "../slices/tags.js";

await migrate();
const M = FITTED_MODEL;
const book = new RatingBook(M.rating);
const rookie = await rookieYears();
const PH = ["auto", "teleop", "endgame", "np"] as const;
type Ph = (typeof PH)[number];
const BANDS = ["rookie", "year2", "veteran"] as const;
const BUCKETS = [[0, 5], [6, 11], [12, 23], [24, 47], [48, 1e9]] as const;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const pts: { season: number; band: string; n: number; miss: Record<Ph, number> }[] = [];
for (const s of [2022, 2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  for (const m of matches) {
    if (unrated.has(m.eventCode)) continue;
    book.setTime(m.time);
    if (s >= 2023 && predictable(m)) {
      const r = book.withRegion(m.region, () => book.withEvent(m.eventCode, () => [...m.red.teams, ...m.blue.teams].map((t) => book.get(t))));
      for (const [al, idx] of [[m.red, [0, 1]], [m.blue, [2, 3]]] as const) {
        const e = { auto: r[idx[0]].auto + r[idx[1]].auto, teleop: r[idx[0]].teleop + r[idx[1]].teleop, endgame: r[idx[0]].endgame + r[idx[1]].endgame };
        const miss = { auto: al.auto - e.auto, teleop: al.teleop - e.teleop, endgame: al.endgame - e.endgame, np: al.np - (e.auto + e.teleop + e.endgame) };
        for (const i of idx) {
          const band = experienceOf(rookie.get([...m.red.teams, ...m.blue.teams][i]), s);
          if (band === "unknown") continue;
          pts.push({ season: s, band, n: r[i].n, miss: { auto: miss.auto / 2, teleop: miss.teleop / 2, endgame: miss.endgame / 2, np: miss.np / 2 } });
        }
      }
    }
    book.update(m);
  }
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const se = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1) / a.length); };
function slope(x: number[], y: number[]) {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx; let rss = 0;
  for (let i = 0; i < x.length; i++) rss += (y[i] - a - b * x[i]) ** 2;
  return { b, ci: 1.96 * Math.sqrt(rss / (x.length - 2) / sxx) };
}
const out: Record<string, unknown>[] = [];
for (const s of [2023, 2024, 2025]) {
  console.log(`\n${s}: mean miss per robot (points, ± 95%) by matches played this season`);
  for (const band of BANDS) {
    const B = pts.filter((p) => p.season === s && p.band === band);
    const row: Record<string, unknown> = { season: s, band, n: B.length, buckets: {}, slopes: {} };
    for (const ph of PH) {
      const cells = BUCKETS.map(([lo, hi]) => { const v = B.filter((p) => p.n >= lo && p.n <= hi).map((p) => p.miss[ph]); return { lo, hi, n: v.length, mean: mean(v), ci: 1.96 * se(v) }; });
      const L = B.filter((p) => p.n <= 48), sl = slope(L.map((p) => p.n), L.map((p) => p.miss[ph]));
      (row.buckets as Record<string, unknown>)[ph] = cells; (row.slopes as Record<string, unknown>)[ph] = sl;
      console.log(`  ${band.padEnd(8)} ${ph.padEnd(8)} ${cells.map((c) => `${c.lo}-${c.hi > 1e8 ? "" : c.hi}: ${c.mean >= 0 ? "+" : ""}${c.mean.toFixed(2)}±${c.ci.toFixed(2)} (${c.n})`).join("  ")}  | slope/10 matches ${(sl.b * 10).toFixed(3)}±${(sl.ci * 10).toFixed(3)}`);
    }
    out.push(row);
  }
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 2));
