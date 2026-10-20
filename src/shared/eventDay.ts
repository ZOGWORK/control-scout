// Which day is it at the event? FIRST lists an event's dates as calendar dates
// in its venue's own time zone ("2026-10-18" in Los Angeles), so "is it on now"
// is answered on that calendar, never on UTC's: 02:00 UTC on the 19th is still
// the evening of the 18th in Los Angeles, and 16:00 UTC on the 18th is already
// the 19th in Brisbane. The event's status (upcoming / live / finished) and the
// live fast lane (server/data/live.ts isEventDay) both read this, so the status
// badge and the live panel always agree. Shared by the server and the offline
// reader in the browser.
import type { EventSummary } from "./api";

/** The calendar date (YYYY-MM-DD) at `now` in an IANA zone; null for an unknown zone. */
export function localDate(now: number, zone: string): string | null {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
  } catch { return null; }
}

/**
 * The dates it can be "today" at the event at `now`: its own date when its zone
 * is a known IANA zone; otherwise (no zone, or one Intl doesn't know) every date
 * that is today somewhere on Earth, UTC−12 … UTC+14.
 */
export function eventToday(now: number, zone: string | null | undefined): { from: string; to: string } {
  const d = zone ? localDate(now, zone) : null;
  if (d) return { from: d, to: d };
  return { from: new Date(now - 12 * 3600_000).toISOString().slice(0, 10), to: new Date(now + 14 * 3600_000).toISOString().slice(0, 10) };
}

export interface EventCalendar { start: string | null; end: string | null; timezone: string | null }

/** Is today (at the event, see eventToday) one of the event's dates? */
export function onEventDates(e: EventCalendar, now = Date.now()): boolean {
  if (!e.start) return false;
  const { from, to } = eventToday(now, e.timezone);
  return e.start <= to && (e.end ?? e.start) >= from;
}

/**
 * The event's status by its venue's calendar: upcoming before its first date,
 * finished after its last, live on its dates, except that once every scheduled
 * match has a result it is finished. The clock alone never makes a match
 * "being played"; that's the live data's job.
 */
export function eventStatus(e: EventCalendar, played: number, total: number, now = Date.now()): EventSummary["status"] {
  const { from, to } = eventToday(now, e.timezone);
  if (e.start && e.start > to) return "upcoming";
  if ((e.end ?? e.start ?? "") < from) return "finished";
  return played && played >= total && total > 0 ? "finished" : "live";
}
