import { describe, expect, it } from "vitest";
import { regionNames } from "./regions";

describe("regionNames", () => {
  it("spells out codes per country", () => {
    expect(regionNames("NJ", "USA")).toContain("New Jersey");
    expect(regionNames("ON", "Canada")).toBe("Ontario");
    expect(regionNames("MT", "Brazil")).toBe(""); // not Montana
    expect(regionNames(null, "United Kingdom")).toContain("UK");
    expect(regionNames(undefined, undefined)).toBe("");
  });
});
