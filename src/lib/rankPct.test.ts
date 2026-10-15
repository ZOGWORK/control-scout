import { describe, expect, it } from "vitest";
import { rankPct } from "./format";

describe("rankPct", () => {
  it("top N% up to and including 50%", () => {
    expect(rankPct(1, 8375)).toBe("top 1%");
    expect(rankPct(616, 8375)).toBe("top 8%");
    expect(rankPct(50, 100)).toBe("top 50%");
    expect(rankPct(1, 2)).toBe("top 50%");
  });
  it("bottom M% past 50%, M = 100 − N + 1 on a round field", () => {
    expect(rankPct(51, 100)).toBe("bottom 50%");
    expect(rankPct(91, 100)).toBe("bottom 10%");
    expect(rankPct(2, 2)).toBe("bottom 50%");
    expect(rankPct(7700, 8375)).toBe("bottom 9%");
  });
  it("no floating-point round-up ((7 / 100) * 100 is just over 7)", () => {
    expect(rankPct(7, 100)).toBe("top 7%");
    expect(rankPct(94, 100)).toBe("bottom 7%");
    for (let r = 1; r <= 100; r++) expect(rankPct(r, 100)).toBe(r <= 50 ? `top ${r}%` : `bottom ${101 - r}%`);
  });
  it("the last rank is bottom 1%, rank 1 always top", () => {
    expect(rankPct(100, 100)).toBe("bottom 1%");
    expect(rankPct(8375, 8375)).toBe("bottom 1%");
    expect(rankPct(1, 1)).toBe("top 100%");
  });
  it("no rank or no field → no label", () => {
    expect(rankPct(null, 100)).toBeNull();
    expect(rankPct(undefined, 100)).toBeNull();
    expect(rankPct(0, 100)).toBeNull();
    expect(rankPct(5, null)).toBeNull();
    expect(rankPct(5, 0)).toBeNull();
  });
  it("capital starts the label with a capital letter", () => {
    expect(rankPct(616, 8375, true)).toBe("Top 8%");
    expect(rankPct(91, 100, true)).toBe("Bottom 10%");
    expect(rankPct(null, 100, true)).toBeNull();
  });
});
