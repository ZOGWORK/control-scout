// League standings asked with no team: read from how people ask, the league found from its FIRST name, code and the
// place its meets are in, never by a list of league names.
import { describe, expect, it } from "vitest";
import { matchLeagues, readLeagueAsk, type League } from "./league";

const L = (region: string, code: string, name: string | null, state: string, teams = 30, country = "USA"): League => ({ region, code, name, state, country, teams });
const LEAGUES = [
  L("USNJ", "NE", "Northeast", "NJ", 35), L("USNJ", "CEN", "Central", "NJ", 28), L("USNJ", "NO", "Northern", "NJ", 20),
  L("USFL", "NE", "Northeast Florida", "FL", 18), L("USTX", "CEUC", "CTX NERD", "TX", 22), L("USNE", "OMA", "Omaha", "NE", 12),
];
const codes = (ask: string) => {
  const a = readLeagueAsk(ask);
  return a ? matchLeagues(a.words, LEAGUES).leagues.map((l) => `${l.region}/${l.code}`) : null;
};

describe("league standings asks", () => {
  it("reads asks with no team, and leaves a team's to the team answer", () => {
    expect(readLeagueAsk("NE league standings")).toEqual({ words: ["ne"], season: null, leader: false });
    expect(readLeagueAsk("northeast league rankings 2026-27")).toMatchObject({ words: ["northeast"], season: 2026 });
    expect(readLeagueAsk("nj northeast league leaderboard")).toMatchObject({ words: ["nj", "northeast"] });
    expect(readLeagueAsk("who is first in the northeast league")).toMatchObject({ words: ["northeast"], leader: true });
    expect(readLeagueAsk("whos leading the central league rn")).toMatchObject({ words: ["central"], leader: true });
    expect(readLeagueAsk("6980 league standing")).toBeNull();
    expect(readLeagueAsk("4215s league ranking")).toBeNull();
    // No standings word: a league's events, not its table.
    expect(readLeagueAsk("northeast league meets")).toBeNull();
    expect(readLeagueAsk("league standings")).toBeNull();
  });

  it("finds the league by its name, its code or its place", () => {
    expect(codes("northeast league standings")).toEqual(["USNJ/NE"]);
    expect(codes("nj northeast league leaderboard")).toEqual(["USNJ/NE"]);
    expect(codes("northeast florida league table")).toEqual(["USFL/NE"]);
    expect(codes("who is first in the ctx nerd league")).toEqual(["USTX/CEUC"]);
    // "NE" is a code in two places (and Nebraska's): both leagues, the answer showing the bigger with the other linked.
    expect(codes("NE league standings")?.sort()).toEqual(["USFL/NE", "USNJ/NE"]);
    // A place alone: its leagues, listed.
    const nj = matchLeagues(readLeagueAsk("nj league standings")!.words, LEAGUES);
    expect(nj).toMatchObject({ place: "New Jersey", named: false });
    expect(nj.leagues.map((l) => l.code).sort()).toEqual(["CEN", "NE", "NO"]);
    expect(codes("new jersey league rankings")?.length).toBe(3);
    expect(codes("narnia league standings")).toEqual([]);
  });
});
