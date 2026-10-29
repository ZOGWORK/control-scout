// Pure maths behind the "How it works" figures. Every constant comes from the
// prediction engine's fitted model (FITTED_MODEL), so the explainer can never
// drift from what the app actually computes.
import { FITTED_MODEL, calibrateProb, phi } from "@control-scout/predict-engine";

export const MODEL = FITTED_MODEL;
export const RATING = FITTED_MODEL.rating;
export const NOISE = FITTED_MODEL.noise;
export const CAL = FITTED_MODEL.calibration ?? { a: 1, b: 0 };

/** Prediction Engine 2.0's measured change on the held-out 2025–26 replay (vs 1.1.0, same matches). */
export const E2 = (FITTED_MODEL.accuracy as { engine2: {
  accuracy: number; baselineAccuracy: number; accuracyGain95: [number, number];
  brier: number; baselineBrier: number; ece: number; baselineEce: number; matches: number; nonTies: number;
} }).engine2;

/** Prediction Engine 2.1 vs 2.0, forward-only (everything fitted before each scored month). */
type CleanSeg = { matches: number; accuracy: number; baselineAccuracy: number; accuracyGain95: [number, number]; brier: number; baselineBrier: number; ece: number; baselineEce: number };
export const E21 = (FITTED_MODEL.accuracy as { engine21: { clean: { season2024: CleanSeg; season2025reused: CleanSeg } } }).engine21.clean;

/** z for a central 80% interval. */
export const Z80 = 1.2815515655446004;

/** Normal density. */
export function pdf(x: number, mean: number, sd: number): number {
  return Math.exp(-0.5 * ((x - mean) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
}

/** Rating update gain for a robot that has already played `n` matches this season. */
export function gain(n: number, p: { k0: number; n0: number; kMin: number } = RATING): number {
  return Math.max(p.kMin, p.k0 / (1 + n / p.n0));
}

/** One alliance's score spread: game noise (grows with the score) plus rating uncertainty (points²). */
export function sigma(mean: number, uncertainty: number, noise: { a: number; b: number } = NOISE): number {
  return Math.hypot(noise.a + noise.b * Math.max(0, mean), Math.sqrt(Math.max(0, uncertainty)));
}

/** Platt-scaled probability, exactly as the engine applies it. */
export function platt(p: number): number {
  return calibrateProb(p, CAL);
}

/** P(red wins) for two expected scores, given each alliance's total rating uncertainty (points²). */
export function winProb(redMean: number, blueMean: number, uncertainty: number, calibrated = true): number {
  const sR = sigma(redMean, uncertainty), sB = sigma(blueMean, uncertainty);
  const raw = phi((redMean - blueMean) / Math.hypot(sR, sB));
  return calibrated ? platt(raw) : raw;
}

/** The 80% score range for an expected score and spread, clamped at zero. */
export function range80(mean: number, sd: number): [number, number] {
  return [Math.max(0, Math.round(mean - Z80 * sd)), Math.round(mean + Z80 * sd)];
}

/** Starting z-score for a new season from the last two seasons' final z-scores. */
export function carryZ(last: number, before: number, p: { rho1: number; rho2: number } = RATING): number {
  return p.rho1 * last + p.rho2 * before;
}

/** Worked rating update: alliance miss split between two robots, scaled by the gain. */
export function ratingUpdate(expected: number, scored: number, matchesPlayed: number) {
  const miss = scored - expected;
  const share = miss / 2;
  const k = gain(matchesPlayed);
  return { miss, share, gain: k, move: k * share };
}

/** Per-robot uncertainty (points²) added by the playground's certainty choices. */
export const CERTAINTY = {
  well: RATING.uncMin,
  new: RATING.uncRookie,
  pre: RATING.uncKnown + NOISE.preExtra,
} as const;
export type Certainty = keyof typeof CERTAINTY;

/** Hero-card footnote for a red win probability. */
export function heroFoot(p: number): string {
  const pc = Math.round(p * 100);
  const oneIn = Math.max(2, Math.round(1 / (1 - p)));
  if (p >= 0.85) return `Even a ${pc}% favourite drops about one match in ${oneIn}.`;
  if (p >= 0.58) return `A ${pc}% favourite loses about one match in ${oneIn}. That's the point: the number is a probability, not a promise.`;
  if (p > 0.42) return "Close to a coin flip. A few points of luck decide matches like this.";
  return "The underdog here is red. Upsets happen more often than people expect.";
}

// ---------- seeded randomness (deterministic for tests and first paint) ----------

/** mulberry32: small, fast, seedable. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw (Box–Muller). */
export function gauss(rand: () => number): number {
  let u = 0;
  while (!u) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Rating path over a season: start, then one update per observed match share. */
export function learnSeries(real: number, start: number, luck: number[], gainFn: (n: number) => number): number[] {
  const out = [start];
  let r = start;
  luck.forEach((noise, i) => {
    r += gainFn(i) * (real + noise - r);
    out.push(r);
  });
  return out;
}

// ---------- the toy qualifier ----------

export const TOY = { teams: 24, rounds: 6, runs: 1000, daySd: 12 } as const;

/** The other 23 robots: evenly spread from 40 to 110 points. */
export function toyField(n = TOY.teams): number[] {
  return Array.from({ length: n - 1 }, (_, i) => 40 + (i * 70) / (n - 2));
}

/**
 * One simulated qualifier: every robot's form is drawn once, then `rounds`
 * rounds of random 2v2 matches; 2 RP per win, average score as tiebreaker.
 * Returns robot 0's (your) final rank, 1-based.
 */
export function toyEvent(you: number, field: number[], rand: () => number, rounds: number = TOY.rounds, noise: { a: number; b: number } = NOISE): number {
  const ratings = [you, ...field];
  const nt = ratings.length;
  const day = ratings.map((r) => r + gauss(rand) * TOY.daySd);
  const rp = new Array<number>(nt).fill(0), pts = new Array<number>(nt).fill(0);
  const order = [...Array(nt).keys()];
  for (let rd = 0; rd < rounds; rd++) {
    for (let i = nt - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (let m = 0; m + 3 < nt; m += 4) {
      const red = [order[m], order[m + 1]], blue = [order[m + 2], order[m + 3]];
      const mr = day[red[0]] + day[red[1]], mb = day[blue[0]] + day[blue[1]];
      const sr = mr + gauss(rand) * (noise.a + noise.b * mr), sb = mb + gauss(rand) * (noise.a + noise.b * mb);
      for (const t of sr > sb ? red : blue) rp[t] += 2;
      for (const t of red) pts[t] += sr;
      for (const t of blue) pts[t] += sb;
    }
  }
  let rank = 1;
  for (let t = 1; t < nt; t++) if (rp[t] > rp[0] || (rp[t] === rp[0] && pts[t] > pts[0])) rank++;
  return rank;
}

/** Share of runs in the top 4 and the median rank from a rank histogram (index 0 = rank 1). */
export function histStats(counts: number[]): { runs: number; top4: number | null; median: number | null } {
  const runs = counts.reduce((a, b) => a + b, 0);
  if (!runs) return { runs, top4: null, median: null };
  const top4 = counts.slice(0, 4).reduce((a, b) => a + b, 0) / runs;
  let acc = 0, median = counts.length;
  for (let i = 0; i < counts.length; i++) { acc += counts[i]; if (acc >= runs / 2) { median = i + 1; break; } }
  return { runs, top4, median };
}

/** Format a z-score with a real minus sign. */
export function fmtZ(z: number, digits = 2): string {
  const v = Math.abs(z) < 0.005 ? 0 : z;
  return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(digits);
}
