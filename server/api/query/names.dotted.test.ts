// A team name's dotted initials read as the word they spell (failed-search #1160; held out: other names and words).
import { describe, expect, it } from "vitest";
import { buildNames, joinDotted } from "./names";
import { parseQuery, type ParseContext } from "./parse";

const TEAMS = [
  { number: 31001, name: "S.T.E.A.M. Engines", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 31002, name: "Steam Punks", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 31003, name: "Code Red - M.E.D.I.C.S.", city: "Town", state: "TX", country: "USA", lastPlayed: 2026 },
  // A dotted name read first that spells another team's whole name (Greptile on #1163).
  { number: 31005, name: "G.E.A.R. Grinders", city: "Town", state: "TX", country: "USA", lastPlayed: 2026 },
  { number: 31004, name: "Gear Grinders", city: "Town", state: "TX", country: "USA", lastPlayed: 2026 },
  { number: 31006, name: "S.T.E.M. Queen's Court", city: "Town", state: "TX", country: "USA", lastPlayed: 2026 },
  { number: 31008, name: "R.O.V. Rangers", city: "Town", state: "TX", country: "USA", lastPlayed: 2026 },
];
const ctx: ParseContext = { names: buildNames(TEAMS, []), today: "2026-11-08", isEvent: async () => false };

describe("dotted initials", () => {
  it("join into the word they spell, a last letter without its dot too, and nothing else changes", () => {
    expect(joinDotted("S.T.E.A.M. Engines")).toBe("STEAM Engines");
    expect(joinDotted("Team R.O.B")).toBe("Team ROB");
    expect(joinDotted("Mr. Roboto 2.0")).toBe("Mr. Roboto 2.0");
    expect(joinDotted("St. Mary's")).toBe("St. Mary's");
  });
  it("find the team typed without dots, and with them", async () => {
    expect(await parseQuery("steam engines highlights", ctx)).toMatchObject({ intent: "highlights", complete: true, teams: [{ number: 31001 }] });
    expect(await parseQuery("s.t.e.a.m. engines record", ctx)).toMatchObject({ teams: [{ number: 31001 }] });
    expect(await parseQuery("code red medics opr", ctx)).toMatchObject({ teams: [{ number: 31003 }] });
    expect(await parseQuery("steam punks record", ctx)).toMatchObject({ teams: [{ number: 31002 }] });
  });
  it("with a possessive dropped too, and never hiding a near miss of another team's own name", async () => {
    expect(await parseQuery("stem queen's court record", ctx)).toMatchObject({ teams: [{ number: 31006 }] });
    expect(await parseQuery("stem queens court opr", ctx)).toMatchObject({ teams: [{ number: 31006 }] });
    // Both teams go by "gear grinders": one name, two teams, so a near miss of it is never a guess between them.
    expect(ctx.names.teamsNamed("gear grinders").map((t) => t.number).sort()).toEqual([31004, 31005]);
    expect(ctx.names.nearTeam("gear grindrs")).toBeNull();
    // Two spellings of one team tying is still that team (Greptile on #1163).
    expect(ctx.names.nearTeam("ro.v rangers")?.number).toBe(31008);
    expect(await parseQuery("steam enignes record", { ...ctx, nearTeam: async (w: string) => ctx.names.nearTeam(w) })).toMatchObject({ teams: [{ number: 31001, via: "near" }] });
  });
});
