// Score ranges (engine 2.2): every predicted score comes with a stated range that should hold 80% of real
// scores. One place for how a range travels (rangesOf) and how it reads ("118 ± 14"), so every prediction
// surface says it the same way.
import type { MatchPredictionView } from "./api";

interface Banded {
  scoreBandA: { lo: number; hi: number; level: number };
  scoreBandB: { lo: number; hi: number; level: number };
}

/** The range fields of a MatchPredictionView, from an engine explanation. */
export function rangesOf(x: Banded): Pick<MatchPredictionView, "redRange" | "blueRange" | "rangeLevel"> {
  return { redRange: [x.scoreBandA.lo, x.scoreBandA.hi], blueRange: [x.scoreBandB.lo, x.scoreBandB.hi], rangeLevel: x.scoreBandA.level };
}

/**
 * Half-width of a range around its predicted score, in whole points ("± 14"). A range cut off at 0 is
 * lopsided; the larger side is quoted so the ± never claims more certainty than the range does.
 */
export function plusMinus(mean: number, range: [number, number]): number {
  return Math.max(0, Math.round(Math.max(range[1] - mean, mean - range[0])));
}

/** "118 ±14 – 96 ±12" (or "118–96" for a call that stated no range), for one-line summaries. */
export function predictedText(p: Pick<MatchPredictionView, "redMean" | "blueMean" | "redRange" | "blueRange">): string {
  const r = Math.round(p.redMean), b = Math.round(p.blueMean);
  if (!p.redRange || !p.blueRange) return `${r}–${b}`;
  return `${r} ±${plusMinus(p.redMean, p.redRange)} – ${b} ±${plusMinus(p.blueMean, p.blueRange)}`;
}

/** "80%" from 0.8. */
export const levelPct = (level = 0.8) => `${Math.round(level * 100)}%`;

/** Plain-language meaning of a range, for titles and screen readers. */
export function rangeSentence(range: [number, number], level = 0.8): string {
  return `${levelPct(level)} range ${range[0]}–${range[1]}: about ${Math.round(level * 10)} in 10 real scores land inside`;
}
