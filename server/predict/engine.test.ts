// Ratings after a sync: pages keep answering from the previous ratings while
// the new ones build, and a frozen season is read from the database once.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { forecasterFor, liveForecaster, liveVersion, refreshForecasters, resetForecasters } from "./engine";

const S = CURRENT_SEASON;

async function playedMatch(season: number, code: string, n: number, red: number[], blue: number[], score: [number, number]) {
  await run(
    `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
       blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, 10, ?, 5, 0, ?, ?, 10, ?, 5, 0, 'test')`,
    [season, code, n, `Q${n}`, `${season}-11-07T10:${String(n).padStart(2, "0")}:00`, score[0], score[0], score[0] - 15, score[1], score[1], score[1] - 15],
  );
  for (const [alliance, ts] of [["red", red], ["blue", blue]] as const) for (const t of ts)
    await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, n, t, alliance]);
}

async function event(season: number, code: string) {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 0, 0, 'test')", [season, code, code, `${season}-11-07`, `${season}-11-07`]);
  for (const t of [1, 2, 3, 4]) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [season, code, t]);
  await playedMatch(season, code, 1, [1, 2], [3, 4], [120, 60]);
}

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  resetForecasters();
  await event(S - 1, "OLDQ1");
  await run("INSERT OR REPLACE INTO seasons (season, name, frozen, last_complete) VALUES (?, 'old', 1, '2026-08-01')", [S - 1]);
  await event(S, "NEWQ1");
  await kvSet("data:version", "v1");
});

describe("ratings after a sync", () => {
  it("pages answer from the previous ratings while the new ones build, then switch", async () => {
    const first = await liveForecaster(S); // the first build is waited for
    expect(await liveVersion(S)).toBe("v1");
    await playedMatch(S, "NEWQ1", 2, [3, 4], [1, 2], [150, 40]);
    await kvSet("data:version", "v2");
    expect(await liveForecaster(S)).toBe(first); // no waiting: still the v1 ratings
    const fresh = await forecasterFor(S); // the background build
    expect(fresh).not.toBe(first);
    expect(await liveForecaster(S)).toBe(fresh);
    expect(await liveVersion(S)).toBe("v2");
  });

  it("refreshForecasters rebuilds only forecasters whose data moved on", async () => {
    const first = await liveForecaster(S);
    await refreshForecasters();
    expect(await liveForecaster(S)).toBe(first);
    await kvSet("data:version", "v2");
    await refreshForecasters();
    expect(await liveForecaster(S)).not.toBe(first);
  });

  it("reads a frozen season once; the current season every rebuild", async () => {
    const spy = vi.spyOn(db, "all");
    const reads = (season: number) => spy.mock.calls.filter(([sql, args]) => /FROM matches WHERE season/.test(String(sql)) && (args as unknown[])?.[0] === season).length;
    await forecasterFor(S);
    await kvSet("data:version", "v2");
    await forecasterFor(S);
    expect(reads(S - 1)).toBe(1);
    expect(reads(S)).toBe(2);
    spy.mockRestore();
  });
});
