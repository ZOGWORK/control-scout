// The example searches show the range of what search answers: never one team over and over.
import { describe, expect, it } from "vitest";
import { SEARCH_EXAMPLES, SEARCH_EXAMPLE_SET } from "./discover";

describe("example searches", () => {
  it("no team number appears in two examples", () => {
    const numbers = SEARCH_EXAMPLES.flatMap((q) => q.match(/\b\d{3,5}\b/g) ?? []);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
  it("some name no team at all", () => {
    expect(SEARCH_EXAMPLES.filter((q) => !/\b\d{3,5}\b/.test(q)).length).toBeGreaterThanOrEqual(2);
  });
  it("one of each kind, and every query once", () => {
    expect(new Set(SEARCH_EXAMPLE_SET.map((e) => e.kind)).size).toBe(SEARCH_EXAMPLE_SET.length);
    expect(new Set(SEARCH_EXAMPLES).size).toBe(SEARCH_EXAMPLES.length);
  });
});
