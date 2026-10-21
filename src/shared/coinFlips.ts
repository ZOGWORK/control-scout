// The coin-flip radar (GET /api/home/coin-flips): today's matches, across every
// event on today, that the model calls closest: one side's win odds between 45%
// and 55%. "Today" is each event's own calendar date at its venue, never the
// server's UTC date. The calls are the ones the match pages already show (the
// live call logged before the match, else the call from today's ratings); the
// radar only gathers them. Calls resting on thin data (the provisional tier: a
// robot with fewer than three matches this season) are left out and counted.
// Shared by the server (server/api/coinFlips.ts) and the home page.
import type { ConfidenceTier } from "./api";
import { localDate } from "./eventDay";

/** A call is a coin flip when red's win odds are within this band (inclusive). */
export const COIN_FLIP_BAND = { lo: 0.45, hi: 0.55 } as const;

/** At most this many matches still to play, the soonest first, and this many decided ones, the latest first. */
export const MAX_UPCOMING = 40;
export const MAX_DECIDED = 12;

export interface CoinFlipRow {
  season: number;
  code: string;
  /** level:series:number, as the match page's URL takes it. */
  key: string;
  label: string;
  eventName: string;
  /** "City, State" or "City, Country" for the event (null: not listed). */
  place: string | null;
  /** The event's IANA zone; every row has one (a match's "today" can't be told without it). */
  timezone: string;
  /** The venue's calendar date the match is on (YYYY-MM-DD). */
  day: string;
  /** Event-local wall time as FIRST reports it (no zone), for "2:30 pm at the venue". */
  time: string | null;
  /** The real instant (UTC ISO), when known. */
  startsAt: string | null;
  red: number[];
  blue: number[];
  /** Red's win odds, never a flat 0 or 1, always within COIN_FLIP_BAND. */
  pRed: number;
  /** Never "provisional": those calls are left out. */
  tier: Exclude<ConfidenceTier, "provisional">;
  /** "live": the call logged before the match (the public record scores it); "now": from today's ratings, not logged yet. */
  kind: "live" | "now";
  played: boolean;
  /** Final scores once played (null before). */
  result: { red: number; blue: number } | null;
}

export interface CoinFlipTally { timezone: string; day: string; calls: number; thin: number }

export interface CoinFlipRadar {
  /** When the radar was gathered (server clock). */
  generatedAt: string;
  band: { lo: number; hi: number };
  /** Events on today at their venue with a published schedule for today. */
  events: number;
  /** Matches on today's schedules with a 2-on-2 call (the pool the coin flips come from). */
  calls: number;
  /** Close calls left out because a robot in them has too few matches this season. */
  thin: number;
  /** Per event with a schedule today: its venue date and its counts, so the totals above can follow the rows
   *  across a venue's midnight (see current() in server/api/coinFlips.ts). */
  tallies: CoinFlipTally[];
  /** Coin flips still to play (soonest first, at most MAX_UPCOMING) and decided ones with a pre-match call (latest first). */
  upcoming: CoinFlipRow[];
  decided: CoinFlipRow[];
}

export const inBand = (p: number) => p >= COIN_FLIP_BAND.lo && p <= COIN_FLIP_BAND.hi;

/** The venue's calendar date a match is on: an event-local wall time's own date, else its instant read in the zone. */
export function matchDay(time: string | null, startsAt: string | null, zone: string): string | null {
  if (time && !/(Z|[+-]\d\d:?\d\d)$/.test(time) && /^\d{4}-\d\d-\d\d/.test(time)) return time.slice(0, 10);
  const at = startsAt ? Date.parse(startsAt) : time ? Date.parse(time) : NaN;
  return Number.isFinite(at) ? localDate(at, zone) : null;
}

/** Is it still the row's day at its venue? (A stored radar keeps answering across a venue's midnight.) */
export const stillToday = (r: Pick<CoinFlipRow, "day" | "timezone">, now = Date.now()) => localDate(now, r.timezone) === r.day;

/** The match page a row opens. */
export const coinFlipHref = (r: Pick<CoinFlipRow, "season" | "code" | "key">) => `/events/${r.season}/${encodeURIComponent(r.code)}/match/${r.key}`;
