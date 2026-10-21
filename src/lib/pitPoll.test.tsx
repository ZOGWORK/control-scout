// @vitest-environment jsdom
// The pit display's poll: a new score arrives with no reload (the same request the event page polls),
// a failure shows "Reconnecting…" and retries sooner, and the next success clears it.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const load = vi.fn();
vi.mock("./api", () => ({ load: (...a: unknown[]) => load(...a), useApi: () => ({}) }));
const { useDisplayPoll, qrPath } = await import("./pitPoll");

const live = { event: { status: "live" }, live: { checkedAt: null, everySeconds: 60, auto: true } } as never;

beforeEach(() => { vi.useFakeTimers(); load.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe("useDisplayPoll", () => {
  it("fetches on the live cadence (30 s), backs off after a failure, and recovers", async () => {
    load.mockResolvedValue({});
    const { result } = renderHook(() => useDisplayPoll(live, "/api/events/2026/X"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(load).toHaveBeenCalledWith("/api/events/2026/X", true);
    expect(result.current).toBe("ok");

    load.mockRejectedValueOnce(new Error("offline"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current).toBe("reconnecting");
    // Retried after 5 s, not 30.
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(load).toHaveBeenCalledTimes(3);
    expect(result.current).toBe("ok");
  });

  it("an event that isn't live still refreshes, every 5 minutes", async () => {
    load.mockResolvedValue({});
    renderHook(() => useDisplayPoll({ event: { status: "upcoming" }, live: null } as never, "/p"));
    await act(async () => { await vi.advanceTimersByTimeAsync(299_000); });
    expect(load).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("offline", () => {
  it("saved data from this device (no connection) is shown as saved, never as live, and retried soon", async () => {
    const { markOffline } = await import("./offline/saved");
    load.mockResolvedValue(markOffline({}, { season: 2026, savedAt: 1, dataAsOf: null }));
    const { result } = renderHook(() => useDisplayPoll(live, "/p"));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current).toBe("saved");
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("before anything loaded", () => {
  it("a failed first load is retried within seconds, not after the 5-minute idle cadence", async () => {
    load.mockResolvedValue({});
    renderHook(() => useDisplayPoll(undefined, "/p"));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("qrPath", () => {
  it("a square of modules for the address", () => {
    const q = qrPath("https://controlscout.org/events/2026/USMNMAN");
    expect(q.size).toBeGreaterThanOrEqual(21);
    expect(q.d).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});
