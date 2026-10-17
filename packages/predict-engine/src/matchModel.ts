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
import type { RatingBook } from "./rating.js";
import { calibrateProb, type CalibrationParams } from "./calibration.js";
import { contextualWinProbWith, type ContextualModel, type MatchContext, type ProbabilityModel } from "./contextual.js";

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

export interface AlliancePrediction {
  mean: number;
  sd: number;
  np: number;
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
}

/** Standard normal CDF (Abramowitz–Stegun erf, |error| < 1.5e-7). */
export function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function predictMatch(book: RatingBook, red: number[], blue: number[], noise: NoiseParams = DEFAULT_NOISE, cal?: CalibrationParams, opts: PredictOptions = {}): MatchPrediction {
  const r = book.allianceExpectation(red);
  const b = book.allianceExpectation(blue);
  const side = (own: typeof r, opp: typeof r): AlliancePrediction => {
    const mean = own.np + opp.pen;
    const game = noise.a + noise.b * Math.max(0, mean);
    return { mean, np: own.np, sd: Math.sqrt(game * game + own.uncertainty) };
  };
  const rp = side(r, b), bp = side(b, r);
  const raw = phi((rp.mean - bp.mean) / Math.sqrt(rp.sd ** 2 + bp.sd ** 2));
  const out: MatchPrediction = { red: rp, blue: bp, pRedWin: cal ? calibrateProb(raw, cal) : raw, pRaw: raw, model: "legacy" };
  // The contextual model corrects the RAW Gaussian probability (L = logit of
  // it), never the Platt-calibrated one: it carries its own calibration.
  const pc = contextualWinProbWith(opts.contextual, book, red, blue, { ...out, pRedWin: raw }, opts.context);
  if (pc != null) { out.pRedWin = pc.p; out.model = "contextual"; out.modelId = pc.model.id; }
  if (opts.shadow) {
    const ps = contextualWinProbWith(opts.shadow, book, red, blue, { ...out, pRedWin: raw }, opts.context);
    out.pShadow = ps ? ps.p : (cal ? calibrateProb(raw, cal) : raw);
    out.shadowModelId = ps ? ps.model.id : "legacy";
  }
  return out;
}
