import { describe, expect, it } from "vitest";
import { canonicalPath, canonicalQuery } from "./meta";

describe("canonicalPath (client) matches the server's canonical URLs", () => {
  it("upper-cases event codes, drops team zero-padding and trailing slashes", () => {
    expect(canonicalPath("/events/2025/usnjnom3")).toBe("/events/2025/USNJNOM3");
    expect(canonicalPath("/events/2025/USNJNOM3/")).toBe("/events/2025/USNJNOM3");
    expect(canonicalPath("/teams/004215")).toBe("/teams/4215");
    expect(canonicalPath("/teams/4215")).toBe("/teams/4215");
    expect(canonicalPath("/power-rankings/2026-W42")).toBe("/power-rankings/2026-w42");
    expect(canonicalPath("/")).toBe("/");
    expect(canonicalPath("/events")).toBe("/events");
    // Malformed or unexpected paths never throw; they're left as they are.
    expect(() => canonicalPath("/events/2025/%ZZ")).not.toThrow();
    expect(canonicalPath("/events/2025/%ZZ")).toBe("/events/2025/%ZZ");
  });
});

describe("canonicalPath: FIRST's other codes (src/shared/eventCode.ts)", () => {
  it("upper-cases and encodes them as the server's canonical does, however the address spells them", () => {
    expect(canonicalPath("/events/2019/2019INMeet10")).toBe("/events/2019/2019INMEET10");
    expect(canonicalPath("/events/2019/laredomeet%202")).toBe("/events/2019/LAREDOMEET%202");
    expect(canonicalPath("/events/2024/NL'hko")).toBe("/events/2024/NL'HKO");
    expect(canonicalPath("/events/2024/NL%27HKO")).toBe("/events/2024/NL'HKO");
    expect(canonicalPath("/events/2021/RU%D0%BC%D0%BEs")).toBe(`/events/2021/${encodeURIComponent("RUМОS")}`);
    expect(canonicalPath("/events/2019/63693260770.2649/display")).toBe("/events/2019/63693260770.2649");
    // A code an address can't carry is left as written.
    expect(canonicalPath("/events/2019/a%3Fb")).toBe("/events/2019/a%3Fb");
  });
});

describe("canonicalPath: the pit display", () => {
  it("is canonical to its event page, as the server says", () => {
    expect(canonicalPath("/events/2025/usnjnom3/display")).toBe("/events/2025/USNJNOM3");
    expect(canonicalPath("/events/2025/USNJNOM3/Display/")).toBe("/events/2025/USNJNOM3");
  });
});

describe("canonicalQuery (client) keeps /rankings' view, like the server", () => {
  it("season, region, week and a page past the first, in a fixed order; nothing for other pages", () => {
    expect(canonicalQuery("/rankings", "?page=2&region=USA:TX&utm_source=x&season=2025")).toBe("?season=2025&region=USA%3ATX&page=2");
    expect(canonicalQuery("/rankings", "?page=1")).toBe("");
    expect(canonicalQuery("/rankings/", "")).toBe("");
    expect(canonicalQuery("/teams", "?season=2025")).toBe("");
  });
  it("normalised as the server reads the view: places as the API parses them (repeats joined), refused values left out", () => {
    expect(canonicalQuery("/rankings", "?region=USA:tx&region=Canada")).toBe("?region=USA%3ATX%2CCanada");
    expect(canonicalQuery("/rankings", "?region=%3Cx%3E&week=2026-02-17&page=-3&season=abc")).toBe("");
    expect(canonicalQuery("/rankings", "?week=2026-02-16&page=2.5")).toBe("?week=2026-02-16");
  });
});
