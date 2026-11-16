// A streak board read in parts (streakBoard.ts boardRows) describes one moment: a write landing between two parts (the
// live lane storing results) has the board read again, so a team in a part already read and one in a part still to
// come are counted alike, never one from before the write and one from after.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { writing } from "../../data/writeGen";

const hook = vi.hoisted(() => ({ afterFirstPart: null as null | (() => Promise<void>) }));
vi.mock("../../db.js", async (real) => {
  const m = await real<typeof import("../../db.js")>();
  return {
    ...m,
    all: async (sql: string, args?: unknown[]) => {
      const rows = await m.all(sql, args as never);
      const f = hook.afterFirstPart;
      if (f && sql.includes("CROSS JOIN match_teams")) { hook.afterFirstPart = null; await f(); }
      return rows;
    },
  };
});

const { migrate, openDb, run, setDb } = await import("../../db");
const { streakBoardAnswer } = await import("./streakBoard");

const S = 2025;
const NJ = { key: "USA:NJ", country: "USA", state: "NJ", name: "New Jersey" };
let match = 0;
const play = async (team: number, day: number) => {
  const n = ++match;
  await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, 30, 30, 20, 20, 't')", [S, `Q${day}`, n, `Q${n}`]);
  await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, 'red', 1)", [S, `Q${day}`, n, team]);
};

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // 600 teams: three parts. Each wins once on day 1.
  for (let i = 0; i < 600; i++) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [1000 + i, `Team ${i}`]);
  for (const d of [1, 2]) await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'Qualifier', 'Town', 'NJ', 'USA', ?, ?, 't')", [S, `Q${d}`, `Qualifier ${d}`, `2026-01-0${d}`, `2026-01-0${d}`]);
  for (let i = 0; i < 600; i++) await play(1000 + i, 1);
});

describe("a streak board read while results are stored", () => {
  it("reads again when a write lands between its parts: both new wins counted, the first part's and the last's", async () => {
    // Just after the first part (teams 1000-1249) is read: a win more for 1005 (read already) and 1590 (still to come).
    hook.afterFirstPart = () => writing(async () => { await play(1005, 2); await play(1590, 2); });
    const a = await streakBoardAnswer({ region: NJ, season: 2026, now: false, losing: false, n: 2 });
    expect(a.source).toBe("From 602 match results of 600 teams from New Jersey");
    const longest = a.blocks?.find((b) => b.kind === "table");
    expect(longest?.kind === "table" && longest.rows.map((r) => [String(r.cells.team).slice(0, 4), r.cells.streak])).toEqual([["1005", "2 wins"], ["1590", "2 wins"]]);
  });
});
