// How fresh the last data sync is, as a stat tile tone (owner console: Overview and Data & sync).
import type { Tone } from "../StatTile";

/** Hours after which the last data sync reads as late (the data cycle runs far more often). */
export const SYNC_LATE_HOURS = 6;
/** Four late windows in a row reads as very late. */
export const SYNC_VERY_LATE_HOURS = SYNC_LATE_HOURS * 4;

/** v8: green while fresh, orange when late, red when very late (or never). */
export function syncTone(at: string | null | undefined, now = Date.now()): Tone {
  const age = at ? (now - new Date(at).getTime()) / 3600e3 : Infinity;
  return age > SYNC_VERY_LATE_HOURS ? "rose" : age > SYNC_LATE_HOURS ? "orange" : "emerald";
}
