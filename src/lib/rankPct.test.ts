import { describe, expect, it } from "vitest";
import { rankPct } from "./format";

describe("rankPct", () => {
  it("top N%: the share of teams ranked at or above it", () => {
    expect(rankPct(1, 8375)).toBe("top 1%");
    expect(rankPct(616, 8375)).toBe("top 8%");
    expect(rankPct(50, 100)).toBe("top 50%");
    expect(rankPct(1, 2)).toBe("top 50%");
  });
  it("never bottom: low ranks read top N% too", () => {
    expect(rankPct(51, 100)).toBe("top 51%");
    expect(rankPct(91, 100)).toBe("top 91%");
    expect(rankPct(2, 2)).toBe("top 100%");
    expect(rankPct(5790, 8375)).toBe("top 70%");
  });
  it("no floating-point round-up ((7 / 100) * 100 is just over 7)", () => {
    expect(rankPct(7, 100)).toBe("top 7%");
    for (let r = 1; r <= 100; r++) expect(rankPct(r, 100)).toBe(`top ${r}%`);
  });
  it("the last rank is top 100%, rank 1 of 1 too", () => {
    expect(rankPct(8375, 8375)).toBe("top 100%");
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
    expect(rankPct(91, 100, true)).toBe("Top 91%");
    expect(rankPct(null, 100, true)).toBeNull();
  });
});
