// The engine in production, for the owner console (Predictions & ledger): its version and probability model
// (the champion: the only one that serves predictions), live and replay accuracy side by side (never blended),
// each engine version's own live calls, the shadow model scored on the same live calls, and the simulation
// settings. Read-only: nothing here changes the engine, and the console never promotes a shadow model.
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { get } from "../db.js";
import { trackRecord } from "../api/accuracy.js";
import { BUDGET_MS, DEBOUNCE_MS } from "../projections/job.js";
import { SIM_RANK_RUNS } from "../projections/rankingSim.js";
import { ADVANCEMENT_RUNS } from "../stats/records.js";
import { FORECAST_RUNS, LOCAL_RUNS, PROJECTION_FLOOR, PROJECTION_RUNS } from "../../src/shared/projections.js";
import type { AccuracyBlock } from "../../src/shared/api.js";
import type { OwnerLedgerScore, OwnerPredictionEngine, SimulationSetting } from "../../src/shared/ownerPredictions.js";

/** The simulation settings in force on this server, as values (read from the code that uses them). */
export const SIMULATION_SETTINGS: SimulationSetting[] = [
  { id: "projectionRuns", label: "Event projections", value: PROJECTION_RUNS, unit: "simulations", note: "Each background run of an event's remaining matches." },
  { id: "projectionFloor", label: "Projection floor", value: PROJECTION_FLOOR, unit: "simulations", note: `What a run drops to when an event takes longer than ${BUDGET_MS / 1000} s.` },
  { id: "projectionDebounce", label: "Re-run after a result", value: DEBOUNCE_MS / 1000, unit: "seconds", note: "A new result waits this long for others before the event is simulated again." },
  { id: "forecastRuns", label: "Advancement forecast", value: FORECAST_RUNS, unit: "simulations", note: "The event page's advancement odds, awards and what-if pairings." },
  { id: "advancementRuns", label: "Pre-event advancement odds", value: ADVANCEMENT_RUNS, unit: "simulations", note: "Per event, for the records' odds as they stood the day before." },
  { id: "rankingSimRuns", label: "Simulated rankings", value: SIM_RANK_RUNS, unit: "simulations", note: "The Rankings tab's simulation before an event's matches start." },
  { id: "localRuns", label: "On-device estimate", value: LOCAL_RUNS, unit: "simulations", note: "A phone's own estimate, only when no stored run can be had." },
];

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
    simulation: SIMULATION_SETTINGS,
    generatedAt: t.generatedAt,
  };
}
