// Partnership memory on the server: the finished seasons' pair history is built
// once into kv, picked up by the forecaster, and shown with a prediction.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvGet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { partnershipPrefix, resetPartnerships } from "./partnerships";
import { forecasterFor, resetForecasters } from "./engine";
import { CURRENT_SEASON } from "../data/seasons";

let server: Server;
let base = "";

async function event(season: number, code: string, name: string, start: string, games: [number[], number, number[], number][]) {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 0, 0, 't')", [season, code, name, start, start]);
  let n = 0;
  for (const [red, rs, blue, bs] of games) {
    n++;
    await run(
      `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen, blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source)
       VALUES (?, ?, 'qual', 0, ?, ?, ?, 1, ?, ?, 10, ?, 10, 0, ?, ?, 10, ?, 10, 0, 't')`,
      [season, code, n, `Q${n}`, `${start}T10:${String(n).padStart(2, "0")}:00`, rs, rs, rs - 20, bs, bs, bs - 20],
    );
    for (const [side, ts] of [["red", red], ["blue", blue]] as const) {
      for (const t of ts) await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [season, code, n, t, side]);
    }
  }
}

beforeAll(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  resetPartnerships();
  resetForecasters();
  for (const s of [2021, 2022, 2023]) await run("INSERT OR REPLACE INTO seasons (season, name, frozen, last_complete) VALUES (?, 'G', 1, '2026-01-01')", [s]);
  // 2022 (history only): 11 and 12 play together twice and win big.
  await event(2022, "NJCMP", "NJ Championship", "2023-03-04", [
    [[11, 12], 150, [13, 14], 60], [[11, 12], 140, [15, 16], 70], [[13, 15], 80, [14, 16], 80],
  ]);
  // 2023: a season to rate and predict.
  await event(2023, "USQ1", "Qualifier One", "2023-11-04", [
    [[11, 13], 90, [12, 14], 80], [[11, 14], 95, [12, 13], 85], [[15, 16], 70, [11, 12], 120],
  ]);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server?.close(); });

describe("partnership memory (server)", () => {
  it("builds the finished seasons once into kv", async () => {
    const book = await partnershipPrefix(2023, { wait: true });
    expect(book?.together(11, 12)?.n).toBe(2);
    expect(book?.together(13, 15)?.n).toBe(1); // one match together: kept a season in case they meet again…
    expect(book?.toData().together.some((r) => r[0] === 13 && r[1] === 15)).toBe(false); // …but never shown
    const stored = await kvGet<{ key: string }>("partnership:prefix:2023");
    expect(stored?.key).toContain("2022:2026-01-01");
  });

  it("is rebuilt when a season it covers is synced again", async () => {
    await run("UPDATE seasons SET frozen = 0, last_sync = '2026-02-02' WHERE season = 2022");
    expect((await partnershipPrefix(2023, { wait: true }))?.together(11, 12)?.n).toBe(2);
    expect((await kvGet<{ key: string }>("partnership:prefix:2023"))?.key).toContain("2022:open:2026-02-02");
    await run("UPDATE seasons SET frozen = 1 WHERE season = 2022");
  });

  it("shows the strongest pair fact with a prediction, without moving the odds", async () => {
    await partnershipPrefix(2023, { wait: true }); // as the stats job does before the forecasters rebuild
    resetForecasters();
    const r =await (await fetch(`${base}/api/predict/match?season=2023&red=11,12&blue=15,16`)).json();
    expect(r.history?.kind).toBe("together");
    expect(r.history?.teams).toEqual([11, 12]);
    expect(r.history?.label).toMatch(/^11 and 12 have played 3 matches together \(3–0\).*best 120 at Qualifier One$/); // the latest season's best (different games never compare)
    expect(r.winProbRed).toBeGreaterThan(0);
    expect(r.winProbRed).toBeLessThan(1);
    const none = await (await fetch(`${base}/api/predict/match?season=2023&red=11,15&blue=13,99`)).json();
    expect(none.history?.kind ?? null).not.toBe("together");
  });

  it("rebuilds a forecaster that went without the older history once that history is ready", async () => {
    resetPartnerships();
    resetForecasters();
    await run("DELETE FROM kv WHERE key LIKE 'partnership:prefix:%'");
    const first = await forecasterFor(2023); // the prefix starts building in the background; no page waits for it
    expect(first.partnershipComplete).toBe(false);
    let f = first;
    for (let i = 0; i < 200 && !f.partnershipComplete; i++) { await new Promise((r) => setTimeout(r, 25)); f = await forecasterFor(2023); }
    expect(f.partnershipComplete).toBe(true);
    expect(f.explain(2023, [11, 12], [15, 16])?.partnership?.matches).toBe(3);
  });
});

describe("partnership memory on an earlier season of the window", () => {
  const now = CURRENT_SEASON, last = CURRENT_SEASON - 1;
  beforeAll(async () => {
    for (const x of [last, now]) await run("INSERT OR REPLACE INTO seasons (season, name, frozen, last_complete) VALUES (?, 'G', 0, NULL)", [x]);
    // Last season: 21 and 22 play together twice. This season: twice more, scoring higher.
    await event(last, "USP1", "Past Qualifier", `${last}-11-07`, [[[21, 22], 100, [23, 24], 50], [[21, 22], 110, [25, 26], 40], [[23, 25], 60, [24, 26], 60]]);
    await event(now, "USN1", "New Qualifier", `${now}-11-06`, [[[21, 22], 130, [23, 24], 60], [[21, 22], 140, [25, 26], 70], [[23, 25], 60, [24, 26], 60]]);
    await partnershipPrefix(now - 2, { wait: true });
    resetForecasters();
  });

  it("reads the pairs as they stood at that season's end (a later match never counts)", async () => {
    const r = await (await fetch(`${base}/api/predict/match?season=${last}&red=21,22&blue=23,24`)).json();
    expect(r.history?.kind).toBe("together");
    expect(r.history?.label).toMatch(/^21 and 22 have played 2 matches together \(2–0\).*best 110 at Past Qualifier$/);
  });

  it("leaves the current season's history as it was", async () => {
    const r = await (await fetch(`${base}/api/predict/match?season=${now}&red=21,22&blue=23,24`)).json();
    expect(r.history?.label).toMatch(/^21 and 22 have played 4 matches together \(4–0\).*best 140 at New Qualifier$/);
  });

  it("changes no served number (a reason only)", async () => {
    const f = await forecasterFor(last);
    const withHistory = f.explain(last, [21, 22], [23, 24]);
    expect(withHistory?.partnership?.matches).toBe(2);
    const tables = (f as any).pastPairTables;
    (f as any).pastPairTables = new Map();
    try {
      const without = f.explain(last, [21, 22], [23, 24]);
      expect(without?.partnership ?? null).toBeNull();
      const { partnership: _a, ...a } = withHistory!;
      const { partnership: _b, ...b } = without!;
      expect(a).toEqual(b);
    } finally { (f as any).pastPairTables = tables; }
  });
});
