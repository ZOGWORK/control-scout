// /next: a team's next match. The events it is entered in are read in order (the earliest that isn't over first), and
// the first unplayed match it is in is the answer — the same order the follow posts read a schedule in (bot/follows.ts),
// so a match with no posted time still counts. Pure and tested: the lookup around it (bot/lookups.ts) fetches the events.
import type { EventDetail, MatchView } from "../src/shared/api.js";

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
