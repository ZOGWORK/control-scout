// A match prediction on this device, for the Predict page with no signal. The page imports this lazily, and only
// after the server couldn't be reached (lib/api.ts): an online visit never loads the engine code here, nor opens
// a pack.
//
// Two snapshots can answer: the lite pack (every team, rebuilt about daily) and an event bundle (the event's
// teams, as of its download). Each is a whole snapshot of what the server's prediction reads (ratings, bonus
// model, pair history, recent records, names), so the call is the one the server made at that snapshot's time,
// through the same options and view (src/shared/predictView.ts). The newer snapshot holding the lineup answers,
// and every number comes from that one snapshot: never ratings from one and bonus odds from the other.
import type { MatchExplanationView } from "../../shared/api";
import { loadLite, packStatus, type LitePack } from "../packs";
import { savedBundles } from "./bundleMeta";
import { loadBundle } from "./bundles";
import { bundleTime, type SavedBundle } from "../../shared/eventBundle";
import { bundleCall, bundleHolds, liteCall } from "./predictCall";

export type OfflineSource = { kind: "lite" } | { kind: "bundle"; season: number; code: string; name: string };

export interface OfflineCall {
  view: MatchExplanationView;
  /** When the snapshot's data is from (the server's last sync before it was built). */
  asOf: string;
  /** Which snapshot answered: the lite pack, or the named event's bundle. */
  source: OfflineSource;
}

/** The lite pack's data time: the server's last sync before its build (as the manifest said), else its build. */
const liteTime = (p: Pick<LitePack, "builtAt">): string => packStatus()?.dataAsOf ?? p.builtAt;

const bundleSource = (m: SavedBundle): OfflineSource => ({ kind: "bundle", season: m.season, code: m.code, name: m.name });

/**
 * Predict a match on this device. Null when nothing saved holds the season (or, for a bundle, the lineup).
 * `level`: the page's what-ifs are qualification matches (as the server's GET /api/predict/match by default).
 */
export async function offlineExplain(season: number, red: number[], blue: number[], level: "qual" | "playoff" = "qual"): Promise<OfflineCall | null> {
  const lineup = [...red, ...blue];
  const metas = savedBundles().filter((b) => b.season === season && (!b.teams || lineup.every((t) => b.teams!.includes(t))))
    .sort((a, b) => bundleTime(b).localeCompare(bundleTime(a)));
  // The lite pack's time from its saved meta, so a newer bundle answers without the pack being decoded.
  const lm = packStatus();
  const liteAt = lm && (!lm.seasons || lm.seasons.includes(season)) ? (lm.dataAsOf ?? lm.builtAt) : null;
  for (const meta of metas) {
    // A newer lite pack answers instead (it's the whole season, a bundle only its event's teams).
    if (liteAt != null && bundleTime(meta) < liteAt) break;
    const b = await loadBundle(meta.season, meta.code);
    if (!b || !bundleHolds(b, lineup)) continue;
    // A bundle from before it carried the rest of the server's inputs (bonus model, pair history, recent records)
    // answers only when no lite pack covers the season (below).
    if (!b.predict && liteAt != null) continue;
    return { view: bundleCall(b, season, red, blue, level), asOf: bundleTime(meta), source: bundleSource(meta) };
  }
  const pack = await loadLite();
  if (pack?.books[String(season)]) return { view: liteCall(pack, season, red, blue, level), asOf: liteTime(pack), source: { kind: "lite" } };
  // No lite pack for the season: any bundle holding the lineup, newest first, even one without the rest.
  for (const meta of metas) {
    const b = await loadBundle(meta.season, meta.code);
    if (b && bundleHolds(b, lineup)) return { view: bundleCall(b, season, red, blue, level), asOf: bundleTime(meta), source: bundleSource(meta) };
  }
  return null;
}
