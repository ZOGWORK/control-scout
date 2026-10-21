// The season replay's bonus calls never learn from a result at the same time as the match they predict:
// two matches share a start time across the refit threshold, and the second must not see the first.
import { beforeAll, describe, expect, it } from "vitest";
import { all, migrate, openDb, run, setDb } from "../db";
import { backtest } from "./job";

const S = 2025;
const flags = (i: number) => JSON.stringify({ movement: i % 2 === 0, goal: i % 5 === 0, pattern: i % 3 === 0 });
/** Match i's start: 99 distinct minutes, then Q100 and Q101 together, then Q102 a minute later. */
const minute = (i: number) => (i <= 99 ? i : i <= 101 ? 100 : 101);

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, 'SAMEQ', 'Same', 'Qualifier', '2025-11-07', '2025-11-07', 0, 0, 'test')", [S]);
  for (const t of [1, 2, 3, 4]) await run("INSERT INTO event_teams (season, code, team) VALUES (?, 'SAMEQ', ?)", [S, t]);
  for (let i = 1; i <= 102; i++) {
    const r = 60 + (i * 37) % 120, b = 60 + (i * 53) % 120;
    const time = `2025-11-07T${String(8 + Math.floor(minute(i) / 60)).padStart(2, "0")}:${String(minute(i) % 60).padStart(2, "0")}:00`;
    await run(
      `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, red_bonus,
         blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, blue_bonus, source) VALUES (?, 'SAMEQ', 'qual', 0, ?, ?, ?, 1, ?, ?, 10, ?, 5, 0, ?, ?, ?, 10, ?, 5, 0, ?, 'test')`,
      [S, i, `Q${i}`, time, r, r, r - 15, flags(i), b, b, b - 15, flags(i + 1)],
    );
    for (const [alliance, ts] of [["red", i % 2 ? [1, 2] : [1, 3]], ["blue", i % 2 ? [3, 4] : [2, 4]]] as const) for (const t of ts)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, 'SAMEQ', 'qual', 0, ?, ?, ?, 1)", [S, i, t, alliance]);
  }
  await backtest([S]);
});

describe("backtest bonus calls and same-time results", () => {
  it("a match sharing its start time with the one that crosses the threshold learns from neither", async () => {
    const rows = await all<any>("SELECT number, bonus_model FROM predictions WHERE kind = 'backtest' AND season = ? AND number >= 99 ORDER BY number", [S]);
    const by = Object.fromEntries(rows.map((r) => [Number(r.number), r.bonus_model]));
    // Q100: Q1–Q99 = 198 alliances, too few to fit.
    expect(by[100]).toBeNull();
    // Q101 starts with Q100, whose result would take it to 200 (the threshold). It wasn't known yet: still no model.
    // (Learning it is exactly the leak: Q101 would have been called with "season:200".)
    expect(by[101]).toBeNull();
    // Q102, a minute later, knows Q1–Q101: 202 alliances.
    expect(by[102]).toBe("season:202");
  });
});
