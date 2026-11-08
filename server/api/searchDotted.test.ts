// A team name's dotted initials in the search index, typo index included (failed-search #1160, Greptile on #1163;
// held out: other names and words).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { rebuildSearch } from "../stats/job";
import { search } from "./search";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[31001, "S.T.E.A.M. Engines"], [31002, "Steam Punks"], [31009, "Engine Room"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'OH', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  await rebuildSearch();
  clearAllCaches();
});

const refs = async (q: string) => (await search(q, 5)).filter((h) => h.kind === "team").map((h) => h.ref);

describe("dotted initials in search", () => {
  it("the name typed without dots finds the team, first", async () => {
    expect((await refs("steam engines"))[0]).toBe("31001");
  });
  it("and so does a typo of it, through the typo index", async () => {
    expect(await refs("steam engins")).toContain("31001");
  });
});
