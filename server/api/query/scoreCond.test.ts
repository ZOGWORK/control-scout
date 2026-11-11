// A score an alliance had to reach, said in a match search ("where the losing alliance scored over 200"): read off
// as the match finder's filter, its number never a team. Fixture names only, no database; every phrasing is a
// rewording of a logged query, never the logged words.
import { describe, expect, it } from "vitest";
import { buildNames } from "./names";
import { parseQuery, queryTime, scoreCondOf, type ParseContext } from "./parse";
import { condValue, condWords } from "./matchFind";

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
    // A score said outright before "match": either alliance's, exactly; never after a comparison word (a floor).
    expect(scoreCondOf("numbered like a score 180 point match")).toEqual({ cond: { side: "either", op: "=", n: 180 }, rest: "numbered like a score match", said: "180 point" });
    expect(scoreCondOf("a 180-point game")).toMatchObject({ cond: { op: "=", n: 180 }, rest: "game" });
    expect(scoreCondOf("matches over 180 points")).toBeNull();
    expect(scoreCondOf("180 points in auto")).toBeNull();
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

  it("a team's match by its score: the team's matches, the score never a second team", async () => {
    const p = await parse("numbered like a score 180 point match");
    expect(p).toMatchObject({ intent: "season-matches", scoreCond: { side: "either", op: "=", n: 180 }, complete: true });
    expect(p.teams.map((t) => t.number)).toEqual([180]);
  });

  it("a match's own number is never dropped for the list", async () => {
    const p = await parse("match 12 at ohio championship where each alliance scored over 180");
    expect(p.intent === "top-matches" && p.complete).toBe(false);
  });

  it("a second limit is never dropped: the query is left to search", async () => {
    const p = await parse("games at ohio championship where each alliance scored over 150 and the losing side scored under 170");
    expect(p.intent === "top-matches" && p.complete).toBe(false);
    expect(await parse("games at ohio championship where each alliance scored over 150")).toMatchObject({ intent: "top-matches", complete: true });
  });

  it("the number is never a year, for the season picker either", () => {
    // 2030 is no team here: read as a year, a picked season would take the threshold out with it.
    expect(queryTime("games where each alliance scored over 2030", ctx.names, ctx.today).time).toBeNull();
    expect(queryTime("games in 2030 where each alliance scored over 180", ctx.names, ctx.today).time).toMatchObject({ kind: "season" });
  });
});

describe("the score held to the number", () => {
  it("both over is the lower score, both under the higher; either the other way round", () => {
    const LOW = "MIN(m.red_total, m.blue_total)", HIGH = "MAX(m.red_total, m.blue_total)";
    // A 300-100 match: both over 150 fails (the lower is 100); both under 150 fails (the higher is 300);
    // one over 150 passes (300); one under 150 passes (100).
    expect(condValue({ side: "both", op: ">", n: 150 })).toBe(LOW);
    expect(condValue({ side: "both", op: "<", n: 150 })).toBe(HIGH);
    expect(condValue({ side: "both", op: "<=", n: 150 })).toBe(HIGH);
    expect(condValue({ side: "either", op: ">=", n: 150 })).toBe(HIGH);
    expect(condValue({ side: "either", op: "<", n: 150 })).toBe(LOW);
    expect(condValue({ side: "losing", op: "<", n: 150 })).toBe(LOW);
    expect(condValue({ side: "winning", op: ">", n: 150 })).toBe(HIGH);
  });
});
