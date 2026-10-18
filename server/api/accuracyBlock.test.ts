// The accuracy block's denominators: `n` counts every scored call, `accuracy`
// and `upsets` only decided ones (no tie, no 50:50 call), and `decided` says how
// many those are, so a correct/missed split never mixes the two.
import { describe, expect, it } from "vitest";
import { block } from "./accuracy";

const call = (p: number, y: number) => ({ p, y, tier: "confident" as const, level: "qual", time: null });

describe("accuracy block", () => {
  it("counts decided calls apart from ties and 50:50 calls", () => {
    const b = block([
      call(0.7, 1), call(0.8, 1), call(0.6, 1), // right
      call(0.9, 0),                              // missed (an upset)
      call(0.7, 0.5),                            // tied match
      call(0.5, 1),                              // 50:50 call
    ])!;
    expect(b.n).toBe(6);
    expect(b.decided).toBe(4);
    expect(b.upsets).toBe(1);
    expect(b.accuracy).toBeCloseTo(3 / 4);
    // The split a correct/missed bar draws: both parts from the same denominator.
    expect(b.decided - b.upsets).toBe(Math.round(b.accuracy * b.decided));
    // Not from the all-scored n: that would claim 4.5 right calls.
    expect(b.accuracy * b.n).not.toBe(b.decided - b.upsets);
  });

  it("is null with no calls, and zero decided when every call was a tie", () => {
    expect(block([])).toBeNull();
    const ties = block([call(0.7, 0.5), call(0.4, 0.5)])!;
    expect(ties).toMatchObject({ n: 2, decided: 0, upsets: 0, accuracy: 0 });
  });
});
