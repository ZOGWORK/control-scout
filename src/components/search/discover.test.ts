// The example searches show the range of what search answers: never one team's page, and no fixed team at all.
import { describe, expect, it } from "vitest";
import { SEARCH_EXAMPLES, SEARCH_EXAMPLE_SET } from "./discover";
import { READINGS, SEARCH_FAMILIES, SEARCH_SHOWCASE, SEARCH_STEPS } from "../howitworks/searchDocs";

/** The teams the how-it-works page's worked examples name (each reads one query word by word). */
const DOC_TEAMS = new Set(["4215", "6980", "7149", "23268"]);

describe("example searches", () => {
  it("name no team, by number or by a team's name", () => {
    expect(SEARCH_EXAMPLES.filter((q) => /\b\d{3,5}\b/.test(q))).toEqual([]);
    for (const name of ["Hypnotic", "Bad Wolf", "ENFORCERS", "Don't Blink", "Ultraviolet", "Bit by Bit"]) {
      expect(SEARCH_EXAMPLES.filter((q) => q.toLowerCase().includes(name.toLowerCase())), name).toEqual([]);
    }
  });
  it("lean on no one region", () => {
    expect(SEARCH_EXAMPLES.filter((q) => /\b(nj|new jersey|oradell)\b/i.test(q))).toEqual([]);
  });
  it("the how-it-works search examples name only its few worked-example teams", () => {
    const docs = [...SEARCH_STEPS.map((s) => s.example), ...SEARCH_FAMILIES.map((f) => f.q), ...SEARCH_SHOWCASE.flatMap((g) => g.items.map((i) => i.q)), ...READINGS.map((r) => r.q)];
    // A season ("2025-26", "2024/25") or a year ("march 15 2026") is not a team.
    const numbers = (q: string) => q.replace(/\b(19|20)\d\d([-/]\d\d)?\b/g, "").match(/\b\d{3,5}\b/g) ?? [];
    expect(docs.flatMap(numbers).filter((t) => !DOC_TEAMS.has(t))).toEqual([]);
    // It catches a team outside them.
    expect(numbers("is 14450's rating rising or falling in 2025-26")).toEqual(["14450"]);
  });
  it("sentence case: each starts with a capital or a number", () => {
    for (const q of SEARCH_EXAMPLES) expect(q).toMatch(/^[A-Z0-9]/);
  });
  it("one of each kind, and every query once", () => {
    expect(new Set(SEARCH_EXAMPLE_SET.map((e) => e.kind)).size).toBe(SEARCH_EXAMPLE_SET.length);
    expect(new Set(SEARCH_EXAMPLES).size).toBe(SEARCH_EXAMPLES.length);
  });
});
