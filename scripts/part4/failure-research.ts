// Engine program Part 4, step 1 (measurement): is the live engine still wrong about fragile robots?
// The 2.1 contextual model already reads each robot's failure and variance state (reliability EMAs),
// so the question is what is left: for favourites whose robots fail often (or swing a lot), does the
// favourite win as often as stated? And how often do strong favourites lose because they collapsed?
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part4/failure-research.ts
import "../../server/env.js";
import { FITTED_MODEL, RatingBook, predictMatch } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { outcome, predictable, seasonCorpus } from "../slices/corpus.js";

await migrate();
const M = FITTED_MODEL;
const book = new RatingBook(M.rating);
interface Row { season: number; fav: number; won: number; failMax: number; varMax: number; n: number; collapsed: boolean; strong: boolean }
const rows: Row[] = [];
for (const s of [2023, 2024, 2025]) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  for (const m of matches) {
    const rated = !unrated.has(m.eventCode);
    if (predictable(m) && rated && s >= 2024) {
      book.setTime(m.time);
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const p = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
      const redFav = p.pRedWin >= 0.5, favTeams = redFav ? m.red.teams : m.blue.teams, favAl = redFav ? m.red : m.blue, favMean = redFav ? p.red.mean : p.blue.mean;
      const rel = favTeams.map((t) => book.reliabilityOf(t)), n = Math.min(...favTeams.map((t) => book.get(t).n));
      const y = outcome(m);
      rows.push({ season: s, fav: Math.max(p.pRedWin, 1 - p.pRedWin), won: y === 0.5 ? 0.5 : (y === 1) === redFav ? 1 : 0,
        failMax: Math.max(...rel.map((r) => r.failure)), varMax: Math.max(...rel.map((r) => r.variance)), n, collapsed: favAl.np < 0.5 * (favMean - (redFav ? m.blue.penCommitted : m.red.penCommitted)), strong: Math.max(p.pRedWin, 1 - p.pRedWin) >= 0.8 });
    }
    if (rated) book.update(m);
  }
}
const q = (xs: number[], p: number) => { const v = [...xs].sort((a, b) => a - b); return v[Math.floor(p * (v.length - 1))]; };
for (const season of [2024, 2025]) {
  const R = rows.filter((r) => r.season === season && r.n >= 6);
  for (const [name, key] of [["failure EMA (max over favourite's robots)", "failMax"], ["variance EMA (max)", "varMax"]] as const) {
    const cuts = [q(R.map((r) => r[key]), 0.5), q(R.map((r) => r[key]), 0.75), q(R.map((r) => r[key]), 0.9)];
    console.log(`${season} — ${name}; cuts p50 ${cuts[0].toFixed(3)} p75 ${cuts[1].toFixed(3)} p90 ${cuts[2].toFixed(3)}`);
    const bands: [string, (r: Row) => boolean][] = [["≤p50", (r) => r[key] <= cuts[0]], ["p50–p75", (r) => r[key] > cuts[0] && r[key] <= cuts[1]], ["p75–p90", (r) => r[key] > cuts[1] && r[key] <= cuts[2]], [">p90", (r) => r[key] > cuts[2]]];
    for (const [b, f] of bands) {
      for (const [lvl, g] of [["all favs", () => true], ["fav ≥80%", (r: Row) => r.strong]] as const) {
        const X = R.filter((r) => f(r) && g(r));
        const stated = X.reduce((a, r) => a + r.fav, 0) / X.length, won = X.reduce((a, r) => a + r.won, 0) / X.length;
        const se = Math.sqrt((won * (1 - won)) / X.length);
        console.log(`  ${b.padEnd(8)} ${lvl.padEnd(9)} n ${String(X.length).padStart(6)}  stated ${(100 * stated).toFixed(1)}%  won ${(100 * won).toFixed(1)}% ±${(196 * se).toFixed(1)}  gap ${(100 * (won - stated)).toFixed(1)}  fav collapsed ${(100 * X.filter((r) => r.collapsed).length / X.length).toFixed(1)}%`);
      }
    }
  }
  const S = R.filter((r) => r.strong && r.won === 0);
  console.log(`${season}: strong favourites that lost: ${S.length}; of them collapsed (< half expected NP): ${(100 * S.filter((r) => r.collapsed).length / S.length).toFixed(1)}%`);
}

// ---- Score ranges: do 80% ranges cover 80% for fragile alliances, and which side do the misses fall on?
{
  const b2 = new RatingBook(M.rating);
  const al: { season: number; fail: number; lo: boolean; hi: boolean; n: number }[] = [];
  for (const s of [2023, 2024, 2025]) {
    const { matches, unrated } = await seasonCorpus(s);
    b2.startSeason(s);
    for (const m of matches) {
      const rated = !unrated.has(m.eventCode);
      if (predictable(m) && rated && s >= 2024) {
        b2.setTime(m.time);
        const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
        const p = predictMatch(b2, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx, band: M.band });
        for (const [side, pr] of [[m.red, p.red], [m.blue, p.blue]] as const) {
          const n = Math.min(...side.teams.map((t) => b2.get(t).n));
          if (n < 6) continue;
          al.push({ season: s, fail: Math.max(...side.teams.map((t) => b2.reliabilityOf(t).failure)), lo: side.total < pr.band.lo, hi: side.total > pr.band.hi, n });
        }
      }
      if (rated) b2.update(m);
    }
  }
  for (const season of [2024, 2025]) {
    const A = al.filter((a) => a.season === season);
    const cuts = [q(A.map((a) => a.fail), 0.5), q(A.map((a) => a.fail), 0.75), q(A.map((a) => a.fail), 0.9)];
    console.log(`${season} score ranges (alliances whose robots have 6+ matches) by failure EMA:`);
    for (const [b, f] of [["≤p50", (a: typeof A[0]) => a.fail <= cuts[0]], ["p50–p75", (a: typeof A[0]) => a.fail > cuts[0] && a.fail <= cuts[1]], ["p75–p90", (a: typeof A[0]) => a.fail > cuts[1] && a.fail <= cuts[2]], [">p90", (a: typeof A[0]) => a.fail > cuts[2]]] as const) {
      const X = A.filter(f);
      console.log(`  ${b.padEnd(8)} n ${String(X.length).padStart(6)}  inside ${(100 * X.filter((a) => !a.lo && !a.hi).length / X.length).toFixed(1)}%  below ${(100 * X.filter((a) => a.lo).length / X.length).toFixed(1)}%  above ${(100 * X.filter((a) => a.hi).length / X.length).toFixed(1)}%`);
    }
  }
}
