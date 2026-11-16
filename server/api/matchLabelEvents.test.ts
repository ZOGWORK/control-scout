// A match's number at an event no stored name fits whole (failed-search #1560: "Q16 <town> Meet 2 <word>", the word in
// no event's name): the events named by the words that do fit, in their order first, never teams sharing a word; and
// not logged as a failed search.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { clearAllCaches } from "../caches";
import { searchAnswer } from "./searchAnswer";
import { failureOf, outcomeTrace } from "../searchFailures";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[30301, "Lakeview Lions"], [30302, "Lakeview 2 Bots"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Lakeview', 'IL', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2026, ?)", [n]);
  }
  const ev = (code: string, name: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2026, ?, ?, 'LeagueMeet', 'Lakeview', 'IL', 'USA', ?, ?, 't')", [code, name, start, start]);
  await ev("USILLVM1H2", "Lakeview Meet 1 - Harper 2", "2026-11-07");
  await ev("USILLVM2", "Lakeview Meet 2 - Hancock", "2026-12-12");
  await ev("USILLVM2H1", "Lakeview Meet 2 - Harper 1", "2026-12-05");
  await rebuildSearch();
  clearAllCaches();
});

describe("a match's number at an event named with a word no event has", () => {
  it("lists the events the other words name, in their order first, and says which word fit none (#1560)", async () => {
    const q = "Q16 Lakeview Meet 2 Westside";
    const a = await searchAnswer(q, { limit: 25 });
    expect(a.hits.every((h) => h.kind === "event")).toBe(true);
    expect(a.hits.slice(0, 2).map((h) => h.title).sort()).toEqual(["Lakeview Meet 2 - Hancock", "Lakeview Meet 2 - Harper 1"]);
    expect(a.understood?.label).toContain('"Westside"');
    expect(a.understood?.label).toContain("Q16");
    expect(failureOf(q, a, outcomeTrace(a))).toBeNull();
  });
});
