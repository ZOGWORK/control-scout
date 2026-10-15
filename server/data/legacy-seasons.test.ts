// 2019–2022 are history only: listed and browsable, never rated, predicted or
// backtested (replaying them would move every rating from 2023 on).
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { CURRENT_SEASON, PREDICT_SEASONS, SEASON_NUMBERS, isLegacy } from "./seasons";
import { ScoutForecaster } from "../predict/engine";
import { teamProfile, teamSeasons } from "../api/teams";

let server: Server;
let base = "";

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  await run("INSERT INTO teams (number, name) VALUES (100, 'Played 2022'), (200, 'Remote 2020'), (300, 'Registered only')");
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (2020, 'REM', 'Remote', 'Qualifier', '2021-03-06', '2021-03-11', 1, 0, 't'), (2021, 'UNR', 'Remote', 'Qualifier', '2022-01-06', '2022-01-06', 1, 0, 't')");
  await run("INSERT INTO event_teams (season, code, team, rank) VALUES (2020, 'REM', 200, 1), (2021, 'UNR', 200, NULL)"); // unranked: no-show
  await run("INSERT INTO team_seasons (season, team) VALUES (2021, 100), (2022, 100), (2024, 300), (2020, 200)");
  await run("INSERT INTO team_season_stats (season, team, matches, events) VALUES (2022, 100, 12, 2), (2024, 300, 0, 0)");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe("legacy seasons", () => {
  it("are held but never predicted", () => {
    expect(SEASON_NUMBERS).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(CURRENT_SEASON).toBe(2026);
    expect(PREDICT_SEASONS).toEqual([2023, 2024, 2025, 2026]);
    expect([2019, 2022, 2023].map(isLegacy)).toEqual([true, true, false]);
  });

  it("stay out of every rating window", () => {
    expect(new ScoutForecaster(2023).seasons).toEqual([2023]);
    expect(new ScoutForecaster(2024).seasons).toEqual([2023, 2024]);
    expect(new ScoutForecaster(2026).seasons).toEqual([2024, 2025, 2026]);
    expect(new ScoutForecaster(2021).seasons).toEqual([]);
  });

  it("team seasons: played (or ranked at a remote event), plus the current season; registration alone doesn't count", async () => {
    expect(await teamSeasons(100)).toEqual([2026, 2022]);
    expect(await teamSeasons(200)).toEqual([2026, 2020]);
    expect(await teamSeasons(300)).toEqual([2026]);
    expect(await teamProfile(999)).toBeNull(); // nothing on record: still a 404, the current season doesn't invent a team
    expect((await teamProfile(100))!.season).toBe(2022);
  });

  it("meta flags them; predict routes refuse them; browsing works", async () => {
    const meta = await (await fetch(`${base}/api/meta`)).json();
    expect(meta.seasons.map((s: { season: number; predictable: boolean }) => [s.season, s.predictable])).toEqual(SEASON_NUMBERS.map((s) => [s, s >= 2023]).reverse());
    for (const p of ["/api/predict/match?season=2021&red=100&blue=200", "/api/predict/upcoming?season=2019", "/api/predict/event?season=2022&code=REM", "/api/predict/partners?season=2020&code=REM&team=200"]) {
      const r = await fetch(base + p);
      expect(r.status, p).toBe(404);
      expect((await r.json()).error, p).toMatch(/history only/);
    }
    const ev = await fetch(`${base}/api/events/2020/REM`);
    expect(ev.status).toBe(200);
    expect((await ev.json()).forecastUnsupported).toMatch(/history/);
    expect((await fetch(`${base}/api/events?season=2019`)).status).toBe(200);
    expect((await fetch(`${base}/api/predict/match?season=2010&red=100&blue=200`)).status).toBe(404);
  });
});
