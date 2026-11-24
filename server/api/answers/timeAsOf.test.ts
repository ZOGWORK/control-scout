// A question asked as of another day (a replay): a month said without its year is the latest begun as of that day,
// its season and its day both read as of it, never today's date beside that day's season (Loopy on #2254).
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, setDb } from "../../db";
import { currentSeason, refreshSearchSeason, seasonDay } from "./season";
import { lastMonthSeason, readTeamFact } from "./families/facts";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await refreshSearchSeason(Date.parse("2025-03-10T12:00:00Z"));
});

describe("a month asked as of an earlier day", () => {
  it("is the latest begun as of that day", () => {
    expect(seasonDay()).toBe("2025-03-10");
    // The season read as of that day (never one before its finished season) has its June still to come on 2025-03-10,
    // as on today's date it has begun: the season before's June.
    const s = currentSeason();
    expect(`${s + 1}-06-01` > "2025-03-10").toBe(true);
    expect(lastMonthSeason(5)).toBe(s - 1);
    expect(readTeamFact("2024 events in june")).toMatchObject({ core: "2024", month: 5, season: s - 1 });
  });
});
