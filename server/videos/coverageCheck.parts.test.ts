// The clip coverage check's first pass after a deploy checks every event: it reads their matches a few events at a
// time (MATCH_ROWS_PART) and writes their rows a batch at a time (so the event loop turns between), and every event
// comes out as it would read alone.
import { beforeAll, describe, expect, it } from "vitest";
import { all, kvSet, migrate, openDb, run, setDb } from "../db";
import { forgetRecordings } from "./recordings";
import { currentSeason } from "../api/answers/season";
import { MATCH_ROWS_PART, eventMatchRows } from "./coverage";
import { checkClipCoverage } from "./coverageCheck";

const S = currentSeason();
const N = 2 * MATCH_ROWS_PART + 3 + 60; // several match-row parts, and more rows than one write batch
const code = (i: number) => `PART${String(i).padStart(3, "0")}`;

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO seasons (season, name) VALUES (?, 'Test')", [S]);
  for (let i = 0; i < N; i++) {
    await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, livestream, source) VALUES (?, ?, ?, 'Qualifier', '2026-03-07', '2026-03-07', 'UTC', 0, 0, ?, 'test')",
      [S, code(i), `Meet ${i}`, `https://www.youtube.com/watch?v=VIDEO${String(i).padStart(6, "0")}`]);
    for (let n = 1; n <= 2; n++) {
      await run("INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, blue_total, blue_np, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, 50, 50, 40, 40, 'test')",
        [S, code(i), n, `Q${n}`, `2026-03-07T1${n}:00:00.5`]);
      for (const [alliance, station, team] of [["red", 1, 100 + n], ["red", 2, 200 + n], ["blue", 1, 300 + n], ["blue", 2, 400 + i]] as const) {
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, station, dq) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, 0)", [S, code(i), n, team, alliance, station]);
      }
    }
  }
  await kvSet("data:version", "v1");
  forgetRecordings();
});

describe("clip coverage over many events", () => {
  it("reads every event's matches across parts exactly as it reads one event alone", async () => {
    const codes = Array.from({ length: N }, (_, i) => code(i));
    const together = await eventMatchRows(S, codes);
    expect(together.size).toBe(N);
    for (const c of codes) expect(together.get(c)).toEqual((await eventMatchRows(S, [c])).get(c));
    expect(together.get(code(7))!.map((m) => [m.label, m.teams])).toEqual([["Q1", [101, 201, 301, 407]], ["Q2", [102, 202, 302, 407]]]);
  });

  it("checks and writes every event, in batches", async () => {
    expect(await checkClipCoverage(() => {})).toBe(N);
    const rows = await all<{ code: string; played: number }>("SELECT code, played FROM clip_coverage WHERE season = ? ORDER BY code", [S]);
    expect(rows.map((r) => r.code)).toEqual(Array.from({ length: N }, (_, i) => code(i)));
    expect(rows.every((r) => Number(r.played) === 2)).toBe(true);
    // Nothing moved: nothing checked again.
    expect(await checkClipCoverage(() => {})).toBe(0);
  });
});
