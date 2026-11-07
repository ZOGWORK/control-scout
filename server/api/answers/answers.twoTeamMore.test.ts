// Two teams asked with the stat first ("who has the higher rating, A or B"), a forecast asked as a question ("will A
// beat B", "predicted winner A vs B"), penalties side by side, and three teams compared with the phases named. Every
// phrasing is a rewording of a logged query, never the logged words.
import { describe, expect, it } from "vitest";
import { readTeamSet, readTwoTeam } from "./read";

describe("the stat asked before the teams", () => {
  it("who has the higher OPR, rating or reliability is that side by side", () => {
    expect(readTwoTeam("which team has the better opr, 6980 or 4215")).toMatchObject({ id: "opr-vs", a: "6980", b: "4215" });
    expect(readTwoTeam("who has the higher opr in 2024-25 6980 or 4215")).toMatchObject({ id: "opr-vs", scope: { season: 2024 } });
    expect(readTwoTeam("who has the stronger rating, 6980 vs 4215")).toMatchObject({ id: "rating-vs", a: "6980", b: "4215" });
    expect(readTwoTeam("who has better reliability 6980 or 4215")).toMatchObject({ id: "reliability-vs" });
  });
});

describe("a forecast asked as a question", () => {
  it("will A beat B and the predicted winner are the engine's call", () => {
    expect(readTwoTeam("would 6980 defeat 4215")).toMatchObject({ id: "predict", a: "6980", b: "4215" });
    expect(readTwoTeam("can 6980 beat 4215 next time")).toMatchObject({ id: "predict" });
    expect(readTwoTeam("projected result 6980 vs 4215 in 2024-25")).toMatchObject({ id: "predict", a: "6980", b: "4215", scope: { season: 2024 } });
    // A match already played is their meetings.
    expect(readTwoTeam("did 6980 beat 4215")).toMatchObject({ id: "head-to-head" });
  });
});

describe("penalties side by side", () => {
  it("fewer or more penalties, asked any way round", () => {
    expect(readTwoTeam("which team gives away fewer penalties, 6980 or 4215")).toMatchObject({ id: "penalties-vs", a: "6980", b: "4215" });
    expect(readTwoTeam("who has fewer fouls 6980 or 4215, like who commits less")).toMatchObject({ id: "penalties-vs", a: "6980", b: "4215" });
    expect(readTwoTeam("6980 vs 4215 penalty points")).toMatchObject({ id: "penalties-vs" });
    expect(readTwoTeam("6980 penalties compared to 4215")).toMatchObject({ id: "penalties-vs" });
  });
});

describe("three teams with the phases named", () => {
  it("the phases are the card's own rows, and 'at once' is no event", () => {
    expect(readTeamSet("compare 6980, 4215 and 7149 by auto and endgame")).toMatchObject({ teams: [6980, 4215, 7149] });
    expect(readTeamSet("compare 6980 4215 7149 in teleop, together")).toMatchObject({ teams: [6980, 4215, 7149] });
    expect(readTeamSet("compare 6980, 4215 and 7149 all at once")).toMatchObject({ teams: [6980, 4215, 7149] });
  });
});
