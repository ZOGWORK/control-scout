// An event's average match score, or two events' side by side. Fixture events only; every phrasing is a rewording,
// never a logged query's words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { eventAverageAnswer, eventAverageTitle, eventsAsked, readEventAverage, type EventRow } from "./families/eventAverage";

describe("reading it", () => {
  it("one event or two, the frame and a trailing side by side dropped", () => {
    expect(readEventAverage("what is the avg alliance score at the Ohio Championship")).toEqual({ events: ["Ohio Championship"], season: null });
    expect(readEventAverage("Ohio Championship mean match score")).toMatchObject({ events: ["Ohio Championship"] });
    expect(readEventAverage("average scores at Ohio Championship compared to Texas Championship side by side?")).toEqual({ events: ["Ohio Championship", "Texas Championship"], season: null });
    expect(readEventAverage("average match score at Ohio Championship, vs TX Championship, 2024-25")).toEqual({ events: ["Ohio Championship", "TX Championship"], season: 2024 });
  });

  it("a team's own average, worlds and three events are never it", () => {
    expect(readEventAverage("12345 average score")).toBeNull();
    expect(readEventAverage("average score at worlds")).toBeNull();
    expect(readEventAverage("average score at A Cup vs B Cup vs C Cup")).toBeNull();
    expect(readEventAverage("12345 highest score")).toBeNull();
  });
});

describe("the answer", () => {
  const ev = (code: string, name: string): EventRow => ({ season: 2025, code, name, type: "Championship", start: "2026-03-01", division: null });
  const EVENTS: Record<string, EventRow> = { "ohio championship": ev("OH", "Ohio Championship"), "texas championship": ev("TX", "Texas Championship"), "utah championship": ev("UT", "Utah Championship") };
  const find = async (w: string) => EVENTS[w.toLowerCase()] ?? null;

  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, source) VALUES (2025, 'OH', 'Ohio Championship', 'Championship', 'test'), (2025, 'TX', 'Texas Championship', 'Championship', 'test'), (2025, 'TXD1', 'Texas Championship - Div 1', 'Championship', 'test'), (2025, 'UT', 'Utah Championship', 'Championship', 'test')");
    await run("UPDATE events SET division_code = 'TX' WHERE code = 'TXD1'");
    // code, number, red total, red np, blue total, blue np
    const ms: [string, number, number, number, number, number][] = [
      ["OH", 1, 100, 90, 80, 80], ["OH", 2, 120, 120, 100, 90], ["TXD1", 1, 200, 180, 160, 160], ["TX", 1, 140, 140, 100, 100],
    ];
    for (const [code, n, rt, rn, bt, bn] of ms) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, 'test')", [code, n, `Q${n}`, rt, rn, bt, bn]);
    }
    // Utah: one match with its scores without penalties, one with only its totals.
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, 'UT', 'qual', 0, 1, 'Q1', 1, 100, 90, 80, 70, 'test')");
    await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, blue_total, source) VALUES (2025, 'UT', 'qual', 0, 2, 'Q2', 1, 200, 160, 'test')");
    // Not played: never counted.
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'OH', 'qual', 0, 3, 'Q3', 0, 'test')");
  });

  it("one event: its mean alliance score, with and without penalties", async () => {
    const a = await eventAverageAnswer({ events: ["Ohio Championship"], season: null }, find);
    expect(a?.headline).toMatchObject({ value: "100.0 points", sub: expect.stringContaining("95.0 without penalties · 2 matches") });
  });

  it("an average without penalties over fewer matches says how many", async () => {
    const a = await eventAverageAnswer({ events: ["Utah Championship"], season: null }, find);
    expect(a?.headline?.sub).toContain("80.0 (1 of 2) without penalties · 2 matches");
    const kpis = a?.blocks.find((b) => b.kind === "kpis");
    expect(kpis && kpis.kind === "kpis" && kpis.items.find((i) => i.label === "Without penalties")).toMatchObject({ value: "80.0", sub: "1 of 2 matches" });
    const vs = await eventAverageAnswer({ events: ["Ohio Championship", "Utah Championship"], season: null }, find);
    const table = vs?.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => r.cells.np)).toEqual(["95.0", "80.0 (1 of 2)"]);
  });

  it("two events side by side, a division's matches counted for its event, the higher one leading", async () => {
    const a = await eventAverageAnswer({ events: ["Ohio Championship", "Texas Championship"], season: null }, find);
    expect(a?.intent).toBe("event-average-score-vs");
    expect(a?.headline).toMatchObject({ value: "+50.0 points", label: "Texas Championship averages more per alliance" });
    const table = a?.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => [r.cells.avg, r.cells.matches, r.strong])).toEqual([["100.0", 2, false], ["150.0", 2, true]]);
  });

  it("the search box's short answer names the events found, counting nothing", async () => {
    const evs = await eventsAsked({ events: ["Ohio Championship", "Texas Championship"], season: null }, find);
    expect(evs && eventAverageTitle(evs)).toBe("Average match score: Ohio Championship vs Texas Championship");
    const one = await eventsAsked({ events: ["Ohio Championship", "ohio championship"], season: null }, find);
    expect(one && eventAverageTitle(one)).toBe("Average match score at Ohio Championship, 2025–26");
  });

  it("an event not found leaves it to search", async () => {
    expect(await eventAverageAnswer({ events: ["Nowhere Cup"], season: null }, find)).toBeNull();
  });
});
