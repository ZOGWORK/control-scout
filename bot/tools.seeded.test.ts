// Bruno's lookups end to end, on a seeded database and the site's own code: the two questions people actually typed in
// Discord are run through the bot's real path — splitAsk, then searchAnswer and answerFacts with no stand-ins — and the
// facts that reach Bruno must answer every part: the board's team, where it is and its Auto OPR; the world record and
// who set it. A follow-up ("who is by") is searched with its subject, so the same question gives the same records on
// controlscout.org/search.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../server/db";
import { rebuildSearch } from "../server/stats/job";
import { CURRENT_SEASON as S } from "../server/data/seasons";
import { searchAnswer } from "../server/api/searchAnswer";
import { answerFacts } from "../server/api/searchBrunoAnswer";
import { SEARCH_PAGE_LIMIT } from "../src/shared/search";
import { realAskDeps } from "./ask";
import { resolveAsk, splitAsk } from "./tools";

/** number, name, city, state, OPR (without penalties), Auto OPR, TeleOp OPR, Endgame OPR */
const TEAMS: [number, string, string, string, number, number, number, number][] = [
  [23268, "Ultraviolet", "Hillsborough", "NJ", 157.9, 40, 82, 35.9],
  [31814, "Quantum Core", "Hillsborough", "NJ", 117.2, 30, 60, 27.2],
  [4215, "Hypnotic Robotics", "Oradell", "NJ", 101.6, 28, 55.1, 18.5],
  [6980, "Bad Wolf", "Oradell", "NJ", 46.9, 13, 25, 8.9],
];

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [i, [n, name, city, state, opr, auto, teleop, endgame]] of TEAMS.entries()) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, 'USA')", [n, name, city, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    await run(
      `INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rank_np, ranked_teams, rating_np, rating_matches, matches, wins, losses, ties)
       VALUES (?, ?, ?, ?, ?, ?, ?, 3800, ?, 20, 20, 14, 6, 0)`,
      [S, n, opr, auto, teleop, endgame, i + 1, opr]);
  }
  await run(
    "INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USNJQ1', 'BioBuzz Qualifier', 'Qualifier', 'Hillsborough', 'NJ', 'USA', '2026-11-07', '2026-11-07', 'test')",
    [S]);
  for (const [i, [n]] of TEAMS.entries())
    await run("INSERT INTO event_teams (season, code, team, rank, wins, losses, ties, qual_played) VALUES (?, 'USNJQ1', ?, ?, 2, 0, 0, 2)", [S, n, i + 1]);
  // Q1's red alliance set the season's record score (412 without penalties); Q2's blue (300) is second.
  const match = async (num: number, red: [number, number], blue: [number, number], redNp: number, blueNp: number) => {
    await run(
      `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_pen, blue_total, blue_np, blue_pen, source)
       VALUES (?, 'USNJQ1', 'qual', 0, ?, ?, ?, 1, ?, ?, 0, ?, ?, 0, 'test')`,
      [S, num, `Q${num}`, `2026-11-07T10:0${num}:00`, redNp, redNp, blueNp, blueNp]);
    for (const [alliance, ts] of [["red", red], ["blue", blue]] as const)
      for (const [i, team] of ts.entries())
        await run(
          "INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, surrogate, on_field) VALUES (?, 'USNJQ1', 'qual', 0, ?, ?, ?, ?, 0, 1)",
          [S, num, team, alliance, i + 1]);
  };
  await match(1, [23268, 4215], [31814, 6980], 412, 240);
  await match(2, [4215, 6980], [23268, 31814], 260, 300);
  await rebuildSearch();
});

describe("Sushil's questions, through the lookups and the site's own search", () => {
  it("\"best team rn, where from, auto opr\": the board answers all three parts", async () => {
    const q = "what is like the best team rn, where are they from and what is their auto opr";
    const { facts } = await (await realAskDeps()).lookups!(q);
    const text = facts.join("\n");
    // Who is best: the board's own top line, naming the team.
    expect(text).toMatch(/#1 23268 Ultraviolet/);
    // Where they are from: the same line carries the place.
    expect(text).toMatch(/23268 Ultraviolet \(Hillsborough, NJ\)/);
    // Their Auto OPR: the number the site gives for it ("40 Auto OPR").
    expect(text).toMatch(/\b40(?:\.0)?\b[^\n]*Auto OPR|Auto OPR[^\n]*\b40(?:\.0)?\b/);
  });

  it("\"bio buzz world record rn and who is by\": the record and who set it", async () => {
    const q = "what is the bio buzz world record rn and who is by";
    const { facts, answer } = await (await realAskDeps()).lookups!(q);
    const text = facts.join("\n");
    // What the record is: the season's best score, from the card the site shows.
    expect(answer?.card?.title).toMatch(/BIOBUZZ/);
    expect(text).toMatch(/412 points/);
    // Who it's by: the alliance that scored it.
    expect(text).toMatch(/412 points[^\n]*23268 Ultraviolet/);
  });

  it("the follow-up is asked with its subject, and that question finds the record on the site too", async () => {
    const parts = splitAsk("what is the bio buzz world record rn and who is by");
    expect(parts).toEqual(["what is the bio buzz world record", "who is by"]);
    const resolved = resolveAsk(parts, 1, [await searchAnswer(parts[0], { learn: false, limit: SEARCH_PAGE_LIMIT })]);
    expect(resolved).toBe("bio buzz world record");
    // The same question typed into controlscout.org/search is the same board.
    const site = await searchAnswer(resolved, { learn: false, limit: 25 });
    expect(site.card?.lines[0]?.text).toMatch(/^412 points/);
    expect(site.card?.lines[0]?.results?.join(" ")).toMatch(/23268 Ultraviolet/);
  });

  it("a pronoun follow-up asks about the team the earlier answer named", async () => {
    const parts = splitAsk("what is like the best team rn, where are they from and what is their auto opr");
    const answers = await Promise.all(parts.map(async (p, i) => (i === 0 ? searchAnswer(p, { learn: false, limit: SEARCH_PAGE_LIMIT }) : null)));
    expect(resolveAsk(parts, 1, answers)).toMatch(/^where are \d+ /);
    expect(resolveAsk(parts, 2, answers)).toMatch(/^what is \d+ auto opr$/);
    // Searched with the team in it, the site gives that team's Auto OPR as a number.
    const auto = await searchAnswer(resolveAsk(parts, 2, answers), { learn: false, limit: 25 });
    expect(await answerFacts(auto)).toEqual(expect.arrayContaining([expect.stringMatching(/\b40(?:\.0)?\b[^\n]*Auto OPR|Auto OPR[^\n]*\b40(?:\.0)?\b/)]));
  });
});
