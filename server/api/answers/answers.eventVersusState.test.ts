// Events side by side with a state's code in a name ("<event> vs NJ Championship"), on a database shaped like the live
// one: an old division whose name carries the state's code in an event code ("…-NJ0312 - Turnpike Division") is never
// the state's championship. Fixture events only; every phrasing is a rewording, never a logged query's words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  // season, code, name, division of
  const events: [number, string, string, string | null][] = [
    [2025, "USOHCMP", "Ohio Championship", null],
    [2025, "USNJCMP", "New Jersey Championship", null],
    [2025, "USNJCMPTRPK", "New Jersey Championship - Turnpike Division", "USNJCMP"],
    [2025, "USNJCMPPKWY", "New Jersey Championship - Parkway Division", "USNJCMP"],
    // An old season's division, its code in its name.
    [2022, "USNJCMPTPKE", "New Jersey State Championship-NJ0312 - Turnpike Division", null],
    // The next season's championship, nothing played yet.
    [2026, "USNJCMP", "New Jersey Championship", null],
  ];
  for (const [season, code, name, of] of events) {
    await run("INSERT INTO events (season, code, name, type, state, country, division_code, source) VALUES (?, ?, ?, 'Championship', ?, 'USA', ?, 'test')", [season, code, name, code.slice(2, 4), of]);
  }
  // season, code, team, OPR; a played match at each event with matches.
  const stats: [number, string, number, number][] = [
    [2025, "USOHCMP", 1, 60], [2025, "USOHCMP", 2, 40], [2025, "USNJCMPTRPK", 3, 90], [2025, "USNJCMPPKWY", 4, 70], [2022, "USNJCMPTPKE", 5, 30], [2022, "USNJCMPTPKE", 6, 20],
  ];
  for (const [season, code, team, opr] of stats) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (?, ?, ?, ?, 5)", [season, code, team, opr]);
  let n = 0;
  for (const [season, code] of [[2025, "USOHCMP"], [2025, "USNJCMPTRPK"], [2025, "USNJCMPPKWY"], [2022, "USNJCMPTPKE"]] as const) {
    n++;
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, 1, 150, 140, 100, 100, 'test')", [season, code, n, `Q${n}`]);
  }
  await rebuildSearch();
});

describe("a state's code in an event's name", () => {
  it("is the state's championship, its latest played season, never an old division with the code in its name", async () => {
    const a = await searchAnswer("Ohio Championship versus NJ Championship", { full: true, limit: 10, learn: false });
    expect(a.intent?.kind).toBe("stat-event-versus");
    expect(a.understood?.label).toBe("Compare events: Ohio Championship vs New Jersey Championship");
    expect(a.stat?.scope).toEqual(["Ohio Championship, 2025–26", "New Jersey Championship, 2025–26"]);
  });
});
