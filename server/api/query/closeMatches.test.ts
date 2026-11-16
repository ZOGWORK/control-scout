// Closest matches as they were searched (failed-search #1563, #1564, #1566, #1567): at an event named by its name or
// its initials, a typo of "closest" before "match", "top N" with the closest said, and a bare score both alliances
// passed ("above 500").
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const stat = async (q: string) => (await searchAnswer(q, { limit: 25, full: true, now: NOW })).stat as StatAnswer;
/** The table rows' cells, in the order shown. */
const cellsOf = (s: StatAnswer) => s.blocks.flatMap((b) => (b.kind === "table" ? b.rows.map((r) => r.cells) : []));

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[30101, "Alpha Bots"], [30102, "Beta Bots"], [30103, "Gamma Bots"], [30104, "Delta Bots"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Laurel', 'MD', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, type: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (2025, ?, ?, ?, 'Laurel', 'MD', 'USA', ?, ?, 't')", [code, name, type, start, start]);
  await ev("USMDOS1", "Multinational Tech Invitational", "OffSeason", "2026-06-26");
  await ev("USMDQ1", "Laurel Qualifier", "Qualifier", "2026-01-10");
  let n = 0;
  const match = async (code: string, day: string, red: number, blue: number) => {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, ?, ?, 't')", [code, n, `Q${n}`, `${day}T10:00:00Z`, red, red, blue, blue]);
    for (const [t, a] of [[30101, "red"], [30102, "red"], [30103, "blue"], [30104, "blue"]] as const) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, 'qual', 0, ?, ?, ?, 1)", [code, n, t, a]);
    }
  };
  // The invitational: decided by 2 and by 40. The qualifier: a 100–100 tie, a 520–515 match and a 610–500 one.
  await match("USMDOS1", "2026-06-26", 202, 200);
  await match("USMDOS1", "2026-06-26", 240, 200);
  await match("USMDQ1", "2026-01-10", 100, 100);
  await match("USMDQ1", "2026-01-10", 520, 515);
  await match("USMDQ1", "2026-01-10", 610, 500);
  await rebuildSearch();
  clearAllCaches();
});

describe("closest matches as searched", () => {
  it("at an event named by its name or its initials: that event's matches, though it is off-season (#1566, #1567)", async () => {
    for (const q of ["closest match in multinational tech invitational", "closes match in mti"]) {
      const s = await stat(q);
      expect(s?.intent, q).toBe("find-closest");
      expect(s.title, q).toMatch(/^Closest match at Multinational Tech Invitational/);
      expect(s.headline?.value, q).toBe("2-point margin");
    }
  });
  it("\"top 10\" with the closest said: the closest matches, never the highest-scoring (#1563)", async () => {
    for (const q of ["top 10 closest match in decode", "top 20 closest match in decode"]) {
      const s = await stat(q);
      expect(s?.intent, q).toBe("find-closest");
      expect(s.title, q).toMatch(/^Closest matches/);
      // Every decided and tied match at official events, closest first: the tie, then 5, then 110.
      expect(cellsOf(s).map((c) => [c.value, c.score]), q).toEqual([["Tie", "100–100"], ["5-point margin", "520–515"], ["110-point margin", "610–500"]]);
    }
  });
  it("a bare score after the closest: both alliances over it, said on the card (#1564)", async () => {
    // Its points said or not: the same reading.
    expect((await stat("closest match in decode above 500 points")).scope).toContain("Both alliances scored over 500");
    const s = await stat("closest match in decode above 500");
    expect(s?.intent).toBe("find-closest");
    expect(s.scope).toContain("Both alliances scored over 500");
    expect(s.headline?.value).toBe("5-point margin");
    // Over 500 is strictly over: the 610–500 match, its blue alliance on exactly 500, is left out, so 520–515 is all.
    expect(s.headline?.sub).toContain("Red 520");
    expect(cellsOf(s)).toEqual([]);
    expect(s.source).toMatch(/^From 1 played match /);
  });
});
