// Partnership memory, second look: does a numeric pair adjustment help the engine served today?
//
//   DATABASE_URL=file:<copy-of-snapshot.db> npx tsx scripts/partnership-refit.ts
//
// 2.4 tested the blend against 2.1.1 and shipped it as a reason only (docs/partnership-memory.md).
// Since then the champion learned alliance overlap (2.11), event-local form (2.9) and regional
// priors, which could either absorb the pair effect or leave a cleaner residual. This replays the
// champion exactly as scripts/engine-slices.ts does (same corpus, same order, same options) and
// asks again, rolling origin: for each test season, choose (decay, k) and fit β only on the
// seasons before it, then score the test season. 2026–27 has played no part in any engine choice.
//
//   logit P' = logit P + βT · (effect(red pair) − effect(blue pair)) + βA · Σ effect(red i vs blue j)
//
// Ship rule (fixed before running): the pooled Δ Brier interval over the test seasons lies below 0,
// and no test season's Δ Brier point estimate is above 0.
//
// Always run it on a COPY of a database: it runs migrations. It writes nothing else to it.
import "../server/env.js";
import { FITTED_MODEL, PARTNERSHIP_PARAMS, PartnershipBook, RatingBook, partnershipFeatures, predictMatch } from "@control-scout/predict-engine";
import { migrate } from "../server/db.js";
import { predictable, seasonCorpus } from "./slices/corpus.js";

const HISTORY = [2019, 2020, 2021, 2022];
const PREDICTED = [2023, 2024, 2025, 2026];
const TESTS = [2024, 2025, 2026];
const DECAYS = [0, 0.25, 0.5, 1];
const KS = [1, 2, 4, 8, 16, 32, 64];
const KEYS = DECAYS.flatMap((d) => KS.map((k) => `${d}|${k}`));

interface Row { season: number; event: string; y: number; L: number; f: Map<string, [number, number]> }
type Beta = [number, number];

const logit = (p: number) => Math.log(p / (1 - p));
const sig = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (p: number) => Math.max(1e-6, Math.min(1 - 1e-6, p));

await migrate();
const M = FITTED_MODEL;
const champion = new RatingBook(M.rating);
const books = DECAYS.map((d) => new PartnershipBook(M.rating, { ...PARTNERSHIP_PARAMS, seasonDecay: d }));
const rows: Row[] = [];

for (const s of [...HISTORY, ...PREDICTED]) {
  const { matches, unrated } = await seasonCorpus(s);
  const predicted = PREDICTED.includes(s);
  if (predicted) champion.startSeason(s);
  let n = 0;
  for (const m of matches) {
    const rated = !unrated.has(m.eventCode);
    if (predicted && rated && predictable(m) && m.red.total !== m.blue.total) {
      champion.setTime(m.time);
      const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
      const p = predictMatch(champion, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
      const f = new Map<string, [number, number]>();
      DECAYS.forEach((d, i) => {
        for (const k of KS) {
          const x = partnershipFeatures(books[i], m.red.teams, m.blue.teams, s, { ...PARTNERSHIP_PARAMS, seasonDecay: d, k });
          f.set(`${d}|${k}`, [x.together, x.against]);
        }
      });
      rows.push({ season: s, event: m.eventCode, y: m.red.total > m.blue.total ? 1 : 0, L: logit(clamp(p.pRedWin)), f });
      n++;
    }
    // Pair history is built from rated matches only, as the served table is.
    if (rated) {
      for (const b of books) b.observe(m);
      if (predicted) champion.update(m);
    }
  }
  console.log(`${s}: ${matches.length} matches${predicted ? `, ${n} scored` : ""}`);
}

/** Logistic fit of y ~ offset L + βT·fT + βA·fA (Newton, small ridge). */
function fitBeta(rs: Row[], key: string): Beta {
  let b: Beta = [0, 0];
  for (let it = 0; it < 30; it++) {
    const g = [0, 0], H = [[1e-3, 0], [0, 1e-3]];
    for (const r of rs) {
      const x = r.f.get(key)!;
      const p = sig(r.L + b[0] * x[0] + b[1] * x[1]);
      const e = r.y - p, w = p * (1 - p);
      g[0] += e * x[0]; g[1] += e * x[1];
      H[0][0] += w * x[0] * x[0]; H[0][1] += w * x[0] * x[1]; H[1][1] += w * x[1] * x[1];
    }
    const det = H[0][0] * H[1][1] - H[0][1] * H[0][1];
    const step: Beta = [(H[1][1] * g[0] - H[0][1] * g[1]) / det, (H[0][0] * g[1] - H[0][1] * g[0]) / det];
    b = [b[0] + step[0], b[1] + step[1]];
    if (Math.abs(step[0]) + Math.abs(step[1]) < 1e-9) break;
  }
  return b;
}
const pOf = (r: Row, key: string, b: Beta) => { const x = r.f.get(key)!; return clamp(sig(r.L + b[0] * x[0] + b[1] * x[1])); };
const logLoss = (rs: Row[], key: string, b: Beta) => -rs.reduce((s, r) => { const p = pOf(r, key, b); return s + (r.y ? Math.log(p) : Math.log(1 - p)); }, 0) / rs.length;
const metrics = (rs: Row[], key: string, b: Beta) => {
  let ll = 0, br = 0, acc = 0;
  for (const r of rs) { const p = pOf(r, key, b); ll -= r.y ? Math.log(p) : Math.log(1 - p); br += (p - r.y) ** 2; acc += (p > 0.5 ? 1 : 0) === r.y ? 1 : 0; }
  return { ll: ll / rs.length, brier: br / rs.length, acc: acc / rs.length };
};

/** Choose (decay, k) on the training seasons: fit β on all but the last, select on the last, refit on all. */
function choose(train: Row[], trainSeasons: number[]): { key: string; b: Beta } {
  const last = Math.max(...trainSeasons);
  const inner = train.filter((r) => r.season < last), sel = train.filter((r) => r.season === last);
  let key = "0.5|4";
  if (inner.length) {
    let best = Infinity;
    for (const k of KEYS) { const l = logLoss(sel, k, fitBeta(inner, k)); if (l < best) { best = l; key = k; } }
  } else {
    // One training season: choose in-sample (the test season stays untouched either way).
    let best = Infinity;
    for (const k of KEYS) { const l = logLoss(train, k, fitBeta(train, k)); if (l < best) { best = l; key = k; } }
  }
  return { key, b: fitBeta(train, key) };
}

interface Scored { event: string; y: number; a: number; c: number }
const scored: Scored[] = [];
const ZERO: Beta = [0, 0];
for (const t of TESTS) {
  const trainSeasons = PREDICTED.filter((s) => s < t);
  const train = rows.filter((r) => r.season < t), test = rows.filter((r) => r.season === t);
  if (!test.length) { console.log(`\nTest ${t}: no rated 2v2 matches in this database yet, skipped`); continue; }
  const { key, b } = choose(train, trainSeasons);
  const m0 = metrics(test, key, ZERO), m1 = metrics(test, key, b);
  const hist = test.filter((r) => { const x = r.f.get(key)!; return x[0] !== 0 || x[1] !== 0; });
  console.log(`\nTest ${t} (${test.length} matches; trained on ${trainSeasons.join(", ")}): decay ${key.split("|")[0]}, k ${key.split("|")[1]}, βT ${b[0].toFixed(3)}, βA ${b[1].toFixed(3)}`);
  console.log(`  served  Brier ${m0.brier.toFixed(5)}  log loss ${m0.ll.toFixed(5)}  accuracy ${(100 * m0.acc).toFixed(2)}%`);
  console.log(`  + pairs Brier ${m1.brier.toFixed(5)}  log loss ${m1.ll.toFixed(5)}  accuracy ${(100 * m1.acc).toFixed(2)}%`);
  console.log(`  Δ Brier ${(m1.brier - m0.brier).toExponential(2)} ${ci(test.map((r) => ({ event: r.event, y: r.y, a: pOf(r, key, ZERO), c: pOf(r, key, b) })))}; pair history on ${(100 * hist.length / test.length).toFixed(1)}%`);
  for (const r of test) scored.push({ event: `${r.season}|${r.event}`, y: r.y, a: pOf(r, key, ZERO), c: pOf(r, key, b) });
}
console.log(`\nPooled over the scored test seasons (${scored.length} matches): Δ Brier ${(mean(scored.map((r) => (r.c - r.y) ** 2 - (r.a - r.y) ** 2))).toExponential(2)} ${ci(scored)}`);

function mean(xs: number[]) { return xs.reduce((a, b) => a + b, 0) / xs.length; }
/** 95% interval of Δ Brier from 1,000 resamples of whole events. */
function ci(rs: Scored[]): string {
  const byEvent = new Map<string, number[]>();
  for (const r of rs) { const d = (r.c - r.y) ** 2 - (r.a - r.y) ** 2; const xs = byEvent.get(r.event) ?? []; xs.push(d); byEvent.set(r.event, xs); }
  const evs = [...byEvent.values()];
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const out: number[] = [];
  for (let i = 0; i < 1000; i++) {
    let s = 0, n = 0;
    for (let j = 0; j < evs.length; j++) { const e = evs[Math.floor(rand() * evs.length)]; for (const d of e) s += d; n += e.length; }
    out.push(s / n);
  }
  out.sort((a, b) => a - b);
  return `[${out[25].toExponential(2)}, ${out[974].toExponential(2)}]`;
}
