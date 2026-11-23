// The engine in production, for the owner console (Predictions & ledger): its version and probability model
// (the champion: the only one that serves predictions), live and replay accuracy side by side (never blended),
// and each engine version's own live calls and the shadow model scored on the same live calls.
// Read-only: nothing here changes the engine, and the console never promotes a shadow model.
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { get } from "../db.js";
import { trackRecord } from "../api/accuracy.js";
import type { AccuracyBlock } from "../../src/shared/api.js";
import type { OwnerLedgerScore, OwnerPredictionEngine } from "../../src/shared/ownerPredictions.js";

const score = (b: AccuracyBlock | null): OwnerLedgerScore | null =>
  b && b.n ? { n: b.n, accuracy: b.accuracy, brier: b.brier, baselineBrier: b.baselineBrier, logLoss: b.logLoss } : null;

export async function predictionEngine(): Promise<OwnerPredictionEngine> {
  const [t, last] = await Promise.all([
    trackRecord(),
    get<{ model: string | null; shadow: string | null; at: string }>(
      "SELECT model_id model, shadow_model_id shadow, predicted_at at FROM predictions WHERE kind = 'live' ORDER BY predicted_at DESC, id DESC LIMIT 1"),
  ]);
  return {
    engineVersion: ENGINE_VERSION,
    servedModel: last?.model ?? null,
    shadowModel: last?.shadow ?? null,
    lastLiveCall: last?.at ?? null,
    headline: t.headline,
    liveThreshold: t.liveThreshold,
    seasons: t.seasons
      .map((s) => ({
        season: s.season, label: s.label, live: score(s.live), replay: score(s.backtest),
        liveByEngine: s.liveByEngine ?? [],
        shadow: s.liveShadow ?? [],
      }))
      .filter((s) => s.live || s.replay),
    generatedAt: t.generatedAt,
  };
}
