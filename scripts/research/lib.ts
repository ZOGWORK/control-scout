// Research program (R2 shrinkage, R4 recency) shared harness: a walk-forward replay of the backtest corpus with
// several rating books side by side on identical matches, plus the metrics, the paired event-bootstrap and the
// rolling-origin selection the notes report.
//
// The replay is the slice report's (scripts/engine-slices.ts): the same corpus loader (scripts/slices/corpus.ts),
// order and exclusions; every match at a rated event is predicted from earlier results only with the served call
// (predictMatch + the fitted contextual model), then folded into every book. Rows keep only rated-event,
// 2-robot-alliance matches (the scope of the published numbers).
//
// Variants that the engine already exposes as a setting are plain RatingBooks with overridden RatingParams. A
// variant that needs rating logic the engine doesn't have is a PATCHED BOOK: a live RatingBook whose update gain
// is steered through the gain experience it already reads (`TeamRating.gainN`; the gain is
// max(kMin, k0 / (1 + gainN / n0))). Nothing in packages/predict-engine is edited; the patch lives here.
import "../../server/env.js";
import { FITTED_MODEL, RatingBook, predictMatch, type MatchRecord, type RatingParams, type TeamRating } from "@control-scout/predict-engine";
import { migrate } from "../../server/db.js";
import { matchKey, outcome, predictable, seasonCorpus } from "../slices/corpus.js";
import { matchesBand, qualBand } from "../slices/tags.js";
import { rng } from "../slices/report.js";

export const M = FITTED_MODEL;
export const LIVE: Partial<RatingParams> = M.rating as Partial<RatingParams>;
/** Engine 1.x's settings, frozen (as in engine-slices.ts): the historical 72.7% / 0.179 baseline, for context only. */
export const LEGACY_RATING: Partial<RatingParams> = {
  k0: 0.65, n0: 10, kMin: 0.33, playoffWeight: 0.5, rho1: 0.6, rho2: 0.2, rookieZ: -0.7, uncKnown: 150, uncRookie: 350, uncDecay: 0.45, uncMin: 10,
  baseAlpha: 0.002, growthPerWeek: 0.05, growthMaxWeeks: 8, populationUpdate: "sequential",
};
export const WEEK = 7 * 864e5;

export interface Variant {
  name: string;
  book: RatingBook;
  /** Engine 1.x: predicted without the contextual model or the event context, as the slice report does. */
  legacy?: boolean;
}

/** Steers a live book's update gain. `gainN` returns the gain experience to use for team t's next update (called
 *  once the match being folded is known; `m` is that match), or undefined to leave the engine's own. `after` sees
 *  every folded match; `season` every season start. */
export interface GainPatch {
  gainN(t: number, r: TeamRating, m: MatchRecord, book: RatingBook): number | undefined;
  after?(m: MatchRecord, book: RatingBook): void;
  season?(s: number): void;
}

/** A live RatingBook (settings `params` over the live ones) whose update gain follows `patch`. The engine reads
 *  `gainN ?? n` when it computes the gain, so the patch sets `gainN` on the stored rating right before each update
 *  (RatingBook.stored() is the only place fold() fetches it from). */
export function patchedBook(params: Partial<RatingParams>, patch: GainPatch): RatingBook {
  const b = new RatingBook({ ...LIVE, ...params });
  const raw = b as unknown as { stored(t: number): TeamRating };
  const stored = raw.stored.bind(b);
  let current: MatchRecord | null = null;
  raw.stored = (t: number) => {
    const r = stored(t);
    if (current) { const g = patch.gainN(t, r, current, b); if (g !== undefined) r.gainN = g; }
    return r;
  };
  const update = b.update.bind(b);
  b.update = (m: MatchRecord) => { current = m; try { update(m); } finally { current = null; } patch.after?.(m, b); };
  const start = b.startSeason.bind(b);
  b.startSeason = (s: number) => { start(s); patch.season?.(s); };
  return b;
}

export interface Row {
  key: string; season: number; event: string; time: number; level: string;
  /** Qualification match band (q1-10 / q11-25 / q26+ / playoff) and the fewest rated matches on the field (champion's count). */
  eventMatch: string; teamMatches: string;
  /** Red's result: 1 win, 0 loss, 0.5 tie; actual margin red − blue (final scores). */
  y: number; margin: number;
  /** Per variant (in the order given): red's win probability and expected margin. */
  p: number[]; mg: number[];
}

/** Replays `seasons` (cold start at the first) with every variant on identical matches. variants[0] is the
 *  champion: its rated-match counts tag the rows. */
export async function replay(variants: Variant[], seasons = [2023, 2024, 2025], hooks: { season?(s: number): void } = {}): Promise<Row[]> {
  await migrate();
  const rows: Row[] = [];
  for (const s of seasons) {
    const { unrated, matches } = await seasonCorpus(s);
    for (const v of variants) v.book.startSeason(s);
    hooks.season?.(s);
    for (const m of matches) {
      if (unrated.has(m.eventCode)) continue;
      for (const v of variants) v.book.setTime(m.time);
      if (predictable(m)) {
        const ctx = { level: m.level, event: m.eventCode, ...(m.region ? { region: m.region } : {}) };
        const champ = variants[0].book;
        const fewest = Math.min(...[...m.red.teams, ...m.blue.teams].map((t) => champ.get(t).n));
        const p: number[] = [], mg: number[] = [];
        for (const v of variants) {
          const x = v.legacy
            ? predictMatch(v.book, m.red.teams, m.blue.teams, M.noise, M.calibration, {})
            : predictMatch(v.book, m.red.teams, m.blue.teams, M.noise, M.calibration, { contextual: M.contextual, context: ctx });
          p.push(x.pRedWin); mg.push(x.red.mean - x.blue.mean);
        }
        rows.push({
          key: matchKey(s, m.eventCode, m.level, m.series, m.number), season: s, event: `${s}|${m.eventCode}`, time: m.time, level: m.level,
          eventMatch: qualBand(m.level, m.number), teamMatches: matchesBand(fewest), y: outcome(m), margin: m.red.total - m.blue.total, p, mg,
        });
      }
      for (const v of variants) v.book.update(m);
    }
    console.error(`${s}: ${rows.filter((r) => r.season === s).length} rated predicted matches`);
  }
  return rows;
}

// ---- Metrics (decisive matches: ties left out of every metric) ----

export interface Summary { n: number; brier: number; accuracy: number; marginMae: number }
const clip = (p: number) => Math.min(1 - 1e-9, Math.max(1e-9, p));
export function summary(rows: Row[], i: number): Summary {
  let n = 0, b = 0, a = 0, e = 0;
  for (const r of rows) {
    if (r.y === 0.5) continue;
    const p = clip(r.p[i]);
    n++; b += (p - r.y) ** 2; a += p === 0.5 ? 0.5 : (p > 0.5) === (r.y === 1) ? 1 : 0; e += Math.abs(r.mg[i] - r.margin);
  }
  return { n, brier: b / n, accuracy: a / n, marginMae: e / n };
}

/** All-match Brier with ties as 0.5 (the slice report's convention), for the reproduction check only. */
export const brierWithTies = (rows: Row[], i: number) => rows.reduce((s, r) => s + (clip(r.p[i]) - r.y) ** 2, 0) / rows.length;

export interface Delta {
  n: number;
  /** Challenger minus champion. Brier ×1 (negative = better), accuracy in points (positive = better), margin MAE in points (negative = better). */
  brier: number; brier95: [number, number];
  accuracyPp: number; accuracy95: [number, number];
  marginMae: number; marginMae95: [number, number];
}

/** Paired challenger (column b) minus champion (column a) on decisive matches, 95% intervals from resampling whole events. */
export function paired(rows: Row[], a: number, b: number, pa?: (r: Row) => [number, number], draws = 2000, seed = 20261103): Delta {
  const ev = new Map<string, { n: number; d: number; acc: number; mae: number }>();
  const corr = (p: number, y: number) => (p === 0.5 ? 0.5 : (p > 0.5) === (y === 1) ? 1 : 0);
  for (const r of rows) {
    if (r.y === 0.5) continue;
    const [pb, mb] = pa ? pa(r) : [r.p[b], r.mg[b]];
    const x = ev.get(r.event) ?? { n: 0, d: 0, acc: 0, mae: 0 };
    x.n++;
    x.d += (clip(pb) - r.y) ** 2 - (clip(r.p[a]) - r.y) ** 2;
    x.acc += corr(pb, r.y) - corr(r.p[a], r.y);
    x.mae += Math.abs(mb - r.margin) - Math.abs(r.mg[a] - r.margin);
    ev.set(r.event, x);
  }
  const E = [...ev.values()];
  const tot = E.reduce((s, x) => ({ n: s.n + x.n, d: s.d + x.d, acc: s.acc + x.acc, mae: s.mae + x.mae }), { n: 0, d: 0, acc: 0, mae: 0 });
  const rand = rng(seed), bs: number[] = [], as: number[] = [], ms: number[] = [];
  for (let i = 0; i < draws && E.length; i++) {
    let n = 0, d = 0, acc = 0, mae = 0;
    for (let j = 0; j < E.length; j++) { const x = E[Math.floor(rand() * E.length)]; n += x.n; d += x.d; acc += x.acc; mae += x.mae; }
    bs.push(d / n); as.push((100 * acc) / n); ms.push(mae / n);
  }
  const q = (xs: number[]) => { xs.sort((x, y) => x - y); return [xs[Math.floor(0.025 * xs.length)], xs[Math.min(xs.length - 1, Math.floor(0.975 * xs.length))]] as [number, number]; };
  return { n: tot.n, brier: tot.d / tot.n, brier95: q(bs), accuracyPp: (100 * tot.acc) / tot.n, accuracy95: q(as), marginMae: tot.mae / tot.n, marginMae95: q(ms) };
}

/** The program's gate on one season: Brier better beyond noise, and neither accuracy nor margin MAE worse beyond noise. */
export const gatePasses = (d: Delta) => d.brier95[1] < 0 && d.accuracy95[1] > 0 && d.marginMae95[0] < 0;

// ---- Rolling origins (Part 9 / 12.5): monthly Oct 2024 – Jul 2026, each month's choice made on the 365 days before it ----

export const ROLL_WINDOW = 365 * 864e5;
export function rollingMonths(): number[] {
  const out: number[] = [];
  for (let d = new Date(Date.UTC(2024, 9, 1)); d <= new Date(Date.UTC(2026, 7, 1)); d.setUTCMonth(d.getUTCMonth() + 1)) out.push(d.getTime());
  return out;
}

/** For each month, the family member (variant index) with the lowest decisive-match Brier over the 365 days before
 *  it; that member's calls are used for the month. Returns the pick per row key and the monthly picks. Rows outside
 *  the rolled months get no pick. */
export function rollingPick(rows: Row[], family: number[]): { pick: Map<string, number>; months: { month: string; train: number; test: number; pick: number }[] } {
  const ms = rollingMonths(), pick = new Map<string, number>(), months: { month: string; train: number; test: number; pick: number }[] = [];
  for (let i = 0; i + 1 < ms.length; i++) {
    const t0 = ms[i], t1 = ms[i + 1];
    const test = rows.filter((r) => r.time >= t0 && r.time < t1);
    if (!test.length) continue;
    const train = rows.filter((r) => r.y !== 0.5 && r.time < t0 && r.time >= t0 - ROLL_WINDOW);
    let best = family[0], bestB = Infinity;
    for (const j of family) {
      const b = train.reduce((s, r) => s + (clip(r.p[j]) - r.y) ** 2, 0);
      if (b < bestB - 1e-12) { bestB = b; best = j; }
    }
    for (const r of test) pick.set(r.key, best);
    months.push({ month: new Date(t0).toISOString().slice(0, 7), train: train.length, test: test.length, pick: best });
  }
  return { pick, months };
}

export const fmt = {
  e4: (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(1e4 * x).toFixed(d)}`,
  ci4: (c: [number, number], d = 2) => `[${fmt.e4(c[0], d)}, ${fmt.e4(c[1], d)}]`,
  pp: (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`,
  cipp: (c: [number, number], d = 2) => `[${fmt.pp(c[0], d)}, ${fmt.pp(c[1], d)}]`,
};

/** The slices the notes report besides "all": the Part 1 report's weakest (quals 1–10, robots with 0–5 matches) and their complements. */
export const SLICES: [string, (r: Row) => boolean][] = [
  ["all", () => true],
  ["quals 1–10", (r) => r.eventMatch === "q1-10"],
  ["quals 11–25", (r) => r.eventMatch === "q11-25"],
  ["quals 26+", (r) => r.eventMatch === "q26+"],
  ["playoffs", (r) => r.eventMatch === "playoff"],
  ["0–5 rated matches", (r) => r.teamMatches === "0-5"],
  ["6–15 rated matches", (r) => r.teamMatches === "6-15"],
  ["16+ rated matches", (r) => r.teamMatches === "16+"],
];
