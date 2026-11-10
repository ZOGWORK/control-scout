// The Events list (hideNoMatch, the Events page's set) leaves out only the known no-match types: an event with no
// type stays, as it does in Scout's picker, so both count the same events.
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { listEvents } from "./events";

const S = 2026;
beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  for (const [code, type] of [["Q1", "Qualifier"], ["KICK", "Kickoff"], ["PD", "PracticeDay"], ["UNTYPED", null]] as const)
    await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, ?, '2026-11-14', '2026-11-14', 0, 0, 'test')", [S, code, code, type]);
});

describe("listEvents hideNoMatch", () => {
  it("drops kickoffs and practice days, keeps an event with no type", async () => {
    expect((await listEvents({ season: S, hideNoMatch: true })).map((e) => e.code).sort()).toEqual(["Q1", "UNTYPED"]);
    expect((await listEvents({ season: S })).map((e) => e.code).sort()).toEqual(["KICK", "PD", "Q1", "UNTYPED"]);
  });
});
