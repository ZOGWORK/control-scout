// A match prediction on this device from the lite pack, for the Predict page
// with no signal. The page imports this lazily, and only after the server
// couldn't be reached (lib/api.ts): an online visit never loads the engine
// code here, nor opens the pack.
import { RatingBook, explainMatch, FITTED_MODEL, type MatchExplanation } from "@control-scout/predict-engine";
import { partnershipFor } from "./partnerships";
import { loadLite } from "../packs";
import { savedBundles } from "./bundleMeta";
import { loadBundle } from "./bundles";
import { bundleTime } from "../../shared/eventBundle";

/**
 * Predict a match on this device from the lite pack (same engine as the
 * server). A pack built before engine 2.0 has no reliability state, so its
 * odds come from the legacy probability model until the next pack arrives.
 */
export async function offlineExplain(season: number, red: number[], blue: number[], level: "qual" | "playoff" = "qual"): Promise<(MatchExplanation & { asOf: string }) | null> {
  const p = await loadLite();
  const data = p?.books[String(season)];
  if (!p || !data) return bundleExplain(season, red, blue, level);
  const book = RatingBook.fromData(data);
  book.setTime(Date.now());
  // Bonus RPs count in qualification matches only; packs built before engine 2.3 carry no bonus model.
  const bonus = level === "qual" ? p.bonus?.[String(season)] : undefined;
  return {
    ...explainMatch(book, red, blue, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, context: { level }, band: FITTED_MODEL.band, partnership: partnershipFor(p, season), ...(bonus ? { bonus: { season, model: bonus } } : {}) }),
    asOf: p.builtAt,
  };
}

/** No lite pack for the season: an event-day bundle holding every one of these teams predicts instead (its
 *  ratings are the event's teams', as of the bundle). The newest such bundle wins. */
async function bundleExplain(season: number, red: number[], blue: number[], level: "qual" | "playoff"): Promise<(MatchExplanation & { asOf: string }) | null> {
  const want = [...red, ...blue];
  const metas = savedBundles().filter((b) => b.season === season).sort((a, b) => bundleTime(b).localeCompare(bundleTime(a)));
  for (const meta of metas) {
    const b = await loadBundle(meta.season, meta.code);
    if (!b?.ratings) continue;
    const have = new Set(b.ratings.ratings.map(([t]) => t));
    if (!want.every((t) => have.has(t))) continue;
    const book = RatingBook.fromData(b.ratings);
    book.setTime(Date.now());
    return { ...explainMatch(book, red, blue, { noise: FITTED_MODEL.noise, calibration: FITTED_MODEL.calibration, contextual: FITTED_MODEL.contextual, context: { level }, band: FITTED_MODEL.band }), asOf: bundleTime(meta) };
  }
  return null;
}
