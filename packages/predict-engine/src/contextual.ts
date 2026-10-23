// Predict — the contextual win probability (engine 2.0+).
//
// A small residual logistic model around the score model's raw win
// probability. It keeps the score model's means, ranges and ratings exactly
// as they are, and corrects only P(win) using things the Gaussian score gap
// doesn't see: the balance of auto / endgame / penalties, how lopsided each
// alliance is, experience, time since each robot last played, rating
// uncertainty, qualification vs playoff, and three causal reliability
// proxies per robot (RatingBook.reliabilityOf).
//
//   L      = logit(raw Gaussian P(red wins)), clamped to [1e-9, 1 − 1e-9]
//   z      = L + Σ_i coefficient_i · D_i / scale_i      (17 features, below)
//   p_raw  = clamp(sigmoid(z), 1e-8, 1 − 1e-8)
//   P(red) = sigmoid(slope · logit(p_raw) + intercept)
//
// Coefficients were fitted on 2023–24 seasons, chosen on Jan–Feb 2025
// development data, calibrated on Mar–May 2025 and frozen before the 2025–26
// season was evaluated (+1.97 points winner accuracy on 37,140 held-out
// non-tied matches; see CHANGELOG 2.0.0). Do not refit them on that season.
import type { RatingBook, ReliabilityState } from "./rating.js";
import type { MatchPrediction } from "./matchModel.js";

export interface ContextualModel {
  kind: "contextual-logistic-reliability";
  /** Identifies the frozen parameter set (recorded with predictions). */
  id: string;
  /** 17 = engine 2.0 inputs (state version ≥ 1); 22 = engine 2.1 (needs state version 2). */
  coefficients: number[];
  scale: number[];
  calibration: { slope: number; intercept: number };
  /** Used when a book's state is too old for this model (2.1 → the 2.0 model). */
  fallback?: ContextualModel;
  /** Engine 2.8: a final calibration per slice of the match, applied after `calibration`. */
  sliceCalibration?: SliceCalibration;
}

/**
 * Engine 2.8: per-slice recalibration. Matches fall into cells by level
 * (qual / playoff) and by how much data the four robots bring (the sum of
 * their rated matches this season: thin below densityCuts[0], dense from
 * densityCuts[1]). Each cell maps P(red) = sigmoid(slope · logit(p) + intercept),
 * fitted forward on earlier seasons and shrunk toward the global mapping;
 * a cell it has no fit for uses `global`.
 */
export interface SliceCalibration {
  densityCuts: [number, number];
  global: { slope: number; intercept: number };
  cells: Record<string, { slope: number; intercept: number; n: number }>;
  provenance?: Record<string, unknown>;
}

/** The recalibration cell of a match: "<level>|<thin|normal|dense>". */
export function sliceCell(book: RatingBook, red: number[], blue: number[], ctx: MatchContext, cuts: [number, number]): string {
  const n = [...red, ...blue].reduce((a, t) => a + book.get(t).n, 0);
  return `${ctx.level ?? "qual"}|${n < cuts[0] ? "thin" : n < cuts[1] ? "normal" : "dense"}`;
}

/** Apply a slice calibration to a probability. */
export function applySliceCalibration(sc: SliceCalibration, p: number, cell: string): number {
  const m = sc.cells[cell] ?? sc.global;
  return sigmoid(m.slope * logit(clampP(p, 1e-9)) + m.intercept);
}

/** What the probability model needs to know about a match beyond its lineups. */
export interface MatchContext {
  /** Qualification or playoff. The generic what-if default is "qual". */
  level?: "qual" | "playoff";
  /** Event code of the match (in-event form, engine 2.1). Missing for a generic
   *  what-if: no robot then has form at "this" event. */
  event?: string;
}

/** State version a model's inputs need. */
export const requiredState = (m: ContextualModel) => (m.coefficients.length > 17 ? 2 : 1);

/** Which model produced a win probability. */
export type ProbabilityModel = "contextual" | "legacy";

const DAY = 864e5;
const clampP = (p: number, eps: number) => Math.max(eps, Math.min(1 - eps, p));
const logit = (p: number) => Math.log(p / (1 - p));

export function sigmoid(x: number): number {
  if (x >= 0) { const e = Math.exp(-x); return 1 / (1 + e); }
  const e = Math.exp(x); return e / (1 + e);
}

/**
 * The 17 model inputs for red vs blue, from the book as it stands now (all
 * of it learned from earlier results only). Returns null for lineups the
 * model was never fitted on (an empty alliance). `raw.pRedWin` must be the
 * raw (uncalibrated) Gaussian probability.
 */
export function contextualFeatures(book: RatingBook, red: number[], blue: number[], raw: MatchPrediction, ctx: MatchContext = {}, inputs = 17): number[] | null {
  if (!red.length || !blue.length) return null;
  const r = red.map((t) => book.get(t)), b = blue.map((t) => book.get(t));
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  const np = (x: { auto: number; teleop: number; endgame: number }) => x.auto + x.teleop + x.endgame;
  const days = (x: { asOf?: number }) => Math.max(0, Math.min(120, (book.now - (x.asOf ?? book.now)) / DAY));
  const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const L = logit(clampP(raw.pRedWin, 1e-9));
  const S = Math.sqrt(raw.red.sd ** 2 + raw.blue.sd ** 2);
  const uR = sum(r, (x) => x.uncertainty), uB = sum(b, (x) => x.uncertainty);
  const all = [...r, ...b];
  const nMin = Math.min(...all.map((x) => x.n));
  const maxGap = Math.max(...all.map(days));
  const unknown = all.filter((x) => !x.n).length;
  const totalStrength = Math.log1p(Math.max(0, raw.red.np + raw.blue.np));
  const playoff = ctx.level === "playoff" ? 1 : 0;
  const rel = (teams: number[]) => {
    const xs: ReliabilityState[] = teams.map((t) => book.reliabilityOf(t));
    return { bias: sum(xs, (x) => x.bias) / xs.length, variance: sum(xs, (x) => x.variance) / xs.length, failure: sum(xs, (x) => x.failure) / xs.length };
  };
  const qR = rel(red), qB = rel(blue);
  const base = [
    (sum(r, (x) => x.auto) - sum(b, (x) => x.auto)) / S,                       // D1 auto gap
    (sum(r, (x) => x.endgame) - sum(b, (x) => x.endgame)) / S,                 // D2 endgame gap
    (sum(b, (x) => x.pen) - sum(r, (x) => x.pen)) / S,                         // D3 penalties (blue − red)
    (spread(r.map(np)) - spread(b.map(np))) / Math.max(20, raw.red.np + raw.blue.np), // D4 partner spread
    sum(r, (x) => Math.log1p(x.n)) - sum(b, (x) => Math.log1p(x.n)),           // D5 experience
    (sum(r, days) - sum(b, days)) / 60,                                         // D6 days since last match
    (uR - uB) / Math.max(1, uR + uB),                                           // D7 rating uncertainty
    L * playoff,                                                                // D8
    L / (1 + nMin / 5),                                                         // D9
    L * Math.log1p(maxGap) / 5,                                                 // D10
    L * unknown / 4,                                                            // D11
    L * (totalStrength - 5),                                                    // D12
    qR.bias - qB.bias,                                                          // D13
    qR.variance - qB.variance,                                                  // D14
    qR.failure - qB.failure,                                                    // D15
    L * Math.log(Math.max(0.1, (qR.variance + qB.variance) / 2)),               // D16
    L * (qR.failure + qB.failure),                                              // D17
  ];
  if (inputs <= 17) return base;
  // Engine 2.1: in-event form, momentum, collapse recency (state version 2).
  const states = (teams: number[]) => teams.map((t) => book.reliabilityOf(t));
  const sR = states(red), sB = states(blue);
  const avg = (xs: ReliabilityState[], f: (x: ReliabilityState) => number) => xs.reduce((a, x) => a + f(x), 0) / xs.length;
  const atEvent = (x: ReliabilityState) => ctx.event != null && x.eventCode === ctx.event;
  const form = (x: ReliabilityState) => (atEvent(x) ? (x.eventSum ?? 0) / ((x.eventN ?? 0) + 2) : 0);
  const minEventN = Math.min(...[...sR, ...sB].map((x) => (atEvent(x) ? x.eventN ?? 0 : 0)));
  return [...base,
    avg(sR, form) - avg(sB, form),                                              // D18 in-event form
    L * Math.log1p(minEventN),                                                  // D19
    avg(sR, (x) => (x.fast ?? 0) - x.bias) - avg(sB, (x) => (x.fast ?? 0) - x.bias), // D20 momentum
    avg(sR, (x) => x.lastFail ?? 0) - avg(sB, (x) => x.lastFail ?? 0),          // D21 last match collapsed
    avg(sR, (x) => Math.log1p(Math.min(10, x.sinceFail ?? 10))) - avg(sB, (x) => Math.log1p(Math.min(10, x.sinceFail ?? 10))), // D22 recovery
  ];
}

/** P(red wins) from the logit of the raw Gaussian probability and the features. */
export function contextualProbability(model: ContextualModel, L: number, features: number[]): number {
  if (features.length !== model.coefficients.length || features.some((v) => !Number.isFinite(v))) throw new Error("Invalid contextual inputs");
  let z = L;
  for (let i = 0; i < features.length; i++) z += (features[i] / model.scale[i]) * model.coefficients[i];
  const raw = clampP(sigmoid(z), 1e-8);
  return sigmoid(model.calibration.slope * logit(raw) + model.calibration.intercept);
}

/**
 * The contextual P(red wins), or null when it can't be used: the book has
 * no reliability history for this season (legacy data) or the lineup is
 * unsupported. Callers then use the legacy calibrated probability.
 */
export function contextualWinProb(model: ContextualModel | undefined, book: RatingBook, red: number[], blue: number[], raw: MatchPrediction, ctx: MatchContext = {}): number | null {
  return contextualWinProbWith(model, book, red, blue, raw, ctx)?.p ?? null;
}

/** The contextual probability and the model that produced it (the model, or its
 *  fallback when the book's state is too old for it); null when neither applies. */
export function contextualWinProbWith(model: ContextualModel | undefined, book: RatingBook, red: number[], blue: number[], raw: MatchPrediction, ctx: MatchContext = {}): { p: number; model: ContextualModel } | null {
  if (!model || !book.reliabilityReady) return null;
  if (book.stateVersion < requiredState(model)) return model.fallback ? contextualWinProbWith(model.fallback, book, red, blue, raw, ctx) : null;
  const x = contextualFeatures(book, red, blue, raw, ctx, model.coefficients.length);
  if (!x || x.some((v) => !Number.isFinite(v))) return null;
  const p = contextualProbability(model, logit(clampP(raw.pRedWin, 1e-9)), x);
  const sc = model.sliceCalibration;
  return { p: sc ? applySliceCalibration(sc, p, sliceCell(book, red, blue, ctx, sc.densityCuts)) : p, model };
}
