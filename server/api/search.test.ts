// Search against an in-memory database with a few real-shaped rows.
import { beforeAll, describe, it, expect } from "vitest";
import { openDb, migrate, setDb, run } from "../db";
import { rebuildSearch } from "../stats/job";
import { ensureSearchIndex, search } from "./search";
import { all as dbAll } from "../db";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string | null, string][] = [
    [16321, "X Drive", null, "Seattle"], [10820, "Cyber Dragons", "Lincoln High", "Austin"], [18360, "Pymble Pyrophosphate", null, "Sydney"],
    [1622, "Team Spyder", null, "San Diego"], [16000, "Gear Maniacs", null, "Boston"], [4215, "Hypnotic Robotics", null, "Ames"],
    [2222, "Robo-Raptors", null, "Leeds"], [3333, "机器人队", null, "Shenzhen"],
    [5555, "Drive Team", null, "Austin"],
  ];
  for (const [n, name, school, city] of teams) {
    await run("INSERT INTO teams (number, name, school, city) VALUES (?, ?, ?, ?)", [n, name, school, city]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
  }
  await run("INSERT INTO events (season, code, name, city, start, source) VALUES (2025, 'AUSYQ1', 'Sydney South Qualifier', 'Sydney', '2025-11-16', 'first')");
  await run("INSERT INTO events (season, code, name, city, start, source) VALUES (2024, 'USMICMP2', 'Michigan FTC State Championship-SE', 'Warren', '2024-12-06', 'first')");
  await run("INSERT INTO events (season, code, name, city, state, country, start, source) VALUES (2026, 'USNJRAM1', 'P1-5 AM Northeast League Meet', 'Ramsey', 'NJ', 'USA', '2026-11-07', 'first')");
  await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'AUSYQ1', 'qual', 0, 12, 'Q12', 1, 'first')");
  await rebuildSearch();
});

const titles = async (q: string) => (await search(q, 5)).map((h) => h.title);

describe("search", () => {
  it("finds places by full state name, not just the code (New Jersey → NJ)", async () => {
    expect(await titles("new jersey")).toContain("P1-5 AM Northeast League Meet");
    expect(await titles("ramsey nj")).toContain("P1-5 AM Northeast League Meet");
  });
  it("tolerates typos in team names", async () => {
    expect((await titles("X Drvie"))[0]).toBe("16321 X Drive");
    expect((await titles("cyber dragns"))[0]).toBe("10820 Cyber Dragons");
  });
  it("matches as you type", async () => {
    expect((await titles("pymb"))[0]).toBe("18360 Pymble Pyrophosphate");
    expect((await titles("x dri"))[0]).toBe("16321 X Drive");
  });
  it("ranks your own teams first after an exact number match", async () => {
    const pref = new Set(["team:16321"]);
    expect((await search("16", 5, pref)).map((h) => h.title)).toEqual(["16321 X Drive", "1622 Team Spyder", "16000 Gear Maniacs"]);
    // An exact match still wins over a preferred one.
    expect((await search("1622", 5, pref))[0].title).toBe("1622 Team Spyder");
    // Typo fallback (no shared trigram): equally good matches tip toward your team too.
    const both = (await search("dirve", 5)).map((h) => h.ref);
    expect(both).toEqual(expect.arrayContaining(["16321", "5555"]));
    expect((await search("dirve", 5, new Set(["team:5555"])))[0].ref).toBe("5555");
    expect((await search("dirve", 5, new Set(["team:16321"])))[0].ref).toBe("16321");
    // Text: near-tied matches tip toward your team.
    expect((await search("dragons", 5, new Set(["team:10820"])))[0].title).toBe("10820 Cyber Dragons");
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
  it("finds short swapped typos that share no trigram (dirve → Drive)", async () => {
    expect(await titles("dirve")).toContain("16321 X Drive"); // ties with "Drive Team" (preference test)
  });
  it("matches across punctuation in stored names (Robo-Raptors)", async () => {
    expect((await titles("robo raptrs"))[0]).toBe("2222 Robo-Raptors");
  });
  it("keeps non-Latin names searchable", async () => {
    expect((await titles("机器人"))[0]).toBe("3333 机器人队");
  });
  it("still finds events by year", async () => {
    expect(await titles("2025")).toContain("Sydney South Qualifier");
  });
  it("fills an empty typo index on an upgraded database", async () => {
    await run("DELETE FROM search_fuzzy");
    await ensureSearchIndex(rebuildSearch);
    expect(Number((await dbAll<{ n: number }>("SELECT COUNT(*) n FROM search_fuzzy"))[0].n)).toBeGreaterThan(0);
    expect((await titles("X Drvie"))[0]).toBe("16321 X Drive");
  });
  it("recovers after a failed index read instead of caching the failure", async () => {
    const c = (await import("../db")).db();
    const real = c.execute.bind(c);
    let fail = true;
    (c as any).execute = (q: any) => (fail && String(q?.sql ?? q).includes("FROM search_fuzzy") && !String(q?.sql ?? q).includes("MATCH") ? Promise.reject(new Error("db down")) : real(q));
    await run("UPDATE kv SET value = '\"v-fail\"' WHERE key = 'search:version'");
    await expect(search("dirve", 5)).rejects.toThrow("db down");
    fail = false;
    expect(await titles("dirve")).toContain("16321 X Drive"); // ties with "Drive Team" (preference test)
    (c as any).execute = real;
  });
  it("doesn't return far-off guesses", async () => {
    expect(await titles("garden state")).toEqual([]);
    expect(await titles("zzzzzz")).toEqual([]);
  });
});
