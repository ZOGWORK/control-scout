// When the offline packs are rebuilt, and how much of them. Kept out of the data cycle so the rule can be tested
// without a database: the cycle asks, and builds what this says.
//
// Predictions at a venue come from the lite pack (about 1.6 MB: every season's rating book). A pack built yesterday
// morning is yesterday's ratings, so on a day an event is running the packs are rebuilt at the sync's own pace —
// every 15 minutes on the VM — rather than once a day. Every other day the daily build rebuilds all of them, past
// seasons included; an event-day build rebuilds only the current season's and carries the frozen ones forward
// (carriedSeason in ./build.ts), so the same tens of megabytes aren't written out all weekend.
//
// Missing or unreadable packs, and a new engine version, rebuild everything: a release's ratings carry state older
// packs lack.

export interface PackBuildState {
  /** When the last build finished (kv packs:last), or null when no build has stamped one here. */
  lastBuiltAt: string | null;
  /** Now, in ms. */
  now: number;
  /** Any event running today ±1 day: the same test the sync's own cadence uses. */
  eventDay: boolean;
  /** The event-day sync interval in minutes (EVENT_DAY_SYNC_MINUTES, else 15 in a child cycle, 60 in-process). */
  eventDayMinutes: number;
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

/** What the cycle does now: build at once (all of them), or wait (and then build the current season's only). */
export function packsDue(s: PackBuildState): PackBuild {
  // Nothing built here yet, the files a manifest names are gone, or the engine moved: everything, now.
  if (!s.present || !s.lastBuiltAt || s.packsEngine !== s.engine) return { due: true, scope: "all" };
  const age = s.now - Date.parse(s.lastBuiltAt);
  if (!Number.isFinite(age)) return { due: true, scope: "all" };
  const gap = s.eventDay ? Math.max(1, s.eventDayMinutes) * 60_000 : PACKS_EVERY_MS;
  return { due: age >= gap, scope: s.eventDay ? "current" : "all" };
}
