// Engine 3.5.0 gate: margin calibration of the served expected scores.
//
// Research (docs/engine/research-2026-11/r1-rating-systems.md, side finding; r6-playoffs.md, margin map) found the
// served expected margin (red − blue) about 7% too wide: on every rolling window the least-squares slope of the real
// margin on the predicted one is 0.90–0.94. Engine 3.5 shrinks both expected scores toward their midpoint,
//   red′ = m + s·(red − m), blue′ = m − s·(m − blue), m = (red + blue) / 2,
// so the margin scales by s and the total is unchanged. Every probability keeps reading the unscaled scores.
//
// Two steps, on a COPY of the pinned snapshot:
//   1. replay (slow, a few minutes): every predictable match of 2023–24 to 2025–26, in order, exactly as the backtest
//      replays it (scripts/slices/corpus.ts: same loader, exclusions, order; predicted from earlier rated matches only;
//      the book learns from rated events only). Writes one row per match: the model's (unscaled) expected scores, the
//      range sd, the served probability, the real scores. Under engine 3.5 it also checks, on every row, that the
//      served scores and ranges are exactly the transform of the model's, and that the probability is the same.
//        DATABASE_URL=file:<copy.db> npx tsx scripts/part12/margin-scale.ts replay <rows.json.gz>
//   sim: the event simulator on fixed seeds against an older build (must be identical: it reads no served score).
//        DATABASE_URL=file:<copy.db> npx tsx scripts/part12/margin-scale.ts sim - --against <3.4.0 dist dir>
//   2. gate (seconds): fit s walk-forward on 2024–25, freeze it, judge 2025–26 as reused, and write the gate doc.
//        npx tsx scripts/part12/margin-scale.ts gate <rows.json.gz> [--scale 0.92] [--json out.json] [--md out.md]
//
// Fitting protocol (Part 9 / 12.5 rolling origins): every month from Oct 2024 is predicted with s fitted on the 365
// days before it (rated events, ties included: they are real margins). Two fits per window: the least-squares slope
// of the real margin on the model's, through the origin, and the s minimising the margin's mean absolute error
// (grid 0.700–1.100, step 0.0025). The rule, set before any number was looked at: s is the MAE fit (the gate's
// metric), and the shipped constant is the median of its 2024–25 monthly values, rounded to 0.01, frozen before
// 2025–26 is scored. The least-squares variant (the research's slope) is gated alongside and reported, not shipped.
// Quals and playoffs get one slope unless separate per-level slopes beat it on 2024–25 beyond noise.
import "../../server/env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { FITTED_MODEL, ENGINE_VERSION, RatingBook, predictMatch, scoreBand, type MatchPrediction } from "@control-scout/predict-engine";
import { matchKey, outcome, predictable, seasonCorpus } from "../slices/corpus.js";
import { rng } from "../slices/report.js";

const [cmd, file] = process.argv.slice(2);
const flag = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };

/** One predicted match. r/b: model (unscaled) expected scores; sr/sb: the range sd; p: served P(red wins). */
interface Row { key: string; season: number; event: string; level: "qual" | "playoff"; time: number; rated: boolean; r: number; b: number; sr: number; sb: number; nr: number; nb: number; p: number; ar: number; ab: number }

if (cmd === "replay") {
  const { migrate } = await import("../../server/db.js");
  await migrate();
  const M = FITTED_MODEL;
  const book = new RatingBook(M.rating);
  const rows: Row[] = [];
  let checked = 0;
  const scale = (M as { margin?: { scale: number } }).margin?.scale ?? 1;
  for (const s of [2023, 2024, 2025]) {
    const { matches, unrated } = await seasonCorpus(s);
    book.startSeason(s);
    for (const m of matches) {
      if (predictable(m)) {
        book.setTime(m.time);
        const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
        const p = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx, shadow: M.contextual?.fallback, band: M.band });
        const pm = p as MatchPrediction & { red: { modelMean?: number }; blue: { modelMean?: number } };
        const r = pm.red.modelMean ?? p.red.mean, b = pm.blue.modelMean ?? p.blue.mean;
        if (pm.red.modelMean != null) {
          // Engine 3.5: the served scores and ranges are exactly the transform of the model's; nothing else moved.
          const mid = (r + b) / 2, R = mid + scale * (r - mid), B = mid - scale * (mid - b);
          const br = scoreBand(R, p.red.band.sd, p.red.band.level), bb = scoreBand(B, p.blue.band.sd, p.blue.band.level);
          if (!Object.is(p.red.mean, R) || !Object.is(p.blue.mean, B) || br.lo !== p.red.band.lo || br.hi !== p.red.band.hi || bb.lo !== p.blue.band.lo || bb.hi !== p.blue.band.hi) {
            throw new Error(`served scores are not the margin transform at ${m.eventCode} ${m.level} ${m.series}-${m.number}`);
          }
          const one = predictMatch(book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx, shadow: M.contextual?.fallback, band: M.band, margin: { scale: 1 } } as never);
          if (!Object.is(one.pRedWin, p.pRedWin) || !Object.is(one.pShadow, p.pShadow) || !Object.is(one.red.mean, r) || !Object.is(one.blue.mean, b) || !Object.is(one.red.band.sd, p.red.band.sd)) {
            throw new Error(`the scale moved a probability or the model scores at ${m.eventCode} ${m.level} ${m.series}-${m.number}`);
          }
          checked++;
        }
        const n = (teams: number[]) => Math.min(...teams.map((t) => book.get(t).n));
        rows.push({
          key: matchKey(s, m.eventCode, m.level, m.series, m.number), season: s, event: m.eventCode, level: m.level, time: m.time, rated: !unrated.has(m.eventCode),
          r, b, sr: p.red.band.sd, sb: p.blue.band.sd, nr: n(m.red.teams), nb: n(m.blue.teams), p: p.pRedWin, ar: m.red.total, ab: m.blue.total,
        });
      }
      if (!unrated.has(m.eventCode)) book.update(m);
    }
    console.log(`${s}: ${rows.filter((x) => x.season === s).length} predicted`);
  }
  writeFileSync(file, gzipSync(JSON.stringify({ engine: ENGINE_VERSION, scale, checked, rows })));
  console.log(`engine ${ENGINE_VERSION}: ${rows.length} rows${checked ? `; served = transform of the model and probabilities unchanged on all ${checked}` : ""} → ${file}`);
  process.exit(0);
}

if (cmd === "sim") {
  // The event simulator on fixed seeds, this engine against an older build (3.4.0's dist): it never reads a served
  // score, so every simulated odd must be identical. 12 events per season (every 25th with 12+ quals), each simulated
  // from the book at its start, half its quals played (real results) and half drawn.
  const { pathToFileURL } = await import("node:url");
  const { resolve } = await import("node:path");
  const { migrate } = await import("../../server/db.js");
  const NEW = await import("@control-scout/predict-engine");
  const OLD = (await import(pathToFileURL(resolve(flag("--against")!, "index.js")).href)) as typeof NEW;
  await migrate();
  const M = FITTED_MODEL;
  const book = new RatingBook(M.rating);
  let events = 0, teams = 0;
  for (const s of [2023, 2024, 2025]) {
    const { matches, unrated } = await seasonCorpus(s);
    book.startSeason(s);
    const byEvent = new Map<string, typeof matches>();
    for (const m of matches) byEvent.set(m.eventCode, [...(byEvent.get(m.eventCode) ?? []), m]);
    const picks = [...byEvent].filter(([code, ms]) => !unrated.has(code) && ms.filter((m) => m.level === "qual" && predictable(m)).length >= 12).map(([c]) => c).filter((_, i) => i % 25 === 0).slice(0, 12);
    const started = new Set<string>();
    for (const m of matches) {
      if (picks.includes(m.eventCode) && !started.has(m.eventCode)) {
        started.add(m.eventCode);
        book.setTime(m.time);
        const qs = byEvent.get(m.eventCode)!.filter((x) => x.level === "qual" && predictable(x));
        const field = [...new Set(qs.flatMap((x) => [...x.red.teams, ...x.blue.teams]))];
        const half = Math.floor(qs.length / 2);
        const quals = qs.map((x, i) => ({ red: x.red.teams, blue: x.blue.teams, ...(i < half ? { result: { red: { np: x.red.np, total: x.red.total, auto: x.red.auto, endgame: x.red.endgame }, blue: { np: x.blue.np, total: x.blue.total, auto: x.blue.auto, endgame: x.blue.endgame } } } : {}) }));
        const input = {
          season: s, ratings: new Map(field.map((t) => [t, book.get(t)])), quals, noise: M.noise,
          variance: new Map(field.map((t) => { const v = NEW.teamScoreVariance(book, t); return [t, { consistency: v.consistency, matches: v.matches }]; })), band: M.band,
          overlap: { auto: book.params.overlapAuto, teleop: book.params.overlapTeleop, endgame: book.params.overlapEndgame }, tieWidth: NEW.TIE_RULE.width,
          bonus: (M.bonus as Record<string, never>)[String(s)], pick: M.pick, awards: { mode: "none" as const }, prequalified: new Set<number>(), slots: 4, runs: 500, seed: 7,
        };
        const a = [...NEW.simulateEvent(input as never).values()], b = [...OLD.simulateEvent(input as never).values()];
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`simulateEvent differs from ${OLD.ENGINE_VERSION} at ${s} ${m.eventCode}`);
        events++; teams += a.length;
      }
      if (predictable(m)) book.setTime(m.time);
      if (!unrated.has(m.eventCode)) book.update(m);
    }
  }
  console.log(`simulateEvent (seed 7, 500 runs): ${NEW.ENGINE_VERSION} = ${OLD.ENGINE_VERSION} on ${events} events, ${teams} teams' odds, bit for bit`);
  process.exit(0);
}

if (cmd !== "gate") { console.error("usage: margin-scale.ts replay|gate <rows.json.gz>"); process.exit(1); }

const data = JSON.parse(gunzipSync(readFileSync(file)).toString()) as { engine: string; rows: Row[] };
const ROWS = data.rows.filter((r) => r.rated).sort((a, b) => a.time - b.time);
const WINDOW = 365 * 864e5;
const LEVEL = 0.8, ALPHA = 1 - LEVEL;
const GRID: number[] = [];
for (let s = 0.7; s <= 1.1 + 1e-9; s += 0.0025) GRID.push(+s.toFixed(4));
const margin = (r: Row) => r.r - r.b, real = (r: Row) => r.ar - r.ab;

/** s minimising Σ|s·m̂ − y| over the rows (grid), and the least-squares slope through the origin. */
function fitScale(R: Row[]): { mae: number; lsq: number } {
  let num = 0, den = 0;
  for (const r of R) { num += margin(r) * real(r); den += margin(r) ** 2; }
  let best = 1, bestE = Infinity;
  for (const s of GRID) {
    let e = 0;
    for (const r of R) e += Math.abs(s * margin(r) - real(r));
    if (e < bestE - 1e-9) { bestE = e; best = s; }
  }
  return { mae: best, lsq: den > 0 ? num / den : 1 };
}

// ---- Rolling origins: monthly from Oct 2024; each month scored with s fitted on the 365 days before it.
const months: number[] = [];
for (let d = new Date(Date.UTC(2024, 9, 1)); d <= new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime());
interface Fold { origin: string; season: number; train: number; test: number; mae: number; lsq: number; qual: number; playoff: number }
const folds: Fold[] = [];
const rolled = new Map<string, { one: number; lsq: number; split: number }>();
for (let i = 0; i + 1 < months.length; i++) {
  const t0 = months[i], t1 = months[i + 1];
  const test = ROWS.filter((r) => r.time >= t0 && r.time < t1);
  if (test.length < 50) continue;
  const train = ROWS.filter((r) => r.time < t0 && r.time >= t0 - WINDOW);
  const f = fitScale(train), q = fitScale(train.filter((r) => r.level === "qual")), pl = fitScale(train.filter((r) => r.level === "playoff"));
  const season = test[0].season;
  folds.push({ origin: new Date(t0).toISOString().slice(0, 7), season, train: train.length, test: test.length, mae: f.mae, lsq: +f.lsq.toFixed(4), qual: q.mae, playoff: pl.mae });
  for (const r of test) rolled.set(r.key, { one: f.mae, lsq: f.lsq, split: r.level === "playoff" ? pl.mae : q.mae });
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const tuneFolds = folds.filter((f) => f.season === 2024);
// Which fit: the one whose rolled months give the lower 2024–25 margin MAE (the tuning season only).
const tuneMae = (k: "one" | "lsq") => {
  const R = ROWS.filter((r) => r.season === 2024 && rolled.has(r.key));
  return R.reduce((e, r) => { const s = rolled.get(r.key)![k]; return e + Math.abs(s * margin(r) - real(r)); }, 0) / R.length;
};
const family = "mae";
const fitted = +median(tuneFolds.map((f) => f.mae)).toFixed(2);
const lsqVariant = +median(tuneFolds.map((f) => f.lsq)).toFixed(2);
const S = flag("--scale") ? Number(flag("--scale")) : fitted;

// ---- Metrics for one centre rule. `c` maps a row to [red′, blue′] (served centres).
type Centre = (r: Row) => [number, number];
const old: Centre = (r) => [r.r, r.b];
const scaled = (s: (r: Row) => number): Centre => (r) => { const m = (r.r + r.b) / 2, k = s(r); return [m + k * (r.r - m), m - k * (m - r.b)]; };
const NEW = scaled(() => S);

/** Per-row sums: [n, margin AE, alliance AE (two sides), Brier, correct, n decisive, inside, IS, width, sides]. */
function parts(r: Row, c: Centre): number[] {
  const [R, B] = c(r);
  const y = outcome({ red: { total: r.ar }, blue: { total: r.ab } } as never);
  const dec = y !== 0.5 ? 1 : 0;
  let inside = 0, is = 0, width = 0;
  for (const [mean, sd, actual] of [[R, r.sr, r.ar], [B, r.sb, r.ab]] as const) {
    const { lo, hi } = scoreBand(mean, sd, LEVEL);
    width += hi - lo;
    if (actual < lo) is += hi - lo + (2 / ALPHA) * (lo - actual);
    else if (actual > hi) is += hi - lo + (2 / ALPHA) * (actual - hi);
    else { inside++; is += hi - lo; }
  }
  const pc = Math.min(1 - 1e-6, Math.max(1e-6, r.p));
  return [1, Math.abs(R - B - real(r)), Math.abs(R - r.ar) + Math.abs(B - r.ab), dec ? (pc - y) ** 2 : 0, dec ? (r.p === 0.5 ? 0.5 : (r.p > 0.5) === (y === 1) ? 1 : 0) : 0, dec, inside, is, width, 2];
}
const METRICS = ["marginMae", "allianceMae", "brier", "accuracy", "coverage", "intervalScore", "width"] as const;
type Metric = (typeof METRICS)[number];
const finish = (t: number[]): Record<Metric, number> => ({
  marginMae: t[1] / t[0], allianceMae: t[2] / t[9], brier: t[3] / t[5], accuracy: t[4] / t[5], coverage: t[6] / t[9], intervalScore: t[7] / t[9], width: t[8] / t[9],
});

/** a (old) vs b (new) on identical rows, with 95% intervals from resampling whole events (2000 draws). */
function paired(R: Row[], a: Centre, b: Centre, draws = 2000) {
  const ev = new Map<string, { a: number[]; b: number[] }>();
  for (const r of R) {
    const e = ev.get(r.event) ?? { a: new Array(10).fill(0), b: new Array(10).fill(0) };
    const pa = parts(r, a), pb = parts(r, b);
    for (let i = 0; i < 10; i++) { e.a[i] += pa[i]; e.b[i] += pb[i]; }
    ev.set(r.event, e);
  }
  const E = [...ev.values()];
  const sum = (pick: (e: { a: number[]; b: number[] }) => number[], idx: number[] | null) => {
    const t = new Array(10).fill(0);
    for (const j of idx ?? E.map((_, k) => k)) { const x = pick(E[j]); for (let i = 0; i < 10; i++) t[i] += x[i]; }
    return t;
  };
  const A = finish(sum((e) => e.a, null)), B = finish(sum((e) => e.b, null));
  const rand = rng(20261104), boot: Record<Metric, number[]> = Object.fromEntries(METRICS.map((m) => [m, []])) as never;
  for (let d = 0; d < draws; d++) {
    const idx = E.map(() => Math.floor(rand() * E.length));
    const x = finish(sum((e) => e.a, idx)), y = finish(sum((e) => e.b, idx));
    for (const m of METRICS) boot[m].push(y[m] - x[m]);
  }
  const ci = (xs: number[]): [number, number] => { xs.sort((u, v) => u - v); return [xs[Math.floor(0.025 * xs.length)], xs[Math.min(xs.length - 1, Math.floor(0.975 * xs.length))]]; };
  return { n: R.length, events: E.length, old: A, new: B, delta: Object.fromEntries(METRICS.map((m) => [m, { d: B[m] - A[m], ci: ci(boot[m]) }])) as Record<Metric, { d: number; ci: [number, number] }> };
}

const SEASONS = [[2024, "2024–25 (tuning)"], [2025, "2025–26 DECODE (reused)"], [2023, "2023–24 (before the tuning season)"]] as const;
const SLICES: [string, (r: Row) => boolean][] = [
  ["all", () => true],
  ["quals", (r) => r.level === "qual"],
  ["playoffs", (r) => r.level === "playoff"],
  ["fewer than 6 matches (least-known robot)", (r) => Math.min(r.nr, r.nb) < 6],
];
const gate: Record<string, Record<string, ReturnType<typeof paired>>> = {};
const variant: Record<string, Record<string, { marginMae: unknown; allianceMae: unknown; intervalScore: unknown }>> = {};
for (const [s, label] of SEASONS) {
  const R = ROWS.filter((r) => r.season === s);
  gate[label] = Object.fromEntries(SLICES.map(([name, keep]) => [name, paired(R.filter(keep), old, NEW)]));
  variant[label] = Object.fromEntries(SLICES.map(([name, keep]) => { const d = paired(R.filter(keep), old, scaled(() => lsqVariant)).delta; return [name, { marginMae: d.marginMae, allianceMae: d.allianceMae, intervalScore: d.intervalScore }]; }));
}

// ---- Walk-forward 2024–25 and the 2025–26 reuse: rolled monthly s against the frozen constant, and one vs split slopes.
const scored = (s: number) => ROWS.filter((r) => r.season === s && rolled.has(r.key));
const rolledOne = scaled((r) => rolled.get(r.key)!.one), rolledLsq = scaled((r) => rolled.get(r.key)!.lsq), rolledSplit = scaled((r) => rolled.get(r.key)!.split);
const walk = Object.fromEntries([2024, 2025].map((s) => {
  const R = scored(s);
  return [s === 2024 ? "2024–25 (tuning)" : "2025–26 DECODE (reused)", {
    rolledMaeFit: paired(R, old, rolledOne).delta.marginMae,
    rolledLsqFit: paired(R, old, rolledLsq).delta.marginMae,
    splitVsOne: paired(R, rolledOne, rolledSplit).delta.marginMae,
    frozen: paired(R, old, NEW).delta.marginMae,
  }];
}));

// ---- Form check: the total. If the total's slope is ~1, the midpoint form (total unchanged) is the right shape.
function totalSlope(R: Row[]) {
  let num = 0, den = 0, e = 0;
  for (const r of R) { const t = r.r + r.b, y = r.ar + r.ab; num += t * y; den += t * t; e += Math.abs(t - y); }
  const k = num / den;
  let e2 = 0;
  for (const r of R) e2 += Math.abs(k * (r.r + r.b) - (r.ar + r.ab));
  return { lsqSlope: +k.toFixed(4), totalMae: e / R.length, totalMaeAtSlope: e2 / R.length };
}
const forms = Object.fromEntries([2024, 2025].map((s) => [s, totalSlope(ROWS.filter((r) => r.season === s))]));

const out = { engineRows: data.engine, generated: new Date().toISOString().slice(0, 10), family, tuneRolledMae: { lsq: tuneMae("lsq"), mae: tuneMae("one") }, fitted, shipped: S, lsqVariant: { scale: lsqVariant, gate: variant }, grid: [GRID[0], GRID[GRID.length - 1], 0.0025], folds, walk, forms, gate };
if (flag("--json")) writeFileSync(flag("--json")!, JSON.stringify(out, (k, v) => (typeof v === "number" && !Number.isInteger(v) ? +v.toPrecision(6) : v), 1) + "\n");

const f2 = (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;
const ci = (c: [number, number], d = 2) => `[${f2(c[0], d)}, ${f2(c[1], d)}]`;
console.log(`2024–25 rolled margin MAE: least squares ${tuneMae("lsq").toFixed(4)}, MAE fit ${tuneMae("one").toFixed(4)} → ${family}`);
console.log(`fitted s (median of ${tuneFolds.length} 2024–25 monthly ${family} fits) = ${fitted}; gate at s = ${S}; least-squares variant ${lsqVariant}`);
for (const [label, sl] of Object.entries(variant)) for (const [name, d] of Object.entries(sl)) console.log(`  variant ${lsqVariant} ${label} · ${name}: margin ${JSON.stringify(d.marginMae)} alliance ${JSON.stringify(d.allianceMae)}`);
console.log(`monthly: ${folds.map((f) => `${f.origin} ${f.mae}/${f.lsq}`).join("  ")}`);
for (const [label, w] of Object.entries(walk)) console.log(`${label} walk-forward ΔMAE: rolled ${f2(w.rolledMaeFit.d, 3)} ${ci(w.rolledMaeFit.ci, 3)}, lsq ${f2(w.rolledLsqFit.d, 3)}, frozen ${f2(w.frozen.d, 3)} ${ci(w.frozen.ci, 3)}; split vs one ${f2(w.splitVsOne.d, 3)} ${ci(w.splitVsOne.ci, 3)}`);
console.log(`total slopes: ${JSON.stringify(forms)}`);
for (const [label, sl] of Object.entries(gate)) for (const [name, g] of Object.entries(sl)) {
  const d = g.delta;
  console.log(`${label} · ${name} (n ${g.n}): marginMAE ${g.old.marginMae.toFixed(2)}→${g.new.marginMae.toFixed(2)} ${f2(d.marginMae.d, 3)} ${ci(d.marginMae.ci, 3)} | alliance ${f2(d.allianceMae.d, 3)} ${ci(d.allianceMae.ci, 3)} | Brier Δ ${d.brier.d} acc Δ ${d.accuracy.d} | cov ${(100 * g.old.coverage).toFixed(2)}→${(100 * g.new.coverage).toFixed(2)} ${ci([100 * d.coverage.ci[0], 100 * d.coverage.ci[1]])} | IS ${g.old.intervalScore.toFixed(2)}→${g.new.intervalScore.toFixed(2)} ${ci(d.intervalScore.ci)} | width ${g.old.width.toFixed(2)}→${g.new.width.toFixed(2)}`);
}
