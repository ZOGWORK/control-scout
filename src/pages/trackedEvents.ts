// The Events page's "Currently tracking" row, its pure logic: which tracked events are already in a
// loaded season list, which still need looking up, and the order they show in (live, then upcoming
// by date, then finished most recent first).
import type { EventListItem } from "../shared/api";
import { qs } from "../lib/api";

/** Tracked events shown before "N more". */
export const TRACKED_SHOWN = 6;
/** At most this many tracked events are looked up one by one (the rest wait for their season's list). */
export const TRACKED_LOOKUPS = 12;

export interface TrackedRef { ref: string; season: number; code: string }

/** "2025:USNJQ1" → { season: 2025, code: "USNJQ1" }; anything else → null. */
export function parseTracked(ref: string): TrackedRef | null {
  const i = ref.indexOf(":");
  const season = Number(ref.slice(0, i));
  const code = ref.slice(i + 1);
  return i > 0 && Number.isInteger(season) && code ? { ref, season, code } : null;
}

/** One event looked up on its own: the season list filtered by its code (a few rows, not the season). */
export const lookupPath = (r: TrackedRef) => `/api/events${qs({ season: r.season, q: r.code, all: 1, limit: 50 })}`;

const RANK: Record<EventListItem["status"], number> = { live: 0, upcoming: 1, finished: 2 };
const FAR = "9999-12-31";

/** Live first (earliest start first), then upcoming by date (no date last), then finished, most recent first. */
export function orderTracked<T extends Pick<EventListItem, "status" | "start" | "end" | "name">>(events: T[]): T[] {
  return [...events].sort((a, b) => {
    const r = RANK[a.status] - RANK[b.status];
    if (r) return r;
    if (a.status === "finished") return (b.end ?? b.start ?? "").localeCompare(a.end ?? a.start ?? "") || a.name.localeCompare(b.name);
    return (a.start ?? FAR).localeCompare(b.start ?? FAR) || a.name.localeCompare(b.name);
  });
}

/**
 * Split the tracked refs into events found in the lists at hand and the refs still unknown. `lists`
 * maps a season to its loaded list, and lookups (by path) to their answer; an answer of null means
 * that lookup failed or found nothing.
 */
export function resolveTracked(refs: string[], lists: Map<number, EventListItem[]>, lookups: Record<string, EventListItem[] | null | undefined>) {
  const found: EventListItem[] = [];
  const missing: TrackedRef[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const r = parseTracked(raw);
    if (!r || seen.has(r.ref)) continue;
    seen.add(r.ref);
    const hit = lists.get(r.season)?.find((e) => e.code === r.code) ?? lookups[lookupPath(r)]?.find((e) => e.code === r.code);
    if (hit) found.push(hit); else missing.push(r);
  }
  return { found: orderTracked(found), missing };
}
