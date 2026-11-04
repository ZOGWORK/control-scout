// Predict — Layer 2: single-match prediction.
//
// Alliance score ~ Normal(mean, variance):
//   mean     = Σ robot (auto + TeleOp + endgame) + Σ opponent penalties committed
//   variance = (a + b·mean)²  (game randomness grows with score level)
//            + Σ robot rating uncertainty (we know new/early teams less well)
// P(red wins) = Φ((μr − μb) / √(σr² + σb²)) — the raw probability. Prediction
// Engine 2.0 then corrects it with the contextual model (contextual.ts) when
// the caller passes one and the book has reliability state; otherwise it is
// Platt-calibrated as in 1.x.
//
// Score ranges (2.2): the stated range around each expected score is drawn
// from its own predictive distribution, Normal(mean, bandSd²), where
//   bandSd² = (a + b·mean)² · scale · consistency^power · (1 + smallSample / (n + 1)) · [playoff]
//           + rating · Σ robot rating uncertainty
// consistency = the alliance's average per-team variance factor (each robot's
// EMA of squared standardized residuals; 1 = as variable as the model assumes)
// and n = the fewest matches any of its robots has played this season, so a
// range widens for erratic robots and small samples. Fitted on 2024–25 by the
// 80% interval score, tested on 2025–26; refitted the same way for 3.2, after
// 2.7–2.11 sharpened the expected scores (docs/engine/part12/bands.md). It never feeds the win probability:
// that still uses `sd`, so win odds are unchanged.
//
// Margin calibration (3.5): the model's expected margin is too wide (the real margin's slope on it is 0.90–0.94
// on every rolling window; docs/engine/gates/gate-3.5.0-margin-scale-*.md). The SERVED expected scores shrink toward their midpoint m = (red + blue) / 2:
//   red′ = m + s·(red − m),  blue′ = m − s·(m − blue)     (s = DEFAULT_MARGIN.scale = FITTED_MODEL.margin.scale)
// so the shown margin is s × the model's and the total is unchanged; each range keeps its sd and is recentred on
// the served score. This is presentation of the score only. EVERY probability reads the model's unscaled scores:
// the Gaussian win chance and the contextual model's inputs (predictOn computes them before serveScores runs),
// P(tie) and the bonus odds (explain.ts reads `modelMean`/`np`/`sd`), the factor sheet's log-odds (built from the
// unscaled phase split), and the event simulator (sim.ts draws from the ratings, never from a served score).
// A test (marginScale.test.ts) fails if any of them ever reads a served (scaled) score.
import type { RatingBook } from "./rating.js";
import { calibrateProb, type CalibrationParams } from "./calibration.js";
import { contextualWinProbWith, sigmoid, type ContextualModel, type MatchContext, type ProbabilityModel } from "./contextual.js";
import { PARTNERSHIP_PARAMS, partnershipShift, type PairLookup, type PartnershipParams } from "./partnership.js";

export interface NoiseParams {
  /** Score noise: σ = a + b·mean (fitted by likelihood on the tuning season). */
  a: number;
  b: number;
  /**
   * Extra per-robot variance (points²) when predicting ahead from an
   * event-start snapshot: a team's level can move during the event.
   */
  preExtra?: number;
}

export const DEFAULT_NOISE: NoiseParams = { a: 14, b: 0.21, preExtra: 0 };

/** How score ranges are drawn (FITTED_MODEL.band; see the header). */
export interface BandParams {
  /** Central probability of the stated range (0.8 = 80% of real scores should land inside). */
  level: number;
  /** Multiplier on the game-noise variance. */
  scale: number;
  /** Exponent on the alliance's per-team variance factor (0 = ignore it). */
  consistencyPower: number;
  /** Small-sample widening: game variance × (1 + smallSample / (fewest matches + 1)). */
  smallSample: number;
  /** Multiplier on the game-noise variance in playoff matches. */
  playoff: number;
  /** Multiplier on the summed rating uncertainty. */
  rating: number;
}

/** The fitted band (refitted for engine 3.2). FITTED_MODEL.band holds the same values (a test keeps them equal). */
export const DEFAULT_BAND: BandParams = { level: 0.8, scale: 0.92, consistencyPower: 0.66, smallSample: 0.85, playoff: 0.72, rating: 0.59 };

/** A stated score range: [lo, hi] should hold `level` of real scores (lo never below 0). */
export interface ScoreBand {
  level: number;
  lo: number;
  hi: number;
  /** sd of the predictive score distribution the range is drawn from. */
  sd: number;
}

/** One robot's inputs to score variance, read from the book now. */
export interface TeamScoreVariance {
  team: number;
  /** Rating uncertainty (points²): how well we know its level. */
  rating: number;
  /** Per-team variance factor: 1 = as variable match to match as the model assumes, 2 = twice the variance. */
  consistency: number;
  /** Matches folded into its rating this season. */
  matches: number;
}

/**
 * Predictive distribution of one alliance's final score. A Monte Carlo
 * consumer samples Normal(mean, sd²) (clipped at 0): the distribution every
 * stated score range is drawn from.
 */
export interface ScoreDistribution {
  mean: number;
  sd: number;
  /** Game-noise variance after the per-team, small-sample and playoff factors (points²). */
  gameVar: number;
  /** Rating-uncertainty variance (points²). */
  ratingVar: number;
  /** The alliance's average per-team variance factor. */
  consistency: number;
  /** Fewest matches any of its robots has played this season. */
  minMatches: number;
}

export interface AlliancePrediction {
  /** The SERVED expected score (engine 3.5: margin-calibrated around the match midpoint; see the header). Show this. */
  mean: number;
  /** The model's expected score before margin calibration (engine 3.5). Probabilities read this, never `mean`. */
  modelMean: number;
  /** sd behind the win probability (game noise + rating uncertainty; unchanged by the 2.2 ranges). */
  sd: number;
  np: number;
  /** The stated score range (engine 2.2+), centred on the served `mean` (3.5); its sd is the model's. */
  band: ScoreBand;
}

/** Margin calibration of the served expected scores (engine 3.5; FITTED_MODEL.margin). */
export interface MarginParams {
  /** Served margin = scale × the model's margin, total unchanged (1 = off, the 3.4 scores). */
  scale: number;
}

/** The fitted margin calibration. FITTED_MODEL.margin holds the same value (a test keeps them equal). */
export const DEFAULT_MARGIN: MarginParams = { scale: 0.95 };

/**
 * The served pair of expected scores from the model's (engine 3.5): both shrink toward their midpoint by `scale`,
 * so the margin scales and the total is unchanged. Display only: never feed the result to a probability.
 */
export function servedScores(red: number, blue: number, margin: MarginParams = DEFAULT_MARGIN): { red: number; blue: number } {
  if (margin.scale === 1) return { red, blue };
  const m = (red + blue) / 2;
  return { red: m + margin.scale * (red - m), blue: m - margin.scale * (m - blue) };
}

export interface MatchPrediction {
  red: AlliancePrediction;
  blue: AlliancePrediction;
  pRedWin: number;
  /** Raw Gaussian P(red wins) from the score gap, before any calibration. */
  pRaw?: number;
  /** Which probability model produced pRedWin ("legacy" = Platt-calibrated Gaussian). */
  model?: ProbabilityModel;
  /** The contextual parameter set's id, when model is "contextual". */
  modelId?: string;
  /** Shadow prediction (opts.shadow): another model's P(red wins) from the same book
   *  at the same moment, logged next to the served one so versions can be compared on
   *  identical matches and information. Never shown to users. */
  pShadow?: number;
  /** The shadow model's parameter set id ("legacy" if it couldn't run on this book). */
  shadowModelId?: string;
  /** Logit shift the partnership history applied to pRedWin (engine 2.4; absent = none). */
  partnershipShift?: number;
}

/** Partnership memory for a prediction (engine 2.4): the pair table and the season predicted. */
export interface PartnershipInput {
  table: PairLookup;
  season: number;
  /** Defaults to PARTNERSHIP_PARAMS. */
  params?: PartnershipParams;
}

export interface PredictOptions {
  /** Qualification or playoff (the contextual model uses it; default "qual"). */
  context?: MatchContext;
  /** Contextual probability model (FITTED_MODEL.contextual). Used when the
   *  book has this season's reliability state; otherwise the legacy
   *  calibrated probability is returned. Scores and ranges are unaffected. */
  contextual?: ContextualModel;
  /** A second contextual model to evaluate on the same inputs (see MatchPrediction.pShadow). */
  shadow?: ContextualModel;
  /** Pair history (partnership.ts). With β = 0 (the 2.2 settings) it never moves pRedWin. */
  partnership?: PartnershipInput;
  /** How score ranges are drawn (default DEFAULT_BAND, the same as FITTED_MODEL.band). */
  band?: BandParams;
  /** Margin calibration of the served scores (default DEFAULT_MARGIN, the same as FITTED_MODEL.margin). Never moves a probability. */
  margin?: MarginParams;
}

/** Standard normal CDF (Abramowitz–Stegun erf, |error| < 1.5e-7). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** z of the central interval holding `level` of a standard normal (exact for 80%, else bisection on phi). */
export function zFor(level: number): number {
  if (level === 0.8) return 1.2815515655446004;
  const target = 0.5 + level / 2;
  let lo = 0, hi = 8;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (phi(mid) < target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** A robot's variance inputs, read from the book now. */
export function teamScoreVariance(book: RatingBook, team: number): TeamScoreVariance {
  const r = book.get(team);
  return { team, rating: r.uncertainty, consistency: book.reliabilityOf(team).variance, matches: r.n };
}

/**
 * Game-noise variance (points²) of an alliance's score at expected level `mean`: (a + b·mean)² times
 * the band's scale, per-team consistency, small-sample and playoff factors (see the header).
 * `consistency` is the alliance's average per-team variance factor, `minMatches` the fewest matches
 * any of its robots has played. Shared by the score ranges and the event simulator (engine 2.6), so
 * both spread an alliance's score the same way.
 */
export function gameVariance(mean: number, consistency: number, minMatches: number, noise: NoiseParams = DEFAULT_NOISE, band: BandParams = DEFAULT_BAND, context: MatchContext = {}): number {
  const game = noise.a + noise.b * Math.max(0, mean);
  return game * game * band.scale * Math.max(1e-6, consistency) ** band.consistencyPower
    * (1 + band.smallSample / (minMatches + 1)) * (context.level === "playoff" ? band.playoff : 1);
}

function distributionOf(book: RatingBook, teams: number[], mean: number, uncertainty: number, noise: NoiseParams, band: BandParams, context: MatchContext): ScoreDistribution {
  const vs = teams.map((t) => teamScoreVariance(book, t));
  const consistency = vs.length ? vs.reduce((s, v) => s + v.consistency, 0) / vs.length : 1;
  const minMatches = vs.length ? Math.min(...vs.map((v) => v.matches)) : 0;
  const gameVar = gameVariance(mean, consistency, minMatches, noise, band, context);
  const ratingVar = band.rating * uncertainty;
  return { mean, sd: Math.sqrt(gameVar + ratingVar), gameVar, ratingVar, consistency, minMatches };
}

/**
 * Predictive distribution of the score alliance `own` puts up against `opp`
 * (penalties `opp` commits count for `own`). Pure: shared by predictMatch,
 * the explain contract and any simulator that wants per-team variance.
 */
export function allianceScoreDistribution(book: RatingBook, own: number[], opp: number[], noise: NoiseParams = DEFAULT_NOISE, band: BandParams = DEFAULT_BAND, context: MatchContext = {}): ScoreDistribution {
  const o = book.allianceExpectation(own, context.level ?? "qual"), x = book.allianceExpectation(opp, context.level ?? "qual");
  return distributionOf(book, own, o.np + x.pen, o.uncertainty, noise, band, context);
}

/** The central `level` range of Normal(mean, sd²), in whole points, never below 0. */
export function scoreBand(mean: number, sd: number, level = DEFAULT_BAND.level): ScoreBand {
  const z = zFor(level);
  return { level, lo: Math.max(0, Math.round(mean - z * sd)), hi: Math.max(0, Math.round(mean + z * sd)), sd };
}

export function predictMatch(book: RatingBook, red: number[], blue: number[], noise: NoiseParams = DEFAULT_NOISE, cal?: CalibrationParams, opts: PredictOptions = {}): MatchPrediction {
  return book.withRegion(opts.context?.region, () => book.withEvent(opts.context?.event, () => predictOn(book, red, blue, noise, cal, opts)));
}

function predictOn(book: RatingBook, red: number[], blue: number[], noise: NoiseParams, cal: CalibrationParams | undefined, opts: PredictOptions): MatchPrediction {
  const level = opts.context?.level ?? "qual";
  const r = book.allianceExpectation(red, level);
  const b = book.allianceExpectation(blue, level);
  const band = opts.band ?? DEFAULT_BAND;
  // ---- Probability path: everything from here to serveScores reads the MODEL scores (mean = modelMean).
  const side = (own: typeof r, opp: typeof r, teams: number[]): AlliancePrediction => {
    const mean = own.np + opp.pen;
    const game = noise.a + noise.b * Math.max(0, mean);
    const d = distributionOf(book, teams, mean, own.uncertainty, noise, band, opts.context ?? {});
    return { mean, modelMean: mean, np: own.np, sd: Math.sqrt(game * game + own.uncertainty), band: scoreBand(mean, d.sd, band.level) };
  };
  const rp = side(r, b, red), bp = side(b, r, blue);
  const raw = phi((rp.mean - bp.mean) / Math.sqrt(rp.sd ** 2 + bp.sd ** 2));
  const out: MatchPrediction = { red: rp, blue: bp, pRedWin: cal ? calibrateProb(raw, cal) : raw, pRaw: raw, model: "legacy" };
  // The contextual model corrects the RAW Gaussian probability (L = logit of
  // it), never the Platt-calibrated one: it carries its own calibration.
  const pc = contextualWinProbWith(opts.contextual, book, red, blue, { ...out, pRedWin: raw }, opts.context);
  if (pc != null) { out.pRedWin = pc.p; out.model = "contextual"; out.modelId = pc.model.id; }
  if (opts.partnership) {
    const shift = partnershipShift(opts.partnership.table, red, blue, opts.partnership.season, opts.partnership.params ?? PARTNERSHIP_PARAMS);
    if (shift) {
      const p = Math.max(1e-8, Math.min(1 - 1e-8, out.pRedWin));
      out.pRedWin = sigmoid(Math.log(p / (1 - p)) + shift);
      out.partnershipShift = shift;
    }
  }
  if (opts.shadow) {
    const ps = contextualWinProbWith(opts.shadow, book, red, blue, { ...out, pRedWin: raw }, opts.context);
    out.pShadow = ps ? ps.p : (cal ? calibrateProb(raw, cal) : raw);
    out.shadowModelId = ps ? ps.model.id : "legacy";
  }
  // ---- Served scores (3.5): every probability above is final; only the shown scores and range centres move.
  return serveScores(out, opts.margin ?? DEFAULT_MARGIN);
}

/** Margin-calibrate a finished prediction's expected scores and recentre its ranges (same sd). Probabilities untouched. */
function serveScores(p: MatchPrediction, margin: MarginParams): MatchPrediction {
  const s = servedScores(p.red.modelMean, p.blue.modelMean, margin);
  const at = (a: AlliancePrediction, mean: number): AlliancePrediction => ({ ...a, mean, band: scoreBand(mean, a.band.sd, a.band.level) });
  return { ...p, red: at(p.red, s.red), blue: at(p.blue, s.blue) };
}

/** The prediction as the probability paths must see it: the model's scores, never the served ones (engine 3.5). */
export function modelView(p: MatchPrediction): MatchPrediction {
  if (p.red.mean === p.red.modelMean && p.blue.mean === p.blue.modelMean) return p;
  return { ...p, red: { ...p.red, mean: p.red.modelMean }, blue: { ...p.blue, mean: p.blue.modelMean } };
}
