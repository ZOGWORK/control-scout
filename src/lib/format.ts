// Formatting helpers shared by every page. The pure ones live in src/shared/format.ts (the server's light pages use them too).

import { DEVICE_LATEST } from "../shared/scoutEntry";

import { dateRange } from "../shared/format";
export { pct, oddsPct, num, int, rankPct, dateRange, place, matchTime, matchDateTime, seasonLabel, awardLabel } from "../shared/format";

export function ago(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** A day as the rest of the app writes one ("Oct 31, 2026"), for "as of" and "released" stamps: dateRange's own
 *  rule (fixed month names, month first) on the local calendar day. The browser's toLocaleDateString() gave
 *  "10/31/2026", or "31 oct. 2026" in another language, beside event dates written "Oct 31, 2026". */
export function dayDate(at: string | number | Date): string {
  const d = new Date(at);
  return dateRange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
}

/** To the second, for live freshness: "just now", "40 s ago", "3 min ago" (then like ago()). */
export function agoSeconds(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return ago(iso);
}

/**
 * Is this a time an entry can really have been saved at? A whole-millisecond stamp after 1970 and before 2100
 * (DEVICE_LATEST, src/shared/scoutEntry.ts). 0 is what the stored-row repair writes for an impossible one; missing,
 * negative and far-future values are unknown too. Shown as "time unknown", never "56 years ago" or a 1970 date.
 */
export function isKnownTime(ms: unknown): ms is number {
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0 && ms <= DEVICE_LATEST;
}

/** Short relative time for attributions: "just now", "2m ago", "3h ago", "4d ago", then the date. */
export function agoShort(ms: number, now = Date.now()): string {
  if (!Number.isFinite(new Date(ms).getTime())) return "time unknown";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(new Date(ms).getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}) });
}
