// The live lane's follow-up (stats, records, live ledger, report cards, coin flips) stays off the web process's
// event loop where the data cycle runs in a child process (DATA_CYCLE=child): on the VM it held every request 12–13 s
// after a busy weekend's results. It runs in a child, the loop keeps turning meanwhile, and what it stores is what
// the in-process follow-up stores.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { all, kvGet, migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "./seasons";
import type { EventRow } from "./bundle";
import { liveIo, refreshEvents, resetLiveState } from "./live";
import { followUpRunsHere } from "./liveFollowUp";

const S = CURRENT_SEASON;
const CODE = "USTXFOLLOW";
const TEAMS = [301, 302, 303, 304, 305, 306];
const dirs: string[] = [];
const env = { DATABASE_URL: process.env.DATABASE_URL, DATA_CYCLE: process.env.DATA_CYCLE, LIVE_FOLLOW_UP: process.env.LIVE_FOLLOW_UP };
const realIo = { ...liveIo };

/** A fresh database file with one live event: six matches, four of them played. */
async function seeded(): Promise<{ url: string; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "cs-follow-"));
  dirs.push(dir);
  const url = `file:${join(dir, "scout.db").replace(/\\/g, "/")}`;
  const c = openDb(url);
  setDb(c);
  await migrate(c);
  const today = new Date().toISOString().slice(0, 10);
  await run("INSERT INTO events (season, code, name, type, start, end, timezone, remote, hybrid, source) VALUES (?, ?, ?, 'Qualifier', ?, ?, 'UTC', 0, 0, 'test')", [S, CODE, CODE, today, today]);
  for (const t of TEAMS) await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, CODE, t]);
  for (let n = 1; n <= 6; n++) {
    const played = n <= 4, red = 40 + n * 7, blue = 90 - n * 5;
    const time = new Date(Date.now() + (n - 4) * 3600_000).toISOString().slice(0, 19);
    await run(
      `INSERT INTO matches (season, code, level, series, number, label, time, played, red_total, red_np, red_auto, red_teleop, red_endgame, red_pen,
         blue_total, blue_np, blue_auto, blue_teleop, blue_endgame, blue_pen, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, ?, ?, ?, 10, ?, 5, 0, ?, ?, 10, ?, 5, 0, 'test')`,
      [S, CODE, n, `Q${n}`, time, played ? 1 : 0, played ? red : null, played ? red : null, played ? red - 15 : null, played ? blue : null, played ? blue : null, played ? blue - 15 : null],
    );
    const rot = [...TEAMS.slice(n % 6), ...TEAMS.slice(0, n % 6)];
    for (const [alliance, ts] of [["red", rot.slice(0, 2)], ["blue", rot.slice(2, 4)]] as const) for (const t of ts)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance) VALUES (?, ?, 'qual', 0, ?, ?, ?)", [S, CODE, n, t, alliance]);
  }
  process.env.DATABASE_URL = url;
  return { url, close: () => c.close() };
}

const event = (): EventRow => {
  const today = new Date().toISOString().slice(0, 10);
  return { season: S, code: CODE, name: CODE, type: "Qualifier", divisionCode: null, region: null, league: null, venue: null, city: null, state: null, country: null,
    start: today, end: today, timezone: "UTC", remote: false, hybrid: false, website: null, livestream: null, source: "first", upstreamUpdated: null };
};

/** What the follow-up stores, without the clock-dependent columns. */
async function stored() {
  return {
    events: await all("SELECT * FROM team_event_stats WHERE season = ? ORDER BY code, team", [S]),
    seasons: (await all<Record<string, unknown>>("SELECT * FROM team_season_stats WHERE season = ? ORDER BY team", [S])).map(({ updated_at: _u, ...r }) => r),
    settled: !!(await kvGet<string>("data:settled")),
    records: !!(await kvGet("records:last")),
  };
}

beforeAll(() => {
  liveIo.canProbe = () => false; // no FIRST: every refresh is a full fetch
  liveIo.fetch = async () => "first" as const; // the "fetch" stored nothing new: the rows above are the results
});
afterEach(() => {
  resetLiveState();
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});
afterAll(() => {
  Object.assign(liveIo, realIo);
  for (const d of dirs.splice(0)) try { rmSync(d, { recursive: true, force: true }); } catch { /* Windows may still hold it */ }
});

describe("the live lane's follow-up", () => {
  it("runs in a child process where the data cycle does, with the event loop free, storing what the in-process one stores", async () => {
    // In-process (a host without the child cycle): the reference.
    const inline = await seeded();
    const before = followUpRunsHere();
    const r1 = await refreshEvents([event()], { minFullMs: 0 });
    expect(r1.fetched).toEqual([CODE]);
    expect(followUpRunsHere()).toBe(before + 1);
    const want = await stored();
    expect(want.events.length).toBeGreaterThan(0);
    expect(want.settled && want.records).toBe(true);
    inline.close();

    // DATA_CYCLE=child: the same follow-up in a child process.
    resetLiveState();
    const child = await seeded();
    process.env.DATA_CYCLE = "child";
    let gap = 0, last = performance.now();
    const tick = setInterval(() => { const n = performance.now(); gap = Math.max(gap, n - last); last = n; }, 5);
    try {
      const r2 = await refreshEvents([event()], { minFullMs: 0 });
      await new Promise((r) => setTimeout(r, 30)); // the tick that measures a loop held until now
      expect(r2.fetched).toEqual([CODE]);
      expect(r2.failed).toEqual([]);
      expect(r2.scored).toBe(r1.scored);
      expect(r2.logged).toBe(r1.logged);
    } finally { clearInterval(tick); }
    // Never on the web process: none of the follow-up's work ran here.
    expect(followUpRunsHere()).toBe(before + 1);
    expect(await stored()).toEqual(want);
    // The child takes seconds to start; the loop never stood still meanwhile.
    expect(gap).toBeLessThan(400);
    child.close();
  }, 120_000);

  it("a failed follow-up in the child fails the refresh here and stays due for the next tick", async () => {
    const c = await seeded();
    process.env.DATA_CYCLE = "child";
    // The child can't open its database: nothing stored, the error comes back.
    process.env.DATABASE_URL = `file:${join(dirs[dirs.length - 1], "missing", "nope.db").replace(/\\/g, "/")}`;
    await expect(refreshEvents([event()], { minFullMs: 0 })).rejects.toThrow();
    expect(await kvGet("data:settled")).toBeNull();
    // Next tick (child back on its database): the event is still waiting, so its follow-up runs even with nothing new.
    process.env.DATABASE_URL = c.url;
    liveIo.fetch = async () => { throw new Error("FIRST down"); };
    try {
      const r = await refreshEvents([event()], { minFullMs: 0 });
      expect(r.failed.map((f) => f.code)).toEqual([CODE]);
      expect(await kvGet("data:settled")).not.toBeNull();
    } finally { liveIo.fetch = async () => "first" as const; }
    c.close();
  }, 120_000);
});
