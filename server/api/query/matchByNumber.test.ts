// A match by its event and number (search audit Q4): "Q12 <event code>", "<town> Meet 2 qualification match 3", "final
// 2 at <state> states" open that match, its score and teams, through the pipeline's match finder. The words typed in
// their order name the event ("Meet 2 - Harper 1", never "Meet 1 - Harper 2"); a meet's own number is part of its name;
// a championship's finals are its own, never a division's bracket final.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer } from "../../../src/shared/searchStat";

const NOW = Date.parse("2026-03-18T12:00:00Z");
const stat = async (q: string) => (await searchAnswer(q, { limit: 25, full: true, now: NOW })).stat as StatAnswer | undefined;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  const teams = [[30201, "Alpha Bots"], [30202, "Beta Bots"], [30203, "Gamma Bots"], [30204, "Delta Bots"]] as const;
  for (const [n, name] of teams) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Laurel', 'MD', 'USA')", [n, name]);
    await run("INSERT INTO team_seasons (season, team) VALUES (2025, ?)", [n]);
  }
  const ev = (code: string, name: string, type: string, division: string | null = null) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, division_code, source) VALUES (2025, ?, ?, ?, 'Laurel', 'MD', 'USA', '2026-02-01', '2026-02-01', ?, 't')", [code, name, type, division]);
  await ev("USMDLM21", "Laurel Meet 2 - Harper 1", "LeagueMeet");
  await ev("USMDLM12", "Laurel Meet 1 - Harper 2", "LeagueMeet");
  await ev("USMDCMP", "Maryland Championship", "Championship");
  await ev("USMDCMPA", "Maryland Championship - Alpha Division", "Championship", "USMDCMP");
  const match = async (code: string, level: string, series: number, number: number, label: string, red: number, blue: number) => {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, ?, ?, ?, ?, '2026-02-01T10:00:00Z', 1, ?, ?, ?, ?, 't')", [code, level, series, number, label, red, red, blue, blue]);
    for (const [t, a] of [[30201, "red"], [30202, "red"], [30203, "blue"], [30204, "blue"]] as const) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, ?, ?, ?, ?, ?, ?, 1)", [code, level, series, number, t, a]);
    }
  };
  await match("USMDLM21", "qual", 0, 3, "Q3", 121, 80);
  await match("USMDLM12", "qual", 0, 3, "Q3", 99, 98);
  await match("USMDCMPA", "qual", 0, 12, "Q12", 150, 140);
  // The division's bracket ends in its own final; the championship's finals are F1 and F2.
  await match("USMDCMPA", "playoff", 1, 1, "M1", 160, 150);
  await match("USMDCMP", "playoff", 0, 1, "F1", 201, 190);
  await match("USMDCMP", "playoff", 0, 2, "F2", 230, 210);
  await rebuildSearch();
  clearAllCaches();
});

describe("a match by its event and number", () => {
  it("by the event's code: the match, its score and teams (a division's when the championship has none)", async () => {
    for (const q of ["USMDCMP qualification match 12", "q12 maryland championship"]) {
      const s = await stat(q);
      expect(s?.intent, q).toBe("find-high");
      expect(s?.headline?.label, q).toBe("Q12 at Maryland Championship - Alpha Division");
      expect(s?.headline?.sub, q).toMatch(/Red 150 \(30201 Alpha Bots, 30202 Beta Bots\)/);
    }
  });
  it("by the event's words in the order typed, never the same words in another order", async () => {
    const s = await stat("Q3 Laurel Meet 2 Harper 1");
    expect(s?.headline?.label).toBe("Q3 at Laurel Meet 2 - Harper 1");
    expect(s?.headline?.sub).toMatch(/Red 121/);
  });
  it("a finals match by its number: the championship's own finals, never a division's last match", async () => {
    for (const [q, red] of [["final 2 at maryland states", "Red 230"], ["F1 maryland championship", "Red 201"]] as const) {
      const s = await stat(q);
      expect(s?.headline?.label, q).toMatch(/^F\d at Maryland Championship$/);
      expect(s?.headline?.sub, q).toContain(red);
    }
  });
});
