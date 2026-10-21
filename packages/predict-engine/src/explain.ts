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
import { predictMatch, type BandParams, type NoiseParams, type PartnershipInput, type ScoreBand } from "./matchModel.js";
import { PARTNERSHIP_PARAMS, partnershipFact, type PartnershipFact } from "./partnership.js";
import type { CalibrationParams } from "./calibration.js";
import type { ContextualModel, MatchContext, ProbabilityModel } from "./contextual.js";
import type { RatingBook } from "./rating.js";
import type { Component, TeamRating } from "./types.js";

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
  teamsA: TeamStrength[];
  teamsB: TeamStrength[];
}

export interface ExplainOptions {
  noise?: NoiseParams;
  calibration?: CalibrationParams;
  /** Contextual win-probability model (FITTED_MODEL.contextual) and the match's context. */
  contextual?: ContextualModel;
  context?: MatchContext;
  /** A second model evaluated on the same inputs, for side-by-side logging. */
  shadow?: ContextualModel;
  /** Pair history (engine 2.2): adds the partnership fact, and its shift on the odds (none at β = 0). */
  partnership?: PartnershipInput;
  /** How score ranges are drawn (FITTED_MODEL.band; the default holds the same values). */
  band?: BandParams;
  /** Names used in factor sentences (default "Red" / "Blue"). */
  nameA?: string;
  nameB?: string;
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

/**
 * Explain one match between alliances A and B (2 robots each in FTC, but any
 * size works). Pure: same book + teams → same answer, server or browser.
 */
export function explainMatch(book: RatingBook, teamsA: number[], teamsB: number[], opts: ExplainOptions = {}): MatchExplanation {
  const nameA = opts.nameA ?? "Red", nameB = opts.nameB ?? "Blue";
  const p = predictMatch(book, teamsA, teamsB, opts.noise, opts.calibration, { contextual: opts.contextual, context: opts.context, shadow: opts.shadow, band: opts.band, partnership: opts.partnership });
  const A = teamsA.map((t) => strength(book, t));
  const B = teamsB.map((t) => strength(book, t));
  const sum = (xs: TeamStrength[], k: keyof TeamStrength) => xs.reduce((s, x) => s + (x[k] as number), 0);
  const base = book.baseline();

  const raw: { id: Component; points: number }[] = [
    { id: "auto", points: sum(A, "auto") - sum(B, "auto") },
    { id: "teleop", points: sum(A, "teleop") - sum(B, "teleop") },
    { id: "endgame", points: sum(A, "endgame") - sum(B, "endgame") },
    { id: "pen", points: sum(B, "pen") - sum(A, "pen") },
  ];
  const factors: Factor[] = raw
    .sort((x, y) => Math.abs(y.points) - Math.abs(x.points))
    .slice(0, 3)
    .map(({ id, points }) => {
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
    partnership: opts.partnership
      ? partnershipFact(opts.partnership.table, teamsA, teamsB, opts.partnership.season, opts.partnership.params ?? PARTNERSHIP_PARAMS, p.partnershipShift ?? 0)
      : null,
    teamsA: A,
    teamsB: B,
  };
}
