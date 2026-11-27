// When the offline packs are rebuilt, and how much of them. Kept out of the data cycle so the rule can be tested
// without a database: the cycle asks, and builds what this says.
//
// Predictions at a venue come from the lite pack (about 4.4 MB: every season's rating book). A pack built yesterday
// morning is yesterday's ratings, so on a day an event is running the lite pack is rebuilt as soon as the sync has
// brought new data — the sync runs every 15 minutes on the VM, and a cycle that found nothing new builds nothing —
// rather than once a day. Every other day the daily build rebuilds all of them, past seasons included.
//
// The current season's full pack (13 MB, about 11 s to build on the VM) follows on an event day at most once an hour
// (CURRENT_PACK_EVERY_MS): nothing at a venue needs it at the sync's pace (the event the person is at can be saved as
// its own event-day bundle, built on request: ./bundle.ts), and every new copy is a 3.6 MB download for each phone that
// saved the season, which updates by itself (src/lib/offline/updateWatcher.tsx). It catches up within the hour even
// when no more data arrives, so the day's last results are in it that evening, not at the next daily build. The frozen
// seasons are carried forward on an event day (carriedSeason in ./build.ts), and so is the current season's between
// its builds: the same bytes (and hash) under the new release's name, so a saved copy isn't downloaded again, and the
// file keeps its own data time (BuiltFile.dataAsOf), so it never claims the newer release's.
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
  /** The data version the published packs (the lite pack) were built from (kv packs:data); null when it isn't recorded. */
  builtFrom: string | null;
  /** When the current season's full pack was last built rather than carried (kv packs:current-last), or null. */
  currentBuiltAt?: string | null;
  /** The data version the current season's full pack was built from (kv packs:current-data), or null. */
  currentFrom?: string | null;
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
  /** Which full packs to rebuild (the lite pack is always rebuilt): "lite" none, every full pack carried; "current" only
   *  the current season's; "all" every season's. */
  scope: "lite" | "current" | "all";
}

/** Rebuilt once a day when no event is running: 23 h, the margin the daily rule has always had. */
export const PACKS_EVERY_MS = 23 * 3600_000;

/** On an event day, the current season's full pack is rebuilt at most this often (the lite pack follows every sync). */
export const CURRENT_PACK_EVERY_MS = 60 * 60_000;

/** The full-pack scopes as buildPacks' `only` (null: every season's). */
export const onlySeasons = (scope: PackBuild["scope"], current: number): number[] | null =>
  scope === "all" ? null : scope === "current" ? [current] : [];

/** What the cycle does now: build at once (all of them); on an event day the lite pack after a sync that brought new
 *  data, with the current season's full pack once it's an hour old and behind; or nothing. */
export function packsDue(s: PackBuildState): PackBuild {
  // Nothing built here yet, the files a manifest names are gone, or the engine moved: everything, now.
  if (!s.present || !s.lastBuiltAt || s.packsEngine !== s.engine) return { due: true, scope: "all" };
  const age = s.now - Date.parse(s.lastBuiltAt);
  if (!Number.isFinite(age)) return { due: true, scope: "all" };
  if (s.eventDay) {
    // A version a build didn't read (or none recorded) is new data.
    const behind = (from: string | null | undefined) => !from || !s.dataVersion || from !== s.dataVersion;
    const fullAge = s.currentBuiltAt ? s.now - Date.parse(s.currentBuiltAt) : NaN;
    // Built under an hour ago (a time in the future, after the clock moved back, counts as old): carried meanwhile.
    const recent = fullAge >= 0 && fullAge < CURRENT_PACK_EVERY_MS;
    if (behind(s.currentFrom) && !recent) return { due: true, scope: "current" };
    return { due: behind(s.builtFrom), scope: "lite" };
  }
  return { due: age >= PACKS_EVERY_MS, scope: "all" };
}

/** kv: when the current season's full pack was last built rather than carried, and from which data version. */
export const CURRENT_PACK_LAST = "packs:current-last";
export const CURRENT_PACK_DATA = "packs:current-data";
