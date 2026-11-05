// The eval's typo cases (./truth.ts): a misspelling is checked only when it is one edit from its team's name and more
// than one from every other team's, decided from the names alone, never by search's own nearest-name reader.
import { describe, expect, it } from "vitest";
import { editDistance, unambiguousTypo } from "./truth";

describe("typo cases", () => {
  it("counts edits, stopping past the limit", () => {
    expect(editDistance("copper lantern", "copper lanterns", 1)).toBe(1);
    expect(editDistance("coper lanterns", "copper lanterns", 1)).toBe(1);
    expect(editDistance("copper", "cobalt", 1)).toBe(2);
    expect(editDistance("a", "abcdef", 1)).toBe(2);
  });

  it("keeps a typo only one team's name is near", () => {
    const names = [{ number: 30002, name: "copper lanterns" }, { number: 30003, name: "silver beacons" }];
    expect(unambiguousTypo("Coper Lanterns", 30002, names)).toBe(true);
    // As near another team's name: a reader couldn't tell which was meant.
    expect(unambiguousTypo("Coper Lanterns", 30002, [...names, { number: 30004, name: "coper lanterns" }])).toBe(false);
    // Not near its own team at all.
    expect(unambiguousTypo("silver beacons", 30002, names)).toBe(false);
  });
});
