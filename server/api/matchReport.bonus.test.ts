// "Know your match" for a played match carries the bonus RPs earned, so its card can show ✓/✗ next to the call.
import { beforeAll, describe, expect, it } from "vitest";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { matchReport } from "./matchReport";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (2025, 'BONQ1', 'Bonus Qualifier', 'Qualifier', '2025-11-07', '2025-11-07', 0, 0, 'test')");
  for (const t of [1, 2, 3, 4]) await run("INSERT INTO event_teams (season, code, team) VALUES (2025, 'BONQ1', ?)", [t]);
  await run(
    `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, red_bonus,
       blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, blue_bonus, source)
     VALUES (2025, 'BONQ1', 'qual', 0, 1, 'Q1', '2025-11-07T10:00:00', 1, 120, 120, 10, 105, 5, 0, ?, 60, 60, 10, 45, 5, 0, ?, 'test')`,
    [JSON.stringify({ movement: true, goal: false, pattern: true }), JSON.stringify({ movement: false, goal: false, pattern: false })],
  );
  for (const [alliance, ts] of [["red", [1, 2]], ["blue", [3, 4]]] as const) for (const t of ts)
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'BONQ1', 'qual', 0, 1, ?, ?, 1)", [t, alliance]);
  await kvSet("data:version", "v1");
});

describe("matchReport bonus results", () => {
  it("a played match's report carries the bonus RPs each alliance earned, in the season's names", async () => {
    const r = (await matchReport(2025, "BONQ1", "qual:0:1"))!;
    expect(r.bonus).toEqual({ labels: ["Movement", "Goal", "Pattern"], red: [true, false, true], blue: [false, false, false] });
  });
});
