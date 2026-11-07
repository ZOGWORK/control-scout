// An event asked about with its words cut short (failed-search reports): a division called by its own name and a game
// ("<name> <game>"), Worlds' divisions said as one ("worlds division highlights"), and an event's finals ("<division>
// finals", a season between). A small fixture database: names only, none from the reports.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { readStatQuestion } from "./answers/read";
import { divisionQuery, searchAnswer } from "./searchAnswer";
import { parseQuery } from "./query/parse";
import { parseContext } from "./query/context";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [code, name, type] of [["CMPTESLA", "FIRST Championship - Tesla Division", "FIRSTChampionship"], ["CMPCURIE", "FIRST Championship - Curie Division", "FIRSTChampionship"]]) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (2023, ?, ?, ?, 'Houston', 'TX', 'USA', '2024-04-17', 'test')", [code, name, type]);
  }
  // A code reused in another season for another event: never swapped for it.
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (2025, 'USXXLT', 'Eastbrook League Tournament', 'LeagueTournament', 'Town', 'NJ', 'USA', '2026-02-01', 'test')");
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (2023, 'USXXLT', 'Westfield League Tournament', 'LeagueTournament', 'Town', 'NJ', 'USA', '2024-02-01', 'test')");
  // The same division's code held again in a later season: the search index lists its newest.
  await run("INSERT INTO events (season, code, name, type, city, state, country, start, source) VALUES (2025, 'CMPCURIE', 'FIRST Championship - Curie Division', 'FIRSTChampionship', 'Houston', 'TX', 'USA', '2026-04-29', 'test')");
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (5001, 'Tesla Coils', 'Tesla', 'CA', 'USA')");
  await rebuildSearch();
});

describe("event phrases", () => {
  it("reads a division called by its own name beside another word as that division", async () => {
    expect(await divisionQuery("curie powerplay")).toBe("curie division powerplay");
    // A word alone stays as typed (a town, a team's name), and a query naming a division already is left alone.
    expect(await divisionQuery("curie")).toBeNull();
    expect(await divisionQuery("curie division")).toBeNull();
    expect(await divisionQuery("hello world")).toBeNull();
    const a = await searchAnswer("curie centerstage", { learn: false, limit: 40, full: true });
    expect(a.step).not.toBe("recovery");
    // The game's season (2023-24), not the division's newest.
    expect(a.hits[0]).toMatchObject({ kind: "event", ref: "2023:CMPCURIE", season: 2023 });
    const r = await searchAnswer("eastbrook league tournament 2023-24", { learn: false, limit: 40, full: true });
    expect(r.hits.some((h) => h.ref === "2023:USXXLT")).toBe(false);
  });
  it("reads Worlds' divisions said as one as Worlds", async () => {
    const p = await parseQuery("WORLDS divisions highlights", await parseContext());
    expect(p).toMatchObject({ worlds: true, intent: "highlights", leftover: [] });
  });
  it("reads a division's or a championship's finals as who won it, a season or game said between", () => {
    for (const q of ["tesla division finals", "tesla division final matches", "tesla division final 2023-24", "state championship finals"]) {
      expect(readStatQuestion(q), q).toMatchObject({ id: "winning-alliance", noTeam: true });
    }
    expect(readStatQuestion("tesla division finals")?.core).toBe("tesla division");
    // A season or a game after the finals, or a game between, stays the season asked.
    expect(readStatQuestion("tesla division final 2023-24")?.scope.season).toBe(2023);
    expect(readStatQuestion("tesla division into the deep finals")).toMatchObject({ id: "winning-alliance", core: "tesla division", scope: { season: 2024 } });
    // A team's finals stay the team's.
    expect(readStatQuestion("5001 finals")?.noTeam ?? false).toBe(false);
  });
});
