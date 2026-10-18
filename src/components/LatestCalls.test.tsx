// @vitest-environment jsdom
// Predict's latest-calls card: real calls only, each with its tier and how it turned out; a near-even
// pick never reads as 50:50; the calls turn over on a timer that the pause button (and reduced motion) stops.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView, TrackRecord } from "../shared/api";

const call = (label: string, pRed: number, red: number, blue: number) => ({
  season: 2026, code: "USCOMSS", key: `qual:0:${label}`, level: "qual", series: 0, number: 1, label, time: null, startsAt: null, played: true, video: null,
  red: { teams: [{ number: 1 }, { number: 2 }], score: { total: red } }, blue: { teams: [{ number: 3 }, { number: 4 }], score: { total: blue } },
  prediction: { pRed, redMean: 0, blueMean: 0, tier: "provisional", kind: "live", predictedAt: null },
}) as unknown as MatchView & { prediction: NonNullable<MatchView["prediction"]> };

let record: Partial<TrackRecord> | undefined;
vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), useApi: () => ({ data: record, error: undefined, loading: false, reload: () => {} }) }));
let reduced = false;
vi.mock("motion/react", async (orig) => ({ ...(await orig<typeof import("motion/react")>()), useReducedMotion: () => reduced }));

const { LatestCalls, callOutcome, pickPct, TURN_MS } = await import("./LatestCalls");
const mount = () => render(<MemoryRouter><LatestCalls /></MemoryRouter>);

beforeEach(() => { reduced = false; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("callOutcome / pickPct", () => {
  it("scores a call right, missed, no pick (50:50) or tied", () => {
    expect(callOutcome(call("Q1", 0.7, 50, 40))).toBe("right");
    expect(callOutcome(call("Q2", 0.7, 30, 40))).toBe("missed");
    expect(callOutcome(call("Q3", 0.5, 30, 40))).toBe("even");
    expect(callOutcome(call("Q4", 0.7, 40, 40))).toBe("tie");
  });
  it("keeps a decimal for a near-even lean", () => {
    expect(pickPct(0.501)).toBe("50.1%");
    expect(pickPct(0.72)).toBe("72%");
  });
});

describe("LatestCalls", () => {
  it("turns through the calls, and the pause button stops it", () => {
    record = { recentCalls: [call("Q1", 0.7, 50, 40), call("Q2", 0.3, 50, 40)] };
    mount();
    expect(screen.getByText(/^Q1/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(TURN_MS); });
    expect(screen.getByText(/^Q2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop turning through the calls" }));
    act(() => { vi.advanceTimersByTime(TURN_MS * 3); });
    expect(screen.getByText(/^Q2/)).toBeTruthy();
    expect(screen.getByText("Missed")).toBeTruthy(); // blue called at 70%, red won
  });

  it("shows the first three still under reduced motion", () => {
    reduced = true;
    record = { recentCalls: [call("Q1", 0.7, 50, 40), call("Q2", 0.6, 50, 40), call("Q3", 0.6, 50, 40), call("Q4", 0.6, 50, 40)] };
    mount();
    expect(screen.getAllByText(/^Q\d/)).toHaveLength(3);
    act(() => { vi.advanceTimersByTime(TURN_MS * 2); });
    expect(screen.getByText(/^Q1/)).toBeTruthy();
  });

  it("says no calls are scored yet instead of inventing any", () => {
    record = { recentCalls: [] };
    mount();
    expect(screen.getByText(/No live calls have been scored yet/)).toBeTruthy();
  });
});
