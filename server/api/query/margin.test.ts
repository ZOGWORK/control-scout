// A margin said exactly ("which game did <team> lose by 2 points"): the team's matches decided by it, its number never a
// team. Fixture names only, no database; every phrasing is a rewording of a logged query, never the logged words.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { marginOf, parseQuery, type ParseContext } from "./parse";

const ctx: ParseContext = {
  // Teams numbered like the margins, so a margin read as a team would show.
  names: buildNames([
    { number: 6980, name: "Bad Wolf", city: "Fair Lawn", state: "NJ", country: "USA", lastPlayed: 2026 },
    { number: 2, name: "Numbered Like A Margin", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
    { number: 15, name: "Also A Margin", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 },
  ], []),
  today: "2026-11-04",
  isEvent: async () => false,
};
const parse = (q: string) => parseQuery(q, ctx);

describe("a margin said exactly", () => {
  it("is read off after a win or a loss, never a team", async () => {
    expect(marginOf("which game did 6980 lose by 2 points")).toEqual({ margin: 2, rest: "which game did 6980 lose" });
    expect(marginOf("6980 matches won by exactly 15 points")).toMatchObject({ margin: 15 });
    expect(marginOf("6980 beat 4215 by 15 pts")).toMatchObject({ margin: 15 });
    // "By" with no win or loss before it is something else ("teams ranked by 2 points"): left alone.
    expect(marginOf("6980 sorted by 2 points")).toBeNull();
  });

  it("asks for the team's closest-match answer, its win or loss kept", async () => {
    expect(await parse("which game did 6980 lose by 2 points")).toMatchObject({ intent: "closest-match", teams: [{ number: 6980 }], margin: 2, complete: true });
    expect(await parse("did 6980 ever win a match by 15 points")).toMatchObject({ intent: "closest-match", teams: [{ number: 6980 }], margin: 15, complete: true });
    expect(await parse("6980 closest loss")).not.toHaveProperty("margin");
  });
});
