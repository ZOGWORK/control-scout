// Bonus ranking point odds (engine bonus.ts via explainMatch): what the ledger stores with a call, and
// the view every match surface shows. Probabilities are kept to 4 places and never a flat 0 or 1
// (they're calls, not results); expected RPs are derived from them and the call's win probability.
import { BONUS_SLOTS, expectedOutcomeRp, type MatchExplanation, type AllianceBonusOdds } from "@control-scout/predict-engine";
import type { BonusOddsView, ConfidenceTier } from "./api.js";

const stable = (p: number) => Math.min(0.9999, Math.max(0.0001, Math.round(p * 1e4) / 1e4));
const triple = (a: AllianceBonusOdds) => BONUS_SLOTS.map((s) => stable(a.p[s])) as [number, number, number];
// pTie (engine 3.1): the match's tie probability; logged calls don't store it, so theirs leave ties out (≤ 0.01 RP).
const rp = (season: number, pWin: number, ps: number[], pTie = 0) => Math.round((expectedOutcomeRp(season, pWin, pTie) + ps.reduce((s, p) => s + p, 0)) * 100) / 100;

/** The model a call's bonus odds came from, as stored: "fitted:2025" or "season:<alliances>". */
export const bonusModelId = (season: number, b: NonNullable<MatchExplanation["bonus"]>) => (b.source === "fitted" ? `fitted:${season}` : `season:${b.samples}`);

/** The view of a call made just now. `pRed`: the win probability as shown (rounded the same way). */
export function bonusView(season: number, x: MatchExplanation, pRed = x.winProbA): BonusOddsView | undefined {
  if (!x.bonus) return undefined;
  const red = triple(x.bonus.A), blue = triple(x.bonus.B);
  return { red, blue, rpRed: rp(season, pRed, red, x.bonus.pTie), rpBlue: rp(season, 1 - pRed, blue, x.bonus.pTie), tier: x.bonus.confidence.tier, reason: x.bonus.confidence.reason };
}

/** Ledger columns (bonus_red, bonus_blue, bonus_tier, bonus_model) for a call; nulls when it has no bonus odds. */
export function bonusArgs(season: number, x: MatchExplanation): [string | null, string | null, string | null, string | null] {
  if (!x.bonus) return [null, null, null, null];
  return [JSON.stringify(triple(x.bonus.A)), JSON.stringify(triple(x.bonus.B)), x.bonus.confidence.tier, bonusModelId(season, x.bonus)];
}

const parse = (s: unknown): [number, number, number] | null => {
  if (typeof s !== "string") return null;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.length === 3 && v.every((p) => typeof p === "number" && Number.isFinite(p)) ? (v as [number, number, number]) : null;
  } catch { return null; }
};

/** The view of a logged call (a predictions row), or undefined when it has no bonus odds. */
export function bonusFromRow(season: number, row: { p_red: number; bonus_red?: unknown; bonus_blue?: unknown; bonus_tier?: unknown }): BonusOddsView | undefined {
  const red = parse(row.bonus_red), blue = parse(row.bonus_blue);
  if (!red || !blue) return undefined;
  const pRed = Number(row.p_red);
  const tier = (["provisional", "moderate", "confident"] as ConfidenceTier[]).includes(row.bonus_tier as ConfidenceTier) ? (row.bonus_tier as ConfidenceTier) : "provisional";
  return { red, blue, rpRed: rp(season, pRed, red), rpBlue: rp(season, 1 - pRed, blue), tier };
}
