// One rounding everywhere (src/shared/format.ts `fixed`): the 2026-11-26 Discord bot audit found 6980's auto at 0.1 on
// its stat card and 0.2 on the compare card, and 4215's endgame at 5.5 and 5.6, because some pages used toFixed.
import { describe, expect, it } from "vitest";
import { fixed, num, pct } from "./format";

describe("fixed", () => {
  it("rounds a stored half up, where toFixed reads the binary value below it", () => {
    expect((0.15).toFixed(1)).toBe("0.1"); // what the stat card showed
    expect(fixed(0.15)).toBe("0.2");
    expect(fixed(5.55)).toBe("5.6");
    expect(fixed(4.35)).toBe("4.4");
    expect(fixed(1.005, 2)).toBe("1.01");
    expect(fixed(16.02)).toBe("16.0");
    expect(fixed(11.26)).toBe("11.3");
    expect(fixed(-0.62)).toBe("-0.6");
  });

  it("is what num and pct use, so a page, a card and the bot read the same", () => {
    expect(num(0.15)).toBe("0.2");
    expect(num(5.55)).toBe("5.6");
    expect(num(16.04)).toBe("16");
    expect(pct(0.1235, 1)).toBe("12.4%");
  });
});
