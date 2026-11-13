// Search's dearest reads use the indexes that keep them cheap (measured 2026-11-13 on the production data: an award
// question over a championship's divisions 15 ms → 0.2 ms; a league meet's standing out of its league 290 ms → 5 ms
// for a team with many league meets). A plan that walks a whole season's rows instead fails here, before it's live.
import { beforeEach, describe, expect, it } from "vitest";
import { all, migrate, openDb, setDb } from "../db";
import { LEAGUE_RANKED } from "./teams";

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
});

const plan = async (sql: string, args: (string | number)[]) =>
  (await all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, args)).map((r) => r.detail).join(" | ");

describe("search's query plans", () => {
  it("finds a championship's divisions by their parent code (events_division), not by walking the seasons' awards", async () => {
    // As searchAsks.ts asks it: the latest season an award was given at the divisions of the event named.
    const p = await plan("SELECT MAX(a.season) season FROM awards a JOIN events d ON d.season = a.season AND d.code = a.code WHERE d.division_code = ? AND a.type = ? AND a.season <= ? AND a.season >= ?", ["USNJCMP", "Think", 2025, 2019]);
    expect(p).toContain("events_division");
    expect(p).not.toMatch(/SEARCH a USING (?:COVERING )?INDEX \S+ \(season>\? AND season<\?\)/);
  });

  it("counts a league's ranked teams from the league's own meets, not from every team of the season", async () => {
    // The league standing's count (teams.ts LEAGUE_RANKED, read by answers/eventSet.ts and answers/families/facts.ts).
    const p = await plan(`SELECT ${LEAGUE_RANKED} n FROM event_teams et JOIN events e ON e.season = et.season AND e.code = et.code WHERE et.team = ?`, [4215]);
    expect(p).toMatch(/SEARCH o USING (?:COVERING )?INDEX \S+ \(season=\? AND code=\?\)/);
    expect(p).not.toMatch(/SEARCH o USING (?:COVERING )?INDEX \S+ \(season=\?\)(?! AND)/);
  });
});
