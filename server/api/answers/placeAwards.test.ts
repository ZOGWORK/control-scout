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
    [44444, "Hoosier Bots", "Indianapolis", "IN", "USA", 15], [55555, "Prairie Gears", "Springfield", "IL", "USA", 12], [66666, "Show Me Bots", "Springfield", "MO", "USA", 11],
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
  await ev(S, "USTXQ1", "Texas Qualifier", "Qualifier", "Dallas", "TX", "USA", `${S}-11-15`);
  await ev(S, "USINQ1", "Indiana Qualifier", "Qualifier", "Indianapolis", "IN", "USA", `${S}-11-22`);
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
  await aw(S, "USTXQ1", "Inspire", 1, 11111, "Inspire Award");
  await aw(S, "USTXQ1", "Winner", 1, 11111, "Winning Alliance - Captain");
  await aw(S, "USINQ1", "JudgesChoice", 1, 44444, "Judges' Choice Award");
  await aw(S, "USINQ1", "Motivate", 1, 55555, "Motivate Award");
  // A second Leadership Award, so it is given more often than Ontario's Promote.
  await aw(S, "USINQ1", "Winner", 3, 55555, "FIRST Leadership Award");
  await aw(S - 1, "CAONQ1", "Inspire", 1, 22222, "Inspire Award");
  await aw(S - 1, "CAONQ2", "Inspire", 1, 22222, "Inspire Award");
  await aw(S - 1, "CAONQ2", "Think", 1, 33333, "Think Award");
  // Worlds: a division's playoffs, then the finals between the division winners (the Championship's own event).
  await run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, 'FTCCMP1EDI', 'FIRST Championship - Edison Division', 'FIRSTChampionship', 'FTCCMP1', 'Houston', 'TX', 'USA', ?, ?, 't')", [S, `${S + 1}-04-19`, `${S + 1}-04-19`]);
  const playoff = async (code: string, n: number, red: number[], blue: number[], r: number, b: number) => {
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'playoff', 0, ?, ?, 1, ?, ?, ?, ?, 't')", [S, code, n, `F${n}`, r, r, b, b]);
    for (const [t, al] of [...red.map((x) => [x, "red"]), ...blue.map((x) => [x, "blue"])]) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'playoff', 0, ?, ?, ?)", [S, code, n, t, al]);
  };
  await playoff("FTCCMP1EDI", 1, [22222, 20265], [11111, 4215], 150, 100);
  await playoff("FTCCMP1", 1, [22222, 20265], [33333, 44444], 90, 160);
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
    expect(rows(s).map((r) => [r.team, r.stat])).toEqual([["20265 Heart of RoBots", "80"], ["11111 Lone Star Bots", "30"], ["11111 Lone Star Bots", "30"]]);
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
    // Greptile on #1100: listed under its own name with every award, never dropped; a Winning Alliance ask leaves it out.
    const all = await placeAwardsAnswer((await readPlaceAwards("awards won by teams from Ontario this season"))!);
    expect(rows(all).filter((r) => r.team === "33333 Northern Bolts").map((r) => r.award)).toContain("Leadership Award");
    expect(rows(all).map((r) => r.award)).not.toContain("Winning Alliance");
    const wa = await placeAwardsAnswer((await readPlaceAwards("Ontario Winning Alliance winners this season"))!);
    expect(rows(wa).map((r) => r.award)).not.toContain("Leadership Award");
  });

  it("finds teams that won two awards at one event", async () => {
    const s = await placeAwardsAnswer((await readPlaceAwards("Texas teams that won both Winning Alliance and Inspire at the same tournament"))!);
    // One team, at two events: one team, both events listed (Greptile on #1100).
    expect(rows(s).map((r) => r.team)).toEqual(["11111 Lone Star Bots", "11111 Lone Star Bots"]);
    expect(s.headline?.value).toBe("1 team");
  });

  it("answers whether any of a place's teams won an award at worlds", async () => {
    const yes = await placeAwardsAnswer((await readPlaceAwards(`has any Ontario team won connect at worlds in ${S}-${String((S + 1) % 100).padStart(2, "0")}`))!);
    expect(yes.headline?.value).toBe("Yes");
    expect(rows(yes).map((r) => r.team)).toEqual(["33333 Northern Bolts"]);
    const no = await placeAwardsAnswer((await readPlaceAwards("did any Texas team win inspire at worlds"))!);
    expect(no.headline?.value).toBe("No");
  });

  // Failed search "did any Romanian team make worlds finals last year": a place's teams in Worlds' playoffs.
  it("answers whether a place's teams reached the Worlds finals, or played in Worlds' playoffs", async () => {
    const ask = await readPlaceAwards("has any Canadian team reached the worlds finals");
    expect(ask).toMatchObject({ place: { kind: "country" }, stage: "finals", mode: "any", season: null });
    const yes = await placeAwardsAnswer(ask!);
    expect(yes.headline).toMatchObject({ value: "Yes", label: "2 teams" });
    expect(rows(yes).map((r) => [r.team, r.won])).toEqual([["22222 Maple Gears", "No"], ["33333 Northern Bolts", "Yes"]]);
    const tx = await placeAwardsAnswer((await readPlaceAwards("Texas teams in the playoffs at worlds this season"))!);
    expect(tx.headline?.value).toBe("2 teams");
    expect((await placeAwardsAnswer((await readPlaceAwards("did any Ohio team make worlds finals"))!)).headline?.value).toBe("No");
    // "Last year" at Worlds is the latest Championship that has finished, as the winners answer reads it.
    expect(await readPlaceAwards("did any Ontario team win Connect at worlds last year")).toMatchObject({ season: S, worlds: true });
    // Greptile on #1100: "last season" keeps its meaning at Worlds; a list is one season; a team that sat out won nothing.
    expect(await readPlaceAwards("did any Ontario team win Connect at worlds last season")).toMatchObject({ season: S - 1 });
    expect(tx.scope.at(-1)).not.toBe("All seasons");
    await run("UPDATE match_teams SET on_field = 0 WHERE code = 'FTCCMP1' AND team = 33333");
    expect(rows(yes).length).toBe(2);
    expect(rows(await placeAwardsAnswer(ask!)).map((r) => [r.team, r.won])).toEqual([["22222 Maple Gears", "No"], ["33333 Northern Bolts", "No"]]);
    await run("UPDATE match_teams SET on_field = 1 WHERE code = 'FTCCMP1' AND team = 33333");
    expect(await readPlaceAwards("worlds finals")).toBeNull();
  });
  // Greptile on #1100.
  it("keeps the default season, saying none were won, with older seasons to ask", async () => {
    const a = await searchAnswer("Ontario Think winners", { limit: 25, learn: false, full: true });
    expect(a.stat?.none).toBe(`No Think Award won by teams from Ontario in ${a.stat?.scope.at(-1)} in the published awards.`);
    expect(a.stat?.blocks.find((b) => b.kind === "related")).toMatchObject({ queries: [`Ontario Think winners ${S - 1}-${String(S % 100).padStart(2, "0")}`, expect.any(String)] });
  });
  it("counts only 1st place toward the rarest award", async () => {
    const s = await placeAwardsAnswer((await readPlaceAwards("the rarest award a Texas team won"))!);
    expect(s.headline?.value).toBe("Think Award");
    expect(rows(s).find((r) => r.award === "Think Award")).toMatchObject({ given: 1, won: 1 });
  });
  it("reads a state's code typed in capitals that is also a word, the award's own spelling, and a shared town's name", async () => {
    expect(await readPlaceAwards("IN Judges' Choice winners")).toMatchObject({ place: { kind: "region", state: "IN" }, types: ["JudgesChoice"] });
    expect(await readPlaceAwards("in judges choice winners")).toBeNull();
    expect(await readPlaceAwards("Springfield IL Motivate winners")).toMatchObject({ place: { kind: "city", city: "Springfield", state: "IL" } });
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
