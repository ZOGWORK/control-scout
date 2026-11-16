// A town with "meet" after it that names a stored event ("top plays at rolla meet", failed-search #1573): that event,
// never the town's events with "meet" left over; and its edition last season, held under another code, is found.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { clearAllCaches } from "../../caches";
import { searchAnswer } from "../searchAnswer";
import type { StatAnswer } from "../../../src/shared/searchStat";

// 2026–27 has begun: this season's meet is scheduled, last season's was played.
const NOW = Date.parse("2026-11-16T12:00:00Z");
const stat = async (q: string) => (await searchAnswer(q, { limit: 25, full: true, now: NOW })).stat as StatAnswer;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  for (const [n, name] of [[30201, "Ozark Bots"], [30202, "Miner Bots"], [30203, "River Bots"], [30204, "Hill Bots"]] as const) {
    await run("INSERT INTO teams (number, name, city, state, country) VALUES (?, ?, 'Rolla', 'MO', 'USA')", [n, name]);
    for (const s of [2025, 2026]) await run("INSERT INTO team_seasons (season, team) VALUES (?, ?)", [s, n]);
  }
  const ev = (season: number, code: string, name: string, start: string) =>
    run("INSERT INTO events (season, code, name, type, city, state, country, start, end, source) VALUES (?, ?, ?, 'LeagueMeet', 'Rolla', 'MO', 'USA', ?, ?, 't')", [season, code, name, start, start]);
  // The same meet under a different code each season; the code it had last season is another meet's this season.
  await ev(2026, "USMORM1", "Rolla Meet @ 10 AM", "2026-12-12");
  await ev(2026, "USMORM6", "Ignite Meet @ 10 AM", "2026-12-19");
  await ev(2025, "USMORM6", "Rolla Meet @ 10 AM", "2025-12-13");
  for (let n = 1; n <= 2; n++) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'USMORM6', 'qual', 0, ?, ?, '2025-12-13T10:00:00Z', 1, ?, ?, 90, 90, 't')", [n, `Q${n}`, 100 + n * 20, 100 + n * 20]);
    for (const [t, a] of [[30201, "red"], [30202, "red"], [30203, "blue"], [30204, "blue"]] as const) {
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (2025, 'USMORM6', 'qual', 0, ?, ?, ?, 1)", [n, t, a]);
    }
  }
  await rebuildSearch();
  clearAllCaches();
});

describe("a town's meet named", () => {
  it("\"top plays at rolla meet\": the meet's highlights, last season's edition while this season's is unplayed (#1573)", async () => {
    const s = await stat("top plays at rolla meet");
    expect(s?.intent).toBe("scope-highlights");
    expect(s.title).toBe("Highlights at Rolla Meet @ 10 AM, 2025–26");
    expect(s.scope[0]).toBe("No 2026–27 matches yet at Rolla Meet @ 10 AM; showing 2025–26");
  });
  it("the town alone is still the town", async () => {
    expect((await stat("highlights in rolla")).title).toMatch(/^Highlights in Rolla/);
  });
});
