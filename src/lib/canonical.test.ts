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
