// The season record counts official events only (src/shared/eventRecord.ts isOfficialEvent), so the team page, its
// search snippet and the search record card say one number; matches played still count every event (launch audit
// D2, D3, D5).
import { beforeAll, describe, expect, it } from "vitest";
import { get, migrate, openDb, run, setDb } from "../db";
import { loadSeason } from "./load";
import { computeSeasonStats } from "./job";
import { offSeasonRecord } from "../../src/shared/eventRecord";
import { boardStatFor, leaderboardAnswer } from "../api/answers/families/leaderboard";

const S = 2024;

async function event(code: string, type: string) {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, ?, '2025-01-10', '2025-01-10', 0, 0, 'test')", [S, code, code, type]);
}
let n = 0;
async function match(code: string, red: number[], blue: number[], score: [number, number]) {
  n++;
  await run(`INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
      blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, ?, ?, 10, ?, 5, 0, ?, ?, 10, ?, 5, 0, 'test')`,
    [S, code, n, `Q${n}`, score[0], score[0], score[0] - 15, score[1], score[1], score[1] - 15]);
  for (const [alliance, ts] of [["red", red], ["blue", blue]] as const) for (const t of ts)
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [S, code, n, t, alliance]);
}

beforeAll(async () => {
  const c = openDb(":memory:"); setDb(c); await migrate(c);
  for (const t of [1, 2, 3, 4]) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [t, `Team ${t}`]);
  await event("QUAL", "Qualifier");
  await event("OFF", "OffSeason");
  await event("SCRIM", "Scrimmage");
  await match("QUAL", [1, 2], [3, 4], [100, 50]);
  await match("QUAL", [1, 3], [2, 4], [40, 90]);
  await match("OFF", [1, 2], [3, 4], [100, 50]);
  await match("OFF", [1, 2], [3, 4], [100, 50]);
  await match("SCRIM", [1, 4], [2, 3], [10, 90]);
  // A third official match for 2, 3 and 4 (not 1): they reach the ranked minimum on official matches, 1 doesn't.
  await match("QUAL", [2, 3], [4], [80, 60]);
  await computeSeasonStats(S, await loadSeason(S));
});

describe("the season record", () => {
  it("counts official events only; matches played count every event", async () => {
    const s = await get<{ wins: number; losses: number; ties: number; matches: number }>("SELECT wins, losses, ties, matches FROM team_season_stats WHERE season = ? AND team = 1", [S]);
    expect(s).toMatchObject({ wins: 1, losses: 1, ties: 0, matches: 5 });
  });
  it("a record list ranks a team on its official matches: two official results and three off-season ones aren't ranked", async () => {
    const a = await leaderboardAnswer({ kind: "top", stat: boardStatFor("record", S)!, n: 10, region: null, city: null, season: S });
    const board = a.blocks.find((x) => x.kind === "leaderboard");
    expect(board?.kind === "leaderboard" ? board.rows.map((r) => r.team.label).sort() : null).toEqual(["2 Team 2", "3 Team 3", "4 Team 4"]);
    expect(board?.kind === "leaderboard" && board.note).toContain("official events only");
  });
  it("the events off the record add up on a line of their own", () => {
    const rows = [{ type: "Qualifier", wins: 1, losses: 1, ties: 0 }, { type: "OffSeason", wins: 2, losses: 0, ties: 0 }, { type: "Scrimmage", wins: 0, losses: 1, ties: 0 }, { type: "OffSeason", wins: null, losses: null, ties: null }];
    expect(offSeasonRecord(rows)).toEqual({ wins: 2, losses: 1, ties: 0, events: 2 });
    expect(offSeasonRecord(rows.slice(0, 1))).toBeNull();
  });
});
