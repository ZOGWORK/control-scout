import { describe, expect, it } from "vitest";
import { cleanCity, cleanSchool } from "./placeClean";
import { place } from "./format";

describe("cleanSchool", () => {
  it("writes FIRST's cut-short last word in full", () => {
    expect(cleanSchool("River Dell Regional High Sch")).toBe("River Dell Regional High School");
    expect(cleanSchool("Technology Acad")).toBe("Technology Academy");
    expect(cleanSchool("Legacy Preparatory Chrn")).toBe("Legacy Preparatory Christian");
  });
  it("leaves whole names, other words and a name that is only the short word alone", () => {
    expect(cleanSchool("Mt Mansfield Union High School")).toBe("Mt Mansfield Union High School");
    expect(cleanSchool("Schaumburg")).toBe("Schaumburg");
    expect(cleanSchool("Sch")).toBe("Sch");
    expect(cleanSchool("Kids2Kids Family/Community")).toBe("Kids2Kids Family/Community");
    expect(cleanSchool(null)).toBeNull();
  });
});

describe("cleanCity", () => {
  it("keeps two of a letter typed three times", () => {
    expect(cleanCity("Oradelll", "NJ", "USA")).toBe("Oradell");
    expect(cleanCity("Greeensboro", "NC", "USA")).toBe("Greensboro");
    expect(cleanCity("Oradell", "NJ", "USA")).toBe("Oradell");
  });
  it("drops the row's own state or country said again after a comma", () => {
    expect(cleanCity("McKinney, Texas", "TX", "USA")).toBe("McKinney");
    expect(cleanCity("San Diego, CA, USA", "CA", "USA")).toBe("San Diego");
    expect(cleanCity("Orange Beach, AL 36561", "AL", "USA")).toBe("Orange Beach");
    expect(cleanCity("Red Deer, Alberta, Canada", "AB", "Canada")).toBe("Red Deer");
    expect(cleanCity("Piscataway,", "NJ", "USA")).toBe("Piscataway");
    expect(cleanCity("McKinney, Texas,", "TX", "USA")).toBe("McKinney");
    expect(cleanCity(cleanCity("McKinney, Texas,", "TX", "USA"), "TX", "USA")).toBe("McKinney");
  });
  it("keeps a district or another state's name", () => {
    expect(cleanCity("CDMX, Tlalpan", "CMX", "Mexico")).toBe("CDMX, Tlalpan");
    expect(cleanCity("Kansas City, Missouri", "KS", "USA")).toBe("Kansas City, Missouri");
    expect(cleanCity("Texas", "TX", "USA")).toBe("Texas");
  });
});

describe("place", () => {
  it("leaves out a part that is only digits (a numeric state code)", () => {
    expect(place("San Lorenzo", "11", "Paraguay")).toBe("San Lorenzo, Paraguay");
    expect(place("Kingston 6", "02", "Jamaica")).toBe("Kingston 6, Jamaica");
  });
});
