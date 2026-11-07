// An event's average match score, or two events' side by side. Fixture events only; every phrasing is a rewording,
// never a logged query's words.
import { beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../../db";
import { eventAverageAnswer, readEventAverage, type EventRow } from "./families/eventAverage";

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
  const EVENTS: Record<string, EventRow> = { "ohio championship": ev("OH", "Ohio Championship"), "texas championship": ev("TX", "Texas Championship") };
  const find = async (w: string) => EVENTS[w.toLowerCase()] ?? null;

  beforeAll(async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    await run("INSERT INTO events (season, code, name, type, source) VALUES (2025, 'OH', 'Ohio Championship', 'Championship', 'test'), (2025, 'TX', 'Texas Championship', 'Championship', 'test'), (2025, 'TXD1', 'Texas Championship - Div 1', 'Championship', 'test')");
    await run("UPDATE events SET division_code = 'TX' WHERE code = 'TXD1'");
    // code, number, red total, red np, blue total, blue np
    const ms: [string, number, number, number, number, number][] = [
      ["OH", 1, 100, 90, 80, 80], ["OH", 2, 120, 120, 100, 90], ["TXD1", 1, 200, 180, 160, 160], ["TX", 1, 140, 140, 100, 100],
    ];
    for (const [code, n, rt, rn, bt, bn] of ms) {
      await run("INSERT INTO matches (season, code, level, series, number, label, played, red_total, red_np, blue_total, blue_np, source) VALUES (2025, ?, 'qual', 0, ?, ?, 1, ?, ?, ?, ?, 'test')", [code, n, `Q${n}`, rt, rn, bt, bn]);
    }
    // Not played: never counted.
    await run("INSERT INTO matches (season, code, level, series, number, label, played, source) VALUES (2025, 'OH', 'qual', 0, 3, 'Q3', 0, 'test')");
  });

  it("one event: its mean alliance score, with and without penalties", async () => {
    const a = await eventAverageAnswer({ events: ["Ohio Championship"], season: null }, find);
    expect(a?.headline).toMatchObject({ value: "100.0 points", sub: expect.stringContaining("95.0 without penalties · 2 matches") });
  });

  it("two events side by side, a division's matches counted for its event, the higher one leading", async () => {
    const a = await eventAverageAnswer({ events: ["Ohio Championship", "Texas Championship"], season: null }, find);
    expect(a?.intent).toBe("event-average-score-vs");
    expect(a?.headline).toMatchObject({ value: "+50.0 points", label: "Texas Championship averages more per alliance" });
    const table = a?.blocks.find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows.map((r) => [r.cells.avg, r.cells.matches, r.strong])).toEqual([["100.0", 2, false], ["150.0", 2, true]]);
  });

  it("an event not found leaves it to search", async () => {
    expect(await eventAverageAnswer({ events: ["Nowhere Cup"], season: null }, find)).toBeNull();
  });
});
