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
// Countdowns run on the field's real pace (pace()): none before the day's first result, then the posted
// schedule shifted by how late or early the field really runs, erring early, never late.
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

// Schedule order: quals before playoffs, then series and number (never the API's order, which puts
// matches without a time first, e.g. an unscheduled playoff ahead of the quals still to play).
const stage = (a: MatchView, b: MatchView) => (a.level === b.level ? 0 : a.level === "qual" ? -1 : 1) || a.series - b.series || a.number - b.number;

const teamsOf = (m: MatchView) => [...m.red.teams, ...m.blue.teams].map((t) => t.number);

/**
 * The next unplayed match, in schedule order (scheduled start where every match has one, else the
 * stage order: quals, then playoffs, by series and number), that involves one of `teams` (any match when
 * `teams` is null). A match whose start has passed but has no result yet is still next: it's running
 * late or being scored. Null when nothing is left.
 */
export function nextMatch(matches: MatchView[], teams: ReadonlySet<number> | ReadonlyMap<number, unknown> | null): MatchView | null {
  const left = matches.filter((m) => !m.played && (!teams || teamsOf(m).some((t) => teams.has(t))));
  if (!left.length) return null;
  const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
  // Times decide only when every candidate has one (a missing time can't be placed).
  const timed = left.every((m) => Number.isFinite(at(m)));
  left.sort((a, b) => (timed ? at(a) - at(b) : 0) || stage(a, b));
  return left[0];
}

/** Played matches this long before the next match's posted start count as the same playing day. */
const SAME_DAY_MS = 12 * 3600_000;
/**
 * The longest a match runs before FIRST posts its score (start, 2:30 of play, scoring and review), plus the
 * server's 60 s check. A match with no score this long after it would have started hasn't started yet.
 */
export const MAX_POST_LAG_MS = 8 * 60_000;
/** The match cycle when the schedule gives none (FTC qualification cycles are 5–8 min). */
const DEFAULT_CYCLE_MS = 5 * 60_000;
/** A posted gap this many cycles long is a break (lunch, alliance selection): breaks absorb a late start. */
const BREAK_CYCLES = 2.5;
/**
 * The most a field runs ahead of its posted schedule. The next match posted further than this past one
 * cycle after the latest real start has a break before it; anything less is the field running early.
 */
const MAX_EARLY_MS = 20 * 60_000;

export interface Pace {
  /** Each unplayed timed match's estimated start (ms), by match key. Empty while waiting for the opener. */
  est: ReadonlyMap<string, number>;
  /** The day's opening match while it has no result: nothing is estimated (or counted down) until it does. */
  opener: MatchView | null;
  /** The match that should be on the field now, by the estimate. */
  onField: MatchView | null;
  /** How far the next match runs behind (+) or ahead (−) of the posted schedule, ms. */
  shift: number;
  /**
   * False when the posted clock times can't be right (the field runs hours off them, e.g. a 1:35 PM start
   * posted as 1:35 AM): then only their gaps are used, and nobody is told it runs "12 hours behind".
   */
  clockOk: boolean;
}

/** A field this far off its posted times is following a mistyped schedule, not running late. */
const MAX_PLAUSIBLE_SHIFT_MS = 3 * 3600_000;

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);

/**
 * When the matches still to play should start, calibrated on the field's real pace (no countdown off the
 * posted plan alone: events rarely start on time).
 *
 * Until the day's first match has a result nothing is estimated (`opener`). After that, a played match's
 * time is its real start (FIRST's actualStartTime), so the next match should start one cycle after the
 * latest real start, and every later match moves by the same amount, up to the next break (a break
 * absorbs a late start, so after one the posted time holds unless the field runs early).
 *
 * Never late: the cycle is the shorter of the posted one and the one the field is really running, and a
 * match still without a score can't have started more than MAX_POST_LAG_MS ago, so the estimate never
 * sits further back than that (a long wait for the next score pushes everything after it).
 */
export function pace(matches: MatchView[], now: number): Pace {
  const at = (m: MatchView) => (m.startsAt ? Date.parse(m.startsAt) : NaN);
  const order = [...matches].sort(stage);
  const rest = order.filter((m) => !m.played && Number.isFinite(at(m)));
  // Nothing played yet (by any clock): wait for the first score, timed schedule or not.
  const none = { est: new Map<string, number>(), opener: null, onField: null, shift: 0, clockOk: true };
  if (!rest.length) return { ...none, opener: order.some((m) => m.played) ? null : nextMatch(matches, null) };
  const n1 = rest[0];
  const s1 = at(n1);
  const playedToday = order.filter((m) => m.played && Number.isFinite(at(m)) && at(m) > s1 - SAME_DAY_MS).sort((a, b) => at(a) - at(b));
  const today = playedToday.map(at);
  if (!today.length) return { ...none, opener: nextMatch(matches, null) };
  // The posted cycle: the usual gap, never a break's (the shortest gap sets what counts as one).
  const gaps = rest.slice(1).map((m, i) => at(m) - at(rest[i])).filter((g) => g > 0);
  const posted = median(gaps.filter((g) => g <= BREAK_CYCLES * Math.min(...gaps)));
  const real = median(today.slice(1).map((t, i) => t - today[i]).filter((g) => g > 0 && g < BREAK_CYCLES * (posted || DEFAULT_CYCLE_MS)));
  const cycle = Math.min(Number.isFinite(posted) ? posted : DEFAULT_CYCLE_MS, Number.isFinite(real) ? real : Infinity);
  const isBreak = (gap: number) => gap > BREAK_CYCLES * cycle;
  const lastStart = today[today.length - 1];
  // A break before the next match: from the posted schedule when the last played match kept its posted start
  // (scheduledAt); without it (older data, other sources), a posted start well past anything an early-running
  // field would reach.
  const lastPosted = Date.parse(playedToday[playedToday.length - 1].scheduledAt ?? "");
  const breakFirst = Number.isFinite(lastPosted) ? isBreak(s1 - lastPosted) : s1 - (lastStart + cycle) > MAX_EARLY_MS;
  // Posted clock times hours off the real field are a mistyped schedule: keep their gaps, not their clock (a
  // break then doesn't snap back to a posted time that never was). Judged on the latest played match's own
  // posted start where it kept one, before any break is placed; else on the next match's offset.
  const lastOff = lastStart - lastPosted;
  const clockOk = Number.isFinite(lastOff) ? Math.abs(lastOff) <= MAX_PLAUSIBLE_SHIFT_MS : Math.abs(lastStart + cycle - s1) <= MAX_PLAUSIBLE_SHIFT_MS;
  // After a break the posted start holds (moved by the clock's error when the clock is wrong); else one cycle
  // after the latest real start. Either way it hasn't started more than MAX_POST_LAG_MS ago (there'd be a score).
  const afterBreak = clockOk || !Number.isFinite(lastOff) ? s1 : s1 + lastOff;
  const first = Math.max(breakFirst ? afterBreak : lastStart + cycle, now - MAX_POST_LAG_MS);
  let shift = first - s1;
  const est = new Map<string, number>();
  rest.forEach((m, i) => {
    if (i && clockOk && isBreak(at(m) - at(rest[i - 1]))) shift = Math.min(shift, 0);
    est.set(m.key, i ? at(m) + shift : first);
  });
  return { est, opener: null, onField: first <= now ? n1 : null, shift: first - s1, clockOk };
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
