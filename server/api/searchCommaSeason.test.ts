// A season written with a comma ("2025, 26") is the season (launch audit, Nov 9 2026, Phase A5); the dash is canonical.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";

const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (4215, 'Hypnotic Robotics', 'Oradell', 'NJ', 'USA', 2010)");
  for (const [s, opr] of [[2024, 60], [2025, 100]]) {
    await run("INSERT INTO team_seasons (season, team) VALUES (?, 4215)", [s]);
    await run(`INSERT INTO team_season_stats (season, team, opr_np, opr_auto, opr_teleop, opr_endgame, rating_np, rating_matches, matches, wins, losses, ties)
      VALUES (?, 4215, ?, 30, 60, 10, 90, 10, 10, 7, 3, 0)`, [s, opr]);
  }
  await rebuildSearch();
});

describe("comma seasons", () => {
  it("reads as the dashed season", async () => {
    const dashed = await ask("4215 opr 2024-25");
    for (const q of ["4215 opr 2024, 25", "4215 opr 2024,25", "4215 opr 2024, 2025", "4215 opr season 24, 25"]) {
      const a = await ask(q);
      expect(a.stat?.title, q).toBe(dashed.stat?.title);
      expect(a.stat?.headline?.value, q).toBe(dashed.stat?.headline?.value);
    }
    expect(dashed.stat?.title).toMatch(/2024–25/);
  });
  it("years that aren't one season stay as typed", async () => {
    expect((await ask("4215 opr 2024, 27")).stat?.title ?? "").not.toMatch(/2024–25/);
  });
});
