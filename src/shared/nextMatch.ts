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
