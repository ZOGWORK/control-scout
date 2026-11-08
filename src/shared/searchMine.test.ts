import { describe, expect, it } from "vitest";
import { MINE, mineQuery, myTeamOf } from "./searchMine";

describe("my and our as the visitor's team (failed-search #731, #1144; held out: other words)", () => {
  it("puts the team in place of my, our and my team", () => {
    expect(mineQuery("when is our next match", 6980)).toBe("when is 6980's next match");
    expect(mineQuery("how did my team do at states", 6980)).toBe("how did 6980 do at states");
    expect(mineQuery("what's our team's record this season", 6980)).toBe("what's 6980's record this season");
    expect(mineQuery("My own team's OPR?", 6980)).toBe("6980's OPR?");
  });
  it("reads my and our only as whole words", () => {
    expect(MINE.test("mystic robotics")).toBe(false);
    expect(MINE.test("tour events")).toBe(false);
    expect(MINE.test("Our record")).toBe(true);
  });
  it("takes a team number only", () => {
    expect(myTeamOf("6980")).toBe(6980);
    for (const x of [undefined, "", "0", "-3", "1.5", "abc", "1000000", ["6980"]]) expect(myTeamOf(x)).toBeNull();
  });
});
