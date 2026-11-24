import { describe, expect, it } from "vitest";
import { SLOW_SEARCH_MS, searchTiming, slowSearchLine } from "./searchTiming";

describe("searchTiming", () => {
  it("writes each part as name;dur in milliseconds, to a tenth, in order", () => {
    expect(searchTiming({ answer: 12.345, extras: 0.04 })).toBe("answer;dur=12.3, extras;dur=0.0");
  });

  it("leaves out a time that isn't one, and a name a header can't carry", () => {
    expect(searchTiming({ answer: Number.NaN, follow: -1, "bad name": 3, extras: 2 })).toBe("extras;dur=2.0");
    expect(searchTiming({})).toBe("");
  });
});

describe("slowSearchLine", () => {
  it("says nothing for a search under a second in all", () => {
    expect(slowSearchLine("answer", { answer: 600, extras: SLOW_SEARCH_MS - 601 }, "4215")).toBeNull();
  });
  it("names the route, the total, each part and the words (cut, on one line)", () => {
    expect(slowSearchLine("answer", { answer: 900.4, extras: 350.2 }, "  has 4215\n been to worlds? ")).toBe('[search] slow answer 1251 ms (answer 900, extras 350) q="has 4215 been to worlds?"');
    expect(slowSearchLine("follow", { follow: 2400 }, "x".repeat(200))).toContain(`q="${"x".repeat(80)}"`);
  });
});
