// Compare's head to head: which matches count as meetings, and from whose side (server/api/teams.ts).
import { describe, expect, it } from "vitest";
import { relationOf } from "./teams.js";

describe("relationOf", () => {
  it("reads a match from the first compared team in it", () => {
    expect(relationOf([1, 2, 3], [1, 9], [2, 8])).toBe("opponents");
    expect(relationOf([1, 2, 3], [1, 2], [7, 8])).toBe("partners");
    // The first requested team didn't play: the next compared team's side counts.
    expect(relationOf([1, 2, 3], [2, 9], [3, 8])).toBe("opponents");
    expect(relationOf([1, 2, 3], [2, 3], [7, 8])).toBe("partners");
  });
  it("leaves out a match with only one compared team", () => {
    expect(relationOf([1, 2], [1, 9], [7, 8])).toBeNull();
    expect(relationOf([1, 2], [5, 9], [7, 8])).toBeNull();
  });
});
