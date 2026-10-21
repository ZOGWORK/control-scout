// Partnership memory on the server: the finished seasons' pair history is built
// once into kv, picked up by the forecaster, and shown with a prediction.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { kvGet, migrate, openDb, run, setDb } from "../db";
import { createApp } from "../app";
import { partnershipPrefix, resetPartnerships } from "./partnerships";
import { resetForecasters } from "./engine";

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
    expect(book?.together(13, 15)).toBeUndefined(); // one match together: pruned at the season's end
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
    expect(r.history?.label).toMatch(/^11 and 12 have played 3 matches together \(3–0\).*best 150 at NJ Championship \(2022–23\)$/);
    expect(r.winProbRed).toBeGreaterThan(0);
    expect(r.winProbRed).toBeLessThan(1);
    const none = await (await fetch(`${base}/api/predict/match?season=2023&red=11,15&blue=13,99`)).json();
    expect(none.history?.kind ?? null).not.toBe("together");
  });
});
