// "Which event had the most teams in California" (failed-search #826): events ranked by their team lists.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../../db";
import type { StatBlock } from "../../../../src/shared/searchStat";
import { biggestEventsAnswer, readBiggestEvents } from "./biggestEvents";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const ev = (code: string, name: string, type: string, state: string, start: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, ?, 'Town', ?, 'USA', ?, ?, 't')", [code, name, type, division, state, start, start]);
  await ev("USCAQ1", "Small Qualifier", "Qualifier", "CA", "2025-11-01");
  await ev("USCAQ2", "Big Qualifier", "Qualifier", "CA", "2025-12-01");
  await ev("USCACMP", "California Championship", "Championship", "CA", "2026-03-01");
  await ev("USCACMPA", "California Championship - A Division", "Championship", "CA", "2026-03-01", "USCACMP");
  await ev("USCACMPB", "California Championship - B Division", "Championship", "CA", "2026-03-01", "USCACMP");
  await ev("USTXQ1", "Huge Texas Qualifier", "Qualifier", "TX", "2025-11-01");
  const teams = (code: string, from: number, n: number) => run(`INSERT INTO event_teams (season, code, team) VALUES ${Array.from({ length: n }, (_, i) => `(2025, '${code}', ${from + i})`).join(", ")}`);
  await teams("USCAQ1", 100, 10);
  await teams("USCAQ2", 200, 20);
  // The championship's teams are on its divisions' lists: 15 + 15, counted together once.
  await teams("USCACMPA", 300, 15);
  await teams("USCACMPB", 400, 15);
  await teams("USTXQ1", 500, 50);
});

describe("events with the most teams", () => {
  it("reads the ask however it's said, with the place, kind and season; a name left over is search's", () => {
    for (const q of ["which event had the most teams in California this season", "biggest event in california", "events with the most team in california", "largest events in CA"])
      expect(readBiggestEvents(q), q).toMatchObject({ e: { region: { key: "USA:CA" } } });
    expect(readBiggestEvents("largest qualifiers in texas")).toMatchObject({ e: { kinds: ["qualifier"], region: { key: "USA:TX" } } });
    expect(readBiggestEvents("events with the most teams in nj 2024-25")).toMatchObject({ e: { season: 2024 } });
    expect(readBiggestEvents("biggest event")).toMatchObject({ e: { region: null } });
    expect(readBiggestEvents("biggest east bergen event")).toBeNull();
    // "Ever" is every season, never quietly the default one; with a season said too, it's left to search.
    expect(readBiggestEvents("biggest event ever in california")).toMatchObject({ e: { allSeasons: true, season: null } });
    expect(readBiggestEvents("largest qualifier of all time")).toMatchObject({ e: { allSeasons: true } });
    expect(readBiggestEvents("biggest event ever in 2024-25")).toBeNull();
    // A state code that is also a word is the state in capitals; a count asked is kept and read past.
    expect(readBiggestEvents("biggest events in IN 2025-26")).toMatchObject({ e: { region: { key: "USA:IN" }, season: 2025 } });
    expect(readBiggestEvents("top 3 biggest events in california")).toMatchObject({ n: 3, e: { region: { key: "USA:CA" } } });
    expect(readBiggestEvents("events in california")).toBeNull();
  });
  it("ranks a place's events by their team lists, an event's divisions counted together", async () => {
    const a = await biggestEventsAnswer(readBiggestEvents("biggest event in california 2025-26")!, 2025);
    expect(a.headline).toMatchObject({ value: "California Championship", label: "30 teams" });
    const table = a.blocks[0] as Extract<StatBlock, { kind: "table" }>;
    expect(table.rows.map((r) => [r.cells.event, r.cells.teams])).toEqual([
      ["California Championship", 30], ["Big Qualifier", 20], ["Small Qualifier", 10]]);
    const q = await biggestEventsAnswer(readBiggestEvents("largest qualifiers in california")!, 2025);
    expect(q.title).toBe("Qualifiers with the most teams in California, 2025–26");
    expect(q.headline?.value).toBe("Big Qualifier");
    // Every season: an older season's bigger event leads.
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2023, 'USCAOLD', 'Old Giant Qualifier', 'Qualifier', 'Town', 'CA', 'USA', '2023-12-01', '2023-12-01', 't')");
    await run(`INSERT INTO event_teams (season, code, team) VALUES ${Array.from({ length: 40 }, (_, i) => `(2023, 'USCAOLD', ${900 + i})`).join(", ")}`);
    const ever = await biggestEventsAnswer(readBiggestEvents("biggest event ever in california")!, 2025);
    expect(ever.title).toBe("Events with the most teams in California, every season");
    expect(ever.headline).toMatchObject({ value: "Old Giant Qualifier", label: "40 teams" });
    const none = await biggestEventsAnswer(readBiggestEvents("biggest event in california")!, 2026);
    expect(none.none).toBe("No event in California in 2026–27 has a team list yet.");
  });
});
