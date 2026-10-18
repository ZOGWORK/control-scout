import { describe, expect, it } from "vitest";
import { COUNTRIES, countryByCode, countryKey, countryOf } from "./countries";

describe("countryOf", () => {
  it("normalises the directory's spellings to one country", () => {
    expect(countryOf("USA")?.code).toBe("US");
    expect(countryOf("United States")?.code).toBe("US");
    expect(countryOf("Türkiye")?.code).toBe("TR");
    expect(countryOf("Turkey")?.code).toBe("TR");
    expect(countryOf("eSwatini")?.code).toBe("SZ");
    expect(countryOf("Eswatini")?.code).toBe("SZ");
    expect(countryOf("Chinese Taipei")?.code).toBe("TW");
    expect(countryOf("Bosnia-Herzegovina")?.code).toBe("BA");
    expect(countryOf("Ivory Coast")?.code).toBe("CI");
    expect(countryOf("Macedonia")?.code).toBe("MK");
    expect(countryOf("  czech republic ")?.code).toBe("CZ");
  });

  it("leaves what isn't a country unmapped", () => {
    expect(countryOf(null)).toBeNull();
    expect(countryOf("")).toBeNull();
    expect(countryOf("   ")).toBeNull();
    expect(countryOf("Independent")).toBeNull();
    expect(countryOf("Atlantis")).toBeNull();
  });

  it("has one entry per code and per numeric code", () => {
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.numeric)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) {
      expect(c.numeric).toMatch(/^\d{3}$/);
      expect(countryOf(c.name)).toBe(c);
      expect(countryByCode(c.code.toLowerCase())).toBe(c);
    }
  });

  it("folds case, accents and punctuation", () => {
    expect(countryKey("Côte d'Ivoire")).toBe("cotedivoire");
    expect(countryKey("eSwatini")).toBe(countryKey("Eswatini"));
  });
});
