// The search display audit (v2.8.9): one possessive rule and one chart-caption sentence, used everywhere.
import { describe, expect, it } from "vitest";
import { possessive, rangeCaption } from "./format";

describe("possessive", () => {
  it("a name ending in s takes an apostrophe alone", () => {
    expect(possessive("Hypnotic Robotics")).toBe("Hypnotic Robotics'");
    expect(possessive("4215 Hypnotic Robotics")).toBe("4215 Hypnotic Robotics'");
    expect(possessive("ENFORCERS")).toBe("ENFORCERS'");
  });
  it("any other name takes 's", () => {
    expect(possessive("Bad Wolf")).toBe("Bad Wolf's");
    expect(possessive("4215")).toBe("4215's");
    expect(possessive("Hypnotic Robotics (4215)")).toBe("Hypnotic Robotics (4215)'s");
  });
});

describe("rangeCaption", () => {
  it("one sentence, sentence case, the unit once", () => {
    expect(rangeCaption(52.4, 101.6, 5)).toBe("Ranges from 52.4 to 101.6 across 5 values.");
    expect(rangeCaption(72, 174.9, 5, "points")).toBe("Ranges from 72 to 174.9 points across 5 values.");
  });
  it("one point, or every point the same", () => {
    expect(rangeCaption(80, 80, 1)).toBe("One value: 80.");
    expect(rangeCaption(80, 80, 3, "points")).toBe("All 3 values: 80 points.");
  });
  it("never the old mixed-case form", () => expect(rangeCaption(52.4, 101.6, 5)).not.toMatch(/·|on the chart|^Low/));
});
