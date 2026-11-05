// The comparison rows the search results guide asks for (.claude/search-viz-guide-2026-11-05.txt §3, §10): each row's
// scale a round number at or above its values, Total first and then the rows by the size of their gap.
import { describe, expect, it } from "vitest";
import { compareRows, decidedText, leadHeadline, niceMax } from "./compareBlock";

describe("compare rows", () => {
  it("a scale is a round number at or above the season's high", () => {
    expect(niceMax(157.9)).toBe(160);
    expect(niceMax(241.3)).toBe(250);
    expect(niceMax(36.5)).toBe(40);
    expect(niceMax(7.2)).toBe(8);
    expect(niceMax(0)).toBe(1);
  });
  it("Total first, then the bar rows by gap, then the rows of values; the scale never below a value", () => {
    const rows = compareRows([
      { label: "Total", total: true, values: [157.9, 115.3], max: 160, better: "higher" },
      { label: "Auto", values: [36.5, 41.6], max: 40, better: "higher" },
      { label: "TeleOp", values: [101, 68.7], max: 120, better: "higher" },
      { label: "Matches", values: [32, 31], better: null },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Total", "TeleOp", "Auto", "Matches"]);
    // A season scale read before a team passed it: rounded up again, so the bar stays inside the row.
    expect(rows[2]).toMatchObject({ max: 45, nums: [36.5, 41.6], best: 1, gap: "+5.1" });
    expect(rows[3].max).toBeUndefined();
    expect(decidedText(rows)).toBe("TeleOp decided it (+32.3)");
    const teams = [{ number: 23268, name: "Ultraviolet" }, { number: 7149, name: "ENFORCERS" }];
    expect(leadHeadline(teams, rows[0], ["#144 of 8,308", "#446 of 8,308", decidedText(rows)])).toEqual({ value: "23268 leads 157.9 – 115.3", label: "+42.6", sub: "#144 of 8,308 · #446 of 8,308 · TeleOp decided it (+32.3)" });
  });
  it("a tie or a missing value names no one", () => {
    const [even] = compareRows([{ label: "Total", total: true, values: [50, 50], max: 60, better: "higher" }]);
    expect(leadHeadline([{ number: 1, name: null }, { number: 2, name: null }], even, [])).toMatchObject({ value: "Even at 50.0" });
    const [gap] = compareRows([{ label: "Total", total: true, values: [50, null], max: 60, better: "higher" }]);
    expect(gap.best).toBeNull();
  });
});
