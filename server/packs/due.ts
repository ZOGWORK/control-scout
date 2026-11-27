// When the offline packs are rebuilt, and how much of them. Kept out of the data cycle so the rule can be tested
// without a database: the cycle asks, and builds what this says.
//
// Predictions at a venue come from the lite pack (about 1.6 MB: every season's rating book). A pack built yesterday
// morning is yesterday's ratings, so on a day an event is running the packs are rebuilt as soon as the sync has brought
// new data — the sync runs every 15 minutes on the VM, and a cycle that found nothing new builds nothing — rather than
// once a day. Every other day the daily build rebuilds all of them, past seasons included; an event-day build rebuilds
// only the current season's and carries the frozen ones forward (carriedSeason in ./build.ts), so the same tens of
// megabytes aren't written out all weekend.
//
// The test is the data version, not the clock: a build that takes minutes finishes with the version it read, and the
// next cycle asks whether the version has moved since — a build once every two cycles (what an interval measured from
// the last finish would have given) is exactly the stale pack this exists to prevent.
//
// Missing or unreadable packs, and a new engine version, rebuild everything: a release's ratings carry state older
// packs lack.

export interface PackBuildState {
  /** When the last build finished (kv packs:last), or null when no build has stamped one here. */
  lastBuiltAt: string | null;
  /** The data version the published packs were built from (kv packs:data); null when it isn't recorded. */
  builtFrom: string | null;
  /** The data version now (`dataVersion()`: kv data:version, "0" before any data). */
  dataVersion: string | null;
  /** Now, in ms. */
  now: number;
  /** Any event running today ±1 day: the same test the sync's own cadence uses. */
  eventDay: boolean;
  /** latest.json parses and every file it lists is on disk. */
  present: boolean;
  /** The engine version the published packs were built with (null when there are none). */
  packsEngine: string | null;
  /** The engine version this server runs. */
  engine: string;
}

export interface PackBuild {
  due: boolean;
  /** Which full packs to rebuild: "current" rebuilds only the current season's, "all" every season's. */
  scope: "current" | "all";
}

/** Rebuilt once a day when no event is running: 23 h, the margin the daily rule has always had. */
export const PACKS_EVERY_MS = 23 * 3600_000;

/** What the cycle does now: build at once (all of them), build the current season's after a sync that brought new data,
 *  or nothing. */
export function packsDue(s: PackBuildState): PackBuild {
  // Nothing built here yet, the files a manifest names are gone, or the engine moved: everything, now.
  if (!s.present || !s.lastBuiltAt || s.packsEngine !== s.engine) return { due: true, scope: "all" };
  const age = s.now - Date.parse(s.lastBuiltAt);
  if (!Number.isFinite(age)) return { due: true, scope: "all" };
  if (s.eventDay) {
    // A version this build didn't read (or none recorded) is new data: the current season's pack, the frozen ones carried.
    const moved = !s.builtFrom || !s.dataVersion || s.builtFrom !== s.dataVersion;
    return { due: moved, scope: "current" };
  }
  return { due: age >= PACKS_EVERY_MS, scope: "all" };
}
