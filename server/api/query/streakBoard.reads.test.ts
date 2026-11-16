// A place's streak board read a few hundred teams at a time (streakBoard.ts TEAMS_PER_READ), each read a turn of the
// event loop apart: one read of a whole country's matches held every other request for seconds (#1557). Read in parts,
// the board is the same: every team's matches, in each team's own order, the leaders found in any part. A database file,
// as in production (in memory, the board is one read: db.ts inSnapshot).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { streakBoardAnswer } from "./streakBoard";

const S = 2025;
const NJ = { key: "USA:NJ", country: "USA", state: "NJ", name: "New Jersey" };
let match = 0;
/** One played match for `team`, on red, won or lost, `day` days into January. */
const play = async (team: number, won: boolean, day: number) => {
  const n = ++match;
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, ?, ?, 20, 20, 't')",
    [S, `Q${day}`, n, `Q${n}`, won ? 30 : 10, won ? 30 : 10]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, 'red', 1)", [S, `Q${day}`, n, team]);
};

beforeAll(async () => {
  const c = openDb(`file:${join(mkdtempSync(join(tmpdir(), "streak-reads-")), "scout.db").replace(/\\/g, "/")}`);
  setDb(c);
  await migrate(c);
  // 600 New Jersey teams (several reads), and teams elsewhere between their numbers, which never count.
  for (let i = 0; i < 600; i++) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [1000 + i * 2, `Team ${i}`]);
  for (let i = 0; i < 600; i++) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'TX', 'USA')", [1001 + i * 2, `Other ${i}`]);
  for (let d = 1; d <= 5; d++)
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', 'NJ', 'USA', ?, ?, 't')", [S, `Q${d}`, `Qualifier ${d}`, `2026-01-0${d}`, `2026-01-0${d}`]);
  // Every New Jersey team wins once on day 1.
  for (let i = 0; i < 600; i++) await play(1000 + i * 2, true, 1);
  // 2190 (the last read): three more wins, then a loss, its last match. 1010 (the first): one more win. A Texas team
  // wins five times: never on New Jersey's board.
  for (const [d, won] of [[2, true], [3, true], [4, true], [5, false]] as const) await play(2190, won, d);
  await play(1010, true, 2);
  for (let d = 1; d <= 5; d++) await play(1001, true, d);
});

describe("a streak board read in parts", () => {
  it("counts every match of every team in the place, from every part", async () => {
    const a = await streakBoardAnswer({ region: NJ, season: 2026, now: false, losing: false, n: 10 });
    expect(a.source).toBe("From 605 match results of 600 teams from New Jersey");
  });

  it("finds the longest run in the last part and the next in the first, each in its own match order", async () => {
    const a = await streakBoardAnswer({ region: NJ, season: 2026, now: false, losing: false, n: 2 });
    const longest = a.blocks?.find((b) => b.kind === "table");
    expect(longest?.kind === "table" && longest.rows.map((r) => [String(r.cells.team).slice(0, 4), r.cells.streak])).toEqual([["2190", "4 wins"], ["1010", "2 wins"]]);
  });

  it("the streak going now: a loss ended 2190's", async () => {
    const a = await streakBoardAnswer({ region: NJ, season: 2026, now: true, losing: false, n: 1 });
    const going = a.blocks?.find((b) => b.kind === "table");
    expect(going?.kind === "table" && going.rows.map((r) => [String(r.cells.team).slice(0, 4), r.cells.streak])).toEqual([["1010", "2 wins"]]);
  });
});
