// "Best alliance partner" ranks partners by the highest score the team made with them (Sushil, 11-11: "should prefer
// the one where we got the highest points together"), not the win rate: a 3-0 partner with low scores never tops an
// 8-1 partner the team scored its best with. The headline and the table name that score and its match; matches
// together and the record together stay as columns.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import type { StatBlock } from "../../../src/shared/searchStat";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[4215, "Hypnotic Robotics"], [207, "Critical Mass"], [25649, "Cyber Huskies"], [9000, "Opp One"], [9001, "Opp Two"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'NJ', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, 'NJQ', 'NJ Qualifier', 'Qualifier', 'Town', 'NJ', 'USA', '2026-01-10', '2026-01-10', 't')");
  // With 207: 9 matches, 8-1, best 300. With 25649: 3 matches, 3-0, best 150.
  let n = 0;
  const add = async (partner: number, own: number, opp: number) => {
    n++;
    await run(`INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'NJQ', 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')`,
      [n, `Q${n}`, `2026-01-10T${String(8 + Math.floor(n / 6)).padStart(2, "0")}:${String((n % 6) * 10).padStart(2, "0")}:00`, own, own, opp, opp]);
    for (const [t, al] of [[4215, "red"], [partner, "red"], [9000, "blue"], [9001, "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'NJQ', 'qual', 0, ?, ?, ?, 1)", [n, t, al]);
  };
  for (const [own, opp] of [[200, 100], [220, 100], [300, 100], [210, 100], [190, 100], [205, 100], [215, 100], [180, 100], [90, 120]]) await add(207, own, opp);
  for (const own of [140, 150, 130]) await add(25649, own, 100);
  await rebuildSearch();
});

describe("best alliance partner", () => {
  it("is the partner with the highest score together, not the best win rate; the score and its match are named", async () => {
    const a = (await searchAnswer("4215 best alliance partner", { limit: 25 })).stat!;
    expect(a.headline).toMatchObject({ value: "207 Critical Mass", label: "300 points together in Q3 at NJ Qualifier, 2025–26", sub: "8-1-0 together in 9 matches", href: "/events/2025/NJQ?match=qual:0:3" });
    const table = a.blocks.find((b): b is Extract<StatBlock, { kind: "table" }> => b.kind === "table")!;
    expect(table.columns.map((c) => c.label)).toEqual(["Team", "Best score together", "Match", "Together", "W-L-T together"]);
    expect(table.rows.map((r) => [r.cells.team, r.cells.best, r.cells.n, r.cells.record])).toEqual([["207 Critical Mass", 300, 9, "8-1-0"], ["25649 Cyber Huskies", 150, 3, "3-0-0"]]);
  });
});
