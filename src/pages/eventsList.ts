// The Events list's pure logic: filtering, grouping by week and the batch of
// cards to render (the page renders a bounded first batch and adds more as you
// scroll, so a season of 1,300+ events stays light on a phone).
import type { EventListItem } from "../shared/api";
import { regionNames } from "../shared/regions";

export type Status = "all" | "live" | "upcoming" | "finished";
/** Video to watch: any event, events with a recording (match clips included), or events whose matches link to their own video. */
export type VideoFilter = "all" | "recording" | "clips";
export interface Filters { region: string | null; type: string; status: Status; from: string | null; to: string | null; q: string; video?: VideoFilter }

/** The status a query string names, "all" included; null when it names none. */
export const statusParam = (v: string | null): Status | null =>
  v === "all" || v === "live" || v === "upcoming" || v === "finished" ? v : null;

/** Picking a video filter never dead-ends: when the status picked has no event with that video, the status goes
 *  back to All (only finished events have a recording, so "Upcoming" + "Match clips" would show nothing). The patch
 *  for the filter bar's `set`. */
export function videoPick(events: EventListItem[], f: Filters, video: VideoFilter): Record<string, string | null> {
  const p: Record<string, string | null> = { video };
  if (video !== "all" && f.status !== "all" && !applyFilters(events, { ...f, video }).some((e) => e.status === f.status)) p.status = null;
  return p;
}

/** And the other way round: a status with nothing under the video filter picked drops the video filter. */
export function statusPick(events: EventListItem[], f: Filters, status: Status): Record<string, string | null> {
  const p: Record<string, string | null> = { status };
  if (f.video && f.video !== "all" && status !== "all" && !applyFilters(events, f).some((e) => e.status === status)) p.video = null;
  return p;
}

/** The filters as written in a query string (the Events page's URL, or Scout's picker's own state): anything unknown reads as "all". */
export function readFilters(get: (k: string) => string | null): Filters & { video: VideoFilter } {
  const status = get("status");
  const video = get("video");
  return {
    region: get("region"), type: get("type") ?? "all", from: get("from"), to: get("to"), q: get("q") ?? "",
    status: status === "live" || status === "upcoming" || status === "finished" ? status : "all",
    video: video === "clips" || video === "recording" ? video : "all",
  };
}

/** Cards in the first render, and how many each "more" adds. */
export const FIRST_EVENTS = 24;
export const MORE_EVENTS = 36;

/** Monday of the week (UTC) that holds a YYYY-MM-DD date. */
export const weekOf = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

/** A place key: "USA:NJ" (country:state) or a country alone ("Mexico"). */
export const placeKey = (e: Pick<EventListItem, "country" | "state">) => (e.country ? (e.state ? `${e.country}:${e.state}` : e.country) : "");
const placeMatches = (e: EventListItem, key: string) => (key.includes(":") ? `${e.country}:${e.state}` === key : e.country === key);

/** Every filter but status (the status chips count what each one would show). */
export function applyFilters(events: EventListItem[], f: Omit<Filters, "status">): EventListItem[] {
  const needle = f.q.trim().toLowerCase();
  return events.filter((e) =>
    (f.type === "all" || e.type === f.type)
    && (!f.video || f.video === "all" || (f.video === "clips" ? e.video === "clips" : !!e.video))
    && (!f.region || placeMatches(e, f.region))
    && (!f.from || (e.end ?? e.start ?? "") >= f.from)
    && (!f.to || (!!e.start && e.start <= f.to))
    && (!needle || `${e.name} ${e.code} ${e.city ?? ""} ${e.state ?? ""} ${e.country ?? ""} ${regionNames(e.state, e.country)}`.toLowerCase().includes(needle)));
}

export type Week = [week: string, events: EventListItem[]];

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byName = new Intl.Collator();

/** Events by week ("TBA" when undated), each week sorted by date then name; current and upcoming weeks first, then the past (newest first). */
export function groupWeeks(list: EventListItem[], thisWeek: string): Week[] {
  const m = new Map<string, EventListItem[]>();
  const weekByDay = new Map<string, string>(); // many events share a start date
  for (const e of list) {
    let w = "TBA";
    if (e.start) { w = weekByDay.get(e.start) ?? weekOf(e.start); weekByDay.set(e.start, w); }
    const evs = m.get(w);
    if (evs) evs.push(e); else m.set(w, [e]);
  }
  // ISO dates compare as plain strings; names through one shared collator (String#localeCompare per pair
  // was the costliest part of a 1,300-event render on a phone).
  for (const evs of m.values()) evs.sort((a, b) => cmp(a.start ?? "", b.start ?? "") || byName.compare(a.name, b.name));
  const groups = [...m.entries()].sort(([a], [b]) => cmp(a, b));
  return [...groups.filter(([w]) => w >= thisWeek), ...groups.filter(([w]) => w < thisWeek).reverse()];
}

/** The first `budget` events, whole weeks in order with the last one cut; each week keeps its full count for its header. */
export function takeBatch(weeks: Week[], budget: number): { shown: [week: string, events: EventListItem[], total: number][]; hidden: number } {
  const shown: [string, EventListItem[], number][] = [];
  let left = budget, total = 0, rendered = 0;
  for (const [w, evs] of weeks) {
    total += evs.length;
    if (left <= 0) continue;
    const cut = evs.slice(0, left);
    shown.push([w, cut, evs.length]);
    rendered += cut.length;
    left -= cut.length;
  }
  return { shown, hidden: total - rendered };
}
