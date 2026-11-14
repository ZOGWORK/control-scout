// The scope's clauses (./clauses.ts): official events only for scores and records, except an event the question names
// itself ("26000 at APOC", an off-season event), whose own matches are the answer.
import { describe, expect, it } from "vitest";
import { eventInScope, officialClause, type Scope } from "./clauses";

const apoc = { season: 2025, code: "AUSYOS", type: "OffSeason" };
const nj = { season: 2025, code: "USNJCMP", type: "Championship" };

describe("officialClause", () => {
  it("keeps official events only when no event is named", () => {
    expect(officialClause()(apoc)).toBe(false);
    expect(officialClause()(nj)).toBe(true);
    expect(eventInScope({ season: 2025 })(apoc)).toBe(false);
  });

  it("keeps an off-season event the question names, and only that one", () => {
    const s: Scope = { season: 2025, event: { season: 2025, code: "AUSYOS", name: "APOC" } } as Scope;
    expect(eventInScope(s)(apoc)).toBe(true);
    expect(eventInScope(s)({ ...apoc, code: "AUOTHER" })).toBe(false);
    expect(eventInScope(s)(nj)).toBe(false);
  });
});

describe("an answer about a named off-season event", () => {
  it("its method says the event's own matches count", async () => {
    const { NAMED_OFF_SEASON } = await import("./index");
    expect(NAMED_OFF_SEASON).toMatch(/off-season event: its own matches count/);
  });
});
