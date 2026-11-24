// @vitest-environment jsdom
// Owner › Server & speed › Search speed and score: phone and desktop medians with their 95th %, weeks newest first.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SearchScoreView, fmtMs, speedTone } from "./SearchScorePanel";
import type { SearchScore } from "../../shared/searchScore";

const none = { n: 0, p50: null, p95: null };
const score: SearchScore = {
  days: 14, sample: 0.5,
  speed: { phone: { n: 40, p50: 420, p95: 2600 }, desktop: { n: 12, p50: 180, p95: 640 }, load: { n: 10, p50: 900, p95: 2600 }, app: { n: 42, p50: 250, p95: 700 } },
  weeks: [
    { week: "2026-W48", from: "2026-11-23", searches: 52, answered: 0.88, direct: 0.6, sorry: 0.12, failed: 0, related: 0.1, reSearch: 0.08 },
    { week: "2026-W47", from: "2026-11-16", searches: 3, answered: 1, direct: 1, sorry: 0, failed: 0, related: 0, reSearch: null },
  ],
};

describe("SearchScoreView", () => {
  it("shows each screen's median, 95th % and count", () => {
    render(<SearchScoreView s={score} />);
    expect(screen.getByText("420 ms")).toBeTruthy();
    expect(screen.getByText("Median · 95th % 2.6 s · 40 timed")).toBeTruthy();
    expect(screen.getByText("Median · 95th % 640 ms · 12 timed")).toBeTruthy();
    expect(screen.getByText(/1 in 2 page loads/)).toBeTruthy();
  });
  it("lists the weeks newest first, rates as percentages, a missing rate as a dash", () => {
    render(<SearchScoreView s={score} />);
    const rows = within(document.querySelector("[data-search-weeks]") as HTMLElement).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual(["2026 · week 4852" + "88%60%12%0%10%8%", "2026 · week 473" + "100%100%0%0%0%—"]);
  });
  it("says so when nothing is counted yet", () => {
    render(<SearchScoreView s={{ ...score, speed: { phone: none, desktop: none, load: none, app: none }, weeks: [] }} />);
    expect(screen.getByText("No searches counted yet.")).toBeTruthy();
    expect(screen.getAllByText("No timed searches yet")).toHaveLength(2);
  });
  it("tones the 95th %: within a second good, past three slow", () => {
    expect([speedTone(null), speedTone(900), speedTone(2500), speedTone(3200)]).toEqual(["neutral", "emerald", "amber", "rose"]);
    expect([fmtMs(null), fmtMs(999.6), fmtMs(1250)]).toEqual(["—", "1.0 s", "1.3 s"]);
  });
});
