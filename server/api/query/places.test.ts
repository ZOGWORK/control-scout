// Two places in one question (search audit): "<place> vs <place> average <stat>" sets both side by side in one season,
// the latest each has enough teams in, never one place's season against the other's; "teams from <place> or <place>"
// is one board over both. One place inside the other is still one place.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { parseQuery } from "./parse";
import { parseContext } from "./context";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const full = (q: string) => searchAnswer(q, { limit: 25, full: true, now: NOW });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // Maryland: four teams both seasons. Delaware: three in 2024–25, only two in 2025–26.
  const teams: [number, string, string, [number, number][]][] = [
    [30301, "Crab Bots", "MD", [[2024, 40], [2025, 60]]], [30302, "Bay Bots", "MD", [[2024, 30], [2025, 50]]],
    [30303, "Old Line Bots", "MD", [[2024, 20], [2025, 40]]], [30304, "Terrapin Bots", "MD", [[2024, 10], [2025, 30]]],
    [30311, "First State Bots", "DE", [[2024, 50], [2025, 90]]], [30312, "Blue Hen Bots", "DE", [[2024, 40], [2025, 80]]],
    [30313, "Diamond Bots", "DE", [[2024, 30]]],
  ];
  for (const [n, name, state, seasons] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    for (const [season, opr] of seasons) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
      await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np, opr_auto) VALUES (?, ?, 6, 3, 3, 0, ?, ?)", [season, n, opr, opr / 4]);
    }
  }
  await rebuildSearch();
  clearAllCaches();
});

describe("two places in one question", () => {
  it("reads both places and the word joining them", async () => {
    const ctx = await parseContext(NOW);
    for (const [q, join, names] of [
      ["maryland vs delaware average opr", "vs", ["Maryland", "Delaware"]],
      ["delaware compared to maryland auto", "vs", ["Delaware", "Maryland"]],
      ["teams from maryland or delaware", "or", ["Maryland", "Delaware"]],
    ] as const) {
      const p = await parseQuery(q, ctx);
      expect([p.places?.join, p.places?.list.map((x) => x.name), p.leftover], q).toEqual([join, names, []]);
    }
    // A town and its state are one place, as before.
    expect((await parseQuery("teams in town maryland", ctx)).places).toBeUndefined();
  });
  it("side by side: each place's average in the one season both have, never two seasons", async () => {
    const a = await full("maryland vs delaware average opr");
    const s = a.stat as StatAnswer;
    expect(s.intent).toBe("places-compare");
    // Delaware has only two teams in 2025–26: both are read in 2024–25.
    expect(s.scope).toEqual(["Maryland", "Delaware", "2024–25"]);
    expect(s.headline).toMatchObject({ value: "Delaware", label: "Higher average OPR: 40.0 to 25.0" });
    const table = s.blocks.find((b) => b.kind === "table");
    expect(table?.kind === "table" && table.rows.map((r) => [r.cells.place, r.cells.avg, r.cells.teams, r.strong])).toEqual([["Maryland", "25.0", 4, false], ["Delaware", "40.0", 3, true]]);
    // A season said is the one read, for both.
    expect(((await full("maryland vs delaware average opr 2025-26")).stat as StatAnswer).headline).toMatchObject({ value: "Delaware", label: "Higher average OPR: 85.0 to 45.0" });
    expect(((await full("delaware compared to maryland auto")).stat as StatAnswer).title).toBe("Delaware vs Maryland · average Auto OPR, 2024–25");
  });
  it("one board over both places' teams", async () => {
    const a = await full("teams from maryland or delaware");
    const s = a.stat as StatAnswer;
    const board = s.blocks.find((b) => b.kind === "leaderboard");
    expect(board?.kind === "leaderboard" && board.rows.map((r) => r.team.label.split(" ")[0])).toEqual(["30311", "30312", "30301", "30302", "30303", "30304"]);
    expect(a.understood?.label).toMatch(/in Maryland and Delaware/);
  });
});
