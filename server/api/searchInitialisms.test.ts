// An event by its initialism (owner: "MTI highlights" for the Multinational Tech Invitational found nothing), and an
// event held only in past seasons read in its latest one, never the current season it isn't in.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { rebuildSearch } from "../stats/job";
import { CURRENT_SEASON } from "../data/seasons";
import { searchAnswer } from "./searchAnswer";
import { eventInitialisms } from "./query/initialisms";
import { parseContext } from "./query/context";

const S = CURRENT_SEASON - 1;
const ask = (q: string) => searchAnswer(q, { limit: 25, full: true, learn: false });

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const n of [4215, 6980, 23268, 7149, 5000, 5001]) await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Laurel', 'MD', 'USA')", [n, `Team ${n}`]);
  await run("INSERT INTO teams (number, name, city, state, country) VALUES (9999, 'BOB', 'Laurel', 'MD', 'USA')");
  // One event code, renamed between seasons (both are "MTI"); another event sharing the initialism, an older one.
  // [season, code, name, teams, held (month-day of the year after the season starts)]
  const events: [number, string, string, number[], string?][] = [
    [S - 1, "USMDMTI", "Maryland Tech Invitational", [4215, 6980, 23268, 7149]],
    [S, "USMDMTI", "Multinational Tech Invitational", [4215, 6980, 23268, 7149]],
    [S - 1, "USCOMTI", "Mountain Tech Invitational", [5000, 5001, 4215, 6980]],
    [S, "USMDBOB", "Battle of the Bay", [5000, 5001, 23268, 7149]],
    // The same initialism in the same season, bigger but held earlier: the later one is "the latest held".
    [S, "USMWMTI", "Midwest Tech Invitational", [4215, 6980, 23268, 7149, 5000, 5001], "03-01"],
    [S, "USMDFR", "Festival of the Robots", [5000, 5001, 4215, 6980]],
  ];
  for (const [season, code, name, teams, held = "06-27"] of events) {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'OffSeason', 'Laurel', 'MD', 'USA', ?, ?, 't')", [season, code, name, `${season + 1}-${held}`, `${season + 1}-${held}`]);
    for (const t of teams) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [season, code, t]);
    await run("INSERT INTO alliances (season, code, number, captain, pick1) VALUES (?, ?, 1, ?, ?), (?, ?, 2, ?, ?)", [season, code, teams[0], teams[1], season, code, teams[2], teams[3]]);
    for (const [level, series, n, label] of [["qual", 0, 1, "Q1"], ["playoff", 6, 1, "F1"], ["playoff", 6, 2, "F2"]] as const) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, red_auto, blue_auto, source) VALUES (?, ?, ?, ?, ?, ?, 1, 150, 150, 120, 120, 40, 30, 't')", [season, code, level, series, n, label]);
      for (const [t, al] of [[teams[0], "red"], [teams[1], "red"], [teams[2], "blue"], [teams[3], "blue"]] as const) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, ?, ?, ?, ?, ?, 1)", [season, code, level, series, n, t, al]);
    }
  }
  await rebuildSearch();
});

describe("an event by its initialism", () => {
  it("is made from its name's significant words, and from a short form it states", () => {
    expect(eventInitialisms("Multinational Tech Invitational")).toEqual(["mti"]);
    expect(eventInitialisms("Festival of the Robots")).toEqual(["fr"]);
    expect(eventInitialisms("Battle of the Bay (BOB)")).toEqual(["bob", "bb"]);
    expect(eventInitialisms("Michigan State Championship")).toEqual(["msc"]);
    expect(eventInitialisms("FIRST Tech Challenge Silicon Valley Kickoff Scrimmage Event")).toEqual([]);
    // A dated meet's name has no initialism: its words are a date and a place.
    expect(eventInitialisms("NJ 1/11/2025 P3 NE Edge League Meet")).toEqual([]);
  });
  it("every way of asking about it finds the event, in its latest season", async () => {
    for (const q of ["MTI highlights", "mti highlights", "MTI recap", "who won MTI", "MTI results"]) {
      const a = await ask(q);
      expect(a.step, q).not.toBe("recovery");
      expect(a.sorry, q).toBeUndefined();
      expect(JSON.stringify(a), q).toContain(`${S}`);
      expect(JSON.stringify(a), q).toContain("Multinational Tech Invitational");
    }
    expect((await ask("MTI highlights")).stat?.title).toMatch(/^Highlights at Multinational Tech Invitational, /);
    expect((await ask("MTI results")).hits.map((h) => h.ref)).toContain(`${S}:USMDMTI`);
  });
  it("several events sharing it: the latest held (its season, then its date), said by name", async () => {
    const a = await ask("mti highlights");
    expect(a.stat?.title).toMatch(/^Highlights at Multinational Tech Invitational, /);
    expect(JSON.stringify(a)).not.toContain("Mountain Tech Invitational");
    expect(JSON.stringify(a)).not.toContain("Midwest Tech Invitational");
  });
  // Greptile on #1006: a year asked narrows the events before one is chosen.
  it("a year asked: chosen among the events held that year", async () => {
    const a = await ask(`mti highlights ${S}`);
    expect(a.step).not.toBe("recovery");
    expect(a.stat?.title).toMatch(/Tech Invitational, /);
    expect(a.stat?.title).not.toContain("Multinational");
  });
  // Greptile on #1006: next season's event already listed is never "the latest held" for its winners.
  it("next season's one listed, not held yet: the winners are the latest one played", async () => {
    await run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, 'USMDMTI', 'Multinational Tech Invitational', 'OffSeason', 'Laurel', 'MD', 'USA', '2099-06-27', '2099-06-29', 't')", [S + 1]);
    await rebuildSearch();
    const a = await ask("who won MTI");
    expect(a.understood?.season).toBe(S);
    expect(a.stat?.headline).toBeDefined();
    await run("DELETE FROM events WHERE season = ? AND code = 'USMDMTI'", [S + 1]);
    await rebuildSearch();
  });
  it("a two-letter initialism finds its event too", async () => {
    expect(await (await parseContext()).isEvent("fr")).toBe(true);
    expect((await ask("fr highlights")).stat?.title).toMatch(/^Highlights at Festival of the Robots, /);
  });
  it("a team named so is the team's, never the event's", async () => {
    expect(await (await parseContext()).isEvent("bob")).toBe(false);
    expect((await ask("BOB")).hits[0]?.ref).toBe("9999");
    expect(await (await parseContext()).isEvent("mti")).toBe(true);
  });
});

describe("an event held only in past seasons, with no season said", () => {
  it("reads its latest season, never the current one with nothing in it", async () => {
    for (const q of ["Multinational Tech Invitational highlights", "who won Multinational Tech Invitational", "Multinational Tech Invitational recap"]) {
      const a = await ask(q);
      expect(a.understood?.season ?? a.stat?.scope?.[0], q).not.toBe(CURRENT_SEASON);
      expect(JSON.stringify(a), q).not.toContain(`${CURRENT_SEASON}–`);
      expect(a.stat?.none, q).toBeUndefined();
    }
  });
  it("a recap with no video says so and points to the stats", async () => {
    const a = await ask("Multinational Tech Invitational recap");
    expect(JSON.stringify(a.stat)).toContain("No recording for this event — stats only.");
  });
});
