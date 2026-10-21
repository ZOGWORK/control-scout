// Predict — the public match contract: win odds, expected scores with ranges,
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
import { predictMatch, type NoiseParams } from "./matchModel.js";
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

/** z for a central 80% interval. */
const Z80 = 1.2815515655446004;

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

export interface MatchExplanation {
  winProbA: number;
  winProbB: number;
  predictedScoreA: number;
  predictedScoreB: number;
  /** Central 80% range of each final score. */
  scoreRangeA: [number, number];
  scoreRangeB: [number, number];
  factors: Factor[];
  confidence: { tier: ConfidenceTier; reason: string; minMatches: number; ratingShare: number };
  /** Which model produced the win odds ("legacy" when the book has no reliability state). */
  probabilityModel: ProbabilityModel;
  /** The contextual parameter set's id (null for the legacy model). */
  probabilityModelId: string | null;
  /** opts.shadow: the shadow model's P(A wins) on the same inputs, and its id (else null). */
  shadow: { winProbA: number; modelId: string } | null;
  teamsA: TeamStrength[];
  teamsB: TeamStrength[];
  /**
   * Notable reasons beyond the factors, e.g. "Team 1234 was a no-show in 2 of its last 10 matches". Only with
   * opts.recent; empty when nothing is notable. Words only: no probability or score depends on them.
   */
  reasons: string[];
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
  return { team, np: npOf(r), auto: r.auto, teleop: r.teleop, endgame: r.endgame, pen: r.pen, matches: r.n, sd: Math.sqrt(r.uncertainty) };
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
  const p = predictMatch(book, teamsA, teamsB, opts.noise, opts.calibration, { contextual: opts.contextual, context: opts.context, shadow: opts.shadow });
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

  const reasons: string[] = [];
  if (opts.recent) {
    for (const t of [...teamsA, ...teamsB]) {
      const r = opts.recent(t);
      if (!r || !r.matches) continue;
      if (r.noShows >= REASON_RULE.noShows) reasons.push(`Team ${t} was a no-show in ${r.noShows} of its last ${r.matches} matches`);
      else if (r.nearZero >= REASON_RULE.nearZero) reasons.push(`Team ${t}'s alliance scored about what its partner alone would in ${r.nearZero} of its last ${r.matches} matches (an estimate: defense or a carry looks the same)`);
    }
  }

  const range = (mean: number, sd: number): [number, number] => [Math.max(0, Math.round(mean - Z80 * sd)), Math.round(mean + Z80 * sd)];
  return {
    winProbA: p.pRedWin,
    winProbB: 1 - p.pRedWin,
    predictedScoreA: Math.round(p.red.mean),
    predictedScoreB: Math.round(p.blue.mean),
    scoreRangeA: range(p.red.mean, p.red.sd),
    scoreRangeB: range(p.blue.mean, p.blue.sd),
    factors,
    confidence: { tier, reason, minMatches, ratingShare: Math.round(ratingShare * 1000) / 1000 },
    probabilityModel: p.model ?? "legacy",
    probabilityModelId: p.modelId ?? null,
    shadow: p.pShadow != null ? { winProbA: p.pShadow, modelId: p.shadowModelId! } : null,
    teamsA: A,
    teamsB: B,
    reasons,
  };
}
