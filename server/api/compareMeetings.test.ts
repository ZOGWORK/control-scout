// Compare's head to head: which matches count as meetings, and from whose side (server/api/teams.ts).
import { describe, expect, it } from "vitest";
import { bySchedule, relationOf } from "./teams.js";

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

describe("bySchedule", () => {
  it("puts merged meetings back in schedule order, so an event's matches stay together", () => {
    const m = (code: string, time: string | null, level: string, number: number) => ({ code, time, level, series: 0, number });
    // A/B meetings at X and Y, then B/C's at X (as merged one team at a time).
    const merged = [m("X", "2026-01-10T10:00", "qual", 1), m("Y", "2026-02-01T10:00", "qual", 4), m("X", "2026-01-10T11:00", "qual", 9), m("X", "2026-01-10T15:00", "playoff", 1)];
    expect([...merged].sort(bySchedule).map((x) => `${x.code} ${x.level} ${x.number}`)).toEqual(["X qual 1", "X qual 9", "X playoff 1", "Y qual 4"]);
  });
});
