// A team's name from the snapshots saved on this device, for the team-number boxes' hint (components/TeamInput.tsx)
// when the server can't be reached: the event packs' names (the ones GET /api/predict/match reads, as the offline
// call names its teams: predictCall.ts), else the lite pack's team list. Loaded lazily, only once a name lookup
// couldn't reach the server, like the rest of lib/offline.
import { loadLite, packStatus } from "../packs";
import { bundleTime } from "../../shared/eventBundle";
import { savedBundles } from "./bundleMeta";
import { loadBundle } from "./bundles";

/** The name a saved snapshot holds for team `n` ("" for a team it holds with no name), or undefined when none holds
 *  the team (it may still exist: a pack only has its event's teams, the lite pack only teams with results). */
export async function savedTeamName(n: number): Promise<string | undefined> {
  const metas = savedBundles().filter((b) => b.teams?.includes(n)).sort((a, b) => bundleTime(b).localeCompare(bundleTime(a)));
  for (const meta of metas) {
    const b = await loadBundle(meta.season, meta.code).catch(() => null);
    if (!b) continue;
    const row = b.predict?.names.find(([t]) => t === n) ?? b.event.field.map((f) => [f.team, f.name ?? null] as const).find(([t]) => t === n);
    if (row) return row[1] ?? "";
  }
  // The lite pack only when one is saved: never a download or a decode for nothing.
  if (!packStatus()) return undefined;
  const pack = await loadLite().catch(() => null);
  const row = pack?.teams.find(([t]) => t === n);
  return row ? row[1] ?? "" : undefined;
}
