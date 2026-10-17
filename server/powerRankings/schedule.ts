// When automatic power rankings go out: every Friday at 00:00 America/New_York (the owner's time
// zone), whatever the server's own zone, through daylight saving changes. Pure: times in, times out.
//
// A server that was down at that moment catches up on its next tick, for as long as the Friday's ISO
// week lasts (until Monday 00:00 New York time): the week id is the ISO week of that Friday, so a
// week caught up on Monday would be a week late and is left for the next Friday instead.
import { PUBLISH_TIME_ZONE, weekIdOf } from "../../src/shared/powerRankings.js";

const DAY = 86_400_000;

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PUBLISH_TIME_ZONE, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});

/** The wall-clock parts in New York at an instant. */
function parts(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second) };
}

/** New York's offset from UTC at an instant, in ms (-4 h in summer, -5 h in winter). */
function offset(ms: number): number {
  const p = parts(ms);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The New York calendar date of an instant, "YYYY-MM-DD". */
export function localDate(ms: number): string {
  const p = parts(ms);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The instant a New York calendar date begins (its 00:00 local), in UTC ms. */
export function localMidnight(date: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`);
  // Midnight is never inside a New York DST jump (they happen at 02:00), so two passes settle it.
  let t = guess - offset(guess);
  t = guess - offset(t);
  return t;
}

export interface PublishSlot {
  /** The Friday (New York date) the week is published on. */
  friday: string;
  /** That Friday's 00:00 New York time, UTC ms. */
  at: number;
  /** The ISO week of that Friday: the week's id ("2026-w43"). */
  week: string;
  /** Until when a missed run may still catch up (the next Monday 00:00 New York time), UTC ms. */
  until: number;
}

/** The slot for a Friday (New York date). */
export function slotFor(friday: string): PublishSlot {
  return { friday, at: localMidnight(friday), week: weekIdOf(new Date(`${friday}T12:00:00Z`)), until: localMidnight(addDays(friday, 3)) };
}

/** The most recent Friday 00:00 New York time at or before `now`. */
export function latestSlot(now: number): PublishSlot {
  const today = localDate(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sunday … 5 Friday
  return slotFor(addDays(today, -((weekday - 5 + 7) % 7)));
}

/** The slot a tick at `now` should publish, or null outside a Friday-to-Sunday window (nothing due). */
export function dueSlot(now: number): PublishSlot | null {
  const s = latestSlot(now);
  return now >= s.at && now < s.until ? s : null;
}

/** The next Friday 00:00 New York time after `now` (the owner portal's "next run"). */
export function nextSlot(now: number): PublishSlot {
  const s = latestSlot(now);
  return now < s.at ? s : slotFor(addDays(s.friday, 7));
}
