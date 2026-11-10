// Score ranges (engine 2.2): every predicted score comes with a stated range that should hold 80% of real
// scores. One place for how a range travels (rangesOf) and how it reads ("118 ± 14"), so every prediction
// surface says it the same way.
import type { MatchPredictionView, RangeCoverageNow } from "./api";

interface Banded {
  scoreBandA: { lo: number; hi: number; level: number };
  scoreBandB: { lo: number; hi: number; level: number };
}

/** The range fields of a MatchPredictionView, from an engine explanation. */
export function rangesOf(x: Banded): Pick<MatchPredictionView, "redRange" | "blueRange" | "rangeLevel"> {
  return { redRange: [x.scoreBandA.lo, x.scoreBandA.hi], blueRange: [x.scoreBandB.lo, x.scoreBandB.hi], rangeLevel: x.scoreBandA.level };
}

/**
 * Half-width of a range around its predicted score as displayed, in whole points ("± 14"). Measured from the
 * rounded score to the stored (whole-point) bounds, and the larger side when a range is lopsided (cut off at
 * 0, or rounding), so "score ± x" always reaches both ends of the stated range.
 */
export function plusMinus(mean: number, range: [number, number]): number {
  const m = Math.round(mean);
  return Math.max(0, range[1] - m, m - range[0]);
}

/** "118 ±14 – 96 ±12" (or "118–96" for a call that stated no range), for one-line summaries. */
export function predictedText(p: Pick<MatchPredictionView, "redMean" | "blueMean" | "redRange" | "blueRange">): string {
  const r = Math.round(p.redMean), b = Math.round(p.blueMean);
  if (!p.redRange || !p.blueRange) return `${r}–${b}`;
  return `${r} ±${plusMinus(p.redMean, p.redRange)} – ${b} ±${plusMinus(p.blueMean, p.blueRange)}`;
}

/** "80%" from 0.8. */
export const levelPct = (level = 0.8) => `${Math.round(level * 100)}%`;

const n = (x: number) => x.toLocaleString("en-US");
const p1 = (x: number) => `${(100 * x).toFixed(1)}%`;

/**
 * How the stated ranges have actually held, with the sample: "80% ranges have held 91.1% of 5,322 live alliance
 * scores in 2026–27 BIOBUZZ (93.4% of 6,450 in its season replay), so they run wider than 80%." Never implies a range
 * holds exactly its stated level. Null without a measured coverage (the caller then says only what level is stated).
 */
export function rangeCoverageLine(c: RangeCoverageNow | null | undefined): string | null {
  if (!c) return null;
  const off = c.live.coverage - c.level;
  const verdict = Math.abs(off) <= 0.03 ? `close to the stated ${levelPct(c.level)}` : off > 0 ? `so they run wider than ${levelPct(c.level)}` : `so they run narrower than ${levelPct(c.level)}`;
  const replay = c.backtest ? ` (${p1(c.backtest.coverage)} of ${n(c.backtest.n)} in its season replay)` : "";
  return `${levelPct(c.level)} ranges have held ${p1(c.live.coverage)} of ${n(c.live.n)} live alliance scores in ${c.label}${replay}, ${verdict}.`;
}

/** Plain-language meaning of a range, for titles and screen readers: the stated level and, when known, how often such
 *  ranges have really held (live, with the sample), never "8 in 10" as if that were measured. */
export function rangeSentence(range: [number, number], level = 0.8, c?: RangeCoverageNow | null): string {
  return `${levelPct(level)} range ${range[0]}–${range[1]}${c ? `; ${levelPct(level)} ranges have held ${p1(c.live.coverage)} of ${n(c.live.n)} live alliance scores (${c.label})` : ""}`;
}
