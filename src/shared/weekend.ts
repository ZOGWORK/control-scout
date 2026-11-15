// The "This weekend" answers (server/api/weekend.ts), as the page, the team page and search read them.
import type { ConfidenceTier } from "./api";
import { weekendWindow, type Weekend } from "./query/time";
import { localDate } from "./eventDay";

/** Today's date on an event's own calendar: UTC's when its time zone is unknown. */
export const dayAt = (now: number, tz: string | null | undefined): string => (tz ? localDate(now, tz) : null) ?? new Date(now).toISOString().slice(0, 10);

/** Whether the event (its first to last day) meets `which` weekend: the reader's (`today`, UTC's when not given), or
 *  its own when its calendar is still behind the reader's (a meet in Los Angeles on Sunday evening, when UTC's Monday
 *  has begun, is still this weekend's). A calendar ahead waits: Monday in Sydney doesn't move its next meet into the
 *  reader's "this weekend". */
export function inWeekend(e: { start: string | null; end: string | null; timezone?: string | null }, which: Weekend, now: number, today?: string | null): boolean {
  return inWindow(e, (d) => weekendWindow(which, d), now, today);
}

/** The same rule for any window read from a date (`windowAt`, "today", "this week"): the reader's window, or the
 *  event's own while its calendar is behind. */
export function inWindow(e: { start: string | null; end: string | null; timezone?: string | null }, windowAt: (today: string) => { from?: string | null; to?: string | null }, now: number, today?: string | null): boolean {
  if (!e.start) return false;
  const meets = (w: { from?: string | null; to?: string | null }) => (!w.to || e.start! <= w.to) && (!w.from || (e.end ?? e.start!) >= w.from);
  const ref = windowAt(today ?? new Date(now).toISOString().slice(0, 10));
  if (meets(ref)) return true;
  const own = windowAt(dayAt(now, e.timezone));
  return !!own.from && !!ref.from && own.from < ref.from && meets(own);
}

/** What the page and search say when a weekend has no event. */
export const noEventsLine = (which: Weekend, region: { name: string } | null): string => `No FTC events ${which} weekend${region ? ` in ${region.name}` : ""}.`;

/** One of the weekend's events. `status`: on its own calendar (live: under way there now). */
export interface WeekendEvent {
  season: number; code: string; name: string; type: string | null;
  /** "Williamstown, NJ, USA". */
  place: string | null; city: string | null; state: string | null; country: string | null;
  start: string | null; end: string | null; timezone: string | null;
  /** "Nov 14–15, 2026". */
  dates: string | null;
  /** Teams listed (registered, or on its match list). */
  teams: number;
  status: "upcoming" | "live" | "finished";
  /** The event's page (live standings while it's under way). */
  href: string;
  /** Its recording on YouTube, when one is on record. */
  recording?: string;
}

export interface WeekendAnswer {
  which: Weekend;
  season: number;
  seasonLabel: string;
  /** Saturday to Sunday, as the heading says it. */
  window: { from: string; to: string; label: string };
  region: { key: string; name: string } | null;
  events: WeekendEvent[];
}

/** An event's kind as the page and search say it ("League meet"). */
const KIND: Record<string, string> = {
  LeagueMeet: "League meet", LeagueTournament: "League tournament", Qualifier: "Qualifier", SuperQualifier: "Super qualifier",
  Championship: "Championship", FIRSTChampionship: "FIRST Championship", Premier: "Premier event", OffSeason: "Off-season event",
  Scrimmage: "Scrimmage", PracticeDay: "Practice day", Kickoff: "Kickoff", Workshop: "Workshop", DemoExhibition: "Demo",
};
export const eventKindLabel = (type: string | null | undefined): string => (type ? KIND[type] ?? type.replace(/([a-z])([A-Z])/g, "$1 $2") : "Event");

/** A match's posted time on its event's own clock, with the zone's short name ("Sat 10:30 AM EST"); "" when none is
 *  posted. `startsAt`: the instant (UTC); `timezone`: the event's. */
export function eventClock(startsAt: string | null | undefined, timezone: string | null | undefined): string {
  if (!startsAt) return "";
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timezone || "UTC", timeZoneName: "short" });
  } catch {
    return d.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" });
  }
}

/** One line for a weekend event: its kind, place, dates, teams, and "Live now" while it's under way there. */
export const weekendEventLine = (e: WeekendEvent): string =>
  [e.status === "live" ? "Live now" : null, eventKindLabel(e.type), e.place, e.dates, e.teams ? `${e.teams} team${e.teams === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");

export interface NextMatchTeam { number: number; name: string | null }

/** A team's next match this weekend, or what it has instead (server/api/weekend.ts teamNextMatch). */
export interface NextMatchAnswer {
  team: number;
  name: string | null;
  season: number;
  seasonLabel: string;
  /** match: its next match this weekend; no-schedule: an event this weekend, its match list not posted; next-event: no
   *  match this weekend, its next event after; none: no upcoming event this season. */
  kind: "match" | "no-schedule" | "next-event" | "none";
  match?: {
    season: number; code: string; event: string; key: string; label: string; played: boolean;
    /** The event's own clock (no zone), and the instant; null for a played match. */
    time: string | null; startsAt: string | null; timezone: string | null;
    alliance: "red" | "blue"; partners: NextMatchTeam[]; opponents: NextMatchTeam[];
    /** The call on an unplayed match: the team's chance to win, its tier, each side's expected points. */
    prediction?: { chance: number; tier: ConfidenceTier; ownMean: number; oppMean: number; kind: string };
    score?: { own: number; opp: number; result: "W" | "L" | "T" };
    video?: string;
    href: string;
  };
  event?: { season: number; code: string; name: string; dates: string | null; place: string | null; href: string };
  /** What the card says when there's no match to show. */
  line?: string;
  /** This weekend's matches already played (the latest few): scores, never times. */
  played: NonNullable<NextMatchAnswer["match"]>[];
}

/** The reader's own date ("2026-11-14"), in the browser: the weekend the pages show is read from it. */
export const viewerToday = (d = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
