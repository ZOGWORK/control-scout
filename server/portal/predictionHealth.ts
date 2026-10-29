// Prediction health for the owner portal: the calibration ledger for one season and one kind of
// call (live, logged before the match, or the walk-forward backtest; never blended), and drift.
//
// Drift, kept simple: a week of calls is flagged when its Brier score is DRIFT_BRIER worse than the
// season's baseline so far (every scored call before that week), or its accuracy DRIFT_ACCURACY
// lower. A week needs MIN_WEEK calls and the baseline MIN_BASELINE before either is judged, so a
// handful of upsets on a quiet week doesn't raise an alarm. The rolling check compares the latest
// ROLLING calls with the season as a whole the same way.
//
// The summary and the reliability bins come from the track record's own code (api/accuracy.ts).
import type { ConfidenceTier } from "@control-scout/predict-engine";
import { all } from "../db.js";
import { PREDICT_SEASONS } from "../data/seasons.js";
import { block, isoWeek } from "../api/accuracy.js";
import type { DriftAlert, LedgerKind, PredictionHealth } from "../../src/shared/owner.js";
import { TIER_ORDER, type TierCalibration } from "../../src/shared/ownerPredictions.js";

export const DRIFT_BRIER = 0.03;
export const DRIFT_ACCURACY = 0.05;
export const MIN_WEEK = 30;
export const MIN_BASELINE = 100;
export const ROLLING = 200;

interface Call { p: number; y: number; tier: ConfidenceTier; level: string; time: string | null }

const brier = (xs: Call[]) => xs.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / Math.max(1, xs.length);
/** Share of decided calls (no tie, no coin flip) the favourite won. */
function accuracy(xs: Call[]): number {
  const d = xs.filter((r) => r.y !== 0.5 && r.p !== 0.5);
  return d.length ? d.filter((r) => (r.p > 0.5) === (r.y === 1)).length / d.length : 0;
}
/** How sure the favourite was, on average. */
const expected = (xs: Call[]) => xs.reduce((s, r) => s + Math.max(r.p, 1 - r.p), 0) / Math.max(1, xs.length);

/** Calibration by confidence tier (the tier each call shows publicly): how sure the favourite was against how
 *  often it won, per tier, over the same calls (ties and 50:50 calls left out of both). Tiers with none are left out. */
export function tierCalibration(xs: Call[]): TierCalibration[] {
  return TIER_ORDER.map((tier) => {
    // Both sides from the same calls: those with a favourite and a winner (no 50:50 call, no tie).
    const cs = xs.filter((c) => c.tier === tier && c.y !== 0.5 && c.p !== 0.5);
    return { tier, n: cs.length, predicted: expected(cs), actual: accuracy(cs), brier: brier(cs) };
  }).filter((t) => t.n > 0);
}

/** Flag the weeks (oldest first in, newest first out) that fell away from the season so far. */
export function driftAlerts(weeks: { week: string; calls: Call[] }[]): DriftAlert[] {
  const alerts: DriftAlert[] = [];
  const before: Call[] = [];
  for (const { week, calls } of weeks) {
    if (calls.length >= MIN_WEEK && before.length >= MIN_BASELINE) {
      const b = brier(calls), bb = brier(before), a = accuracy(calls), ba = accuracy(before);
      const reasons: DriftAlert["reasons"] = [];
      if (b - bb >= DRIFT_BRIER) reasons.push("brier");
      if (ba - a >= DRIFT_ACCURACY) reasons.push("accuracy");
      if (reasons.length) alerts.push({ week, n: calls.length, brier: b, baselineBrier: bb, accuracy: a, baselineAccuracy: ba, reasons });
    }
    before.push(...calls);
  }
  return alerts.reverse();
}

export async function predictionHealth(kind: LedgerKind, season?: number | null): Promise<PredictionHealth> {
  const available = (await all<{ kind: string; season: number; n: number }>(
    "SELECT kind, season, COUNT(*) n FROM predictions WHERE outcome IS NOT NULL GROUP BY kind, season ORDER BY season DESC",
  )).filter((r) => (r.kind === "live" || r.kind === "backtest") && PREDICT_SEASONS.includes(Number(r.season)))
    .map((r) => ({ kind: r.kind as LedgerKind, season: Number(r.season), n: Number(r.n) }));
  const s = season && available.some((a) => a.kind === kind && a.season === season) ? season : available.find((a) => a.kind === kind)?.season ?? null;
  const thresholds = { brier: DRIFT_BRIER, accuracy: DRIFT_ACCURACY, minWeek: MIN_WEEK, rollingWindow: ROLLING };
  if (s == null) return { kind, season: null, available, summary: null, reliability: [], byTier: [], weekly: [], rolling: null, alerts: [], thresholds };

  const calls = (await all<{ p: number; y: number; tier: ConfidenceTier; level: string; time: string | null }>(
    "SELECT p_red p, outcome y, tier, level, match_time time FROM predictions WHERE kind = ? AND season = ? AND outcome IS NOT NULL ORDER BY match_time, id",
    [kind, s],
  )).map((r) => ({ p: Number(r.p), y: Number(r.y), tier: r.tier, level: r.level, time: r.time }));
  const b = block(calls);
  const byWeek = new Map<string, Call[]>();
  for (const c of calls) if (c.time) { const w = isoWeek(c.time); byWeek.set(w, [...(byWeek.get(w) ?? []), c]); }
  const weeks = [...byWeek].sort(([a], [z]) => a.localeCompare(z)).map(([week, cs]) => ({ week, calls: cs }));
  const timed = calls.filter((c) => c.time);
  const recent = timed.slice(-ROLLING);
  const rolling = recent.length >= Math.min(ROLLING, MIN_BASELINE) && timed.length > recent.length
    ? (() => {
      const rb = brier(recent), ra = accuracy(recent);
      return { n: recent.length, brier: rb, accuracy: ra, drifting: rb - brier(calls) >= DRIFT_BRIER || accuracy(calls) - ra >= DRIFT_ACCURACY };
    })()
    : null;
  return {
    kind, season: s, available,
    summary: b && { n: b.n, accuracy: b.accuracy, brier: b.brier, baselineBrier: b.baselineBrier, logLoss: b.logLoss },
    reliability: b?.reliability ?? [],
    byTier: tierCalibration(calls),
    weekly: weeks.map(({ week, calls: cs }) => ({ week, n: cs.length, expected: expected(cs), actual: accuracy(cs), brier: brier(cs) })),
    rolling,
    alerts: driftAlerts(weeks).slice(0, 12),
    thresholds,
  };
}
