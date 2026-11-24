// /next: a team's next match. The events it is entered in are read in order (the earliest that isn't over first), and
// the first unplayed match it is in is the answer — the same order the follow posts read a schedule in (bot/follows.ts),
// so a match with no posted time still counts. Pure and tested: the lookup around it (bot/lookups.ts) fetches the events.
import type { EventDetail, MatchView } from "../src/shared/api.js";
import { eventOver, type EventCalendar } from "../src/shared/eventDay.js";

/** The events to look in, at most this many: a team is not in two on one weekend, and reading every one it has ever
 *  been in for "the next match" would be calls for nothing. */
export const AHEAD = 3;

/**
 * The events that aren't over yet, earliest first, capped at AHEAD. "Over" is read on the venue's own calendar
 * (src/shared/eventDay.ts), never on UTC: at 19:30 in New York on the 24th it is already the 25th in UTC, and a match
 * still to be played that evening must not drop out of "next".
 */
export function aheadEvents<T extends EventCalendar & { start: string | null }>(events: readonly T[], now = Date.now()): T[] {
  // An event with no date published yet is not over (eventOver says so) and is kept, after the dated ones: its team is
  // entered in it, and "nothing scheduled" must be able to name it.
  return events.filter((e) => !eventOver(e, now)).sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999")).slice(0, AHEAD);
}

/** Schedule order at one event: qualifications before playoffs, then series and number. */
const order = (a: MatchView, b: MatchView) =>
  (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;

/** Whether the team is in the match's lineup, on either side (a playoff alliance's third robot included). */
const plays = (m: MatchView, team: number) => [...m.red.teams, ...m.blue.teams].some((t) => t.number === team);

/** Whether the team is in the event at all (a schedule posted with any of its matches): what tells "its matches there
 *  are all played" from "no schedule has it yet", which are different answers. */
export const inEvent = (event: EventDetail, team: number) => event.matches.some((m) => plays(m, team));

export interface NextMatch {
  event: EventDetail;
  match: MatchView;
}

/**
 * The team's next unplayed match: the first of `details` (its events, in the order the caller read them) with one, and
 * that event's first unplayed match with the team in it. Null when none is scheduled yet — never a played match, and
 * never a guess at one.
 */
export function nextPlaying(details: readonly (EventDetail | null)[], team: number): NextMatch | null {
  for (const event of details) {
    if (!event) continue;
    const match = event.matches.filter((m) => !m.played && plays(m, team)).sort(order)[0];
    if (match) return { event, match };
  }
  return null;
}
