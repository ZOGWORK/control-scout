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
// Expected ranking points add the win and tie RPs of rules.ts rankingPoints
// (2025+: a win is 3, a tie 1; before: 2 and 1), with the outcome three-way
// (engine 3.1): P(tie) = TIE_RULE.width · the density of the predicted
// final-score margin at 0, and the served win probability p counts a tie as
// half a win (as every replay scores it), so
//   P(win) = p − P(tie)/2,   E[RP] = winRP · P(win) + tieRP · P(tie) + Σ P(bonus).
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

/**
 * Ties (engine 3.1, Part 12.6): a qualification match ties with probability width · the density of the
 * final-score margin at 0. Fitted on 2021–22 to 2024–25 quals (one width predicts each season's tie rate,
 * about 0.75%, and the rate across closeness quintiles; docs/engine/part12/ties.md). Ties move ranking points
 * and the event simulator's standings only; the headline win probability is unchanged.
 */
export const TIE_RULE = { width: 1.135 } as const;

/** P(tie) for a match whose final-score margin is Normal(mean, sd²), capped so P(win) and P(loss) stay ≥ 0 given p. */
export function tieProbability(margin: { mean: number; sd: number }, p: number, width: number = TIE_RULE.width): number {
  if (!(margin.sd > 0) || width <= 0) return 0;
  const z = margin.mean / margin.sd;
  return Math.max(0, Math.min((width * Math.exp(-0.5 * z * z)) / (Math.sqrt(2 * Math.PI) * margin.sd), 2 * Math.min(p, 1 - p)));
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
  /** Expected ranking points from the match: win RPs × P(win) + tie RPs × P(tie) + expected bonus RPs. */
  expectedRp: number;
}

/**
 * Bonus odds and expected RPs for one alliance: its non-penalty score
 * distribution (mean, sd: predictMatch's AlliancePrediction np and sd), its
 * served win probability (a tie counted half) and the match's P(tie)
 * (tieProbability; 0 leaves ties out, as before 3.1). Null before 2025 (no bonus RPs).
 */
export function allianceBonusOdds(season: number, model: BonusModel, np: { mean: number; sd: number }, pWin: number, pTie = 0): AllianceBonusOdds | null {
  if (season < 2025) return null;
  const p = {} as Record<BonusSlot, number>;
  let sum = 0;
  for (const s of BONUS_SLOTS) { p[s] = bonusProbability(model[s], np.mean, np.sd); sum += p[s]; }
  return { p, expectedBonus: sum, expectedRp: expectedOutcomeRp(season, pWin, pTie) + sum };
}

/** Expected win-and-tie ranking points of one alliance: p its win probability (a tie counted half), pTie the match's. */
export function expectedOutcomeRp(season: number, p: number, pTie = 0): number {
  const { win, tie } = winRankingPoints(season);
  return win * (p - pTie / 2) + tie * pTie;
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
export function bonusModelBefore(matches: BonusMatch[], beforeMs: number): BonusModelSource | null {
  const h = new BonusHistory();
  for (const m of [...matches].sort((a, b) => a.time - b.time)) h.add(m);
  return h.modelBefore(beforeMs);
}

type BonusMatch = { time: number; level: string; red: { np: number; bonusRp?: BonusFlags }; blue: { np: number; bonusRp?: BonusFlags } };

/**
 * A season's played qualification results in time order, answering "the bonus
 * model as it stood at time t" with one rule: only results whose match started
 * strictly before t count. A result at the same time as the match being
 * predicted (another field, a shared schedule slot) was not known yet, even if
 * it was added first. Shared by bonusModelBefore and walk-forward replays, so
 * the two can't disagree.
 */
export class BonusHistory {
  private readonly times: number[] = [];
  private readonly samples: BonusSample[] = [];

  /** Add a played match (in nondecreasing time order). */
  add(m: BonusMatch): void {
    const last = this.times.length ? this.times[this.times.length - 1] : -Infinity;
    if (m.time < last) throw new Error("BonusHistory.add: matches must be added in time order");
    for (const s of bonusSamples([m])) { this.times.push(m.time); this.samples.push(s); }
  }

  /** Alliances recorded strictly before `t`. */
  countBefore(t: number): number {
    let lo = 0, hi = this.times.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.times[mid] < t) lo = mid + 1; else hi = mid; }
    return lo;
  }

  /** recentBonusModel of the alliances recorded strictly before `t`. */
  modelBefore(t: number): BonusModelSource | null {
    const n = this.countBefore(t);
    return recentBonusModel(this.samples.slice(Math.max(0, n - BONUS_WINDOW), n));
  }
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
