import { describe, expect, it } from "vitest";
import { oddsPct } from "./format";

describe("oddsPct", () => {
  it("plain percentages, never a flat 0% or 100% (and no < or > marks)", () => {
    expect(oddsPct(1)).toBe("99%");
    expect(oddsPct(0.999)).toBe("99%");
    expect(oddsPct(0.001)).toBe("1%");
    expect(oddsPct(0)).toBe("1%");
    expect(oddsPct(0.42)).toBe("42%");
  });
  it("a decided outcome shows as it is", () => {
    expect(oddsPct(1, true)).toBe("100%");
    expect(oddsPct(0, true)).toBe("0%");
  });
});
