// The Predict Lab's event list (Advancement, step 2): which events to offer and how the
// search box matches them. Pure, so the rules are tested without rendering the page.
import type { EventListItem } from "../shared/api";
import { regionNames } from "../shared/regions";

/** Event types that advance teams: the only ones the advancement lab can simulate. */
export const ADVANCING = new Set(["LeagueTournament", "Qualifier", "Championship", "SuperQualifier", "Premier", "FIRSTChampionship"]);

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Whether an event matches a search: every word of it appears in the event's name, code, city,
 * state or country, full region names included ("Texas" for TX, "New Jersey" for NJ).
 * Word by word, so "Athens AL", "Edinburg, Texas" and "texas qualifier" all match.
 */
export function eventMatches(e: Pick<EventListItem, "name" | "code" | "city" | "state" | "country">, q: string): boolean {
  const words = fold(q).split(/[\s,]+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(`${e.name} ${e.code} ${e.city ?? ""} ${e.state ?? ""} ${e.country ?? ""} ${regionNames(e.state, e.country)}`);
  return words.every((w) => hay.includes(w));
}

export interface LabEventChoices {
  /** Events to list, by date. */
  list: EventListItem[];
  /** The list is the chosen team's events only. */
  teamOnly: boolean;
  /** Advancing events the team is registered at this season (null: no team chosen). */
  teamCount: number | null;
  /** Events that match the search but don't advance teams (scrimmages, league meets), to explain an empty list. */
  otherMatches: number;
}

/**
 * The events step 2 offers. With a team chosen (`teamCodes`, the codes of the events it's registered at
 * that season), only its advancing events, unless `showAll`; without one, every advancing event.
 */
export function labEventChoices(events: EventListItem[], o: { teamCodes: Set<string> | null; q: string; showAll?: boolean }): LabEventChoices {
  const advancing = events.filter((e) => ADVANCING.has(e.type ?? ""));
  const teamCount = o.teamCodes ? advancing.filter((e) => o.teamCodes!.has(e.code)).length : null;
  const teamOnly = !!o.teamCodes && !o.showAll;
  const list = advancing
    .filter((e) => (!teamOnly || o.teamCodes!.has(e.code)) && eventMatches(e, o.q))
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name));
  const otherMatches = o.q.trim() && !list.length
    ? events.filter((e) => !ADVANCING.has(e.type ?? "") && (!teamOnly || o.teamCodes!.has(e.code)) && eventMatches(e, o.q)).length
    : 0;
  return { list, teamOnly, teamCount, otherMatches };
}

/** Today as YYYY-MM-DD in local time, the way event dates are written. */
export const todayIso = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Still to come (or on now): ends today or later. Dateless events count as upcoming. */
const isUpcoming = (e: EventListItem, today: string) => (e.end ?? e.start ?? "9999") >= today;
/** Upcoming first, nearest first; then past ones, most recent first. */
const byNearest = (today: string) => (a: EventListItem, b: EventListItem) => {
  const ua = isUpcoming(a, today), ub = isUpcoming(b, today);
  if (ua !== ub) return ua ? -1 : 1;
  const d = ua ? (a.start ?? "9999").localeCompare(b.start ?? "9999") : (b.start ?? "").localeCompare(a.start ?? "");
  return d || a.name.localeCompare(b.name);
};

export interface PickerResults {
  /** Rows to show, in order (at most `limit`). */
  list: EventListItem[];
  /** Every event the search (or suggestion set) found, before the cap. */
  total: number;
  /** Suggestions (nothing typed yet), or search results. */
  mode: "suggested" | "search";
  /** The suggestions are the chosen team's events (else the season's nearest). */
  teamSuggestions: boolean;
  /** With advancing-only on: events that match the search but don't advance teams, to explain an empty list. */
  otherMatches: number;
}

/** How many suggestions show before anything is typed, and the most search results ever rendered. */
export const SUGGEST_LIMIT = 8;
export const RESULT_LIMIT = 50;

/**
 * The event search picker's rows. Nothing typed: a few suggestions, the team's events when there are any
 * (upcoming first), else the season's events nearest today. Typed: every match, the team's events first
 * (never only them), then an exact code or a name that starts with the search, then nearest by date.
 */
export function pickerResults(events: EventListItem[], o: { q: string; teamCodes?: Set<string> | null; advancingOnly?: boolean; today?: string; limit?: number }): PickerResults {
  const today = o.today ?? todayIso();
  const advancingOnly = o.advancingOnly ?? true;
  const pool = advancingOnly ? events.filter((e) => ADVANCING.has(e.type ?? "")) : events;
  const nearest = byNearest(today);
  const q = o.q.trim();
  const isTeam = (e: EventListItem) => !!o.teamCodes?.has(e.code);
  if (!q) {
    const team = o.teamCodes ? pool.filter(isTeam) : [];
    const from = team.length ? team : pool;
    return { list: [...from].sort(nearest).slice(0, SUGGEST_LIMIT), total: Math.min(from.length, SUGGEST_LIMIT), mode: "suggested", teamSuggestions: team.length > 0, otherMatches: 0 };
  }
  const lower = q.toLowerCase();
  const strong = (e: EventListItem) => (e.code.toLowerCase() === lower || e.name.toLowerCase().startsWith(lower) ? 0 : 1);
  const hits = pool.filter((e) => eventMatches(e, q))
    .sort((a, b) => Number(isTeam(b)) - Number(isTeam(a)) || strong(a) - strong(b) || nearest(a, b));
  const otherMatches = advancingOnly && !hits.length ? events.filter((e) => !ADVANCING.has(e.type ?? "") && eventMatches(e, q)).length : 0;
  return { list: hits.slice(0, o.limit ?? RESULT_LIMIT), total: hits.length, mode: "search", teamSuggestions: false, otherMatches };
}
