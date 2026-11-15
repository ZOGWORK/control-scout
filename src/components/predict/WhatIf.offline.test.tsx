// @vitest-environment jsdom
// What if with no signal: measured on 6.5.1, the offline Predict page dropped the box. It's back, and the swap is
// predicted on this device from the same snapshot as the match above it, or says the pack doesn't hold the new robot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MatchExplanationView } from "../../shared/api";
import type { OfflineSource } from "../../lib/offline/predict";

const offlineExplain = vi.fn();
vi.mock("../../lib/offline/predict", () => ({ offlineExplain: (...a: unknown[]) => offlineExplain(...a) }));
const { WhatIf } = await import("./WhatIf");

const fetched: string[] = [];
const view = (red: number[], blue: number[], pRed: number, r: number, b: number) => ({
  season: 2026, level: "qual", red, blue, winProbRed: pRed, winProbBlue: 1 - pRed, predictedRed: r, predictedBlue: b,
}) as unknown as MatchExplanationView;
const base = view([1, 2], [3, 4], 0.7, 100, 90);
const from: OfflineSource = { kind: "bundle", season: 2026, code: "USMIMIQ1", name: "Michigan Qualifier" };

beforeEach(() => {
  fetched.length = 0;
  vi.stubGlobal("fetch", async (url: string) => { fetched.push(String(url)); throw new TypeError("Failed to fetch"); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); offlineExplain.mockReset(); });

const at = (whatif: string) => render(<MemoryRouter initialEntries={[`/predict?mode=match&season=2026&red=1,2&blue=3,4&whatif=${whatif}`]}><WhatIf base={base} offline={from} /></MemoryRouter>);

describe("What if, offline", () => {
  it("predicts the swap from the match's own snapshot, never asking the server", async () => {
    offlineExplain.mockResolvedValue({ view: view([9, 2], [3, 4], 0.3, 75, 90), asOf: "t", source: from });
    at("1:9");
    expect(await screen.findByTestId("what-if-after")).toBeTruthy();
    expect(offlineExplain).toHaveBeenCalledWith(2026, [9, 2], [3, 4], "qual", from);
    expect(screen.getByTestId("what-if-change").textContent).toMatch(/Red's chance falls 40 points, and the margin moves 25 toward Blue/);
    expect(fetched.filter((u) => u.includes("/api/predict/match"))).toEqual([]);
  });

  it("a robot the pack doesn't hold: says so, with no made-up call", async () => {
    offlineExplain.mockResolvedValue(null);
    at("1:9");
    expect(await screen.findByText("9 isn't in your Michigan Qualifier pack, so this swap can't be predicted offline.")).toBeTruthy();
    expect(screen.queryByTestId("what-if-after")).toBeNull();
  });
});
