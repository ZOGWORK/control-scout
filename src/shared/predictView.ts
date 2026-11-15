// A what-if match prediction, built the one way: the engine's options for a call and the API's view of its
// explanation. The server (server/predict/engine.ts explain, server/api/predictMatch.ts) and the device with no
// signal (src/lib/offline/predict.ts, from the lite pack or an event bundle) both use these, so the same ratings,
// bonus model, pair history and recent records give the same page, number for number and word for word.
import { ENGINE_VERSION, FITTED_MODEL, type BonusModelSource, type ExplainOptions, type MatchExplanation, type PartnershipInput, type RecentRecord } from "@control-scout/predict-engine";
import type { MatchExplanationView } from "./api.js";
import { compactSheet } from "./factorSheet.js";
import { pairHistory } from "./pairHistory.js";
import { overlapTotal } from "./predictionBasis.js";
import { bonusView } from "./bonusOdds.js";

export interface CallInputs {
  level: "qual" | "playoff";
  event?: string;
  region?: string | null;
  partnership?: PartnershipInput;
  /** Recent records by team (reasons only). */
  recent?: (team: number) => RecentRecord | null;
  /** The season's bonus-RP model; used for qualification matches only. */
  bonus?: { season: number; model: BonusModelSource } | null;
}

/** The engine options for a call: the fitted model's settings plus the call's own inputs. */
export function callOptions(c: CallInputs): ExplainOptions {
  return {
    noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual,
    context: { level: c.level, event: c.event, ...(c.event && c.region ? { region: c.region } : {}) },
    shadow: FITTED_MODEL.contextual?.fallback, band: FITTED_MODEL.band, partnership: c.partnership,
    ...(c.recent ? { recent: c.recent } : {}),
    // Bonus ranking points count in qualification matches only.
    ...(c.bonus && c.level === "qual" ? { bonus: c.bonus } : {}),
  };
}

/** Recent records as shipped in packs and bundles ([team, matches, no-shows, near-zero]), as a lookup. */
export type RecentRow = [number, number, number, number];
export function recentLookup(rows: RecentRow[] | null | undefined): ((team: number) => RecentRecord | null) | undefined {
  if (!rows) return undefined;
  const m = new Map(rows.map(([t, matches, noShows, nearZero]) => [t, { matches, noShows, nearZero }]));
  return (t) => m.get(t) ?? null;
}

/** The API's view of a what-if call (GET /api/predict/match). `factorSheet`: the owner switch of the same name. */
export function matchView(season: number, red: number[], blue: number[], level: "qual" | "playoff", x: MatchExplanation, name: (team: number) => string | null, factorSheet: boolean): MatchExplanationView {
  return {
    season, red, blue, winProbRed: x.winProbA, winProbBlue: x.winProbB, predictedRed: x.predictedScoreA, predictedBlue: x.predictedScoreB,
    rangeRed: x.scoreRangeA, rangeBlue: x.scoreRangeB, rangeLevel: x.scoreBandA.level, factors: x.factors, ...(factorSheet ? { factorSheet: compactSheet(x.factorSheet) } : {}), history: x.partnership ? pairHistory(x.partnership) : null, confidence: x.confidence, reasons: x.reasons,
    teamsRed: x.teamsA.map((t) => ({ ...t, name: name(t.team) })), teamsBlue: x.teamsB.map((t) => ({ ...t, name: name(t.team) })),
    overlapRed: overlapTotal(x.overlapA), overlapBlue: overlapTotal(x.overlapB), marginScale: x.marginScale,
    level, probabilityModel: x.probabilityModel, bonus: bonusView(season, x) ?? null, engineVersion: ENGINE_VERSION,
  };
}
