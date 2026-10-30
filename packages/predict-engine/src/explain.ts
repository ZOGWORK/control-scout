// Predict — the public match contract: win odds, expected scores with 80%
// ranges (drawn from matchModel's per-alliance score distribution),
// the top 3 factors behind the call, and a confidence tier.
//
// Built on predictMatch (no second model): the factors are an exact split of
// the predicted margin, so they always add up to the gap between the two
// expected scores —
//   margin = Σ_c (A_c − B_c) over auto / TeleOp / endgame
//          + (B's penalties committed − A's penalties committed)
// (penalties a side commits are added to the other side's score).
//
// The confidence tier says how much of the call rests on real matches rather
// than priors. Its thresholds are a stated rule, not a fitted value — see
// CONFIDENCE_RULE — and are checked against the calibration ledger.
import { predictMatch, type BandParams, type MatchPrediction, type NoiseParams, type PartnershipInput, type ScoreBand } from "./matchModel.js";
import { PARTNERSHIP_PARAMS, partnershipFact, type PartnershipFact } from "./partnership.js";
import type { CalibrationParams } from "./calibration.js";
import { contextualFeatures, contextualModelById, contextualTerms, type ContextualModel, type MatchContext, type ProbabilityModel } from "./contextual.js";
import type { RatingBook } from "./rating.js";
import type { Component, TeamRating } from "./types.js";
import { allianceBonusOdds, BONUS_CONFIDENCE_RULE, tieProbability, type AllianceBonusOdds, type BonusModelSource } from "./bonus.js";

export type ConfidenceTier = "provisional" | "moderate" | "confident";

/** The rule behind the tier (shown on methodology pages; not fitted). */
export const CONFIDENCE_RULE = {
  /** Fewer matches than this for any robot → provisional. */
  provisionalBelow: 3,
  /** Every robot needs at least this many matches for confident… */
  confidentMinMatches: 8,
  /** …and rating uncertainty must be under this share of the outcome variance. */
  confidentMaxRatingShare: 0.15,
} as const;

export interface Factor {
  id: Component;
  /** Signed points toward side A (negative = favours B). */
  points: number;
  favors: "A" | "B" | "even";
  /** Plain-language sentence, e.g. "Red's autonomous is worth about 14 more points". */
  label: string;
}

/** The factor sheet's entries (engine 3.3): the four phases, the win model's grouped inputs, and words-only reasons. */
export type SheetFactorId = Component | "pointMix" | "form" | "momentum" | "reliability" | "partners" | "experience" | "certainty" | "schedule" | "headToHead";

export interface SheetFactor {
  id: SheetFactorId;
  /** phase: a split of the predicted margin; model: the win model's other inputs; reason: words only, weight 0. */
  kind: "phase" | "model" | "reason";
  /** Short name, e.g. "Autonomous", "Momentum". */
  name: string;
  /** One plain sentence. Phases carry the same sentence as `factors`. */
  label: string;
  favors: "A" | "B" | "even";
  /** Log-odds toward A this factor adds to the served call (0 for reasons: they never move the odds). */
  logit: number;
  /** Share of the call: |logit| over the sum of every entry's |logit| (0-1; the weights add up to 1). */
  weight: number;
  /** Phases: signed points toward A, the same number as in `factors`. */
  points?: number;
}

/**
 * Every factor behind a call, each with its weight (engine 3.3). The entries' log-odds add up exactly to
 * logit(winProbA): the score gap is split across the four phases in proportion to their points, the
 * contextual model's inputs are grouped into plain factors, and whatever the calibration adds (and the
 * clamps take) sits with "How sure the data is". Built from the served numbers; it never changes them.
 */
export interface FactorSheet {
  probabilityModel: ProbabilityModel;
  /** logit(winProbA), clamped at 1e-12 from 0 and 1: the sum of every entry's logit. */
  logit: number;
  /** All four phases, ranked as `factors` (which are the first three, field for field). */
  phases: SheetFactor[];
  /** The win model's other inputs, grouped, largest weight first (legacy model: at most the calibration). */
  model: SheetFactor[];
  /** Words only, weight 0: schedule strength, and with opts.partnership the robots' history. */
  reasons: SheetFactor[];
}

export interface TeamStrength {
  team: number;
  /** Expected non-penalty points this robot adds to its alliance. */
  np: number;
  auto: number;
  teleop: number;
  endgame: number;
  /** Expected penalty points it gives away per match. */
  pen: number;
  /** Matches folded into its rating this season. */
  matches: number;
  /** ± points (1 sd) of rating uncertainty. */
  sd: number;
  /** Per-team variance factor (1 = as variable match to match as the model assumes); widens score ranges. */
  consistency: number;
}

/**
 * A robot's recent record as the app measured it (Control Scout: its reliability index, from public match
 * data). Read only to write reasons: it never changes a probability or a score.
 */
export interface RecentRecord {
  /** Latest listed qualification matches looked at (usually 10). */
  matches: number;
  /** Of those: listed but not on the field. */
  noShows: number;
  /** Of those: estimated near-zero contribution (alliance score minus the partner's OPR came to almost nothing). */
  nearZero: number;
}

/** A reason is notable from this many no-shows / near-zero matches in the recent window. */
export const REASON_RULE = { noShows: 2, nearZero: 3 } as const;

/** Event-local form (engine 2.9) is worth a reason from this many points, and this share of the robot's usual strength. */
export const EVENT_FORM_RULE = { points: 5, share: 0.1 } as const;

/**
 * "Team 1234 is playing about 9 points above its usual level here (4 matches)": robots whose form at this
 * event moves their expected contribution notably (RatingBook.eventOffset). The adjustment is in the
 * prediction already; this only names it.
 */
export function eventFormReasons(book: RatingBook, teams: number[], event: string | undefined): string[] {
  if (!event) return [];
  const out: string[] = [];
  for (const t of teams) {
    const s = book.eventFormOf(t);
    if (!s || !book.eventOffset(t, event)) continue;
    // What the prediction actually uses (each phase stops at zero) against the permanent rating.
    const np = (r: { auto: number; teleop: number; endgame: number }) => r.auto + r.teleop + r.endgame;
    const usual = np(book.permanent(t)), pts = book.withEvent(event, () => np(book.get(t))) - usual;
    if (Math.abs(pts) < Math.max(EVENT_FORM_RULE.points, EVENT_FORM_RULE.share * usual)) continue;
    out.push(`Team ${t} is playing about ${Math.round(Math.abs(pts))} points ${pts > 0 ? "above" : "below"} its usual level at this event (${s.n} match${s.n === 1 ? "" : "es"} here)`);
  }
  return out;
}

/**
 * The notable recent-record reasons for a lineup, in lineup order (at most one per robot: no-shows first).
 * The same sentences explainMatch returns; exported for apps that build their own match rows (a forecast's
 * matches) and want the reasons without a second explanation.
 */
export function recentReasons(teams: number[], recent: (team: number) => RecentRecord | null): string[] {
  const out: string[] = [];
  for (const t of teams) {
    const r = recent(t);
    if (!r || !r.matches) continue;
    if (r.noShows >= REASON_RULE.noShows) out.push(`Team ${t} was a no-show in ${r.noShows} of its last ${r.matches} matches`);
    else if (r.nearZero >= REASON_RULE.nearZero) out.push(`Team ${t}'s alliance scored about what its partner alone would in ${r.nearZero} of its last ${r.matches} matches (an estimate: defense or a carry looks the same)`);
  }
  return out;
}

export interface MatchExplanation {
  winProbA: number;
  winProbB: number;
  predictedScoreA: number;
  predictedScoreB: number;
  /** Central range of each final score: scoreBandA.level (80%) of real scores should land inside. */
  scoreRangeA: [number, number];
  scoreRangeB: [number, number];
  /** The full stated ranges: level, bounds and the sd they are drawn from (engine 2.2+). */
  scoreBandA: ScoreBand;
  scoreBandB: ScoreBand;
  /** Half-width of each range in whole points, for "118 ± 14". */
  scorePlusMinusA: number;
  scorePlusMinusB: number;
  factors: Factor[];
  confidence: { tier: ConfidenceTier; reason: string; minMatches: number; ratingShare: number };
  /** Which model produced the win odds ("legacy" when the book has no reliability state). */
  probabilityModel: ProbabilityModel;
  /** The contextual parameter set's id (null for the legacy model). */
  probabilityModelId: string | null;
  /** opts.shadow: the shadow model's P(A wins) on the same inputs, and its id (else null). */
  shadow: { winProbA: number; modelId: string } | null;
  /** The strongest real history between these robots (played together or against each
   *  other, any season since 2019–20), when opts.partnership is given and a pair has met. */
  partnership: PartnershipFact | null;
  /** Every factor with its weight in the call (engine 3.3). `factors` are its top three phases. */
  factorSheet: FactorSheet;
  teamsA: TeamStrength[];
  teamsB: TeamStrength[];
  /** Points each alliance loses to overlap per phase (engine 2.11; zeros in playoffs or when off). With the
   *  teams' strengths, these make the factors an exact split of the predicted margin. */
  overlapA: { auto: number; teleop: number; endgame: number };
  overlapB: { auto: number; teleop: number; endgame: number };
  /**
   * Notable reasons beyond the factors: a robot's form at this event (2.9, already in the prediction), and with
   * opts.recent e.g. "Team 1234 was a no-show in 2 of its last 10 matches". Empty when nothing is notable.
   * Words only: no probability or score depends on them.
   */
  reasons: string[];
  /** opts.bonus (a qualification match of a 2025+ season with a bonus model): each alliance's
   *  bonus-RP odds and expected ranking points (bonus.ts), with their own confidence. Else null. */
  bonus: MatchBonusOdds | null;
}

export interface MatchBonusOdds {
  A: AllianceBonusOdds;
  B: AllianceBonusOdds;
  /** P(the match ties) (bonus.ts tieProbability, engine 3.1): its expected RPs count a tie's RP. */
  pTie: number;
  /** The match's tier, capped by how much the bonus model has learned from (BONUS_CONFIDENCE_RULE). */
  confidence: { tier: ConfidenceTier; reason: string };
  source: BonusModelSource["source"];
  samples: number | null;
}

export interface ExplainOptions {
  noise?: NoiseParams;
  calibration?: CalibrationParams;
  /** Contextual win-probability model (FITTED_MODEL.contextual) and the match's context. */
  contextual?: ContextualModel;
  context?: MatchContext;
  /** A second model evaluated on the same inputs, for side-by-side logging. */
  shadow?: ContextualModel;
  /** A robot's recent record (no-shows, near-zero matches), for reasons only; null when unknown. */
  recent?: (team: number) => RecentRecord | null;
  /** Pair history (engine 2.4): adds the partnership fact, and its shift on the odds (none at β = 0). */
  partnership?: PartnershipInput;
  /** How score ranges are drawn (FITTED_MODEL.band; the default holds the same values). */
  band?: BandParams;
  /** Names used in factor sentences (default "Red" / "Blue"). */
  nameA?: string;
  nameB?: string;
  /** Bonus ranking points (2025+ qualification matches): the season and its bonus model. */
  bonus?: { season: number; model: BonusModelSource };
}

const TIER_ORDER: ConfidenceTier[] = ["provisional", "moderate", "confident"];

function bonusOdds(season: number, src: BonusModelSource, p: { red: { mean: number; np: number; sd: number }; blue: { mean: number; np: number; sd: number } }, pA: number, match: { tier: ConfidenceTier; reason: string }): MatchBonusOdds | null {
  // A bonus is earned on the alliance's own non-penalty points: their mean is the lineup's np, their spread
  // the score's game noise + rating uncertainty (the event simulator draws them the same way).
  // A tie (engine 3.1) is priced on the final-score margin: the two alliances' totals, their spreads combined.
  const pTie = tieProbability({ mean: p.red.mean - p.blue.mean, sd: Math.hypot(p.red.sd, p.blue.sd) }, pA);
  const A = allianceBonusOdds(season, src.model, { mean: p.red.np, sd: p.red.sd }, pA, pTie);
  const B = allianceBonusOdds(season, src.model, { mean: p.blue.np, sd: p.blue.sd }, 1 - pA, pTie);
  if (!A || !B) return null;
  const R = BONUS_CONFIDENCE_RULE;
  const n = src.samples;
  const cap: ConfidenceTier = src.source === "fitted" || n == null ? "confident" : n < R.provisionalBelow ? "provisional" : n < R.confidentMin ? "moderate" : "confident";
  const capped = TIER_ORDER.indexOf(cap) < TIER_ORDER.indexOf(match.tier);
  const reason = capped
    ? `This season's bonus model has learned from only ${n!.toLocaleString("en-US")} alliance results so far.`
    : src.source === "season" && n != null
      ? `${match.reason} Bonus odds learn from ${n.toLocaleString("en-US")} of this season's alliance results.`
      : match.reason;
  return { A, B, pTie, confidence: { tier: capped ? cap : match.tier, reason }, source: src.source, samples: n };
}

const COMPONENT_WORDS: Record<Component, string> = {
  auto: "autonomous",
  teleop: "TeleOp scoring",
  endgame: "endgame",
  pen: "penalty discipline",
};

const npOf = (r: TeamRating) => r.auto + r.teleop + r.endgame;
const round1 = (x: number) => Math.round(x * 10) / 10;

function strength(book: RatingBook, team: number): TeamStrength {
  const r = book.get(team);
  return { team, np: npOf(r), auto: r.auto, teleop: r.teleop, endgame: r.endgame, pen: r.pen, matches: r.n, sd: Math.sqrt(r.uncertainty), consistency: book.reliabilityOf(team).variance };
}

/** The robot carrying a component for its side, and how far above the season average it is. */
function carrier(side: TeamStrength[], c: Exclude<Component, "pen">, base: number | null): string {
  const top = [...side].sort((a, b) => b[c] - a[c])[0];
  if (!top || top[c] < 1) return "";
  const ratio = base && base > 0.5 ? top[c] / base : null;
  return ratio && ratio >= 1.5
    ? ` — Team ${top.team}'s ${COMPONENT_WORDS[c]} rating is ${ratio.toFixed(1)}× the season average`
    : ` (led by Team ${top.team}, ~${Math.round(top[c])} pts)`;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** A sheet to store or send: log-odds and weights to 4 places (about 0.01 percentage points). */
export function compactFactorSheet(s: FactorSheet): FactorSheet {
  const entry = (f: SheetFactor): SheetFactor => ({ ...f, logit: r4(f.logit), weight: r4(f.weight) });
  return { probabilityModel: s.probabilityModel, logit: r4(s.logit), phases: s.phases.map(entry), model: s.model.map(entry), reasons: s.reasons.map(entry) };
}

const PHASE_NAMES: Record<Component, string> = { auto: "Autonomous", teleop: "TeleOp", endgame: "Endgame", pen: "Penalties" };

type ModelFactorId = Exclude<SheetFactorId, Component | "schedule" | "headToHead">;

/** The contextual model's inputs (contextualFeatures order, D1–D22) and the factor each one belongs to. */
const INPUT_FACTOR: ModelFactorId[] = [
  "pointMix", "pointMix", "pointMix", // D1–D3 auto / endgame / penalty gaps, on top of their points
  "partners", // D4 how unevenly each alliance's robots score
  "experience", "experience", "experience", // D5–D7 matches played, days since the last match, rating uncertainty
  "certainty", "certainty", "certainty", "certainty", "certainty", // D8–D12 how far to trust the score gap
  "form", // D13 beating its rating this season
  "reliability", "reliability", // D14–D15 consistency, collapse rate
  "certainty", "certainty", // D16–D17
  "form", // D18 form at this event
  "certainty", // D19
  "momentum", // D20 the last few matches against the season
  "reliability", "reliability", // D21–D22 last match collapsed, matches since
];

const MODEL_NAMES: Record<ModelFactorId, string> = {
  pointMix: "Where the points come from", form: "Form", momentum: "Momentum", reliability: "Reliability",
  partners: "Partner balance", experience: "Experience and rest", certainty: "How sure the data is",
};

/** Below this many log-odds (about a quarter point near 50%) a model factor reads as even. */
const EVEN_LOGIT = 0.01;

function modelLabel(id: ModelFactorId, favors: SheetFactor["favors"], side: string, firmer: boolean): string {
  if (favors === "even") {
    if (id === "certainty") return "The data behind this call is about as sure as usual";
    if (id === "pointMix") return "The mix of auto, endgame and penalty points is about even";
    return `${MODEL_NAMES[id]} ${id === "experience" ? "are" : "is"} about even`;
  }
  switch (id) {
    case "pointMix": return `${side}'s mix of auto, endgame and penalty points counts in its favor`;
    case "form": return `Form this season and at this event favors ${side}`;
    case "momentum": return `Momentum over the last few matches favors ${side}`;
    case "reliability": return `Breakdowns and consistency favor ${side}`;
    case "partners": return `How evenly the partners share the work favors ${side}`;
    case "experience": return `Matches played and rest favor ${side}`;
    case "certainty": return firmer ? `Solid data makes ${side} a firmer favorite` : "Thin or noisy data pulls the call toward 50/50";
  }
}

const logitOf = (p: number) => { const q = Math.max(1e-12, Math.min(1 - 1e-12, p)); return Math.log(q / (1 - q)); };

/**
 * The factor sheet for a prediction already made (engine 3.3). `raw` holds the four phases' unrounded
 * points in the order of `ranked` (the factors, before the top-3 cut).
 */
function sheetOf(book: RatingBook, teamsA: number[], teamsB: number[], p: MatchPrediction, opts: ExplainOptions, raw: { id: Component; points: number }[], ranked: Factor[], fact: PartnershipFact | null, nameA: string, nameB: string): FactorSheet {
  const F = logitOf(p.pRedWin);
  const L = logitOf(p.pRaw ?? p.pRedWin);
  const margin = raw.reduce((s, x) => s + x.points, 0);
  // Log-odds of the score gap per point of margin; at a zero margin, its slope there (4φ(0)/S).
  const S = Math.hypot(p.red.sd, p.blue.sd);
  const perPoint = Math.abs(margin) > 1e-9 ? L / margin : S > 0 ? 1.5957691216057308 / S : 0;
  const model = p.model === "contextual" ? contextualModelById(opts.contextual, p.modelId) : null;
  let gain = 1;
  const grouped = new Map<ModelFactorId, number>();
  if (model) {
    const x = contextualFeatures(book, teamsA, teamsB, { ...p, pRedWin: p.pRaw ?? p.pRedWin }, opts.context, model.coefficients.length);
    if (x) {
      const t = contextualTerms(model, x);
      gain = t.gain;
      t.terms.forEach((v, i) => grouped.set(INPUT_FACTOR[i], (grouped.get(INPUT_FACTOR[i]) ?? 0) + gain * v));
    }
  } else if (opts.calibration) gain = opts.calibration.a;
  const phases: SheetFactor[] = ranked.map((f, i) => ({
    id: f.id, kind: "phase", name: PHASE_NAMES[f.id], label: f.label, favors: f.favors, logit: gain * perPoint * raw[i].points, weight: 0, points: f.points,
  }));
  const shift = p.partnershipShift ?? 0;
  // The calibration's offset and the clamps land in "How sure the data is", so the sheet adds up exactly.
  const accounted = phases.reduce((s, f) => s + f.logit, 0) + [...grouped.values()].reduce((s, v) => s + v, 0) + shift;
  grouped.set("certainty", (grouped.get("certainty") ?? 0) + F - accounted);
  const modelFactors: SheetFactor[] = [...grouped]
    .filter(([id, v]) => model || id !== "certainty" || Math.abs(v) > 1e-9)
    .map(([id, v]) => {
      const favors: SheetFactor["favors"] = Math.abs(v) < EVEN_LOGIT ? "even" : v > 0 ? "A" : "B";
      return { id, kind: "model", name: MODEL_NAMES[id], label: modelLabel(id, favors, favors === "A" ? nameA : nameB, Math.sign(v) === Math.sign(F)), favors, logit: v, weight: 0 };
    });
  const reasons: SheetFactor[] = [{
    id: "schedule", kind: "reason", name: "Schedule strength", favors: "even", logit: 0, weight: 0,
    label: "Ratings already account for every partner and opponent faced, so schedule strength adds no separate weight",
  }];
  if (opts.partnership) {
    const favors: SheetFactor["favors"] = !fact ? "even"
      : fact.kind === "against" ? (fact.record.wins > fact.record.losses ? "A" : fact.record.wins < fact.record.losses ? "B" : "even")
      : Math.abs(fact.effect) < 0.15 ? "even" : (fact.effect > 0) === (fact.side === "A") ? "A" : "B";
    reasons.unshift({
      id: "headToHead", kind: "reason", name: "Head-to-head", favors, logit: shift, weight: 0,
      label: fact?.label ?? "These robots haven't played together or against each other before",
    });
  }
  const all = [...phases, ...modelFactors, ...reasons];
  const total = all.reduce((s, f) => s + Math.abs(f.logit), 0);
  for (const f of all) f.weight = total > 0 ? Math.abs(f.logit) / total : 0;
  modelFactors.sort((x, y) => y.weight - x.weight);
  return { probabilityModel: p.model ?? "legacy", logit: F, phases, model: modelFactors, reasons };
}

/**
 * Explain one match between alliances A and B (2 robots each in FTC, but any
 * size works). Pure: same book + teams → same answer, server or browser.
 */
export function explainMatch(book: RatingBook, teamsA: number[], teamsB: number[], opts: ExplainOptions = {}): MatchExplanation {
  return book.withRegion(opts.context?.region, () => book.withEvent(opts.context?.event, () => explainOn(book, teamsA, teamsB, opts)));
}

function explainOn(book: RatingBook, teamsA: number[], teamsB: number[], opts: ExplainOptions): MatchExplanation {
  const nameA = opts.nameA ?? "Red", nameB = opts.nameB ?? "Blue";
  const p = predictMatch(book, teamsA, teamsB, opts.noise, opts.calibration, { contextual: opts.contextual, context: opts.context, shadow: opts.shadow, band: opts.band, partnership: opts.partnership });
  const A = teamsA.map((t) => strength(book, t));
  const B = teamsB.map((t) => strength(book, t));
  const sum = (xs: TeamStrength[], k: keyof TeamStrength) => xs.reduce((s, x) => s + (x[k] as number), 0);
  const base = book.baseline();

  // Engine 2.11: what each alliance loses to overlap comes off its phase, so the factors still split the margin exactly.
  const level = opts.context?.level ?? "qual";
  const oA = book.allianceOverlap(teamsA, level), oB = book.allianceOverlap(teamsB, level);
  const raw: { id: Component; points: number }[] = [
    { id: "auto", points: sum(A, "auto") - oA.auto - (sum(B, "auto") - oB.auto) },
    { id: "teleop", points: sum(A, "teleop") - oA.teleop - (sum(B, "teleop") - oB.teleop) },
    { id: "endgame", points: sum(A, "endgame") - oA.endgame - (sum(B, "endgame") - oB.endgame) },
    { id: "pen", points: sum(B, "pen") - sum(A, "pen") },
  ];
  const ranked = raw.sort((x, y) => Math.abs(y.points) - Math.abs(x.points)).map(({ id, points }): Factor => {
    const favors: Factor["favors"] = Math.abs(points) < 1 ? "even" : points > 0 ? "A" : "B";
    const pts = Math.round(Math.abs(points));
    let label: string;
    if (favors === "even") label = `${COMPONENT_WORDS[id][0].toUpperCase()}${COMPONENT_WORDS[id].slice(1)} is about even`;
    else if (id === "pen") {
      const cleaner = favors === "A" ? nameA : nameB, other = favors === "A" ? nameB : nameA;
      label = `${other} tends to give away about ${pts} more penalty points than ${cleaner}`;
    } else {
      const lead = favors === "A" ? nameA : nameB;
      label = `${lead}'s ${COMPONENT_WORDS[id]} is worth about ${pts} more points${carrier(favors === "A" ? A : B, id, base?.[id] ?? null)}`;
    }
    return { id, points: round1(points), favors, label };
  });
  // The top 3 are the sheet's first three phases (engine 3.3): one ranking, so the two never disagree.
  const factors = ranked.slice(0, 3);

  const all = [...A, ...B];
  const minMatches = all.length ? Math.min(...all.map((t) => t.matches)) : 0;
  const ratingVar = all.reduce((s, t) => s + t.sd * t.sd, 0);
  const totalVar = p.red.sd ** 2 + p.blue.sd ** 2;
  const ratingShare = totalVar > 0 ? ratingVar / totalVar : 1;
  const R = CONFIDENCE_RULE;
  let tier: ConfidenceTier, reason: string;
  if (!base || minMatches < R.provisionalBelow) {
    tier = "provisional";
    reason = !base
      ? "No matches played this season yet — ratings come from last season's results."
      : `At least one robot has played only ${minMatches} match${minMatches === 1 ? "" : "es"} this season, so its rating is mostly a prior.`;
  } else if (minMatches >= R.confidentMinMatches && ratingShare < R.confidentMaxRatingShare) {
    tier = "confident";
    reason = `Every robot has ${minMatches}+ matches this season; most of the remaining doubt is ordinary match-to-match variance.`;
  } else {
    tier = "moderate";
    reason = minMatches < R.confidentMinMatches
      ? `The least-known robot has ${minMatches} matches this season.`
      : "Ratings still carry noticeable uncertainty relative to match variance.";
  }

  const partnership = opts.partnership
    ? partnershipFact(opts.partnership.table, teamsA, teamsB, opts.partnership.season, opts.partnership.params ?? PARTNERSHIP_PARAMS, p.partnershipShift ?? 0)
    : null;
  const factorSheet = sheetOf(book, teamsA, teamsB, p, opts, raw, ranked, partnership, nameA, nameB);

  const reasons = [...eventFormReasons(book, [...teamsA, ...teamsB], opts.context?.event), ...(opts.recent ? recentReasons([...teamsA, ...teamsB], opts.recent) : [])];

  // From the displayed (rounded) score to the stored whole-point bounds, the larger side: "score ± pm" always
  // reaches both ends of the range (rounding the score and the bounds separately could fall a point short).
  const pm = (mean: number, b: ScoreBand) => { const m = Math.round(mean); return Math.max(0, b.hi - m, m - b.lo); };
  return {
    winProbA: p.pRedWin,
    winProbB: 1 - p.pRedWin,
    predictedScoreA: Math.round(p.red.mean),
    predictedScoreB: Math.round(p.blue.mean),
    scoreRangeA: [p.red.band.lo, p.red.band.hi],
    scoreRangeB: [p.blue.band.lo, p.blue.band.hi],
    scoreBandA: p.red.band,
    scoreBandB: p.blue.band,
    scorePlusMinusA: pm(p.red.mean, p.red.band),
    scorePlusMinusB: pm(p.blue.mean, p.blue.band),
    factors,
    confidence: { tier, reason, minMatches, ratingShare: Math.round(ratingShare * 1000) / 1000 },
    probabilityModel: p.model ?? "legacy",
    probabilityModelId: p.modelId ?? null,
    shadow: p.pShadow != null ? { winProbA: p.pShadow, modelId: p.shadowModelId! } : null,
    partnership,
    factorSheet,
    teamsA: A,
    teamsB: B,
    overlapA: oA,
    overlapB: oB,
    reasons,
    bonus: opts.bonus ? bonusOdds(opts.bonus.season, opts.bonus.model, p, p.pRedWin, { tier, reason }) : null,
  };
}
