// Event-day live mode (v1.6 Task 3): the rules the event page's LIVE panel runs on, kept pure so
// they're tested without a browser, plus the poller that keeps a live event's page fresh.
//
// Live mode: the event is running now. The server says so twice: `status: "live"` (started, not every
// scheduled match played) and `live` (today is one of its days in its own time zone). Both must hold.
// When either goes (the last match is scored, or the day ends) the page drops back to the normal view.
//
// Relevant teams (whose next match the countdown targets), in this order of reasons:
//   1. my team (the personal store's myTeam),
//   2. teams assigned to me at this event in my active workspace (the scout space this device last
//      showed, as the Scout page resolves it), open or done,
//   3. my tracked teams (the personal store's tracked.teams).
// None at this event: the panel counts down to the event's next match instead and says so.
//
// Refresh cadence: while live, the event is fetched every LIVE_POLL_MS (half the server's fast-lane
// interval, clamped to 20–30 s: the lane checks FIRST about every 60 s, so a new score shows within
// ~30 s of the server having it), only while the tab is visible. Hidden: no timer runs at all. Back to
// the front (visible or focused) after at least MIN_GAP_MS: one fetch at once, then the cadence again.
// The detail answers with an ETag and `Cache-Control: no-cache`, so a poll that finds nothing new is
// a 304 with no body. On an event day that isn't live (all matches played, playoffs or awards may
// still come) the old reload stays: every `everySeconds`, only where the server checks on its own.
import { useEffect, useRef } from "react";
import type { EventDetail, MatchView } from "../shared/api";

export const LIVE_POLL_MIN_S = 20;
export const LIVE_POLL_MAX_S = 30;
/** Coming back to the front sooner than this after the last fetch fetches nothing (tab flicking). */
export const MIN_GAP_MS = 5_000;

/** Is the event running now (the LIVE panel shows)? */
export function isLiveMode(d: Pick<EventDetail, "event" | "live"> | null | undefined): boolean {
  return !!d && d.event.status === "live" && d.live != null;
}

/**
 * How often to fetch the event, in ms (0 = never). Live: half the fast lane's interval, 20–30 s.
 * An event day that isn't live: the lane's interval where the server checks on its own (as before).
 * Any other day: never.
 */
export function pollInterval(d: Pick<EventDetail, "event" | "live"> | null | undefined): number {
  if (!d?.live) return 0;
  if (isLiveMode(d)) return Math.min(LIVE_POLL_MAX_S, Math.max(LIVE_POLL_MIN_S, Math.round(d.live.everySeconds / 2))) * 1000;
  return d.live.auto ? Math.max(20, d.live.everySeconds) * 1000 : 0;
}

export type RelevantReason = "my team" | "assigned" | "tracked";
export const REASON_LABEL: Record<RelevantReason, string> = { "my team": "Your team", assigned: "Assigned to you", tracked: "Tracked" };

export interface RelevantInput {
  myTeam: number | null;
  tracked: number[];
  /** Teams assigned to me at this event in my active workspace. */
  assigned: number[];
}

/** Each relevant team and why (the first reason, in the order at the top of this file). */
export function relevantTeams(i: RelevantInput): Map<number, RelevantReason> {
  const out = new Map<number, RelevantReason>();
  const add = (t: number, r: RelevantReason) => { if (Number.isSafeInteger(t) && t > 0 && !out.has(t)) out.set(t, r); };
  if (i.myTeam != null) add(i.myTeam, "my team");
  for (const t of i.assigned) add(t, "assigned");
  for (const t of i.tracked) add(t, "tracked");
  return out;
}

const teamsOf = (m: MatchView) => [...m.red.teams, ...m.blue.teams].map((t) => t.number);

/**
 * The next unplayed match, in schedule order (scheduled start where every match has one, else the
 * order the event lists them: quals, then playoffs), that involves one of `teams` (any match when
 * `teams` is null). A match whose start has passed but has no result yet is still next: it's running
 * late or being scored. Null when nothing is left.
 */
export function nextMatch(matches: MatchView[], teams: ReadonlySet<number> | ReadonlyMap<number, unknown> | null): MatchView | null {
  const left = matches.map((m, i) => ({ m, i })).filter(({ m }) => !m.played && (!teams || teamsOf(m).some((t) => teams.has(t))));
  if (!left.length) return null;
  const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
  // Times decide only when every candidate has one (a missing time can't be placed); ties keep list order.
  if (left.every(({ m }) => Number.isFinite(at(m)))) left.sort((a, b) => at(a.m) - at(b.m) || a.i - b.i);
  return left[0].m;
}

/** What the countdown says: "4:05" (under an hour), "1 h 05 min", or null once the start has passed. */
export function formatCountdown(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.ceil(ms / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const min = Math.floor(s / 60);
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

/** The screen reader's words for the same: "4 minutes", "1 hour 5 minutes". */
export function countdownWords(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60), m = min % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return h ? (m ? `${part(h, "hour")} ${part(m, "minute")}` : part(h, "hour")) : part(m, "minute");
}

/**
 * A match's scheduled start as a clock time at the venue ("10:42 AM"), read in the event's time zone
 * (the same instant the server worked out from FIRST's zone-less local time). Without an instant,
 * FIRST's local time as given. Null when there's no time at all.
 */
export function venueClock(m: Pick<MatchView, "startsAt" | "time">, timezone: string | null): string | null {
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  if (m.startsAt && timezone) {
    try { return new Date(m.startsAt).toLocaleTimeString(undefined, { ...opts, timeZone: timezone }); } catch { /* unknown zone: below */ }
  }
  if (!m.time) return null;
  // FIRST's local time has no zone: read it as written (as UTC, so nothing shifts it).
  const hasZone = /(Z|[+-]\d\d:?\d\d)$/.test(m.time);
  const d = new Date(hasZone ? m.time : `${m.time}Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString(undefined, { ...opts, ...(hasZone ? {} : { timeZone: "UTC" }) });
}

/**
 * Keep an event's data fresh: `reload` every pollInterval(d) ms while the tab is visible; nothing while
 * it's hidden; once at once when it comes back (visible or focused) after MIN_GAP_MS or more. Every
 * timer and listener goes when the cadence changes (live mode ends) or the page unmounts.
 */
export function useEventPoll(d: Pick<EventDetail, "event" | "live"> | null | undefined, reload: () => void): void {
  const every = pollInterval(d);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!every) return;
    let last = Date.now();
    let id: ReturnType<typeof setInterval> | undefined;
    const fire = () => { last = Date.now(); reloadRef.current(); };
    const start = () => { if (id === undefined) id = setInterval(fire, every); };
    const stop = () => { if (id !== undefined) { clearInterval(id); id = undefined; } };
    const visible = () => document.visibilityState !== "hidden";
    const onShow = () => {
      if (!visible()) { stop(); return; }
      // Due (or nearly): fetch now and start the cadence over from here.
      if (Date.now() - last >= MIN_GAP_MS) { stop(); fire(); }
      start();
    };
    if (visible()) start();
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("focus", onShow);
    return () => { stop(); document.removeEventListener("visibilitychange", onShow); window.removeEventListener("focus", onShow); };
  }, [every]);
}
