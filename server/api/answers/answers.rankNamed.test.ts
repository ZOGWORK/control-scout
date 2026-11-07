// Teams named and ranked by one stat ("rank these teams by OPR: A, B, C"): the leaderboard of those teams only.
// Every phrasing is a rewording of a logged query, never the logged words.
import { describe, expect, it } from "vitest";
import { readLeaderboard } from "./read";

describe("teams named, ranked by a stat", () => {
  it("reads the stat and the teams, the list's words before them saying nothing more", () => {
    expect(readLeaderboard("sort these michigan teams by auto opr: 6980, 4215 and 7149")).toMatchObject({ kind: "top", stat: "auto", teams: [6980, 4215, 7149], n: 3, region: null });
    expect(readLeaderboard("rank my teams on win rate 6980 4215")).toMatchObject({ stat: "win-rate", teams: [6980, 4215] });
    expect(readLeaderboard("order the teams by reliability: 6980, 4215, 7149, 33950")).toMatchObject({ stat: "reliability", teams: [6980, 4215, 7149, 33950] });
    expect(readLeaderboard("6980, 4215 and 7149 ranked by teleop opr")).toMatchObject({ stat: "teleop", teams: [6980, 4215, 7149] });
    expect(readLeaderboard("rank these teams by opr in 2024-25: 6980, 4215")).toMatchObject({ stat: "opr", teams: [6980, 4215], season: 2024 });
  });

  it("needs a stat it ranks by and two teams or more", () => {
    expect(readLeaderboard("rank these teams by vibes: 6980, 4215")).toBeNull();
    expect(readLeaderboard("rank teams by opr: 6980")?.teams).toBeUndefined();
    // A place's list is still the place's.
    expect(readLeaderboard("top 10 teams by opr in nj")).not.toHaveProperty("teams");
  });
});
