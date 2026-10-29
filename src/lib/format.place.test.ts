import { describe, expect, it } from "vitest";
import { place } from "./format";

describe("place", () => {
  it("joins the parts it has with commas", () => {
    expect(place("Livingston High School", "Livingston", "NJ", "USA")).toBe("Livingston High School, Livingston, NJ, USA");
    expect(place(null, "Livingston", undefined, "USA")).toBe("Livingston, USA");
    expect(place(null, undefined)).toBe("");
  });
  it("never doubles a comma when a part already ends in one", () => {
    expect(place("Livingston High School,", "Livingston", "NJ")).toBe("Livingston High School, Livingston, NJ");
    expect(place("Livingston High School, ", " Livingston", "NJ")).toBe("Livingston High School, Livingston, NJ");
    expect(place(", Main St ,", "Town")).toBe("Main St, Town");
  });
  it("drops parts that are only commas or spaces", () => {
    expect(place("  ", ",", "Livingston")).toBe("Livingston");
  });
});
