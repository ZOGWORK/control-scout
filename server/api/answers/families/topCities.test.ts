// "Which city in Romania has the most FTC teams" (failed-search #935): a place's home cities by how many teams list them.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../../db";
import type { StatBlock } from "../../../../src/shared/searchStat";
import { readTopCities, topCitiesAnswer } from "./topCities";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // number, city, state, country, played in 2025–26
  const teams: [number, string, string, string, boolean][] = [
    [101, "Bucharest", "B", "Romania", true], [102, "BUCHAREST", "B", "Romania", true], [103, "Bucharest", "B", "Romania", false],
    [104, "Cluj-Napoca", "CJ", "Romania", true], [105, "Cluj-Napoca", "CJ", "Romania", true], [106, "Iasi", "IS", "Romania", false],
    [201, "Edison", "NJ", "USA", true], [202, "Oradell", "NJ", "USA", false], [203, "Atlanta", "GA", "USA", true],
  ];
  for (const [n, city, state, country, played] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, ?, ?, ?)", [n, `Team ${n}`, city, state, country]);
    if (played) await run("INSERT INTO team_season_stats (season, team, opr_np, events, matches, wins, losses, ties) VALUES (2025, ?, 50, 1, 5, 3, 2, 0)", [n]);
  }
});

describe("cities with the most teams", () => {
  it("reads the ask however it's said; the place a state, a country or the world", () => {
    for (const q of ["which city in Romania has the most FTC teams", "which city has the most teams in romania", "cities with the most teams in Romania", "top 5 cities in romania by teams", "towns in romania with the most teams"])
      expect(readTopCities(q), q).toMatchObject({ region: null, country: expect.stringMatching(/romania/i) });
    expect(readTopCities("which city in georgia has the most teams")).toMatchObject({ region: { key: "USA:GA" } });
    expect(readTopCities("cities with the most teams in the uk")).toMatchObject({ country: "uk" });
    expect(readTopCities("which city has the most teams")).toMatchObject({ region: null, n: 10 });
    expect(readTopCities("top 3 cities with the most teams")).toMatchObject({ n: 3 });
    for (const q of ["cities with the most teams in narnia", "which team has the most awards", "cities in romania"]) expect(readTopCities(q), q).toBeNull();
  });
  it("ranks by the teams that played in the newest season, every team listed beside; one spelling of each city", async () => {
    const a = (await topCitiesAnswer(readTopCities("which city in Romania has the most FTC teams")!))!;
    expect(a.title).toBe("Cities with the most teams in Romania");
    expect(a.headline).toMatchObject({ value: "Bucharest", label: "2 teams played in 2025–26", sub: "3 listed in all", href: "/search?q=teams%20in%20Bucharest%20Romania" });
    const t = a.blocks[0] as Extract<StatBlock, { kind: "table" }>;
    expect(t.rows.map((r) => [r.cells.city, r.cells.played, r.cells.teams])).toEqual([["Bucharest", 2, 3], ["Cluj-Napoca", 2, 2], ["Iasi", 0, 1]]);
    // A state's cities link to that state's town; worldwide, each city says where it is.
    const ga = (await topCitiesAnswer(readTopCities("which city in georgia has the most teams")!))!;
    expect(ga.headline).toMatchObject({ value: "Atlanta", href: "/search?q=teams%20in%20Atlanta%20GA" });
    const world = (await topCitiesAnswer(readTopCities("which city has the most teams")!))!;
    expect((world.blocks[0] as Extract<StatBlock, { kind: "table" }>).rows.map((r) => r.cells.city).slice(0, 2)).toEqual(["Bucharest, Romania", "Cluj-Napoca, Romania"]);
    // A country no team lists is left to search.
    expect(await topCitiesAnswer(readTopCities("cities with the most teams in france")!)).toBeNull();
  });
});
