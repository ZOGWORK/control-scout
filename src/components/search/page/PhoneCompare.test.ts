// Compare picks on a phone's /search: two sides at most, a third replaces the first; the link keeps the season.
import { describe, expect, it } from "vitest";
import { pickHref, togglePick } from "./PhoneCompare";

describe("togglePick", () => {
  it("picks, unpicks, and keeps the last two", () => {
    expect(togglePick([], 1)).toEqual([1]);
    expect(togglePick([1], 1)).toEqual([]);
    expect(togglePick([1, 2], 3)).toEqual([2, 3]);
  });
  it("links both sides, in the results' season when they name one", () => {
    expect(pickHref([4215, 23268])).toBe("/compare?teams=4215,23268");
    expect(pickHref([4215, 23268], 2024)).toBe("/compare?teams=4215,23268&season=2024");
  });
});
