// @vitest-environment jsdom
// Event-day live mode (v1.6 Task 3): when the LIVE panel shows, which match it counts down to, how the
// countdown reads, and the poller that keeps the page fresh (cadence, hidden tabs, clean exit).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetail, MatchView } from "../shared/api";
import { countdownWords, formatCountdown, isLiveMode, MIN_GAP_MS, nextMatch, pollInterval, relevantTeams, useEventPoll, venueClock } from "./liveMode";

type D = Pick<EventDetail, "event" | "live">;
const ev = (status: EventDetail["event"]["status"], live: EventDetail["live"]): D => ({ event: { status } as EventDetail["event"], live });
const LIVE = { checkedAt: "2026-10-16T15:00:00.000Z", everySeconds: 60, auto: true };

function match(n: number, red: number[], blue: number[], o: Partial<MatchView> = {}): MatchView {
  const side = (ts: number[]) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
  return { season: 2025, code: "X", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null,
    played: false, red: side(red), blue: side(blue), video: null, prediction: null, ...o };
}

describe("live mode detection", () => {
  it("is live only while the event is running and it's one of its days", () => {
    expect(isLiveMode(ev("live", LIVE))).toBe(true);
    expect(isLiveMode(ev("live", null))).toBe(false); // the day is over (in the event's zone)
    expect(isLiveMode(ev("upcoming", LIVE))).toBe(false);
    expect(isLiveMode(ev("finished", LIVE))).toBe(false); // every match has a result
    expect(isLiveMode(null)).toBe(false);
  });
  it("leaves live mode when the event ends: the last match scored, then the day ends", () => {
    const steps = [ev("live", LIVE), ev("finished", LIVE), ev("finished", null)];
    expect(steps.map(isLiveMode)).toEqual([true, false, false]);
    // Live: every 30 s. Finished, still the event day: the old reload (the lane's 60 s). Day over: nothing.
    expect(steps.map(pollInterval)).toEqual([30_000, 60_000, 0]);
  });
});

describe("poll cadence", () => {
  it("is half the fast lane's interval, kept within 20–30 s", () => {
    expect(pollInterval(ev("live", { ...LIVE, everySeconds: 60 }))).toBe(30_000);
    expect(pollInterval(ev("live", { ...LIVE, everySeconds: 20 }))).toBe(20_000);
    expect(pollInterval(ev("live", { ...LIVE, everySeconds: 300 }))).toBe(30_000);
    expect(pollInterval(ev("live", { ...LIVE, everySeconds: 50 }))).toBe(25_000);
  });
  it("still polls while live when only manual checks reach FIRST (someone else's check shows up)", () => {
    expect(pollInterval(ev("live", { ...LIVE, auto: false }))).toBe(30_000);
  });
  it("keeps the old behaviour on non-live days and non-live event days", () => {
    expect(pollInterval(ev("upcoming", null))).toBe(0);
    expect(pollInterval(ev("finished", null))).toBe(0);
    expect(pollInterval(ev("finished", { ...LIVE, auto: false }))).toBe(0);
  });
});

describe("relevant teams", () => {
  it("is my team, then teams assigned to me, then tracked teams, each once", () => {
    const r = relevantTeams({ myTeam: 100, tracked: [300, 100, 200], assigned: [200, 400] });
    expect([...r]).toEqual([[100, "my team"], [200, "assigned"], [400, "assigned"], [300, "tracked"]]);
  });
  it("is empty with nothing set", () => {
    expect(relevantTeams({ myTeam: null, tracked: [], assigned: [] }).size).toBe(0);
  });
});

describe("next relevant match", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 16, h, m)).toISOString();
  const ms = [
    match(1, [1, 2], [3, 4], { played: true, startsAt: at(14) }),
    match(2, [5, 6], [7, 8], { startsAt: at(14, 10) }),
    match(3, [100, 9], [10, 11], { startsAt: at(14, 20) }),
    match(4, [12, 13], [200, 14], { startsAt: at(14, 30) }),
  ];
  it("picks the first unplayed match with a tracked team", () => {
    expect(nextMatch(ms, new Set([100]))?.label).toBe("Q3");
  });
  it("picks a workspace (assigned) team's match", () => {
    expect(nextMatch(ms, relevantTeams({ myTeam: null, tracked: [], assigned: [200] }))?.label).toBe("Q4");
  });
  it("is the earliest of several relevant teams' matches", () => {
    expect(nextMatch(ms, new Set([200, 100]))?.label).toBe("Q3");
  });
  it("is null when no relevant team has a match left (played ones don't count)", () => {
    expect(nextMatch(ms, new Set([1]))).toBeNull();
    expect(nextMatch(ms, new Set([999]))).toBeNull();
  });
  it("without a filter, is the event's next match", () => {
    expect(nextMatch(ms, null)?.label).toBe("Q2");
  });
  it("orders by scheduled start when every match has one", () => {
    const late = [match(10, [100, 1], [2, 3], { startsAt: at(16) }), match(11, [100, 4], [5, 6], { startsAt: at(15) })];
    expect(nextMatch(late, new Set([100]))?.label).toBe("Q11");
  });
  it("falls back to schedule order when a time is missing", () => {
    const noTimes = [match(1, [5, 6], [7, 8], { played: true }), match(2, [100, 1], [2, 3]), match(3, [100, 4], [5, 6], { startsAt: at(9) })];
    expect(nextMatch(noTimes, new Set([100]))?.label).toBe("Q2");
  });
  it("puts quals still to play ahead of an unscheduled playoff, whatever order the list has", () => {
    // matchViews lists matches without a time first: an unscheduled playoff can come before the quals.
    const sf = match(1, [100, 1], [2, 3], { level: "playoff", series: 1, label: "SF1", key: "playoff:1:1" });
    const list = [sf, match(30, [100, 4], [5, 6], { startsAt: at(9) }), match(29, [7, 8], [100, 9], { startsAt: at(8, 50) })];
    expect(nextMatch(list, new Set([100]))?.label).toBe("Q29");
    expect(nextMatch(list, null)?.label).toBe("Q29");
  });
  it("keeps a match that's running late as next", () => {
    const now = Date.parse(at(15));
    const m = nextMatch(ms, new Set([100]))!;
    expect(Date.parse(m.startsAt!) - now).toBeLessThan(0);
    expect(formatCountdown(Date.parse(m.startsAt!) - now)).toBeNull(); // "Due now", no negative timer
  });
});

describe("countdown", () => {
  it("reads m:ss under an hour, h + min above, and nothing once due", () => {
    expect(formatCountdown(4 * 60_000 + 5_000)).toBe("4:05");
    expect(formatCountdown(59_000)).toBe("0:59");
    expect(formatCountdown(400)).toBe("0:01"); // rounds up: never "0:00" before it's due
    expect(formatCountdown(3600_000)).toBe("1 h 00 min");
    expect(formatCountdown(2 * 3600_000 + 5 * 60_000 + 30_000)).toBe("2 h 05 min");
    expect(formatCountdown(0)).toBeNull();
    expect(formatCountdown(-5_000)).toBeNull();
    expect(formatCountdown(NaN)).toBeNull();
  });
  it("has words for screen readers", () => {
    expect(countdownWords(4 * 60_000 + 5_000)).toBe("5 minutes");
    expect(countdownWords(60_000)).toBe("1 minute");
    expect(countdownWords(3600_000 + 60_000)).toBe("1 hour 1 minute");
    expect(countdownWords(2 * 3600_000)).toBe("2 hours");
  });
  it("shows the start as the venue's clock, read in the event's time zone", () => {
    // 15:42 UTC = 10:42 in Chicago (CDT, UTC−5) = 08:42 in Los Angeles.
    const m = { startsAt: "2026-10-16T15:42:00.000Z", time: "2026-10-16T10:42:00" };
    expect(venueClock(m, "America/Chicago")).toMatch(/10:42/);
    expect(venueClock(m, "America/Los_Angeles")).toMatch(/8:42/);
  });
  it("without a zone, shows FIRST's local time as written (no countdown)", () => {
    expect(venueClock({ startsAt: null, time: "2026-10-16T10:42:00" }, null)).toMatch(/10:42/);
    expect(venueClock({ startsAt: null, time: null }, "America/Chicago")).toBeNull();
  });
});

describe("useEventPoll", () => {
  let hidden = false;
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (hidden ? "hidden" : "visible") });
  });
  afterEach(() => { vi.useRealTimers(); });
  const setHidden = (h: boolean) => { hidden = h; act(() => { document.dispatchEvent(new Event("visibilitychange")); }); };

  it("fetches every 30 s while live and visible", () => {
    const reload = vi.fn();
    renderHook(() => useEventPoll(ev("live", LIVE), reload));
    act(() => { vi.advanceTimersByTime(29_999); });
    expect(reload).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it("runs no timer while the tab is hidden, and fetches at once when it's back", () => {
    const reload = vi.fn();
    renderHook(() => useEventPoll(ev("live", LIVE), reload));
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(reload).not.toHaveBeenCalled();
    setHidden(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // Then the cadence again, counted from that fetch.
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("fetches on focus, but not twice in a row for a quick flick", () => {
    const reload = vi.fn();
    renderHook(() => useEventPoll(ev("live", LIVE), reload));
    act(() => { vi.advanceTimersByTime(MIN_GAP_MS); window.dispatchEvent(new Event("focus")); });
    expect(reload).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1_000); window.dispatchEvent(new Event("focus")); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("uses the newest reload it was given", () => {
    const a = vi.fn(), b = vi.fn();
    const { rerender } = renderHook(({ r }) => useEventPoll(ev("live", LIVE), r), { initialProps: { r: a } });
    rerender({ r: b });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("slows to the old cadence when the event finishes, and stops when the day ends", () => {
    const reload = vi.fn();
    const { rerender } = renderHook(({ d }) => useEventPoll(d, reload), { initialProps: { d: ev("live", LIVE) } });
    rerender({ d: ev("finished", LIVE) });
    act(() => { vi.advanceTimersByTime(59_999); });
    expect(reload).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(reload).toHaveBeenCalledTimes(1);
    rerender({ d: ev("finished", null) });
    expect(vi.getTimerCount()).toBe(0);
    setHidden(true); setHidden(false);
    act(() => { vi.advanceTimersByTime(10 * 60_000); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("leaves no timer or listener behind on unmount", () => {
    const reload = vi.fn();
    const add = vi.spyOn(document, "addEventListener"), remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useEventPoll(ev("live", LIVE), reload));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    const added = add.mock.calls.filter(([t]) => t === "visibilitychange").map(([, f]) => f);
    const removed = remove.mock.calls.filter(([t]) => t === "visibilitychange").map(([, f]) => f);
    expect(added.length).toBe(1);
    expect(removed).toEqual(added);
    setHidden(false);
    window.dispatchEvent(new Event("focus"));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(reload).not.toHaveBeenCalled();
  });
});
