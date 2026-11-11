// The next event in words, never its code (Sushil, 11-11): its name when ours, FTC Events' own words, else "the next event".
import { describe, expect, it } from "vitest";
import { advancementHeading, advancesToWords } from "./AdvancedTeams";

describe("where an event's teams advance to, in words", () => {
  it("the next event's name, never its code", () => {
    expect(advancesToWords({ advancesTo: "USNJCMP", advancesToName: "New Jersey Championship" })).toBe("the New Jersey Championship");
    expect(advancesToWords({ advancesTo: "FTCCMP1", advancesToName: "FIRST Championship" })).toBe("the FIRST Championship");
  });
  it("a code with no name known: the next event", () => {
    expect(advancesToWords({ advancesTo: "USNJCMP", advancesToName: null })).toBe("the next event");
    expect(advancesToWords({ advancesTo: "USNJCMP" })).toBe("the next event");
    expect(advancesToWords({ advancesTo: null })).toBe("the next event");
  });
  it("FTC Events' own words are kept", () => {
    expect(advancesToWords({ advancesTo: "FIRST Championship & Premier Events" })).toBe("the FIRST Championship & Premier events");
  });
  it("the heading counts the teams that took a slot, else the slots", () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ team: i + 1, status: "FIRST", declined: false }));
    expect(advancementHeading({ slots: 5, advancesTo: "USNJCMP", advancesToName: "New Jersey Championship", rows: rows(5) })).toBe("5 teams advance to the New Jersey Championship");
    expect(advancementHeading({ slots: 1, advancesTo: "X1", rows: rows(1) })).toBe("1 team advances to the next event");
    expect(advancementHeading({ slots: 3, advancesTo: "X1", rows: [] })).toBe("3 slots to the next event");
    expect(advancementHeading({ slots: 2, advancesTo: "X1", rows: [{ team: 1, status: "FIRST", declined: true }] })).toBe("2 slots to the next event");
  });
});
