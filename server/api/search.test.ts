// Search against an in-memory database with a few real-shaped rows.
import { beforeAll, describe, it, expect } from "vitest";
import { openDb, migrate, setDb, run } from "../db";
import { rebuildSearch } from "../stats/job";
import { search } from "./search";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string | null, string][] = [
    [16321, "X Drive", null, "Seattle"], [10820, "Cyber Dragons", "Lincoln High", "Austin"], [18360, "Pymble Pyrophosphate", null, "Sydney"],
    [1622, "Team Spyder", null, "San Diego"], [16000, "Gear Maniacs", null, "Boston"], [4215, "Hypnotic Robotics", null, "Ames"],
  ];
  for (const [n, name, school, city] of teams) {
    await run("INSERT INTO teams (number, name, school, city) VALUES (?, ?, ?, ?)", [n, name, school, city]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, city, start, source) VALUES (2025, 'AUSYQ1', 'Sydney South Qualifier', 'Sydney', '2025-11-16', 'first')");
  await run("INSERT INTO events (season, code, name, city, start, source) VALUES (2024, 'USMICMP2', 'Michigan FTC State Championship-SE', 'Warren', '2024-12-06', 'first')");
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'AUSYQ1', 'qual', 0, 12, 'Q12', 1, 'first')");
  await rebuildSearch();
});

const titles = async (q: string) => (await search(q, 5)).map((h) => h.title);

describe("search", () => {
  it("tolerates typos in team names", async () => {
    expect((await titles("X Drvie"))[0]).toBe("16321 X Drive");
    expect((await titles("cyber dragns"))[0]).toBe("10820 Cyber Dragons");
  });
  it("matches as you type", async () => {
    expect((await titles("pymb"))[0]).toBe("18360 Pymble Pyrophosphate");
    expect((await titles("x dri"))[0]).toBe("16321 X Drive");
  });
  it("prefix-matches team numbers, exact number first", async () => {
    expect(await titles("16")).toEqual(["1622 Team Spyder", "16000 Gear Maniacs", "16321 X Drive"]);
    expect((await titles("4215"))[0]).toBe("4215 Hypnotic Robotics");
    expect(await titles("0")).toEqual([]);
  });
  it("finds events by misspelled name, and matches by code", async () => {
    expect((await titles("sydney south qualifer"))[0]).toBe("Sydney South Qualifier");
    expect((await titles("AUSYQ1 Q12"))[0]).toBe("Q12 · Sydney South Qualifier");
  });
  it("doesn't return far-off guesses", async () => {
    expect(await titles("garden state")).toEqual([]);
    expect(await titles("zzzzzz")).toEqual([]);
  });
});
