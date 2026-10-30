// When the email digest goes out: SENDS_PER_WEEK times a week, at random times. Each ISO week (Monday to Sunday,
// New York dates) gets its own slots: SENDS_PER_WEEK different days, never two in a row within the week, each at a random minute
// between FIRST_HOUR:00 and LAST_HOUR:59 New York time (no email in the middle of the night), through daylight saving.
//
// "Random" is drawn from a hash of the week, not Math.random: every server, restart and re-run agrees on the same
// times, so a slot is sent once however many processes see it (the send log's key is the slot). Nobody is told
// the times (the app never names a send day or time).
//
// A slot that a server was down for catches up later the same New York day, never the next: the email's contents
// are counted up to the day before it, and the next slot starts from its date. Pure: times in, times out.
import { createHash } from "node:crypto";
import { localDate } from "../powerRankings/schedule.js";
import { localToUtcMs } from "../../src/shared/time.js";

export const SENDS_PER_WEEK = 3;
export const FIRST_HOUR = 9;
export const LAST_HOUR = 19;
const ZONE = "America/New_York";
const DAY = 86_400_000;

export interface Slot {
  /** The send log's key: the New York date and time, "2026-11-04T14:37". */
  key: string;
  /** The New York date it goes out on. */
  date: string;
  /** When, UTC ms. */
  at: number;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
/** The Monday (New York date) of the week a New York date falls in. */
export const mondayOf = (date: string) => addDays(date, -weekday(date));

/** Every choice of SENDS_PER_WEEK days out of seven with no two in a row (Monday 0 … Sunday 6), in a fixed order. */
const PATTERNS: number[][] = (() => {
  const out: number[][] = [];
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === SENDS_PER_WEEK) { out.push(chosen); return; }
    for (let d = from; d < 7; d++) pick(d + 2, [...chosen, d]);
  };
  pick(0, []);
  return out;
})();

/** The week's send slots, earliest first. `monday`: the week's Monday, New York date. */
export function slotsOfWeek(monday: string): Slot[] {
  const h = createHash("sha256").update(`control-scout digest ${monday}`).digest();
  const days = PATTERNS[h.readUInt32BE(0) % PATTERNS.length];
  const span = (LAST_HOUR - FIRST_HOUR + 1) * 60;
  return days.map((d, i) => {
    const date = addDays(monday, d);
    const minute = FIRST_HOUR * 60 + (h.readUInt32BE(4 + i * 4) % span);
    const hh = String(Math.floor(minute / 60)).padStart(2, "0"), mm = String(minute % 60).padStart(2, "0");
    const at = localToUtcMs(`${date}T${hh}:${mm}:00`, ZONE);
    if (at == null) throw new Error(`no instant for ${date} ${hh}:${mm} in ${ZONE}`);
    return { key: `${date}T${hh}:${mm}`, date, at };
  });
}

/** A one-off slot at `now` (the owner's "send now"): keyed by its New York date and minute, like a scheduled one. */
export function slotAt(now: number): Slot {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { key: `${date}T${p.hour}:${p.minute}`, date, at: now };
}

/** The slot due at `now`: the latest one whose time has come, as long as it's still its New York day. Else null. */
export function dueSlot(now: number): Slot | null {
  const today = localDate(now);
  return slotsOfWeek(mondayOf(today)).filter((s) => s.date === today && s.at <= now).at(-1) ?? null;
}

/** The slot before this one (it may be in the previous week). */
export function previousSlot(s: Slot): Slot {
  const monday = mondayOf(s.date);
  const before = slotsOfWeek(monday).filter((x) => x.at < s.at);
  return before.at(-1) ?? slotsOfWeek(addDays(monday, -7)).at(-1)!;
}

/** The first slot after `now` (or after a slot's time). */
export function nextSlot(now: number): Slot {
  const monday = mondayOf(localDate(now));
  return slotsOfWeek(monday).find((x) => x.at > now) ?? slotsOfWeek(addDays(monday, 7))[0];
}
