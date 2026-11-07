// A kind of event a place has never held, in any season on record (failed-search reports: league meets asked for in
// a state that runs no leagues): said as the answer, with the place's events listed instead, never "no events
// match". A small fixture database.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";

const S = CURRENT_SEASON;
const ask = (q: string) => searchAnswer(q, { learn: false, limit: 40, full: true });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const events: [number, string, string, string, string][] = [
    [S, "USVTQ1", "Green Mountain Qualifier", "Qualifier", "VT"], [S, "USVTS1", "Maple Scrimmage", "Scrimmage", "VT"],
    [S - 1, "USVTQ0", "Old Qualifier", "Qualifier", "VT"], [S, "USNHM1", "Granite League Meet", "LeagueMeet", "NH"],
    // A league meet held only in an earlier season: the kind has been held there, so none this season stays "none".
    [S - 1, "USMEM0", "Pine League Meet", "LeagueMeet", "ME"], [S, "USMEQ1", "Pine Qualifier", "Qualifier", "ME"],
  ];
  for (const [season, code, name, type, state] of events) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (?, ?, ?, ?, 'Town', ?, 'USA', ?, 'test')", [season, code, name, type, state, `${season}-12-01`]);
  }
  await rebuildSearch();
});

describe("a kind of event a place has never held", () => {
  it("says so as the answer and lists the place's events instead", async () => {
    for (const q of ["meets in Vermont", "meets Vermont", "league meets in Vermont"]) {
      const a = await ask(q);
      expect(a.step, q).toBe("deterministic");
      expect(a.understood?.fallback, q).toMatch(/^Vermont has held no .*meets in any season on record/);
      expect(a.hits.filter((h) => h.kind === "event").map((h) => h.ref).sort(), q).toEqual([`${S}:USVTQ1`, `${S}:USVTS1`]);
      // The place's link counts them as what they are, events.
      expect(a.hits.find((h) => h.kind === "place")?.subtitle ?? "", q).not.toMatch(/meets/);
    }
  });
  it("says when the dates asked were dropped too", async () => {
    // Every fixture event is held 1 December, so on 2 December none is upcoming.
    const a = await searchAnswer("upcoming meets in Vermont", { learn: false, limit: 40, full: true, now: Date.parse(`${S}-12-02T12:00:00Z`) });
    expect(a.understood?.fallback).toMatch(/showing its events of any date instead$/);
    expect(a.understood?.time).toBeUndefined();
    expect(a.hits.filter((h) => h.kind === "event").length).toBe(2);
  });
  it("never opens another kind's page in place of the kind asked", async () => {
    const a = await ask("meets in Vermont rankings");
    expect(a.hits.some((h) => h.kind === "event" && h.section === "rankings")).toBe(false);
  });
  it("leaves a place that holds the kind as it was", async () => {
    expect((await ask("meets in New Hampshire")).hits.some((h) => h.ref === `${S}:USNHM1`)).toBe(true);
    // Held in an earlier season only: not "never", so this season's none is not reworded.
    expect((await ask("meets in Maine")).understood?.fallback ?? "").not.toMatch(/any season on record/);
  });
});
