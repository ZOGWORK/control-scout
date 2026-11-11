// An award at an event in a season named by its game ("Innovate award at Worlds in into the deep", a logged failed
// search): that season's award, never an older season's in its place. Worlds 2024-25 judged the Innovate Award in each
// division, so its divisions' places are the answer, winners first; a judged award's finalists FIRST names as such
// ("… Finalist", placed 1 like the winner) come after its winner, said as finalists.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";
import { askAnswer, gameAsSeason, readAsk } from "../searchAsks";

const ask = (q: string) => searchAnswer(q, { limit: 25, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams: [number, string][] = [[7149, "ENFORCERS"], [16461, "Infinite Turtles"], [11260, "Up-A-Creek Robotics"], [18840, "Reynolds Reybots Too"], [26000, "Theseus"], [17969, "MECH"], [16413, "Lo-Ellen Robotics"]];
  for (const [n, name] of teams) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Town', 'TX', 'USA')", [n, name]);
  const ev = (season: number, code: string, name: string, start: string, end: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, division_code, city, state, country, start, end, source) VALUES (?, ?, ?, 'FIRSTChampionship', ?, 'Houston', 'TX', 'USA', ?, ?, 't')", [season, code, name, division, start, end]);
  await ev(2021, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge", "2022-04-20", "2022-04-23");
  await ev(2024, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge", "2025-04-15", "2025-04-19");
  await ev(2024, "FTCCMP1EDIS", "FIRST Championship - FIRST Tech Challenge - Edison Division", "2025-04-15", "2025-04-19", "FTCCMP1");
  await ev(2024, "FTCCMP1FRAN", "FIRST Championship - FIRST Tech Challenge - Franklin Division", "2025-04-15", "2025-04-19", "FTCCMP1");
  // A newer Worlds not held yet: a season named never says so.
  await ev(2026, "FTCCMP1", "FIRST Championship - FIRST Tech Challenge", "2027-04-28", "2027-05-01");
  // 2021-22: one winner and its finalists, the first finalist placed 1 like the winner (as FIRST files them).
  await run(`INSERT INTO awards (season, code, type, placement, team, name) VALUES
    (2021, 'FTCCMP1', 'Innovate', 1, 7149, 'Innovate Award sponsored by Raytheon Technologies Finalist'),
    (2021, 'FTCCMP1', 'Innovate', 1, 16461, 'Innovate Award sponsored by Raytheon Technologies'),
    (2021, 'FTCCMP1', 'Innovate', 2, 11260, 'Innovate Award sponsored by Raytheon Technologies Finalist'),
    (2021, 'FTCCMP1', 'DeansList', 1, 11260, 'Dean''s List Finalist'),
    (2021, 'FTCCMP1', 'DeansList', 2, 7149, 'Dean''s List Finalist')`);
  // 2024-25: the championship's own list has no Innovate Award; each division judged its own.
  await run(`INSERT INTO awards (season, code, type, placement, team, name) VALUES
    (2024, 'FTCCMP1', 'Inspire', 1, 7149, 'Inspire Award'),
    (2024, 'FTCCMP1EDIS', 'Innovate', 1, 18840, 'Innovate Award sponsored by RTX'),
    (2024, 'FTCCMP1EDIS', 'Innovate', 2, 17969, 'Innovate Award sponsored by RTX 2nd Place'),
    (2024, 'FTCCMP1FRAN', 'Innovate', 1, 26000, 'Innovate Award sponsored by RTX'),
    (2024, 'FTCCMP1FRAN', 'Innovate', 2, 16413, 'Innovate Award sponsored by RTX 2nd Place')`);
  await rebuildSearch();
});

describe("an award at Worlds in a season named by its game", () => {
  it("reads that season's award: each division's places, winners first (failed search)", async () => {
    const a = await ask("Innovate award at Worlds in into the deep");
    expect(a.card?.kind).toBe("event-awards");
    expect(a.card?.event).toMatchObject({ season: 2024, code: "FTCCMP1" });
    expect(a.card?.title).toBe("Innovate Award sponsored by RTX · FIRST Championship - FIRST Tech Challenge · 2024–25");
    expect(a.card?.lines.map((l) => [l.text, l.results, l.detail])).toEqual([
      ["18840 Reynolds Reybots Too", ["Winner"], "Innovate Award sponsored by RTX · Edison Division"],
      ["26000 Theseus", ["Winner"], "Innovate Award sponsored by RTX · Franklin Division"],
      ["17969 MECH", ["2nd place"], "Innovate Award sponsored by RTX 2nd Place · Edison Division"],
      ["16413 Lo-Ellen Robotics", ["2nd place"], "Innovate Award sponsored by RTX 2nd Place · Franklin Division"],
    ]);
    expect(a.card?.note).toMatch(/judged in each division/);
    // The event under the card is that season's, its own dates.
    expect(a.hits[0]).toMatchObject({ ref: "2024:FTCCMP1", season: 2024, section: "awards" });
    expect(a.hits[0].event?.start).toBe("2025-04-15");
    expect(a.understood?.label).toBe("Who won the Innovate Award sponsored by RTX at FIRST Championship - FIRST Tech Challenge (2024–25)");
    expect(a.understood?.season).toBe(2024);
  });

  it("an older season named: its winner first, its finalists as finalists, its own event dates", async () => {
    const a = await ask("Innovate award at Worlds in freight frenzy");
    expect(a.card?.event).toMatchObject({ season: 2021, code: "FTCCMP1" });
    expect(a.card?.title).toBe("Innovate Award sponsored by Raytheon Technologies · FIRST Championship - FIRST Tech Challenge · 2021–22");
    expect(a.card?.lines.map((l) => [l.text, l.results])).toEqual([
      ["16461 Infinite Turtles", ["Winner"]], ["7149 ENFORCERS", ["Finalist"]], ["11260 Up-A-Creek Robotics", ["Finalist"]],
    ]);
    // The card's award list too: the winner before the finalist placed 1 beside it.
    expect(a.card?.awards?.filter((x) => x.type === "Innovate").map((x) => x.team)).toEqual([16461, 7149, 11260]);
    expect(a.hits[0]).toMatchObject({ ref: "2021:FTCCMP1", season: 2021 });
    expect(a.hits[0].event?.start).toBe("2022-04-20");
    expect(a.understood?.label).not.toMatch(/isn't held yet|no award posted/);
  });

  it("an award given only to finalists is titled by their own name (Loopy on #1363)", async () => {
    const a = await ask("who won deans list at worlds 2021-22");
    expect(a.card?.title).toBe("Dean's List Finalist · FIRST Championship - FIRST Tech Challenge · 2021–22");
    expect(a.card?.lines.map((l) => l.results)).toEqual([["Finalist"], ["Finalist"]]);
  });

  it("a season said by its game, read straight from the ask (no rewrite first): that season only (Loopy on #1363)", async () => {
    expect(gameAsSeason("worlds in freight frenzy")).toBe("worlds 2021-22");
    expect(gameAsSeason("worlds during the into the deep season")).toBe("worlds 2024-25");
    expect(gameAsSeason("new jersey championship")).toBe("new jersey championship");
    // Inspire at Worlds is recorded in 2024-25 only: 2021-22 asked by its game has none, never 2024-25's said instead.
    const q = "who won inspire at worlds in freight frenzy";
    const a = await askAnswer(q, readAsk(q)!, { prefer: new Set(), ask });
    expect(a?.card?.event).toMatchObject({ season: 2021, code: "FTCCMP1" });
    expect(a?.card?.lines).toEqual([]);
    expect(a?.card?.none).toMatch(/in 2021–22\.$/);
  });

  it("a place asked is a placed team's, never a finalist FIRST lists second (Loopy on #1363)", async () => {
    const a = await ask("who got 2nd place innovate at worlds in freight frenzy");
    expect(a.card?.lines.map((l) => [l.text, l.results])).toEqual([
      ["16461 Infinite Turtles", ["Winner"]], ["7149 ENFORCERS", ["Finalist"]], ["11260 Up-A-Creek Robotics", ["Finalist"]],
    ]);
    expect(a.understood?.label).toMatch(/ · No 2nd place recorded$/);
  });
});
