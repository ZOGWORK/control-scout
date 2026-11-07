// A team called by its name's own part (./query/names.ts teamsCalled): the name without the words that only say it is
// a team ("Team …", "… Robotics"), its words typed apart, its last word made plural; and a name several teams share
// read as the one that played most recently, as the parser reads it. A small fixture database.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { forgetTeamNames } from "./searchLayers";
import { buildNames } from "./query/names";

const S = CURRENT_SEASON;
const ask = (q: string) => searchAnswer(q, { learn: false, limit: 40, full: true });
const top = async (q: string) => (await ask(q)).hits[0]?.ref;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // [number, name, rookie year, last season played (null: none yet)]
  const teams: [number, string, number, number | null][] = [
    [7001, "Team Squidward", 2015, S], [7002, "Hullabaloo Robotics", 2018, S], [7003, "Zapbot Junior", 2025, null],
    [7004, "Zapbot", 2019, S], [7005, "Quasartron", 2017, S], [7006, "Quasartron", 2020, S - 1],
  ];
  for (const [n, name, rookie, last] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country, rookie_year) VALUES (?, ?, 'Paramus', 'NJ', 'USA', ?)", [n, name, rookie]);
    await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [S, n]);
    if (last != null) {
      await run("INSERT OR IGNORE INTO events (season, code, name, type, city, state, country, start, source) VALUES (?, ?, 'Bergen Qualifier', 'Qualifier', 'Paramus', 'NJ', 'USA', '2025-12-01', 'test')", [last, `USNJBQ${last}`]);
      await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, ?, ?, 50, 5)", [last, `USNJBQ${last}`, n]);
      await run("INSERT OR IGNORE INTO team_season_stats (season, team, matches) VALUES (?, ?, 5)", [last, n]);
    }
  }
  await rebuildSearch();
  forgetTeamNames();
});

describe("a team called by its name's own part", () => {
  it("indexes the name without the words that only say it is a team, typed apart, or with its last word plural", () => {
    const idx = buildNames([
      { number: 1, name: "Team Squidward", city: null, state: null, country: null },
      { number: 2, name: "Hullabaloo Robotics", city: null, state: null, country: null },
      { number: 3, name: "Zapbot Junior", city: null, state: null, country: null },
      { number: 4, name: "Robotics", city: null, state: null, country: null },
    ], []);
    expect(idx.teamsCalled("squidward").map((t) => t.number)).toEqual([1]);
    expect(idx.teamsCalled("hulla baloo").map((t) => t.number)).toEqual([2]);
    expect(idx.teamsCalled("zapbot juniors").map((t) => t.number)).toEqual([3]);
    // A whole name is never re-read, and nothing distinctive left is no part.
    expect(idx.teamsCalled("robotics")).toEqual([]);
    expect(idx.teamsCalled("team")).toEqual([]);
  });
  it("answers a team's fact asked with its name's own part, the fact said first", async () => {
    const a = await ask("rookie year of squidward");
    expect(a.hits[0]?.ref).toBe("7001");
    expect(a.step).toBe("deterministic");
  });
  it("finds the team from its name's own part, its words typed apart, or its last word made plural", async () => {
    expect(await top("hulla baloo")).toBe("7002");
    // A team that hasn't played yet, named so, is the answer rather than a closest match.
    const z = await ask("zapbot juniors");
    expect(z).toMatchObject({ step: "deterministic", hits: [{ ref: "7003" }] });
  });
  it("lists every team of a shared name, words after it that ask for everything aside", async () => {
    const a = await ask("show me quasartron stuff, like everything");
    expect(a.step).toBe("deterministic");
    expect(a.hits.slice(0, 2).map((h) => h.ref).sort()).toEqual(["7005", "7006"]);
  });
  it("reads a name two teams share as the one that played most recently in a fact", async () => {
    expect(await top("rookie year for quasartron")).toBe("7005");
  });
});
