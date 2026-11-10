// Stored places and school names are tidied once (server/data/tidyPlaces.ts), and what a sync writes is tidied on the
// way in (server/data/bundle.ts), so FIRST's "Oradelll" and "… High Sch" never reach a page.
import { beforeAll, describe, expect, it } from "vitest";
import { all, db, migrate, openDb, run, setDb } from "../db";
import { tidyStoredPlaces } from "./tidyPlaces";
import { teamStatements } from "./bundle";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name, school, city, state, country) VALUES (4215, 'Hypnotic Robotics', 'River Dell Regional High Sch', 'Oradell', 'NJ', 'USA')");
  await run("INSERT INTO teams (number, name, school, city, state, country) VALUES (33950, 'First Street Kids', NULL, 'Ridgewood', 'NJ', 'USA')");
  await run("INSERT INTO events (season, code, name, type, city, state, country, source, synced_at) VALUES (2025, 'NOM7', 'P3-6 League Meet', 'LeagueMeet', 'Oradelll', 'NJ', 'USA', 'first', '2026-01-01')");
  await run("INSERT INTO events (season, code, name, type, city, state, country, source, synced_at) VALUES (2023, 'TXQ', 'McKinney Qualifier', 'Qualifier', 'McKinney, Texas', 'TX', 'USA', 'first', '2026-01-01')");
});

describe("tidyStoredPlaces", () => {
  it("cleans the rows that need it, and a second run changes nothing", async () => {
    expect(await tidyStoredPlaces()).toEqual({ teams: 1, events: 2 });
    expect(await all("SELECT number, school, city FROM teams ORDER BY number")).toEqual([
      { number: 4215, school: "River Dell Regional High School", city: "Oradell" },
      // No school in FIRST's data: honestly none, never made up.
      { number: 33950, school: null, city: "Ridgewood" },
    ]);
    expect((await all<{ city: string }>("SELECT city FROM events ORDER BY season")).map((e) => e.city)).toEqual(["McKinney", "Oradell"]);
    expect(await tidyStoredPlaces()).toEqual({ teams: 0, events: 0 });
  });

  it("a sync's team rows are written tidied", async () => {
    await db().batch(teamStatements([{ number: 9999, name: "New", fullName: null, school: "St Louis Day Sch", sponsors: [], city: "Greeensboro", state: "NC", country: "USA", rookieYear: 2026, website: null, homeRegion: null }]), "write");
    expect(await all("SELECT school, city FROM teams WHERE number = 9999")).toEqual([{ school: "St Louis Day School", city: "Greensboro" }]);
  });
});
