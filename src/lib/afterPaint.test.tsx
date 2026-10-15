// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAfterFirstPaint } from "./afterPaint";

describe("useAfterFirstPaint", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("is false on the first render and true after the next frame", () => {
    vi.useFakeTimers();
    let frame: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frame = cb; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { result } = renderHook(() => useAfterFirstPaint());
    expect(result.current).toBe(false);
    act(() => { frame?.(0); vi.advanceTimersByTime(0); });
    expect(result.current).toBe(true);
  });

  it("still turns true when no frame comes (a background tab)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const { result } = renderHook(() => useAfterFirstPaint());
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current).toBe(true);
  });
});
