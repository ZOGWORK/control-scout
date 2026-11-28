// A team's next match: the one rule its team page (src/pages/TeamPage.tsx Upcoming), the "This weekend" page and
// search ("4215 next match": server/api/weekend.ts) all read, so each shows the same match.
import type { MatchView } from "./api";
import { eventOver, type EventCalendar } from "./eventDay";

/** One of the team's events, as the rule reads it. */
export interface NextMatchEvent extends EventCalendar { season: number; code: string; name: string; type: string | null; start: string | null; end: string | null; timezone: string | null }

/** How long after its posted start a match with no result stops being "next": it's running late, not next. */
export const LATE_MS = 30 * 60_000;

/** The team's next match on a posted schedule, soonest first (not played, its event not over); null when none is posted. */
export function nextMatchOf(matches: MatchView[], events: (EventCalendar & { code: string })[], now = Date.now()): MatchView | null {
  const live = new Set(events.filter((e) => !eventOver(e, now)).map((e) => e.code));
  // A match whose start passed over half an hour ago without a result is late, not next.
  return matches.find((m) => !m.played && live.has(m.code) && (!m.startsAt || Date.parse(m.startsAt) > now - LATE_MS)) ?? null;
}

/** A card's next match: the earliest unplayed one whose start hasn't passed by more than a schedule's slack (a match
 *  with no posted instant gets a longer grace, read as event-local time in UTC). Home's "Your teams" card reads it,
 *  and so does the compact `next` that /api/teams-summary returns (?next=1): one rule, one answer. */
export function upcomingMatchOf(matches: MatchView[], now = Date.now()): MatchView | undefined {
  const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : m.time ? Date.parse(`${m.time.replace(/Z$/, "")}Z`) : NaN);
  const slack = (m: MatchView) => (m.startsAt ? 12 : 26) * 3600_000;
  return matches
    .filter((m) => !m.played && (!Number.isFinite(at(m)) || at(m) > now - slack(m)))
    .sort((a, b) => (Number.isFinite(at(a)) ? at(a) : Infinity) - (Number.isFinite(at(b)) ? at(b) : Infinity))[0];
}
