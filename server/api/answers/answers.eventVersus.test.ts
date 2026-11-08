// Events side by side ("<event> vs <event>"). Fixture events only; every phrasing is a rewording, never a logged
// query's words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { eventVersusAnswer, eventVersusTitle, eventsNamed, readEventVersus, type EventRow } from "./families/eventVersus";
import { rebuildSearch } from "../../stats/job";
import { searchAnswer } from "../searchAnswer";

describe("reading it", () => {
  it("every side an event, by a word only an event's name has", () => {
    expect(readEventVersus("Ohio Championship versus Texas Championship")).toEqual(["Ohio Championship", "Texas Championship"]);
    expect(readEventVersus("compare the Ohio State Qualifier v. Lake Erie League Meet?")).toEqual(["Ohio State Qualifier", "Lake Erie League Meet"]);
    expect(readEventVersus("OH Championship vs TX Championship vs Worlds")).toEqual(["OH Championship", "TX Championship", "Worlds"]);
  });

  it("a team on any side is the teams' versus", () => {
    expect(readEventVersus("Robo Rebels vs Ohio Championship")).toBeNull();
    expect(readEventVersus("12345 vs 67890")).toBeNull();
    // A team's number with an event word is still a team.
    expect(readEventVersus("league team 12345 vs Texas Championship")).toBeNull();
    expect(readEventVersus("Ohio Championship")).toBeNull();
  });
});

describe("the answer", () => {
  const ev = (code: string, name: string): EventRow => ({ season: 2025, code, name, type: "Championship", start: "2026-03-01", division: null });
  const EVENTS: Record<string, EventRow> = { "ohio championship": ev("OH", "Ohio Championship"), "texas championship": ev("TX", "Texas Championship"), "empty championship": ev("EM", "Empty Championship"),
    "utah championship": { ...ev("UT", "Utah Championship"), season: 2024 } };
  const find = async (w: string) => EVENTS[w.toLowerCase()] ?? null;

  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, source) VALUES (2025, 'OH', 'Ohio Championship', 'Championship', 'test'), (2025, 'TX', 'Texas Championship', 'Championship', 'test'), (2025, 'TXD1', 'Texas Championship - Div 1', 'Championship', 'test'), (2025, 'EM', 'Empty Championship', 'Championship', 'test'), (2024, 'UT', 'Utah Championship', 'Championship', 'test'), (2025, 'CMP', 'FIRST Championship', 'FIRSTChampionship', 'test'), (2025, 'PWS', 'Pre Worlds Scrimmage', 'Scrimmage', 'test')");
    await run("UPDATE events SET division_code = 'TX' WHERE code = 'TXD1'");
    // code, team, OPR
    const ts: [string, number, number][] = [["OH", 1, 40], ["OH", 2, 60], ["TXD1", 3, 90], ["TXD1", 4, 70], ["TX", 3, 95]];
    for (const [code, team, opr] of ts) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, ?, ?, ?, 5)", [code, team, opr]);
    // Another season's game, its points far higher.
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2024, 'UT', 5, 300, 5), (2024, 'UT', 6, 250, 5), (2025, 'CMP', 3, 100, 5), (2025, 'CMP', 8, 80, 5)");
    // An event with "worlds" in its name is never Worlds.
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'CMP', 'playoff', 1, 1, 'M1', 1, 260, 250, 200, 200, 'test'), (2025, 'PWS', 'qual', 0, 1, 'Q1', 1, 90, 90, 80, 80, 'test')");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2024, 'UT', 'qual', 0, 1, 'Q1', 1, 500, 480, 400, 400, 'test')");
    // A team that never played: not counted.
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'OH', 9, 500, 0)");
    // code, number, red total, red np, blue total, blue np
    const ms: [string, number, number, number, number, number][] = [["OH", 1, 130, 110, 80, 80], ["TXD1", 1, 200, 180, 160, 160], ["TX", 1, 140, 140, 100, 100]];
    for (const [code, n, rt, rn, bt, bn] of ms) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, 'test')", [code, n, `Q${n}`, rt, rn, bt, bn]);
    }
    // A played playoff match with only its totals on record: no score without penalties to offer, so never the high.
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, blue_total, source) VALUES (2025, 'OH', 'playoff', 1, 1, 'M1', 1, 300, 250, 'test')");
    // On the field there: team 1 (with stats) and team 7, a playoff-only appearance with no stats row.
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (2025, 'OH', 'qual', 0, 1, 1, 'red'), (2025, 'OH', 'playoff', 1, 1, 7, 'blue')");
    await rebuildSearch();
  });

  it("each field's average OPR, best OPR, high score and teams, a division counted for its event", async () => {
    const evs = await eventsNamed(["Ohio Championship", "Texas Championship"], null, find);
    const a = await eventVersusAnswer(evs!);
    expect(a.intent).toBe("event-versus");
    // Texas: teams 3 (best 95, across division and finals) and 4 (70): 82.5; Ohio: 50.
    expect(a.headline).toMatchObject({ value: "+32.5 OPR", label: "Texas Championship had the stronger field" });
    const table = a.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => [r.cells.teams, r.cells.field, r.cells.top, r.cells.high, r.strong]))
      .toEqual([[3, "50.0", "60.0", 110, false], [2, "82.5", "95.0", 180, true]]);
    const kpis = a.blocks.find((b) => b.kind === "kpis");
    expect(kpis && kpis.kind === "kpis" && kpis.items.map((i) => i.href)).toEqual(["/teams/2?season=2025", "/teams/3?season=2025"]);
  });

  it("a state's code is spelled out, the same event twice is one, one alone is no comparison", async () => {
    const evs = await eventsNamed(["OH Championship", "Texas Championship", "ohio championship"], null, async (w) => (w === "OH Championship" ? null : find(w)));
    expect(evs && eventVersusTitle(evs)).toBe("Compare events: Ohio Championship vs Texas Championship");
    expect(await eventsNamed(["Ohio Championship", "ohio championship"], null, find)).toBeNull();
    expect(await eventsNamed(["Ohio Championship", "Nowhere Championship"], null, find)).toBeNull();
  });

  it("events from different seasons are side by side, neither called stronger", async () => {
    const a = await eventVersusAnswer((await eventsNamed(["Ohio Championship", "Utah Championship"], null, find))!);
    expect(a.headline).toBeUndefined();
    expect(a.none).toBeUndefined();
    const table = a.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => [r.cells.field, r.strong])).toEqual([["50.0", false], ["275.0", false]]);
    expect(a.definition).toMatch(/different seasons/);
  });

  it("the search box's link opens the query as asked, its season too", async () => {
    const q = "Texas Championship versus Ohio Championship 2025-26";
    const a = await searchAnswer(q, { limit: 10 });
    expect(a.understood).toMatchObject({ label: "Compare events: Texas Championship vs Ohio Championship", season: 2025 });
    expect(a.pages[0].href).toBe(`/search?q=${encodeURIComponent(q)}`);
  });

  it("Worlds is the FIRST Championship, on either side, before any other reading", async () => {
    for (const q of ["worlds versus ohio championship", "Ohio Championship vs FIRST Championship"]) {
      const a = await searchAnswer(q, { limit: 10 });
      expect(a.intent?.kind, q).toBe("stat-event-versus");
      expect(a.understood?.label, q).toMatch(/^Compare events: .*(?:Ohio Championship vs FIRST Championship|FIRST Championship vs Ohio Championship)$/);
    }
  });

  it("an event with nothing played says so", async () => {
    const a = await eventVersusAnswer((await eventsNamed(["Ohio Championship", "Empty Championship"], null, find))!);
    expect(a.headline).toBeUndefined();
    expect(a.none).toBe("Empty Championship, 2025–26 has no played matches on record yet.");
  });
});
