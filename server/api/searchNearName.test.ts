// A misspelled team name that a team's own name nearly spells reaches that team, even when the same words, fuzzily,
// are also in another team's school or city (failed search-eval check: "lake rbotics record").
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { searchAnswer } from "./searchAnswer";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string, string | null, string, string][] = [
    [24105, "Lake Robotics", "Upper Lake High School", "Upper Lake", "CA"],
    [18119, "Mostly Operational", "Lake Oswego Robotics", "Lake Oswego", "OR"],
    [5663, "Twisted Devils Red", "Gull Lake Area Robotics", "Richland", "MI"],
  ];
  for (const [n, name, school, city, state] of teams) {
    await run("INSERT INTO teams (number, name, school, city, state, country) VALUES (?, ?, ?, ?, ?, 'USA')", [n, name, school, city, state]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
    await run("INSERT INTO team_event_stats (season, code, team, matches) VALUES (2025, 'USCAQ1', ?, 5)", [n]).catch(() => {});
  }
  await rebuildSearch();
});

describe("a misspelled team name", () => {
  it("comes before teams matched only by the same words in a school or city", async () => {
    const a = await searchAnswer("lake rbotics", { limit: 12, intents: false, learn: false });
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "24105" });
  });
  it("is the team a question about it reads", async () => {
    const a = await searchAnswer("lake rbotics record", { limit: 12, learn: false });
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "24105" });
  });
  it("leaves a school's words, typed as they are, to the school's team", async () => {
    const a = await searchAnswer("lake oswego robotics", { limit: 12, intents: false, learn: false });
    expect(a.hits[0]).toMatchObject({ kind: "team", ref: "18119" });
  });
});
