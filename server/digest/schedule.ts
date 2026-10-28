// When the weekly digest goes out: Mondays at 08:00 America/New_York, whatever the server's own zone, through
// daylight saving changes. A server that was down at 08:00 catches up later that Monday (New York date), never
// on Tuesday: a "Monday" email that turns up mid-week reads as a mistake. Pure: times in, times out.
import { localDate, localMidnight } from "../powerRankings/schedule.js";

export const SEND_HOUR = 8;
const HOUR = 3_600_000;

/** The digest week due at `now` (its Monday, New York date), or null outside Monday 08:00–24:00 New York time. */
export function dueWeek(now: number): string | null {
  const day = localDate(now);
  if (new Date(`${day}T12:00:00Z`).getUTCDay() !== 1) return null;
  // Daylight saving never changes on a Monday, so midnight plus eight hours is 08:00 local.
  return now >= localMidnight(day) + SEND_HOUR * HOUR ? day : null;
}

/** The next send time after `now`, UTC ms (for the owner and the docs). */
export function nextSend(now: number): number {
  let day = localDate(now);
  for (let i = 0; i < 8; i++) {
    const at = localMidnight(day) + SEND_HOUR * HOUR;
    if (new Date(`${day}T12:00:00Z`).getUTCDay() === 1 && at > now) return at;
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  }
  throw new Error("no Monday within a week");
}
