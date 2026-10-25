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
