// The example searches show the range of what search answers: never one team over and over.
import { describe, expect, it } from "vitest";
import { SEARCH_EXAMPLES, SEARCH_EXAMPLE_SET } from "./discover";
import { SUGGESTION_TEAMS } from "../../shared/homeSuggestions";
import { READINGS, SEARCH_FAMILIES, SEARCH_SHOWCASE, SEARCH_STEPS } from "../howitworks/searchDocs";

/** The teams a query names: its team numbers, and the six suggestion teams it names by name. */
const teamsIn = (q: string) => [...(q.match(/\b\d{3,5}\b/g) ?? []),
  ...Object.entries(SUGGESTION_TEAMS).filter(([, name]) => q.toLowerCase().includes(name.toLowerCase())).map(([n]) => n)];

describe("example searches", () => {
  it("no team appears in two examples", () => {
    const teams = SEARCH_EXAMPLES.flatMap(teamsIn);
    expect(new Set(teams).size).toBe(teams.length);
  });
  it("names only the six suggestion teams, here and in the how-it-works search examples", () => {
    const allowed = new Set(Object.keys(SUGGESTION_TEAMS));
    const docs = [...SEARCH_STEPS.map((s) => s.example), ...SEARCH_FAMILIES.map((f) => f.q), ...SEARCH_SHOWCASE.flatMap((g) => g.items.map((i) => i.q)), ...READINGS.map((r) => r.q)];
    // A season ("2025-26", "2024/25") or a year ("march 15 2026") is not a team.
    const numbers = (q: string) => q.replace(/\b(19|20)\d\d([-/]\d\d)?\b/g, "").match(/\b\d{3,5}\b/g) ?? [];
    expect([...SEARCH_EXAMPLES.flatMap(teamsIn), ...docs.flatMap(numbers)].filter((t) => !allowed.has(t))).toEqual([]);
    // It catches a team outside the six.
    expect(numbers("is 14450's rating rising or falling in 2025-26")).toEqual(["14450"]);
  });
  it("some name no team at all", () => {
    expect(SEARCH_EXAMPLES.filter((q) => !teamsIn(q).length).length).toBeGreaterThanOrEqual(2);
  });
  it("sentence case: each starts with a capital or a number", () => {
    for (const q of SEARCH_EXAMPLES) expect(q).toMatch(/^[A-Z0-9]/);
  });
  it("one of each kind, and every query once", () => {
    expect(new Set(SEARCH_EXAMPLE_SET.map((e) => e.kind)).size).toBe(SEARCH_EXAMPLE_SET.length);
    expect(new Set(SEARCH_EXAMPLES).size).toBe(SEARCH_EXAMPLES.length);
  });
});
