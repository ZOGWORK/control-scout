// A what-if matchup's prediction (/api/predict/match, and the first paint of /predict?mode=match: server/firstPaint.ts),
// built the one way, so the drawn page and the API can't differ.
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { all } from "../db.js";
import { isEnabled } from "../flags.js";
import { liveForecaster, recentRecords } from "../predict/engine.js";
import { pairHistory } from "../../src/shared/pairHistory.js";
import { compactSheet } from "../../src/shared/factorSheet.js";
import { overlapTotal } from "../../src/shared/predictionBasis.js";
import { bonusView } from "../../src/shared/bonusOdds.js";
import type { MatchExplanationView } from "../../src/shared/api.js";

/** The prediction for `red` vs `blue` in `season` (each side 1–3 teams, already checked), as a qualification or playoff
 *  match. Null while the season's ratings aren't ready. */
export async function matchExplanation(season: number, red: number[], blue: number[], level: "qual" | "playoff" = "qual"): Promise<MatchExplanationView | null> {
  const f = await liveForecaster(season);
  const x = f.explain(season, red, blue, level, undefined, await recentRecords(season, [...red, ...blue]));
  if (!x) return null;
  const names = new Map((await all<any>(`SELECT number, name FROM teams WHERE number IN (${[...red, ...blue].map(() => "?").join(",")})`, [...red, ...blue])).map((r) => [Number(r.number), r.name]));
  return {
    season, red, blue, winProbRed: x.winProbA, winProbBlue: x.winProbB, predictedRed: x.predictedScoreA, predictedBlue: x.predictedScoreB,
    rangeRed: x.scoreRangeA, rangeBlue: x.scoreRangeB, rangeLevel: x.scoreBandA.level, factors: x.factors, ...((await isEnabled("factorSheet")) ? { factorSheet: compactSheet(x.factorSheet) } : {}), history: x.partnership ? pairHistory(x.partnership) : null, confidence: x.confidence, reasons: x.reasons,
    teamsRed: x.teamsA.map((t) => ({ ...t, name: names.get(t.team) ?? null })), teamsBlue: x.teamsB.map((t) => ({ ...t, name: names.get(t.team) ?? null })),
    overlapRed: overlapTotal(x.overlapA), overlapBlue: overlapTotal(x.overlapB), marginScale: x.marginScale,
    level, probabilityModel: x.probabilityModel, bonus: bonusView(season, x) ?? null, engineVersion: ENGINE_VERSION,
  };
}
