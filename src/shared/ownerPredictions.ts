// The owner console's Predictions & ledger section: the engine in production and how it's doing, read-only.
// Nothing here changes the engine, its weights or its calibration, and nothing promotes a shadow model.
import type { ConfidenceTier } from "./api.js";

/** One block of scored calls (live or replay, never blended). */
export interface OwnerLedgerScore { n: number; accuracy: number; brier: number; baselineBrier: number; logLoss: number }

/** One simulation setting, as a value to read (none can be changed from the console). */
export interface SimulationSetting { id: string; label: string; value: number; unit: string; note: string }

/** GET /api/owner/predictions/engine. */
export interface OwnerPredictionEngine {
  /** The engine version this server runs (the champion: the only one that serves predictions). */
  engineVersion: string;
  /** The probability model the newest live call was served by, and the shadow model scored beside it (or null). */
  servedModel: string | null;
  shadowModel: string | null;
  /** When the newest live call was logged (null: none yet). */
  lastLiveCall: string | null;
  /** The headline the public track record shows, with its kind. */
  headline: { kind: "live" | "backtest"; season: number; accuracy: number; n: number } | null;
  liveThreshold: number;
  /** Newest season first: live and replay side by side, per engine version, and the shadow comparison (read-only). */
  seasons: {
    season: number;
    label: string;
    live: OwnerLedgerScore | null;
    replay: OwnerLedgerScore | null;
    liveByEngine: { engine: string; n: number; accuracy: number; brier: number; logLoss: number }[];
    shadow: { servedModel: string; shadowModel: string; n: number; served: { accuracy: number; brier: number; logLoss: number }; shadow: { accuracy: number; brier: number; logLoss: number } }[];
  }[];
  simulation: SimulationSetting[];
  generatedAt: string;
}

/** Calibration of one confidence tier (the tier every prediction shows publicly): how sure the favourite was
 *  on average against how often it won, and the Brier score of those calls. */
export interface TierCalibration { tier: ConfidenceTier; n: number; predicted: number; actual: number; brier: number }

/** The tiers in the order they're shown, least sure first. */
export const TIER_ORDER: ConfidenceTier[] = ["provisional", "moderate", "confident"];
