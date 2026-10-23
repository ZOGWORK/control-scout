// Engine program Part 8, step 1 (measurement): how good are the season-start
// priors? Replays the corpus with the live engine and measures:
//   A. carryover: how well last season's standing (z) predicts this season's, per phase;
//   B. teams with no history: FIRST rookies vs returning teams the book has no history for;
//   C. region: do rookies (and veterans) differ by home region beyond noise;
//   D. first-event error by how many robots on the field start from the no-history prior.
// Diagnostics only; nothing here is fitted into the engine.
//
//   DATABASE_URL=file:<copy.db> npx tsx scripts/part8/priors-research.ts [--out <file.json>]
import "../../server/env.js";
import { writeFileSync } from "node:fs";
import { FITTED_MODEL, RatingBook, predictMatch } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { homeRegions, outcome, predictable, rookieYears, seasonCorpus } from "../slices/corpus.js";

await migrate();
const args = process.argv.slice(2);
const OUT = args[args.indexOf("--out") + 1] && args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const M = FITTED_MODEL;
const SEASONS = [2023, 2024, 2025];
const PH = ["auto", "teleop", "endgame", "np"] as const;
type Ph = (typeof PH)[number];

const rookie = await rookieYears();
const region = await homeRegions();
const book = new RatingBook(M.rating);
/** Season-end standing per team (n ≥ 3), z-scored per phase within the season. */
const standing = new Map<number, Map<number, Record<Ph, number> & { n: number }>>();
/** Per team-season: did the book have history for it at its first match, and the prior z it used. */
const start = new Map<number, Map<number, { known: boolean; z: number }>>();
const firstEvent: Record<string, { n: number; brier: number; correct: number; decided: number }> = {};

const stats = (xs: number[]) => {
  const n = xs.length, m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean: m, sd, se: sd / Math.sqrt(Math.max(1, n)) };
};

for (const s of SEASONS) {
  const { matches, unrated } = await seasonCorpus(s);
  book.startSeason(s);
  const st = new Map<number, { known: boolean; z: number }>();
  const seenEvents = new Map<number, string>();
  for (const m of matches) {
    const teams = [...m.red.teams, ...m.blue.teams];
    for (const t of teams) if (!st.has(t) && !unrated.has(m.eventCode)) st.set(t, book.priorZ(t));
    if (predictable(m) && !unrated.has(m.eventCode)) {
      book.setTime(m.time);
      // First event of the season for some robot on the field: bucket by how many start with no history.
      const firstHere = teams.filter((t) => { const e = seenEvents.get(t); return e == null || e === m.eventCode; });
      for (const t of teams) if (!seenEvents.has(t)) seenEvents.set(t, m.eventCode);
      if (firstHere.length) {
        const noHist = firstHere.filter((t) => !book.priorZ(t).known && book.get(t).n < 1e9).length;
        const k = `${s}|noHistoryOnField=${Math.min(2, teams.filter((t) => !book.priorZ(t).known).length)}`;
        const p = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: { level: m.level, event: m.eventCode } }).pRedWin;
        const y = outcome(m);
        const b = (firstEvent[k] ??= { n: 0, brier: 0, correct: 0, decided: 0 });
        b.n++; b.brier += (p - y) ** 2;
        if (y !== 0.5) { b.decided++; b.correct += (p > 0.5) === (y === 1) ? 1 : 0; }
        void noHist;
      }
    }
    if (!unrated.has(m.eventCode)) book.update(m);
  }
  start.set(s, st);
  // Season-end standing (the same population the book's carryover uses: n ≥ 3).
  const snap = [...book.snapshot()].filter(([, r]) => r.n >= 3);
  const z = new Map<number, Record<Ph, number> & { n: number }>();
  const col = (f: (r: { auto: number; teleop: number; endgame: number }) => number) => { const v = snap.map(([, r]) => f(r)); return stats(v); };
  const S = { auto: col((r) => r.auto), teleop: col((r) => r.teleop), endgame: col((r) => r.endgame), np: col((r) => r.auto + r.teleop + r.endgame) };
  for (const [t, r] of snap) {
    const v = { auto: r.auto, teleop: r.teleop, endgame: r.endgame, np: r.auto + r.teleop + r.endgame };
    z.set(t, { ...(Object.fromEntries(PH.map((p) => [p, (v[p] - S[p].mean) / (S[p].sd || 1)])) as Record<Ph, number>), n: r.n });
  }
  standing.set(s, z);
  console.log(`${s}: ${matches.length} matches, ${z.size} teams with n ≥ 3`);
}

// ---- A. Carryover per phase: z_s,c ~ b · z_{s-1},c (and the engine's way: every phase from last season's NP z).
const ols = (x: number[], y: number[]) => {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  const b = sxy / sxx, a = my - b * mx, r = sxy / Math.sqrt(sxx * syy);
  const res = y.map((v, i) => v - a - b * x[i]); const s2 = res.reduce((q, e) => q + e * e, 0) / (n - 2);
  return { n, slope: b, intercept: a, r, slopeSe: Math.sqrt(s2 / sxx), residSd: Math.sqrt(s2) };
};
const carry: Record<string, unknown> = {};
for (const s of [2024, 2025]) {
  const now = standing.get(s)!, prev = standing.get(s - 1)!;
  const both = [...now.keys()].filter((t) => prev.has(t));
  const res: Record<string, unknown> = { teams: both.length };
  for (const p of PH) res[`own_${p}`] = ols(both.map((t) => prev.get(t)![p]), both.map((t) => now.get(t)![p]));
  for (const p of PH) res[`fromNp_${p}`] = ols(both.map((t) => prev.get(t)!.np), both.map((t) => now.get(t)![p]));
  if (s === 2025) {
    // Two seasons back: does 2023 add anything once 2024 is known? (partial slope via residualising)
    const three = both.filter((t) => standing.get(2023)!.has(t));
    const z1 = three.map((t) => prev.get(t)!.np), z2 = three.map((t) => standing.get(2023)!.get(t)!.np), y = three.map((t) => now.get(t)!.np);
    const f1 = ols(z1, y), g = ols(z1, z2);
    const ry = y.map((v, i) => v - f1.intercept - f1.slope * z1[i]), r2 = z2.map((v, i) => v - g.intercept - g.slope * z1[i]);
    res.twoBack = { teams: three.length, slopeOnLast: f1.slope, partialSlopeOnTwoBack: ols(r2, ry) };
  }
  carry[s] = res;
}

// ---- B. No-history teams: where do they actually finish, vs the rookie prior z?
const noHistory: Record<string, unknown> = {};
for (const s of [2024, 2025]) {
  const st = start.get(s)!, z = standing.get(s)!;
  const groups: Record<string, number[]> = { firstRookie: [], returningNoHistory: [], known: [] };
  for (const [t, p] of st) {
    const fin = z.get(t);
    if (!fin) continue;
    const ry = rookie.get(t);
    const g = p.known ? "known" : ry != null && ry >= s ? "firstRookie" : "returningNoHistory";
    groups[g].push(fin.np);
  }
  // Teams that never reached n ≥ 3 are missing from the standing: count them (they skew weak).
  const dropped = [...st].filter(([t]) => !z.has(t)).length;
  noHistory[s] = { priorZ: M.rating.rookieZ, droppedUnder3: dropped, ...Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, stats(v)])) };
}

// ---- C. Region: rookies' (and known teams') final z by home region; between-region spread vs noise.
const regionFx: Record<string, unknown> = {};
for (const s of [2024, 2025]) {
  const st = start.get(s)!, z = standing.get(s)!;
  for (const which of ["noHistory", "known"] as const) {
    const by = new Map<string, number[]>();
    for (const [t, p] of st) {
      const fin = z.get(t), r = region.get(t);
      if (!fin || !r || (which === "known") !== p.known) continue;
      (by.get(r) ?? by.set(r, []).get(r)!).push(which === "known" ? fin.np - p.z : fin.np);
    }
    const rs = [...by].filter(([, v]) => v.length >= 15).map(([r, v]) => ({ region: r, ...stats(v) }));
    const means = rs.map((r) => r.mean), within = rs.reduce((a, r) => a + r.se ** 2, 0) / Math.max(1, rs.length);
    const between = stats(means).sd ** 2;
    regionFx[`${s}_${which}`] = {
      regions: rs.length, teams: rs.reduce((a, r) => a + r.n, 0),
      // Signal share of the region means' spread (method of moments; ≤ 0 = no region effect beyond noise).
      betweenVariance: between, noiseVariance: within, signalShare: between > 0 ? Math.max(0, 1 - within / between) : 0,
      extremes: [...rs].sort((a, b) => a.mean - b.mean).filter((_, i, a) => i < 3 || i >= a.length - 3).map((r) => ({ region: r.region, n: r.n, mean: +r.mean.toFixed(3) })),
    };
  }
}
// Do region means carry over between seasons (a real, stable effect), for no-history teams?
const regionMeans = (s: number) => {
  const st = start.get(s)!, z = standing.get(s)!, by = new Map<string, number[]>();
  for (const [t, p] of st) { const fin = z.get(t), r = region.get(t); if (fin && r && !p.known) (by.get(r) ?? by.set(r, []).get(r)!).push(fin.np); }
  return new Map([...by].filter(([, v]) => v.length >= 15).map(([r, v]) => [r, stats(v).mean]));
};
const r24 = regionMeans(2024), r25 = regionMeans(2025), common = [...r24.keys()].filter((r) => r25.has(r));
regionFx.noHistoryRegionMeanStability = { regions: common.length, ...ols(common.map((r) => r24.get(r)!), common.map((r) => r25.get(r)!)) };

// ---- E. Prior bias in points where it is used: early matches (every robot on the alliance ≤ 5 rated
// matches), alliance residual per phase regressed on the robots it holds, split by whether each robot
// started without history, and on known robots' prior z (positive slope = last season under-carried).
const early: Record<string, number[][]> = {};
for (const s of [2024, 2025]) {
  const { matches, unrated, byCode } = await seasonCorpus(s);
  const b = new RatingBook(M.rating);
  // Rebuild the history the season starts from (replay the seasons before it quickly).
  for (const prev of SEASONS.filter((x) => x < s)) {
    const c = await seasonCorpus(prev);
    b.startSeason(prev);
    for (const m of c.matches) if (!c.unrated.has(m.eventCode)) b.update(m);
  }
  b.startSeason(s);
  const rows: number[][] = [];
  for (const m of matches) {
    if (unrated.has(m.eventCode)) continue;
    if (predictable(m)) {
      b.setTime(m.time);
      for (const al of [m.red, m.blue]) {
        const rs = al.teams.map((t) => ({ t, r: b.get(t), pz: b.priorZ(t) }));
        if (rs.some((x) => x.r.n > 5)) continue;
        const exp = b.allianceExpectation(al.teams);
        const nh = rs.filter((x) => !x.pz.known).length, kn = rs.length - nh;
        const zKnown = rs.filter((x) => x.pz.known).reduce((a, x) => a + x.pz.z, 0);
        const reg = byCode.get(m.eventCode)?.region ?? "";
        rows.push([nh, kn, zKnown, al.auto - exp.auto, al.teleop - exp.teleop, al.endgame - exp.endgame, al.np - exp.np, reg.length ? reg.charCodeAt(0) : 0]);
        (early[`${s}|${reg}`] ??= []).push([nh, kn, al.np - exp.np]);
      }
    }
    b.update(m);
  }
  early[String(s)] = rows;
}
// Least squares without intercept on [noHistory, known, zKnown] per phase.
const lsq = (X: number[][], y: number[]) => {
  const k = X[0].length, A = Array.from({ length: k }, () => new Array(k).fill(0)), v = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { v[a] += X[i][a] * y[i]; for (let c = 0; c < k; c++) A[a][c] += X[i][a] * X[i][c]; }
  // Gaussian elimination.
  for (let i = 0; i < k; i++) { const p = A[i][i]; for (let c = i; c < k; c++) A[i][c] /= p; v[i] /= p; for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i]; for (let c = i; c < k; c++) A[r][c] -= f * A[i][c]; v[r] -= f * v[i]; } }
  return v;
};
const bias: Record<string, unknown> = {};
for (const s of ["2024", "2025"]) {
  const R = early[s], X = R.map((r) => [r[0], r[1], r[2]]);
  bias[s] = { alliances: R.length, ...Object.fromEntries(["auto", "teleop", "endgame", "np"].map((ph, j) => {
    const c = lsq(X, R.map((r) => r[3 + j]));
    return [ph, { perNoHistoryRobot: c[0], perKnownRobot: c[1], perKnownPriorZ: c[2] }];
  })) };
}
// Region: per-region mean early NP residual of alliances with no-history robots (points per such robot).
const regBias: { region: string; season: number; n: number; perRobot: number }[] = [];
for (const [k, R] of Object.entries(early)) {
  if (!k.includes("|")) continue;
  const [s, reg] = k.split("|");
  const nh = R.filter((r) => r[0] > 0);
  if (nh.length < 60 || !reg) continue;
  regBias.push({ region: reg, season: Number(s), n: nh.length, perRobot: nh.reduce((a, r) => a + r[2], 0) / nh.reduce((a, r) => a + r[0], 0) });
}
const rb24 = new Map(regBias.filter((r) => r.season === 2024).map((r) => [r.region, r.perRobot]));
const rb25 = new Map(regBias.filter((r) => r.season === 2025).map((r) => [r.region, r.perRobot]));
const rbCommon = [...rb24.keys()].filter((r) => rb25.has(r));
bias.regionNoHistory = { regions2024: rb24.size, regions2025: rb25.size, common: rbCommon.length, stability: rbCommon.length > 3 ? ols(rbCommon.map((r) => rb24.get(r)!), rbCommon.map((r) => rb25.get(r)!)) : null,
  spread2025: stats([...rb25.values()]) };

const fe = Object.fromEntries(Object.entries(firstEvent).sort().map(([k, v]) => [k, { n: v.n, brier: v.brier / v.n, accuracy: v.correct / v.decided }]));
const out = { engine: M.contextual?.id, carryover: carry, noHistory, region: regionFx, firstEventMatches: fe, earlyBias: bias };
if (OUT) writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, (k, v) => (typeof v === "number" ? +v.toFixed(4) : v), 1));
