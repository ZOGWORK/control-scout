// @vitest-environment jsdom
// The schedule hook: a saved season's (older) answer never hides or replaces the copy kept from the server.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MatchView } from "../shared/api";

const state = vi.hoisted(() => ({ data: undefined as unknown, saved: false }));
vi.mock("./api", () => ({ useApi: () => ({ data: state.data, error: undefined, loading: state.data === undefined, reload: async () => {} }) }));
vi.mock("./offline/saved", () => ({ offlineSource: (d: unknown) => (d && state.saved ? { season: 2026 } : null) }));
const { readStoredSchedule, storeSchedule, useEventSchedule } = await import("./eventSchedule");

const mv = (n: number): MatchView => ({
  season: 2026, code: "E", key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null, played: false,
  red: { teams: [{ number: 1, surrogate: false, dq: false, onField: true }], score: null }, blue: { teams: [{ number: 2, surrogate: false, dq: false, onField: true }], score: null }, video: null, prediction: null,
});
const detail = (n: number) => ({ event: { name: "Event" }, matches: Array.from({ length: n }, (_, i) => mv(i + 1)) });
const kept = { name: "Event", matches: [1, 2, 3].map((n) => ({ key: `qual:0:${n}`, label: `Q${n}`, level: "qual" as const, time: null, startsAt: null, played: false, red: [1], blue: [2] })), at: 5 };

beforeEach(() => { localStorage.clear(); state.data = undefined; state.saved = false; });

describe("useEventSchedule", () => {
  it("keeps the server's schedule on the device", () => {
    state.data = detail(2);
    const { result } = renderHook(() => useEventSchedule(2026, "e"));
    expect(result.current).toMatchObject({ status: "ready", fromDevice: false });
    expect(readStoredSchedule(2026, "E")?.matches).toHaveLength(2);
  });

  it("a saved season with no schedule doesn't hide the kept one", () => {
    storeSchedule(2026, "E", kept);
    state.data = detail(0); state.saved = true;
    const { result } = renderHook(() => useEventSchedule(2026, "E"));
    expect(result.current).toMatchObject({ status: "ready", fromDevice: true });
    expect(result.current.matches).toHaveLength(3);
  });

  it("a saved season's older schedule never replaces the kept one", () => {
    storeSchedule(2026, "E", kept);
    state.data = detail(1); state.saved = true;
    const { result } = renderHook(() => useEventSchedule(2026, "E"));
    expect(result.current.matches).toHaveLength(3);
    expect(readStoredSchedule(2026, "E")?.matches).toHaveLength(3);
  });

  it("with nothing kept, a saved season's schedule shows (from the device)", () => {
    state.data = detail(2); state.saved = true;
    const { result } = renderHook(() => useEventSchedule(2026, "E"));
    expect(result.current).toMatchObject({ status: "ready", fromDevice: true });
    expect(readStoredSchedule(2026, "E")).toBeNull();
  });
});
