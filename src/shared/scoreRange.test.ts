import { describe, expect, it } from "vitest";
import { levelPct, plusMinus, predictedText, rangeSentence, rangesOf } from "./scoreRange";

describe("score ranges", () => {
  it("± is the half-width, the larger side when the range is cut off at 0", () => {
    expect(plusMinus(118, [104, 132])).toBe(14);
    expect(plusMinus(10, [0, 30])).toBe(20);
  });

  it("reads the same everywhere", () => {
    expect(predictedText({ redMean: 118.4, blueMean: 96, redRange: [104, 132], blueRange: [84, 108] })).toBe("118 ±14 – 96 ±12");
    expect(predictedText({ redMean: 118.4, blueMean: 96 })).toBe("118–96"); // a call from before ranges were stated
    expect(levelPct(0.8)).toBe("80%");
    expect(rangeSentence([104, 132])).toBe("80% range 104–132: about 8 in 10 real scores land inside");
  });

  it("carries the engine's bands into a match prediction", () => {
    expect(rangesOf({ scoreBandA: { lo: 1, hi: 9, level: 0.8 }, scoreBandB: { lo: 2, hi: 8, level: 0.8 } }))
      .toEqual({ redRange: [1, 9], blueRange: [2, 8], rangeLevel: 0.8 });
  });
});
