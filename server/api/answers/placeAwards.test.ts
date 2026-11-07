// A place's award winners (./families/placeAwards.ts), from the failed searches "<state> Inspire winners", "awards won by
// teams from <town>, <country>, this season", "which <country's> team has won the most Inspire awards", "the rarest award
// a <state> team won", "won both Inspire and Winning Alliance at the same event", "did any <state> team win Inspire at
// worlds last year" and "<state> Inspire winners by auto". Held out: other places, awards, seasons and words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { placeAwardsAnswer, readPlaceAwards } from "./families/placeAwards";
import { searchSeason } from "./season";

const S = searchSeason();

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string, string, string, number][] = [
    [20265, "Heart of RoBots", "Austin", "TX", "USA", 80], [11111, "Lone Star Bots", "Houston", "TX", "USA", 30],
    [22222, "Maple Gears", "Toronto", "ON", "Canada", 20], [33333, "Northern Bolts", "Ottawa", "ON", "Canada", 10], [4215, "Hypnotic Robotics", "Oradell", "NJ", "USA", 40],
  ];
  for (const [n, name, city, state, country, auto] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, name, city, state, country]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run("INSERT INTO team_season_stats (season, team, opr_np, opr_auto, matches, wins, losses, ties) VALUES (?, ?, 50, ?, 10, 5, 5, 0)", [S, n, auto]);
  }
  const ev = (season: number, code: string, name: string, type: string, city: string, state: string, country: string, day: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 't')", [season, code, name, type, city, state, country, day, day]);
  await ev(S, "USTXCMP", "Texas Championship", "Championship", "Austin", "TX", "USA", `${S + 1}-03-01`);
  await ev(S, "CAONQ1", "Ontario Qualifier", "Qualifier", "Toronto", "ON", "Canada", `${S}-12-01`);
  await ev(S, "FTCCMP1", "FIRST Championship", "FIRSTChampionship", "Houston", "TX", "USA", `${S + 1}-04-20`);
  await ev(S - 1, "CAONQ1", "Ontario Qualifier", "Qualifier", "Toronto", "ON", "Canada", `${S - 1}-12-01`);
  await ev(S - 1, "CAONQ2", "Ontario Qualifier 2", "Qualifier", "Ottawa", "ON", "Canada", `${S - 1}-12-08`);
  const aw = (season: number, code: string, type: string, placement: number, team: number, name: string) =>
    run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (?, ?, ?, ?, ?, ?)", [season, code, type, placement, team, name]);
  await aw(S, "USTXCMP", "Think", 1, 20265, "Think Award");
  await aw(S, "USTXCMP", "Think", 2, 11111, "Think Award 2nd Place");
  await aw(S, "USTXCMP", "Inspire", 1, 11111, "Inspire Award");
  await aw(S, "USTXCMP", "Winner", 1, 20265, "Winning Alliance - Captain");
  await aw(S, "USTXCMP", "Winner", 2, 11111, "Winning Alliance - 1st Team Selected");
  await aw(S, "USTXCMP", "Connect", 1, 20265, "Connect Award");
  await aw(S, "USTXCMP", "Design", 1, 11111, "Design Award");
  await aw(S, "CAONQ1", "Inspire", 1, 22222, "Inspire Award");
  await aw(S, "CAONQ1", "Design", 1, 33333, "Design Award");
  await aw(S, "CAONQ1", "Promote", 1, 22222, "Promote Award");
  await aw(S, "CAONQ1", "Winner", 3, 33333, "FIRST Leadership Award");
  await aw(S, "FTCCMP1", "Connect", 1, 33333, "Connect Award");
  await aw(S, "FTCCMP1", "Inspire", 1, 4215, "Inspire Award");
  await aw(S - 1, "CAONQ1", "Inspire", 1, 22222, "Inspire Award");
  await aw(S - 1, "CAONQ2", "Inspire", 1, 22222, "Inspire Award");
  await aw(S - 1, "CAONQ2", "Think", 1, 33333, "Think Award");
  await rebuildSearch();
});

const rows = (s: Awaited<ReturnType<typeof placeAwardsAnswer>>, i = 0) => {
  const b = s.blocks[i];
  return b?.kind === "table" ? b.rows.map((r) => r.cells) : [];
};

describe("a place's award winners", () => {
  it("lists a state's winners of one award, 1st place only, the default season", async () => {
    const ask = await readPlaceAwards("Texas Think winners");
    expect(ask).toMatchObject({ place: { kind: "region", state: "TX" }, types: ["Think"], mode: "list", season: null });
    const s = await placeAwardsAnswer(ask!);
    expect(rows(s).map((r) => r.team)).toEqual(["20265 Heart of RoBots"]);
    expect(s.headline?.value).toBe("1 Think Award");
  });

  it("orders the winners by a stat that season", async () => {
    const s = await placeAwardsAnswer((await readPlaceAwards("texas winning alliance winners by auto"))!);
    expect(rows(s).map((r) => [r.team, r.stat])).toEqual([["20265 Heart of RoBots", "80"], ["11111 Lone Star Bots", "30"]]);
  });

  it("lists every award a town's teams won, the town said with its country, a season in words", async () => {
    const ask = await readPlaceAwards("Which awards did teams from Ottawa, Canada, win last season?");
    expect(ask).toMatchObject({ place: { kind: "city", city: "Ottawa" }, types: [], season: S - 1 });
    expect(rows(await placeAwardsAnswer(ask!)).map((r) => `${r.team} ${r.award}`)).toEqual(["33333 Northern Bolts Think"]);
  });

  it("counts a country's teams by one award, every season, by its people's word", async () => {
    const s = await placeAwardsAnswer((await readPlaceAwards("what canadian team won the most inspire awards"))!);
    expect(s.headline).toMatchObject({ value: "22222 Maple Gears", label: "3 Inspire Awards" });
    expect(s.title).toBe("Teams from Canada with the most Inspire Awards, every season");
  });

  it("finds the rarest award a place's teams won: given fewest times anywhere that season", async () => {
    const s = await placeAwardsAnswer((await readPlaceAwards("rarest award an Ontario team won this season"))!);
    expect(s.headline?.value).toBe("Promote Award");
    // FIRST's Leadership Award, stored as a Winner, is never a Winning Alliance.
    expect(rows(s).map((r) => r.award)).not.toContain("Winning Alliance");
  });

  it("finds teams that won two awards at one event", async () => {
    const s = await placeAwardsAnswer((await readPlaceAwards("Texas teams that won both Winning Alliance and Inspire at the same tournament"))!);
    expect(rows(s).map((r) => r.team)).toEqual(["11111 Lone Star Bots"]);
  });

  it("answers whether any of a place's teams won an award at worlds", async () => {
    const yes = await placeAwardsAnswer((await readPlaceAwards(`has any Ontario team won connect at worlds in ${S}-${String((S + 1) % 100).padStart(2, "0")}`))!);
    expect(yes.headline?.value).toBe("Yes");
    expect(rows(yes).map((r) => r.team)).toEqual(["33333 Northern Bolts"]);
    const no = await placeAwardsAnswer((await readPlaceAwards("did any Texas team win inspire at worlds"))!);
    expect(no.headline?.value).toBe("No");
  });

  it("leaves a team's, an event's and an award-less ask alone", async () => {
    // The most awards of any kind is the count leaderboard's.
    expect(await readPlaceAwards("which team has the most awards in Texas")).toBeNull();
    for (const q of ["Heart of RoBots awards", "20265 think award", "who won inspire at texas championship", "texas teams", "texas", "think award"]) expect(await readPlaceAwards(q), q).toBeNull();
  });

  it("is search's answer, with the seasons before it to ask next", async () => {
    const a = await searchAnswer("Texas Think winners", { limit: 25, learn: false, full: true });
    expect(a.intent?.kind).toBe("stat-place-awards");
    expect(a.stat?.blocks.find((b) => b.kind === "related")).toMatchObject({ queries: [`Texas Think winners ${S - 1}-${String(S % 100).padStart(2, "0")}`, expect.any(String)] });
  });
});
