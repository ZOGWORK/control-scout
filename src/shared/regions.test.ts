import { describe, expect, it } from "vitest";
import { cityShortForm, findRegions, regionLabel, regionNames } from "./regions";
import { regionOf } from "./searchEventQuery";

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

describe("a place said another way", () => {
  it("reads New Jersey by its name, its code or its key, all one place", () => {
    for (const q of ["nj", "NJ", "new jersey", "New Jersey", "USA:NJ"]) expect(regionOf(q.split(" "))?.key).toBe("USA:NJ");
  });
  it("says a city FIRST runs as its own region by its events' short form, whole words only", () => {
    expect(cityShortForm("new york city championship")).toBe("NYC championship");
    expect(cityShortForm("New  York City")).toBe("NYC");
    expect(cityShortForm("new york championship")).toBe("new york championship");
    expect(cityShortForm("new york cityscape")).toBe("new york cityscape");
  });
});
