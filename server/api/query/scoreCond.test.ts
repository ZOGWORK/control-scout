// A score an alliance had to reach, said in a match search ("where the losing alliance scored over 200"): read off
// as the match finder's filter, its number never a team. Fixture names only, no database; every phrasing is a
// rewording of a logged query, never the logged words.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { parseQuery, scoreCondOf, type ParseContext } from "./parse";
import { condWords } from "./matchFind";

const ctx: ParseContext = {
  // A team numbered like the score, so a number read as a team would show.
  names: buildNames([{ number: 180, name: "Numbered Like A Score", city: "Town", state: "OH", country: "USA", lastPlayed: 2026 }], []),
  today: "2026-11-04",
  isEvent: async (w) => w === "ohio championship",
};
const parse = (q: string) => parseQuery(q, ctx);

describe("whose score, which way, how many", () => {
  it("reads the side, the comparison and the number, and leaves the rest", () => {
    expect(scoreCondOf("games in ohio last week with the losing side scored over 180")).toMatchObject({ cond: { side: "losing", op: ">", n: 180 }, rest: "games in ohio last week" });
    expect(scoreCondOf("matches where each alliance had at least 180 points")).toMatchObject({ cond: { side: "both", op: ">=", n: 180 } });
    expect(scoreCondOf("matches where the winning alliance scored under 90")).toMatchObject({ cond: { side: "winning", op: "<", n: 90 } });
    expect(scoreCondOf("matches where one alliance scored more than 400")).toMatchObject({ cond: { side: "either", op: ">", n: 400 } });
    expect(scoreCondOf("180 highest score")).toBeNull();
  });

  it("says it back in words", () => {
    expect(condWords({ side: "losing", op: ">", n: 180 })).toBe("the losing alliance scored over 180");
    expect(condWords({ side: "both", op: ">=", n: 180 })).toBe("both alliances scored at least 180");
  });
});

describe("a match search with a score to reach", () => {
  it("is the match list, the number never a team, at a place, a window or an event", async () => {
    expect(await parse("games in ohio last week where the losing side scored over 180")).toMatchObject({ intent: "top-matches", teams: [], scoreCond: { side: "losing", n: 180 }, place: { name: "Ohio" }, complete: true });
    expect(await parse("matches at ohio championship where each alliance scored over 180")).toMatchObject({ intent: "top-matches", teams: [], event: { words: "ohio championship" }, complete: true });
    expect(await parse("highest scoring matches where both alliances scored at least 180")).toMatchObject({ intent: "top-matches", complete: true });
  });
});
