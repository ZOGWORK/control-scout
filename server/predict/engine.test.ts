// Ratings after a sync: pages keep answering from the previous ratings while
// the new ones build, and a frozen season is read from the database once.
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import { kvSet, migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { forecasterFor, liveForecaster, liveVersion, refreshForecasters, resetForecasters } from "./engine";
import { runStats, statsRulesStale, STATS_RULES } from "../stats/job";

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

  it("a stats run (after every sync) keeps the previous ratings for pages", async () => {
    const first = await liveForecaster(S);
    await playedMatch(S, "NEWQ1", 2, [3, 4], [1, 2], [150, 40]);
    const job = runStats({ seasons: [S], backtest: false });
    await new Promise((r) => setTimeout(r, 0)); // the job has started (new data version, rebuilding)
    expect(await liveForecaster(S)).toBe(first); // pages: answered at once from the last finished ratings
    await job;
    expect(await liveForecaster(S)).not.toBe(first); // the job's rebuild took over
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

describe("bonus odds before an event (no hindsight)", () => {
  const flags = (i: number) => JSON.stringify({ movement: i % 2 === 0, goal: i % 5 === 0, pattern: i % 3 === 0 });
  /** `n` played qualification matches at a new event on `day` (YYYY-MM-DD), every alliance with recorded bonus RPs. */
  async function playedEvent(season: number, code: string, day: string, n: number) {
    await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 0, 0, 'test')", [season, code, code, day, day]);
    for (const t of [1, 2, 3, 4]) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [season, code, t]);
    for (let i = 1; i <= n; i++) {
      const r = 60 + (i * 37) % 120, b = 60 + (i * 53) % 120;
      await run(
        `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, red_bonus,
           blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, blue_bonus, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, 10, ?, 5, 0, ?, ?, ?, 10, ?, 5, 0, ?, 'test')`,
        [season, code, i, `Q${i}`, `${day}T${String(8 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00`, r, r, r - 15, flags(i), b, b, b - 15, flags(i + 1)],
      );
      for (const [alliance, ts] of [["red", i % 2 ? [1, 2] : [1, 3]], ["blue", i % 2 ? [3, 4] : [2, 4]]] as const) for (const t of ts)
        await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [season, code, i, t, alliance]);
    }
  }
  const target = (season: number) => ({
    season, code: "TARGET", type: "Qualifier", start: `${season}-12-01`, end: `${season}-12-01`,
    field: [1, 2, 3, 4].map((t) => ({ teamNumber: t, rank: null })), alliances: [],
    matches: [{ key: "qual:0:1", label: "Q1", level: "qual" as const, series: 0, number: 1, time: `${season}-12-01T10:00:00Z`, played: false, red: { teams: [{ number: 1 }, { number: 2 }], score: null }, blue: { teams: [{ number: 3 }, { number: 4 }], score: null } }],
  });

  it("learns only from results before the event, not later ones", async () => {
    await playedEvent(S, "EARLY", `${S}-11-20`, 110); // 220 alliances before TARGET
    await playedEvent(S, "LATE", `${S}-12-20`, 150); // 300 more after it
    await kvSet("data:version", "vb1");
    const f = await forecasterFor(S);
    const pre = f.preEventForecast(target(S) as never, null, 20)!;
    expect(pre.matches[0].bonus?.reason).toMatch(/only 220 alliance results/);
    // The current view learns from everything played.
    expect(f.bonusModel(S)?.samples).toBe(110 * 2 + 150 * 2); // NEWQ1 recorded no bonus RPs
  });

  it("shows none, rather than the shipped whole-season fit, when too little was played before", async () => {
    await playedEvent(2025, "LATE25", "2025-12-20", 150);
    await kvSet("data:version", "vb2");
    const f = await forecasterFor(2025);
    expect(f.preEventForecast(target(2025) as never, null, 20)!.matches[0].bonus ?? null).toBeNull();
  });
});

describe("Prediction Engine 2.0 in the app", () => {
  it("match explanations use the contextual win probability, with the match level", async () => {
    const f = await liveForecaster(S);
    const q = f.explain(S, [1, 3], [2, 4])!;
    expect(q.probabilityModel).toBe("contextual");
    expect(f.explain(S, [1, 3], [2, 4], "qual")!.winProbA).toBe(q.winProbA); // no level = qualification
    expect(f.explain(S, [1, 3], [2, 4], "playoff")!.winProbA).not.toBe(q.winProbA);
    expect(f.explain(S, [1, 3], [2, 4], "playoff")!.predictedScoreA).toBe(q.predictedScoreA); // scores unchanged
  });

  it("recorded bonus RPs of synced matches are available to live forecasts", async () => {
    await run("UPDATE matches SET red_bonus = ?, blue_bonus = ? WHERE season = ? AND code = 'NEWQ1' AND number = 1",
      [JSON.stringify({ movement: false, goal: true, pattern: true }), JSON.stringify({ movement: true, goal: false, pattern: false }), S]);
    await kvSet("data:version", "v3");
    const f = await forecasterFor(S);
    const recorded = (side: "red" | "blue") => (f as unknown as { recordedBonus(s: number, c: string, k: string, x: "red" | "blue"): unknown }).recordedBonus(S, "NEWQ1", "qual:0:1", side);
    expect(recorded("red")).toEqual({ movement: false, goal: true, pattern: true });
    expect(recorded("blue")).toEqual({ movement: true, goal: false, pattern: false });
    expect((f as unknown as { recordedBonus(s: number, c: string, k: string, x: "red" | "blue"): unknown }).recordedBonus(S, "NEWQ1", "qual:0:9", "red")).toBeNull();
  });
});

describe("engine upgrade marker", () => {
  it("a partial stats run after an engine change doesn't mark the upgrade done; a full run does", async () => {
    await kvSet("stats:rules", STATS_RULES);
    await kvSet("stats:engine", "1.1.0");
    expect(await statsRulesStale()).toBe(true);
    await runStats({ seasons: [S], backtest: false });
    expect(await statsRulesStale()).toBe(true); // only one season was recomputed
    await runStats({ backtest: false });
    expect(await statsRulesStale()).toBe(false);
  });
});
