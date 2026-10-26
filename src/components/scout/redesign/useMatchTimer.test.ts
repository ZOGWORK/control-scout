// @vitest-environment jsdom
// The match timer: FTC's boundaries, time worked out from the start (a background jump lands on the
// right phase with one call), stop holds the clock, reset turns it off, a vibration at each boundary.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MATCH_S as VIDEO_MATCH_S } from "../../../lib/videoMoment";
import { clock, CUE_MS, fieldClock, MATCH_S, phaseAt, useMatchTimer } from "./useMatchTimer";

describe("phaseAt and the field clock", () => {
  it("auto through the transition, TeleOp from 0:38, endgame for TeleOp's last 30 s", () => {
    expect(MATCH_S).toBe(VIDEO_MATCH_S);
    expect([0, 29.9, 30, 37.9].map(phaseAt)).toEqual(["auto", "auto", "auto", "auto"]);
    expect([38, 100, 127.9].map(phaseAt)).toEqual(["teleop", "teleop", "teleop"]);
    expect([128, 157, 158, 400].map(phaseAt)).toEqual(["endgame", "endgame", "endgame", "endgame"]);
    expect(phaseAt(-5)).toBe("auto");
    expect(phaseAt(NaN)).toBe("auto");
  });
  it("counts down each period like the field's display", () => {
    expect(fieldClock(0)).toEqual({ period: "Auto", left: 30 });
    expect(fieldClock(32)).toEqual({ period: "Transition", left: 6 });
    expect(fieldClock(38)).toEqual({ period: "TeleOp", left: 120 });
    expect(fieldClock(128)).toEqual({ period: "Endgame", left: 30 });
    expect(fieldClock(158).period).toBe("Ended");
    expect(clock(30)).toBe("0:30");
    expect(clock(29.4)).toBe("0:30");
    expect(clock(120)).toBe("2:00");
    expect(clock(0)).toBe("0:00");
  });
});

describe("useMatchTimer", () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  it("is off until started", () => {
    const { result } = renderHook(() => useMatchTimer());
    expect(result.current).toMatchObject({ startedAt: null, running: false, elapsed: 0, phase: null, cue: null });
  });

  it("calls onPhase once per phase entered, buzzes and cues at each boundary", () => {
    const seen: string[] = [];
    const { result } = renderHook(() => useMatchTimer((p) => seen.push(p)));
    act(() => result.current.start());
    expect(seen).toEqual(["auto"]);
    expect(vibrate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(37_000); });
    expect(seen).toEqual(["auto"]);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(seen).toEqual(["auto", "teleop"]);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(result.current.cue).toBe("teleop");
    act(() => { vi.advanceTimersByTime(CUE_MS); });
    expect(result.current.cue).toBeNull();
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(seen).toEqual(["auto", "teleop", "endgame"]);
    expect(vibrate).toHaveBeenCalledTimes(2);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(seen).toHaveLength(3);
  });

  it("works time out from the start, so a 60 s jump with no ticks (phone locked) lands right, with one call", () => {
    const seen: string[] = [];
    const { result } = renderHook(() => useMatchTimer((p) => seen.push(p)));
    act(() => result.current.start());
    act(() => { vi.advanceTimersByTime(20_000); });
    // The page in the background: the clock moves on, no interval fires.
    vi.setSystemTime(Date.now() + 110_000);
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(Math.round(result.current.elapsed)).toBe(130);
    expect(result.current.phase).toBe("endgame");
    expect(seen).toEqual(["auto", "endgame"]);
  });

  it("stop holds the clock, reset turns it off, and a new start is a new match", () => {
    const seen: string[] = [];
    const { result } = renderHook(() => useMatchTimer((p) => seen.push(p)));
    act(() => result.current.start());
    act(() => { vi.advanceTimersByTime(50_000); });
    act(() => result.current.stop());
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.running).toBe(false);
    expect(result.current.elapsed).toBe(50);
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ startedAt: null, phase: null, elapsed: 0 });
    act(() => result.current.start());
    expect(seen).toEqual(["auto", "teleop", "auto"]);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
