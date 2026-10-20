// What a match record says in words: who won and by how much, and how that compares with the
// prediction made before it (the replayed walk-forward call in the records). Used by the phone
// summary of /matches. Pure, unit tested.
import type { ConfidenceTier } from "../../shared/api";
import type { MatchRecordRow } from "../../shared/statCatalog";
import { oddsPct } from "../format";

export type Side = "red" | "blue";

/** The stats the phone summary always needs, whatever columns are picked. */
export const SUMMARY_FIELDS = ["redTotalPoints", "blueTotalPoints"] as const;
export const PREDICTION_FIELD = "redPredictedWinPct";

export interface MatchOutcome {
  /** Null while the match has no scores (scheduled, or not reported yet). */
  red: number | null;
  blue: number | null;
  played: boolean;
  /** Null for a tie or an unplayed match. */
  winner: Side | null;
  margin: number;
  /** "Red won by 12", "Tie, 100–100", "Not played yet". */
  headline: string;
  prediction: {
    /** Null when the call was an even split. */
    favourite: Side | null;
    /** The favourite's chance, as shown (never a flat 0% or 100%); null when the call has no recorded tier (then no % is shown). */
    chance: string | null;
    /** The confidence tier recorded with the call (never worked out from the probability); null when there is none. */
    tier: ConfidenceTier | null;
    /** "called" (the favourite won), "upset", "tie", "even" (no favourite), "pending" (not played). */
    verdict: "called" | "upset" | "tie" | "even" | "pending";
    /** The comparison in one sentence. */
    text: string;
  } | null;
}

const NAME: Record<Side, string> = { red: "Red", blue: "Blue" };
const score = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function matchOutcome(r: Pick<MatchRecordRow, "stats" | "predictionTier">): MatchOutcome {
  const red = score(r.stats.redTotalPoints), blue = score(r.stats.blueTotalPoints);
  const played = red != null && blue != null;
  const winner: Side | null = !played || red === blue ? null : red! > blue! ? "red" : "blue";
  const margin = played ? Math.abs(red! - blue!) : 0;
  const headline = !played ? "Not played yet" : winner ? `${NAME[winner]} won by ${margin}` : `Tie, ${red}–${blue}`;

  const pct = score(r.stats[PREDICTION_FIELD]);
  let prediction: MatchOutcome["prediction"] = null;
  if (pct != null) {
    const pRed = pct / 100;
    const favourite: Side | null = pRed > 0.5 ? "red" : pRed < 0.5 ? "blue" : null;
    // A probability is only shown with the confidence it was recorded with: without a tier, the verdict alone.
    const tier = r.predictionTier ?? null;
    const chance = tier ? oddsPct(favourite === "blue" ? 1 - pRed : pRed) : null;
    const called = favourite ? `${NAME[favourite]} favoured${chance ? ` (${chance})` : ""}` : `Even call${chance ? ` (${chance} each)` : ""}`;
    const p = { favourite, chance, tier };
    if (!played) prediction = { ...p, verdict: "pending", text: `${called}, not played yet` };
    else if (!winner) prediction = { ...p, verdict: "tie", text: `${called}, ended in a tie` };
    else if (!favourite) prediction = { ...p, verdict: "even", text: `${called}, ${NAME[winner]} won` };
    else if (favourite === winner) prediction = { ...p, verdict: "called", text: `${called}, ${NAME[winner]} won` };
    else prediction = { ...p, verdict: "upset", text: `${called}, ${NAME[winner]} won` };
  }
  return { red, blue, played, winner, margin, headline, prediction };
}

/** The verdict's short label. */
export const VERDICT_LABEL: Record<NonNullable<MatchOutcome["prediction"]>["verdict"], string> = {
  called: "Called it",
  upset: "Upset",
  tie: "Tie",
  even: "Toss-up",
  pending: "Prediction",
};
