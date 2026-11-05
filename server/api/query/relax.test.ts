// The relaxation order (relax.ts): every season a window's dates touch, newest first, then the season before.
import { describe, expect, it } from "vitest";
import { windowSteps } from "./relax";

describe("windowSteps", () => {
  it("a window inside one season: that season, then the one before", () => {
    expect(windowSteps({ label: "this week", from: "2026-03-16", to: "2026-03-22" }, 2025).map((s) => [s.step.filter, s.step.from, s.step.to, s.season]))
      .toEqual([["window", "this week", "2025–26", 2025], ["season", "2025–26", "2024–25", 2024]]);
  });
  it("a week across the season's start: the newer season first, then the older, then the one before", () => {
    expect(windowSteps({ label: "this week", from: "2026-08-31", to: "2026-09-06" }, 2025).map((s) => [s.step.filter, s.step.from, s.step.to, s.season]))
      .toEqual([["window", "this week", "2026–27", 2026], ["window", "2026–27", "2025–26", 2025], ["season", "2025–26", "2024–25", 2024]]);
  });
});
