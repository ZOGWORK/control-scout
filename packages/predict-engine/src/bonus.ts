// Predict — bonus ranking points for one match, before it's played.
//
// The same math the event simulator (sim.ts) uses for an unplayed match: an
// alliance earns each bonus RP with probability logistic(c0 + c1 · its
// non-penalty score) (BonusModel), and its non-penalty score is Normal(the
// lineup's expected points, game noise + rating uncertainty), floored at 0.
// The simulator draws one score per run; here the same expectation is taken
// exactly, by integrating the logistic over that score distribution:
//
//   P(bonus) = E[ logistic(c0 + c1 · max(0, X)) ],  X ~ N(μ, σ²)
//
// Expected ranking points add the win RPs of rules.ts rankingPoints:
//   E[RP] = winRP · P(win) + Σ P(bonus)   (2025+: a win is 3, a tie 1; the
//   Gaussian model gives a tie no mass, so ties are left out).
//
// Pure: no network, no clock. Shared by Control Scout, Control Point and the
// event simulator's callers.
import type { BonusModel } from "./sim.js";
import type { BonusFlags } from "./inputs.js";

export const BONUS_SLOTS = ["movement", "goal", "pattern"] as const;
export type BonusSlot = (typeof BONUS_SLOTS)[number];

/** A bonus model plus where it came from: the shipped fit, or one fitted from this season's results so far. */
export interface BonusModelSource {
  model: BonusModel;
  /** "fitted": FITTED_MODEL.bonus (research pipeline). "season": fitBonusModel on the season's recorded results. */
  source: "fitted" | "season";
  /** Alliances the season fit learned from (null for a shipped fit). */
  samples: number | null;
}

/** One qualification alliance's result, for fitting a season's bonus model. */
export interface BonusSample { np: number; bonus: BonusFlags }

/** Fewest recorded alliances before a season fit is used at all (≈ 100 qualification matches). */
export const BONUS_MIN_SAMPLES = 200;

/**
 * A season fit learns from the season's latest this-many alliances only. How
 * much score it takes to earn a bonus drifts through a season; on the 2025–26
 * replay (fitted walk-forward, 212k calls) the latest 2,000 scored a Brier of
 * 0.1467 against 0.1597 for every alliance so far and 0.1781 for the shipped
 * whole-season fit.
 */
export const BONUS_WINDOW = 2000;

/**
 * The confidence rule for bonus odds (stated, not fitted). The tier is the
 * match's own tier, capped by how much the bonus model has learned from:
 * a season fit on fewer than `provisionalBelow` alliances is provisional,
 * fewer than `confidentMin` (a full window) at most moderate. A shipped fit doesn't cap.
 */
export const BONUS_CONFIDENCE_RULE = { provisionalBelow: 600, confidentMin: BONUS_WINDOW } as const;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

// Standard normal quadrature: composite Simpson on z ∈ [−8, 8], h = 0.05.
// Smooth integrand (the floor at 0 only bends it), so the error is far below
// the 4 decimal places anything is shown or stored with.
const Z: number[] = [];
const W: number[] = [];
{
  const n = 320, h = 16 / n;
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const z = -8 + i * h;
    const w = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * (h / 3) * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
    Z.push(z); W.push(w); total += w;
  }
  for (let i = 0; i < W.length; i++) W[i] /= total; // exactly 1 in total
}

/** P(bonus) for one alliance: E[logistic(c0 + c1 · max(0, X))], X ~ N(mean, sd²). */
export function bonusProbability(coef: readonly [number, number], mean: number, sd: number): number {
  const [c0, c1] = coef;
  if (!(sd > 0)) return logistic(c0 + c1 * Math.max(0, mean));
  let p = 0;
  for (let i = 0; i < Z.length; i++) p += W[i] * logistic(c0 + c1 * Math.max(0, mean + sd * Z[i]));
  return p;
}

/** Win and tie ranking points per season (as rules.ts rankingPoints counts them). */
export function winRankingPoints(season: number): { win: number; tie: number } {
  return season >= 2025 ? { win: 3, tie: 1 } : { win: 2, tie: 1 };
}

export interface AllianceBonusOdds {
  /** P(earning each bonus RP), in the engine's slot order (the season names them; server/data/seasons.ts). */
  p: Record<BonusSlot, number>;
  /** Expected bonus RPs (Σ p). */
  expectedBonus: number;
  /** Expected ranking points from the match: win RPs × P(win) + expected bonus RPs. */
  expectedRp: number;
}

/**
 * Bonus odds and expected RPs for one alliance: its non-penalty score
 * distribution (mean, sd: predictMatch's AlliancePrediction np and sd) and
 * its served win probability. Null before 2025 (no bonus RPs).
 */
export function allianceBonusOdds(season: number, model: BonusModel, np: { mean: number; sd: number }, pWin: number): AllianceBonusOdds | null {
  if (season < 2025) return null;
  const p = {} as Record<BonusSlot, number>;
  let sum = 0;
  for (const s of BONUS_SLOTS) { p[s] = bonusProbability(model[s], np.mean, np.sd); sum += p[s]; }
  return { p, expectedBonus: sum, expectedRp: winRankingPoints(season).win * pWin + sum };
}

/**
 * Fit a season's bonus model from its recorded qualification alliances:
 * one logistic regression per bonus RP on the alliance's non-penalty score
 * (the form of FITTED_MODEL.bonus). Newton's method on the standardised
 * score, with one pseudo-success and one pseudo-failure at the average score
 * and a unit ridge on the slope, so a bonus every alliance (or none) earned
 * stays finite. Null with fewer than BONUS_MIN_SAMPLES alliances.
 */
export function fitBonusModel(samples: BonusSample[], minSamples = BONUS_MIN_SAMPLES): BonusModel | null {
  const n = samples.length;
  if (n < Math.max(1, minSamples)) return null;
  let mu = 0;
  for (const s of samples) mu += s.np;
  mu /= n;
  let v = 0;
  for (const s of samples) v += (s.np - mu) ** 2;
  const sdx = Math.max(1, Math.sqrt(v / n));
  const xs = samples.map((s) => (s.np - mu) / sdx);
  const fit = (slot: BonusSlot): [number, number] => {
    let b0 = 0, b1 = 0;
    for (let it = 0; it < 100; it++) {
      // Gradient and Hessian of the penalised log-likelihood (pseudo-observations at x = 0).
      const p0 = logistic(b0);
      let g0 = (1 - p0) + (0 - p0), g1 = -b1;
      let h00 = 2 * p0 * (1 - p0), h01 = 0, h11 = 1;
      for (let i = 0; i < n; i++) {
        const x = xs[i], p = logistic(b0 + b1 * x), y = samples[i].bonus[slot] ? 1 : 0, w = p * (1 - p);
        g0 += y - p; g1 += (y - p) * x;
        h00 += w; h01 += w * x; h11 += w * x * x;
      }
      const det = h00 * h11 - h01 * h01;
      if (!(det > 0)) break;
      const d0 = (h11 * g0 - h01 * g1) / det, d1 = (h00 * g1 - h01 * g0) / det;
      b0 += d0; b1 += d1;
      if (Math.abs(d0) < 1e-10 && Math.abs(d1) < 1e-10) break;
    }
    // Back to the raw score: b0 + b1 · (np − mu) / sdx.
    return [b0 - (b1 * mu) / sdx, b1 / sdx];
  };
  return { movement: fit("movement"), goal: fit("goal"), pattern: fit("pattern") };
}

/** A fit to the latest BONUS_WINDOW of `samples` (oldest first), or null with fewer than BONUS_MIN_SAMPLES. */
export function recentBonusModel(samples: BonusSample[]): BonusModelSource | null {
  const xs = samples.length > BONUS_WINDOW ? samples.slice(-BONUS_WINDOW) : samples;
  const model = fitBonusModel(xs);
  return model ? { model, source: "season", samples: xs.length } : null;
}

/**
 * The bonus model for a season: a fit to its latest recorded qualification
 * alliances (`samples`, oldest first; recentBonusModel), else, early in a
 * season, the shipped fit (FITTED_MODEL.bonus, which the event simulator also
 * uses) when there is one. Null before 2025, or with neither.
 */
export function seasonBonusModel(fitted: Record<string, BonusModel> | undefined, season: number, samples: () => BonusSample[]): BonusModelSource | null {
  if (season < 2025) return null;
  const recent = recentBonusModel(samples());
  if (recent) return recent;
  const f = fitted?.[String(season)];
  return f ? { model: f, source: "fitted", samples: null } : null;
}

/**
 * The season's bonus model as it stood at `beforeMs`, for forecasts of a past
 * moment ("before the event"): fitted only to the qualification results played
 * before then (`matches`: the season's played matches, any order). Never the
 * shipped fit, which learned from the whole season. Null with too few results.
 */
export function bonusModelBefore(matches: { time: number; level: string; red: { np: number; bonusRp?: BonusFlags }; blue: { np: number; bonusRp?: BonusFlags } }[], beforeMs: number): BonusModelSource | null {
  return recentBonusModel(bonusSamples(matches.filter((m) => m.time < beforeMs).sort((a, b) => a.time - b.time)));
}

/** Bonus samples from played qualification matches (2-robot alliances with recorded bonus RPs). */
export function bonusSamples(matches: { level: string; red: { np: number; bonusRp?: BonusFlags }; blue: { np: number; bonusRp?: BonusFlags } }[]): BonusSample[] {
  const out: BonusSample[] = [];
  for (const m of matches) {
    if (m.level !== "qual") continue;
    for (const a of [m.red, m.blue]) if (a.bonusRp) out.push({ np: a.np, bonus: a.bonusRp });
  }
  return out;
}
