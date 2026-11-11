// "Best finish" judges every event the team played, league meets included (by the meet's own standing), by the
// whole result (Sushil, 11-11: "best finish only takes in ranked matches and excludes league meets"): the Winning
// Alliance, then the Finalist Alliance, then advancing, then a playoff alliance, then the qualification rank as a
// share of the teams ranked. Each event is listed with its finish, best first.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import type { StatBlock } from "../../../src/shared/searchStat";

const T = 33950;
beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, 'Finish Line', 'Livingston', 'NJ', 'USA')", [T]);
  await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [T]);
  const ev = (code: string, name: string, type: string, start: string, league: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, region, league, source) VALUES (2025, ?, ?, ?, 'Town', 'NJ', 'USA', ?, ?, 'USNJ', ?, 't')", [code, name, type, start, start, league]);
  await ev("QWIN", "Won Qualifier", "Qualifier", "2025-11-01");
  await ev("QADV", "Advanced Qualifier", "Qualifier", "2025-11-08");
  await ev("QTOP", "Ranked Qualifier", "Qualifier", "2025-11-15");
  await ev("LMEET", "Northeast League Meet", "LeagueMeet", "2025-12-01", "NE");
  await ev("LTOUR", "Northeast League Tournament", "LeagueTournament", "2026-02-28", "NE");
  // Ranks: Won Qualifier #6 of 20 (won the playoffs), Advanced #10 of 20 (took a slot), Ranked #2 of 20, the league
  // meet's standing #4 of 5, the league tournament #14 of 17.
  const field = async (code: string, n: number, rank: number) => {
    for (let i = 1; i <= n; i++) await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2025, ?, ?, ?)", [code, i === rank ? T : 50000 + i, i]);
  };
  await field("QWIN", 20, 6); await field("QADV", 20, 10); await field("QTOP", 20, 2); await field("LMEET", 5, 4); await field("LTOUR", 17, 14);
  // The league meet's own finish, as the team page shows it: #2 of the 3 teams ranked at that meet.
  for (const [t, rank] of [[T, 2], [50001, 1], [50002, 3]]) await run("INSERT INTO team_event_records (season, code, team, rank) VALUES (2025, 'LMEET', ?, ?)", [t, rank]);
  await run("INSERT INTO awards (season, code, type, placement, team, name) VALUES (2025, 'QWIN', 'Winner', 1, ?, 'Winning Alliance Captain')", [T]);
  await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (2025, 'QWIN', 1, ?, 50001)", [T]);
  await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (2025, 'QADV', 2, 'USNJCMP', ?)", [JSON.stringify([{ team: T, status: "FIRST", declined: false }])]);
  await rebuildSearch();
});

describe("best finish", () => {
  it("judges the whole result at every event, league meets included, and lists each with its finish, best first", async () => {
    const a = (await searchAnswer(`${T} best finish`, { limit: 25 })).stat!;
    expect(a.headline).toMatchObject({ value: "Won", label: "Won Qualifier", sub: expect.stringMatching(/^Ranked #6 of 20 · /) });
    const table = a.blocks.find((b): b is Extract<StatBlock, { kind: "table" }> => b.kind === "table")!;
    expect(table.rows.map((r) => [r.cells.event, r.cells.finish, r.cells.rank])).toEqual([
      ["Won Qualifier", "Won", "#6 of 20"],
      ["Advanced Qualifier", "Advanced", "#10 of 20"],
      ["Ranked Qualifier", "–", "#2 of 20"],
      ["Northeast League Meet", "–", "#2 of 3 at the meet"],
      ["Northeast League Tournament", "–", "#14 of 17"],
    ]);
    expect(a.source).toMatch(/^From 5 event records/);
  });
  it("the worst finish reads the same rule the other way round", async () => {
    const a = (await searchAnswer(`${T} worst finish`, { limit: 25 })).stat!;
    expect(a.headline).toMatchObject({ value: "#14 of 17", label: "Northeast League Tournament" });
  });
});
