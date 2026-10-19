// @vitest-environment jsdom
// The shared-work state model (audit E4): which failures leave a write's outcome unknown (checked before it's
// called failed), and the published pending work, which is only ever handed to the account it belongs to.
import { afterEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ApiError } from "./api";
import { allPending, claimScope, isClaimed, outcomeUnknown, publishPending, usePendingWork, type PendingItem } from "./pendingWork";

const item = (account: number, key: string): PendingItem => ({ key, account, kind: "note", workspaceId: "901", season: 2025, team: 7, label: "Note on 7", status: "attention", message: "Not saved yet." });

afterEach(() => { publishPending("a", []); publishPending("b", []); });

describe("outcomeUnknown", () => {
  it("no answer, a cut-off body or a proxy's 5xx: unknown (it may have arrived)", () => {
    for (const e of [new TypeError("Failed to fetch"), new ApiError(0, "Can't reach the server", true), new ApiError(200, "cut off"), new ApiError(502, "Bad gateway"), new ApiError(522, "Timed out")]) {
      expect(outcomeUnknown(e, false)).toBe(true);
    }
  });
  it("an answer (refused, paused) or known offline before sending: definite", () => {
    for (const e of [new ApiError(409, "Conflict"), new ApiError(400, "Bad"), new ApiError(503, "Paused"), new ApiError(429, "Slow down")]) expect(outcomeUnknown(e, false)).toBe(false);
    expect(outcomeUnknown(new ApiError(0, "You're offline.", true), true)).toBe(false);
  });
});

describe("published pending work", () => {
  it("is handed only to its own account, and clears when its source has nothing left", () => {
    act(() => { publishPending("a", [item(1, "x"), item(2, "y")]); publishPending("b", [item(1, "z")]); });
    const one = renderHook(() => usePendingWork(1));
    const two = renderHook(() => usePendingWork(2));
    const none = renderHook(() => usePendingWork(null));
    expect(one.result.current.map((x) => x.key)).toEqual(["x", "z"]);
    expect(two.result.current.map((x) => x.key)).toEqual(["y"]);
    expect(none.result.current).toEqual([]);
    act(() => { publishPending("a", []); });
    expect(one.result.current.map((x) => x.key)).toEqual(["z"]);
    expect(two.result.current).toEqual([]);
    act(() => { publishPending("b", []); });
    expect(allPending()).toEqual([]);
  });

  it("a claimed scope stays claimed until every claim is released", () => {
    const a = claimScope("1:901:2025"), b = claimScope("1:901:2025");
    a();
    expect(isClaimed("1:901:2025")).toBe(true);
    b();
    expect(isClaimed("1:901:2025")).toBe(false);
  });
});
