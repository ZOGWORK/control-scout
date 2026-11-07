// A match that "went to a tiebreak, or overtime": a tie, said another way, so the team's ties answer it. A team named
// like the word ("Overtime") is still that team anywhere a verb doesn't say how a match ended. Fixture names only;
// every phrasing is a rewording of a logged query, never the logged words.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { endedLevel, parseQuery, type ParseContext } from "./parse";

const ctx: ParseContext = {
  names: buildNames([
    { number: 6980, name: "Bad Wolf", city: "Fair Lawn", state: "NJ", country: "USA", lastPlayed: 2026 },
    { number: 30020, name: "Overtime", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  ], []),
  today: "2026-11-04",
  isEvent: async () => false,
};
const parse = (q: string) => parseQuery(q, ctx);

describe("a match that ended level", () => {
  it("went to a tiebreak, overtime or sudden death is a tie", () => {
    expect(endedLevel("has 6980 had a game that ended in a tiebreaker")).toBe("has 6980 had a game that tied");
    expect(endedLevel("6980 matches that went to overtime or a tiebreak")).toBe("6980 matches that tied");
    expect(endedLevel("6980 matches decided by sudden death")).toBe("6980 matches tied");
  });

  it("asks for the team's ties, playing said as a verb", async () => {
    expect(await parse("has 6980 ever played a game that went to a tiebreaker or overtime")).toMatchObject({ intent: "ties-count", teams: [{ number: 6980 }], complete: true });
    expect(await parse("6980 matches that ended in a tie")).toMatchObject({ intent: "ties-count", complete: true });
  });

  it("any ending said either side of an or, and tie-break hyphenated", async () => {
    expect(endedLevel("6980 games that went to sudden death or a tie")).toBe("6980 games that tied");
    for (const q of ["did 6980 have any games go to a Tie-Break", "6980 games that went to sudden death or a tie"]) {
      expect(await parse(q), q).toMatchObject({ intent: "ties-count", complete: true });
    }
  });

  it("a state after it keeps its capitals", async () => {
    expect((await parse("6980 games that ended in a tie in IN")).place).toMatchObject({ kind: "region", state: "IN" });
  });

  it("a match's number with it is left to search", async () => {
    expect(await parse("did 6980 play match 4 that went to overtime")).not.toMatchObject({ intent: "ties-count", complete: true });
  });

  it("a team named Overtime is still that team", async () => {
    expect(await parse("overtime record")).toMatchObject({ intent: "record", teams: [{ number: 30020 }] });
    expect(await parse("6980 vs overtime")).toMatchObject({ teams: [{ number: 6980 }, { number: 30020 }] });
  });
});
