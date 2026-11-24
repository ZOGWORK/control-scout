// Two places in one question (search audit): "<place> vs <place> average <stat>" sets both side by side in one season,
// the latest each has enough teams in, never one place's season against the other's; "teams from <place> or <place>"
// is one board over both. One place inside the other is still one place.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import { parseQuery } from "./parse";
import { placesAsk } from "./places";
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
    // Virginia: three teams in 2024–25, none in 2025–26.
    [30321, "Old Dominion Bots", "VA", [[2024, 20]]], [30322, "Cardinal Bots", "VA", [[2024, 20]]], [30323, "Dogwood Bots", "VA", [[2024, 20]]],
    // Pennsylvania: three teams in 2024–25, level with Virginia.
    [30331, "Keystone Bots", "PA", [[2024, 10]]], [30332, "Liberty Bots", "PA", [[2024, 20]]], [30333, "Steel Bots", "PA", [[2024, 30]]],
  ];
  for (const [n, name, state, seasons] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', ?, 'USA')", [n, name, state]);
    for (const [season, opr] of seasons) {
      await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [season, n]);
      await run("INSERT INTO team_season_stats (season, team, matches, wins, losses, ties, opr_np, opr_auto, rating_pen, avg_np, rating_np, rating_matches) VALUES (?, ?, 6, 3, 3, 0, ?, ?, ?, ?, ?, 6)", [season, n, opr, opr / 4, opr / 10, opr * 2, opr]);
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
    expect(a.understood?.label).toMatch(/in Maryland or Delaware/);
    // "or" joins the places, never two searches ("teams from maryland" or "delaware"): every word read.
    for (const q of ["teams from maryland or delaware", "teams from delaware or maryland"]) expect((await full(q)).understood?.unread ?? [], q).toEqual([]);
  });
  it("a place with no teams in the season said is never level; fewer is better reads as lower; rookies are never dropped", async () => {
    const s = (await full("maryland vs virginia average opr 2025-26")).stat as StatAnswer;
    expect([s.headline, s.none]).toEqual([undefined, "Virginia had no teams with OPR in 2025–26."]);
    // Level places: neither is the leader, on the tiles or in the table.
    const level = (await full("virginia vs pennsylvania average opr 2024-25")).stat as StatAnswer;
    const tiles = level.blocks.find((b) => b.kind === "kpis"), rows = level.blocks.find((b) => b.kind === "table");
    expect([level.headline?.value, tiles?.kind === "kpis" && tiles.items.map((i) => i.tone ?? null), rows?.kind === "table" && rows.rows.map((r) => r.strong)]).toEqual(["Level", [null, null], [false, false]]);
    const pen = (await full("maryland vs delaware average penalties")).stat as StatAnswer;
    expect(pen.headline).toMatchObject({ value: "Maryland", label: "Lower average penalties a match: 2.5 to 4.0" });
    // "Rookie teams" asks of the places something this answer can't keep: left to search's other readers.
    expect(placesAsk(await parseQuery("rookie teams from maryland or delaware", await parseContext(NOW)), null)).toBeNull();
  });
  it("the stat, the season and the order as said; a question these words can't keep is left to search's other readers", async () => {
    const title = async (q: string) => ((await full(q)).stat as StatAnswer | undefined)?.title;
    expect(await title("maryland vs delaware average auto opr")).toBe("Maryland vs Delaware · average Auto OPR, 2024–25");
    expect(await title("maryland vs delaware average score")).toBe("Maryland vs Delaware · average score, 2024–25");
    // "This season" is the season it names (2025–26 in March 2026), never the latest both places fill.
    expect(await title("maryland vs delaware average opr this season")).toBe("Maryland vs Delaware · average OPR, 2025–26");
    // Fewer is better: the best by penalties are the fewest first.
    expect(await title("best teams from maryland or delaware by penalties")).toMatch(/^Lowest 10 teams by penalties a match in Maryland or Delaware/);
    const ctx = await parseContext(NOW);
    // The board over both is the one-place board's: "best team" is the one team first, as for one place.
    const best = (await full("best team from maryland or delaware by opr")).stat as StatAnswer;
    expect([best.headline?.value, best.title]).toEqual(["30311 First State Bots", "Best team in Maryland or Delaware by OPR · 2025–26"]);
    for (const q of ["maryland vs delaware matches", "maryland vs delaware highlights", "maryland vs delaware opr gain", "which team has the most matches in maryland or delaware", "top 3 maryland vs delaware average opr", "maryland vs delaware average opr teams that never won an award", "how many teams from maryland or delaware", "teams from maryland or delaware not opr", "teams named crab from maryland or delaware", "the top maryland team vs the top delaware team"]) {
      expect(placesAsk(await parseQuery(q, ctx), null), q).toBeNull();
    }
    // The board ranks by its own stats, highest or lowest first: a score's average or a median over both is not it.
    expect(placesAsk(await parseQuery("teams from maryland or delaware by score", ctx), "avg-score")).toBeNull();
    for (const q of ["median opr teams from maryland or delaware", "median opr of teams from maryland or delaware"]) expect(placesAsk(await parseQuery(q, ctx), "opr"), q).toBeNull();
  });
  it("either place first is the same board; an average is a decimal; the best team breaks ties as the board does", async () => {
    const teams = async (q: string) => { const b = ((await full(q)).stat as StatAnswer).blocks.find((x) => x.kind === "leaderboard"); return b?.kind === "leaderboard" ? b.rows.map((r) => r.team.label.split(" ")[0]).sort() : []; };
    expect(await teams("teams from delaware or maryland")).toEqual(await teams("teams from maryland or delaware"));
    expect((await teams("teams from delaware or maryland")).length).toBe(6);
    // Every team won 3: level, said as an average.
    expect(((await full("maryland vs delaware average wins")).stat as StatAnswer).headline).toMatchObject({ value: "Level", label: "Average wins 3.0 in both" });
    // Two Maryland teams with no penalties: the one with fewer penalty points a match is the best, as on the board.
    await run("UPDATE team_season_stats SET rating_pen = 0, avg_pen = CASE team WHEN 30301 THEN 2 ELSE 1 END WHERE season = 2025 AND team IN (30301, 30302)");
    try {
      const t = ((await full("maryland vs delaware average penalties 2025-26")).stat as StatAnswer).blocks.find((b) => b.kind === "table");
      expect(t?.kind === "table" && t.rows[0].cells.best).toBe("30302 · 0.0");
    } finally { await run("UPDATE team_season_stats SET rating_pen = opr_np / 10, avg_pen = NULL WHERE season = 2025 AND team IN (30301, 30302)"); clearAllCaches(); }
    // The longer name is read first; the place typed before "compared to" is still the first.
    expect(((await full("virginia compared to pennsylvania average opr 2024-25")).stat as StatAnswer).title).toBe("Virginia vs Pennsylvania · average OPR, 2024–25");
    // Averages that read the same to a decimal are level: no leader named by a difference the card doesn't show.
    await run("UPDATE team_season_stats SET opr_np = opr_np + 0.03 WHERE season = 2024 AND team = 30321");
    try {
      expect(((await full("virginia vs pennsylvania average opr 2024-25")).stat as StatAnswer).headline).toMatchObject({ value: "Level", label: "Average OPR 20.0 in both" });
    } finally {
      try { await run("UPDATE team_season_stats SET opr_np = 20 WHERE season = 2024 AND team = 30321"); } finally { clearAllCaches(); }
    }
    // A median is not an average: another reader's.
    const med = await parseQuery("maryland vs delaware median opr", await parseContext(NOW));
    expect([med.agg != null && med.agg !== "mean", placesAsk(med, null)]).toEqual([true, null]);
  });
});
