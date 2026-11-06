// The /search page's events in sections (src/pages/SearchPage.tsx): status first, then date, then each event or
// family (./eventFamilies.ts), so a visitor sees what is on now, what is coming and when, and what is over without
// reading every card. Live now (any event under way) comes first, by start; then Upcoming, soonest first, a section a
// day this week ("Today, Nov 6, 2026", "Tomorrow, …") and a section a week after that ("Week of Nov 16, 2026");
// Finished last, newest first, sectioned the same way. A family is placed whole, by its status and its first day.
// Nothing here names an event, a date or a type: it works on any list.
import type { SearchHit } from "../../../shared/api";
import { weekOf } from "../../../pages/eventsList";
import { eventFacts } from "./results";
import { eventGroups, familyDates, familyStatus, type EventGroup, type FamilyStatus } from "./eventFamilies";

export interface DateSection { key: string; title: string | null; groups: EventGroup[]; count: number }
export interface StatusSection { status: FamilyStatus; title: string; count: number; dates: DateSection[] }

/** Today on the viewer's own calendar: the day "Today" and "Tomorrow" are read on. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TITLE: Record<FamilyStatus, string> = { live: "Live now", upcoming: "Upcoming", finished: "Finished" };
const DAY_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });
const at = (d: string) => new Date(`${d}T00:00:00Z`);
const addDays = (d: string, n: number) => { const x = at(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** An event's or a family's status: an event under way with no end stored ("started") is live. */
export function groupStatus(g: EventGroup, today?: string): FamilyStatus {
  if (g.kind === "family") return familyStatus(g.family, today);
  const s = eventFacts(g.hits[0], today).status;
  return s === "started" ? "live" : s;
}
const groupStart = (g: EventGroup) => (g.kind === "family" ? familyDates(g.family).start : eventFacts(g.hits[0]).start);
/** How many events a group holds: the count every heading and tab says (a family is its finals and divisions). */
export const groupSize = (g: EventGroup) => (g.kind === "family" ? g.family.divisions.length + (g.family.finals ? 1 : 0) : g.hits.length);

/** The section a day falls in, from `today`: its own day this week (Today, Tomorrow, Yesterday, else its weekday),
 *  its week otherwise; no date, "Date to be announced". */
export function dateSection(start: string | null, today: string): { key: string; title: string } {
  if (!start) return { key: "tba", title: "Date to be announced" };
  if (weekOf(start) === weekOf(today)) {
    const rel = start === today ? "Today" : start === addDays(today, 1) ? "Tomorrow" : start === addDays(today, -1) ? "Yesterday" : WEEKDAY.format(at(start));
    return { key: start, title: `${rel}, ${DAY_YEAR.format(at(start))}` };
  }
  const w = weekOf(start);
  return { key: `week:${w}`, title: `Week of ${DAY_YEAR.format(at(w))}` };
}

/** The hits as status sections (only those with events, in the order Live now, Upcoming, Finished), each in date
 *  sections. Every hit is in exactly one; counts are events. */
export function eventSections(hits: SearchHit[], today: string): StatusSection[] {
  const by: Record<FamilyStatus, EventGroup[]> = { live: [], upcoming: [], finished: [] };
  for (const g of eventGroups(hits)) by[groupStatus(g, today)].push(g);
  // Soonest first (undated last) while live or to come; newest first once over. Stable: ties keep the server's order.
  const key = (g: EventGroup) => groupStart(g) ?? "9999";
  by.live.sort((a, b) => key(a).localeCompare(key(b)));
  by.upcoming.sort((a, b) => key(a).localeCompare(key(b)));
  by.finished.sort((a, b) => (groupStart(b) ?? "").localeCompare(groupStart(a) ?? ""));
  const out: StatusSection[] = [];
  for (const status of ["live", "upcoming", "finished"] as const) {
    const groups = by[status];
    if (!groups.length) continue;
    const dates: DateSection[] = [];
    if (status === "live") dates.push({ key: "live", title: null, groups, count: 0 });
    else for (const g of groups) {
      const d = dateSection(groupStart(g), today);
      const last = dates.at(-1);
      if (last?.key === d.key) last.groups.push(g); else dates.push({ ...d, groups: [g], count: 0 });
    }
    for (const d of dates) d.count = d.groups.reduce((n, g) => n + groupSize(g), 0);
    out.push({ status, title: TITLE[status], count: dates.reduce((n, d) => n + d.count, 0), dates });
  }
  return out;
}
