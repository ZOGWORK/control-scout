// Events side by side ("<event> vs <event>"). Fixture events only; every phrasing is a rewording, never a logged
// query's words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { eventVersusAnswer, eventVersusTitle, eventsNamed, readEventVersus, type EventRow } from "./families/eventVersus";

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
  const EVENTS: Record<string, EventRow> = { "ohio championship": ev("OH", "Ohio Championship"), "texas championship": ev("TX", "Texas Championship"), "empty championship": ev("EM", "Empty Championship") };
  const find = async (w: string) => EVENTS[w.toLowerCase()] ?? null;

  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, source) VALUES (2025, 'OH', 'Ohio Championship', 'Championship', 'test'), (2025, 'TX', 'Texas Championship', 'Championship', 'test'), (2025, 'TXD1', 'Texas Championship - Div 1', 'Championship', 'test'), (2025, 'EM', 'Empty Championship', 'Championship', 'test')");
    await run("UPDATE events SET division_code = 'TX' WHERE code = 'TXD1'");
    // code, team, OPR
    const ts: [string, number, number][] = [["OH", 1, 40], ["OH", 2, 60], ["TXD1", 3, 90], ["TXD1", 4, 70], ["TX", 3, 95]];
    for (const [code, team, opr] of ts) await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, ?, ?, ?, 5)", [code, team, opr]);
    // A team that never played: not counted.
    await run("INSERT INTO team_event_stats (season, code, team, opr_np, matches) VALUES (2025, 'OH', 9, 500, 0)");
    // code, number, red total, red np, blue total, blue np
    const ms: [string, number, number, number, number, number][] = [["OH", 1, 130, 110, 80, 80], ["TXD1", 1, 200, 180, 160, 160], ["TX", 1, 140, 140, 100, 100]];
    for (const [code, n, rt, rn, bt, bn] of ms) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, 'test')", [code, n, `Q${n}`, rt, rn, bt, bn]);
    }
  });

  it("each field's average OPR, best OPR, high score and teams, a division counted for its event", async () => {
    const evs = await eventsNamed(["Ohio Championship", "Texas Championship"], null, find);
    const a = await eventVersusAnswer(evs!);
    expect(a.intent).toBe("event-versus");
    // Texas: teams 3 (best 95, across division and finals) and 4 (70): 82.5; Ohio: 50.
    expect(a.headline).toMatchObject({ value: "+32.5 OPR", label: "Texas Championship had the stronger field" });
    const table = a.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => [r.cells.teams, r.cells.field, r.cells.top, r.cells.high, r.strong]))
      .toEqual([[2, "50.0", "60.0", 110, false], [2, "82.5", "95.0", 180, true]]);
    const kpis = a.blocks.find((b) => b.kind === "kpis");
    expect(kpis && kpis.kind === "kpis" && kpis.items.map((i) => i.href)).toEqual(["/teams/2?season=2025", "/teams/3?season=2025"]);
  });

  it("a state's code is spelled out, the same event twice is one, one alone is no comparison", async () => {
    const evs = await eventsNamed(["OH Championship", "Texas Championship", "ohio championship"], null, async (w) => (w === "OH Championship" ? null : find(w)));
    expect(evs && eventVersusTitle(evs)).toBe("Compare events: Ohio Championship vs Texas Championship");
    expect(await eventsNamed(["Ohio Championship", "ohio championship"], null, find)).toBeNull();
    expect(await eventsNamed(["Ohio Championship", "Nowhere Championship"], null, find)).toBeNull();
  });

  it("an event with nothing played says so", async () => {
    const a = await eventVersusAnswer((await eventsNamed(["Ohio Championship", "Empty Championship"], null, find))!);
    expect(a.headline).toBeUndefined();
    expect(a.none).toBe("Empty Championship, 2025–26 has no played matches on record yet.");
  });
});
