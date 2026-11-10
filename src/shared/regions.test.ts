import { describe, expect, it } from "vitest";
import { findRegions, regionLabel, regionNames } from "./regions";

describe("regionNames", () => {
  it("spells out codes per country", () => {
    expect(regionNames("NJ", "USA")).toContain("New Jersey");
    expect(regionNames("ON", "Canada")).toBe("Ontario");
    expect(regionNames("MT", "Brazil")).toBe(""); // not Montana
    expect(regionNames(null, "United Kingdom")).toContain("UK");
    expect(regionNames(undefined, undefined)).toBe("");
  });
  it("finds regions by name, start of name or code", () => {
    expect(findRegions("New Jersey").map((r) => r.key)).toEqual(["USA:NJ"]);
    expect(findRegions("new jers").map((r) => r.key)).toEqual(["USA:NJ"]);
    expect(findRegions("nj").map((r) => r.key)).toEqual(["USA:NJ"]);
    expect(findRegions("quebec").map((r) => r.key)).toEqual(["Canada:QC"]);
    expect(findRegions("new")).toEqual([]);
    expect(findRegions("robotics")).toEqual([]);
    expect(regionLabel("USA:NJ")).toBe("New Jersey");
  });
});

describe("placeName", () => {
  it("a state's own name, else the country as FIRST names it, never search words", async () => {
    const { placeName } = await import("./regions");
    expect(placeName("NJ", "USA")).toBe("New Jersey");
    expect(placeName(null, "USA")).toBe("USA");
    expect(placeName("XX", "Mexico")).toBe("Mexico");
    expect(placeName(null, null)).toBeNull();
  });
});
