// A match prediction on this device from the lite pack, for the Predict page
// with no signal. The page imports this lazily, and only after the server
// couldn't be reached (lib/api.ts): an online visit never loads the engine
// code here, nor opens the pack.
import { RatingBook, explainMatch, FITTED_MODEL, type MatchExplanation } from "@control-scout/predict-engine";
import { partnershipFor } from "./partnerships";
import { loadLite } from "../packs";

/**
 * Predict a match on this device from the lite pack (same engine as the
 * server). A pack built before engine 2.0 has no reliability state, so its
 * odds come from the legacy probability model until the next pack arrives.
 */
export async function offlineExplain(season: number, red: number[], blue: number[], level: "qual" | "playoff" = "qual"): Promise<(MatchExplanation & { asOf: string }) | null> {
  const p = await loadLite();
  const data = p?.books[String(season)];
  if (!p || !data) return null;
  const book = RatingBook.fromData(data);
  book.setTime(Date.now());
  return { ...explainMatch(book, red, blue, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, context: { level }, partnership: partnershipFor(p, season) }), asOf: p.builtAt };
}
