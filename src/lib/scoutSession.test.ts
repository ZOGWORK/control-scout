// @vitest-environment jsdom
// The scouting session and the kept schedule: device-only, validated on read, one per space.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { readScoutSession, sessionStorageKey, useScoutSession, writeScoutSession } from "./scoutSession";
import { readStoredSchedule, storeSchedule } from "./eventSchedule";

beforeEach(() => localStorage.clear());

describe("scout session", () => {
  it("saves per space, uppercased, and ignores bad values", () => {
    expect(writeScoutSession(null, { season: 2026, eventCode: " usnjq1 ", watching: { kind: "all" } })?.eventCode).toBe("USNJQ1");
    expect(readScoutSession(null)?.watching).toEqual({ kind: "all" });
    expect(readScoutSession("w1")).toBeNull();
    expect(writeScoutSession("w1", { season: 2026, eventCode: "bad code!", watching: { kind: "all" } })).toBeNull();
    localStorage.setItem(sessionStorageKey("w1"), JSON.stringify({ season: 2026, eventCode: "X", watching: { kind: "slot", slot: "red3" } }));
    expect(readScoutSession("w1")).toBeNull();
  });

  it("the hook shows the season's session, suggests the workspace default, and follows changes", () => {
    const { result } = renderHook(() => useScoutSession("w1", 2026, "usnjq2"));
    expect(result.current.session).toBeNull();
    expect(result.current.suggested).toBe("USNJQ2");
    act(() => { result.current.set("USNJQ1", { kind: "alliance", side: "blue" }); });
    expect(result.current.session?.eventCode).toBe("USNJQ1");
    expect(result.current.suggested).toBeNull();
    const other = renderHook(() => useScoutSession("w1", 2025));
    expect(other.result.current.session).toBeNull(); // another season's page
    act(() => { result.current.end(); });
    expect(result.current.session).toBeNull();
  });

  it("a session this device can't store still takes for this visit", () => {
    const { result } = renderHook(() => useScoutSession("w2", 2026));
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
    act(() => { result.current.set("USNJQ1", { kind: "all" }); });
    blocked.mockRestore();
    expect(result.current.session?.eventCode).toBe("USNJQ1");
    expect(readScoutSession("w2")?.watching).toEqual({ kind: "all" });
    act(() => { result.current.end(); }); // stored fine this time: the visit-only copy goes
    expect(readScoutSession("w2")).toBeNull();
  });
});

describe("kept schedule", () => {
  const m = { key: "qual:0:1", label: "Q1", level: "qual" as const, time: null, startsAt: null, played: false, red: [1, 2], blue: [3, 4] };
  it("keeps the newest few events and rejects a damaged copy", () => {
    for (let i = 1; i <= 4; i++) storeSchedule(2026, `E${i}`, { name: `Event ${i}`, matches: [m], at: i });
    expect(readStoredSchedule(2026, "E1")).toBeNull();
    expect(readStoredSchedule(2026, "e4")?.name).toBe("Event 4");
    localStorage.setItem("cs-scout-schedule:2026:E4", JSON.stringify({ name: "x", matches: [{ ...m, red: ["1"] }], at: 9 }));
    expect(readStoredSchedule(2026, "E4")).toBeNull();
  });
});
