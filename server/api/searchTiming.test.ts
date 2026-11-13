import { describe, expect, it } from "vitest";
import { searchTiming } from "./searchTiming";

describe("searchTiming", () => {
  it("writes each part as name;dur in milliseconds, to a tenth, in order", () => {
    expect(searchTiming({ answer: 12.345, extras: 0.04 })).toBe("answer;dur=12.3, extras;dur=0.0");
  });

  it("leaves out a time that isn't one, and a name a header can't carry", () => {
    expect(searchTiming({ answer: Number.NaN, follow: -1, "bad name": 3, extras: 2 })).toBe("extras;dur=2.0");
    expect(searchTiming({})).toBe("");
  });
});
