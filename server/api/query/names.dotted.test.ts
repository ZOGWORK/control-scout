// A team name's dotted initials read as the word they spell (failed-search #1160; held out: other names and words).
import { describe, expect, it } from "vitest";
import { buildNames, joinDotted } from "./names";
import { parseQuery, type ParseContext } from "./parse";

const TEAMS = [
  { number: 31001, name: "S.T.E.A.M. Engines", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 31002, name: "Steam Punks", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  { number: 31003, name: "Code Red - M.E.D.I.C.S.", city: "Town", state: "TX", country: "USA", lastPlayed: 2026 },
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
});
