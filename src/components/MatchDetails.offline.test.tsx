// @vitest-environment jsdom
// The match drawer with no connection: the match detail can't load, but the call the list already made on the
// device (lite pack) still shows its top factors and full why breakdown.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { MatchView } from "../shared/api";
import type { FactorSheet } from "../shared/factorSheet";

const state = vi.hoisted(() => ({ offline: true }));
vi.mock("../lib/api", async (orig) => {
  const real = await orig<typeof import("../lib/api")>();
  return { ...real, useApi: () => ({ data: undefined, error: new real.ApiError(0, "You're offline.", state.offline), loading: false, reload: async () => {} }) };
});
vi.mock("./MatchVideo", () => ({ MatchVideoSection: () => null, useVideoLinkCount: () => 0 }));
vi.mock("../lib/calibration", () => ({ useCalibration: () => null }));
const { MatchDetails } = await import("./MatchDetails");

const f = (id: string, kind: "phase" | "model" | "reason", favors: "A" | "B" | "even", weight: number) => ({ id, kind, name: `${id} name`, label: `${id} label`, favors, logit: favors === "B" ? -weight : weight, weight });
const sheet = {
  probabilityModel: "contextual", logit: 1,
  phases: [{ ...f("auto", "phase", "A", 0.6), points: 20 }, { ...f("teleop", "phase", "A", 0.2), points: 5 }, { ...f("endgame", "phase", "B", 0.1), points: -2 }, { ...f("pen", "phase", "even", 0), points: 0 }],
  model: [f("form", "model", "A", 0.1)],
  reasons: [f("schedule", "reason", "even", 0)],
} as unknown as FactorSheet;
const side = (ts: number[]) => ({ teams: ts.map((number) => ({ number, surrogate: false, dq: false, onField: true })), score: null });
const match = (withSheet: boolean): MatchView => ({
  season: 2025, code: "OFF1", key: "qual:0:3", level: "qual", series: 0, number: 3, label: "Q3", time: null, startsAt: null, played: false, red: side([1, 2]), blue: side([3, 4]), video: null,
  prediction: { pRed: 0.7, redMean: 120, blueMean: 100, tier: "confident", kind: "now", predictedAt: null, factors: [{ id: "auto", points: 20, favors: "A", label: "Red's autonomous is worth about 20 more points" }], ...(withSheet ? { sheet } : {}) },
} as MatchView);
const show = (m: MatchView) => render(<MemoryRouter><MatchDetails m={m} /></MemoryRouter>);

afterEach(() => { cleanup(); state.offline = true; });

describe("MatchDetails offline", () => {
  it("shows the device's call with its why breakdown when the match detail can't load", () => {
    show(match(true));
    const box = screen.getByTestId("offline-why");
    expect(box.textContent).toContain("Red's autonomous is worth about 20 more points");
    expect(screen.getByTestId("factor-sheet").textContent).toContain("form name");
  });

  it("adds nothing for a server error, or a call without a breakdown", () => {
    state.offline = false;
    show(match(true));
    expect(screen.queryByTestId("offline-why")).toBeNull();
    cleanup();
    state.offline = true;
    show(match(false));
    expect(screen.queryByTestId("offline-why")).toBeNull();
  });
});
