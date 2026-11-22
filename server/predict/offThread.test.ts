// The forecaster's replay on the rebuild worker (offThread.ts, rebuildWorker.ts) gives exactly the forecaster the
// server's own thread built: same ratings, events, pair tables and calls, whether a part was sent or kept.
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { all, kvGet, kvSet, migrate, openDb, run, setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { ScoutForecaster, buildForecaster, forecasterFor, resetForecasters } from "./engine";
import { partnershipPrefix } from "./partnerships";
import { offThreadRebuilds, rebuildWorkerAlive, rebuildWorkerEntry, replayOffThread, replayOnThisThread, stopRebuildWorker } from "./offThread";
import { bigWindowDb, WINDOW } from "./__fixtures__/bigWindow";
import type { Client } from "@libsql/client";

const S = CURRENT_SEASON;
const FIELDS = ["books", "events", "stored", "advancement", "awardHistory", "regionByCode", "regions", "partnershipData", "pairTable", "pastPairTables", "partnershipComplete"] as const;
const fields = (f: ScoutForecaster) => f as unknown as Record<string, unknown>;

/** Field for field (class instances by their own properties and prototype), and the same calls. */
function expectSame(there: ScoutForecaster, here: ScoutForecaster) {
  for (const k of FIELDS) expect(fields(there)[k], k).toStrictEqual(fields(here)[k]);
  const teams = [...here.book(S - 1)!.ratings.keys()].slice(0, 24);
  for (let i = 0; i + 3 < teams.length; i += 4) for (const s of [S, S - 1]) {
    const [red, blue] = [teams.slice(i, i + 2), teams.slice(i + 2, i + 4)];
    expect(there.explain(s, red, blue, "qual", "E1")).toStrictEqual(here.explain(s, red, blue, "qual", "E1"));
  }
}

let window: { client: Client; close: () => void };
beforeAll(async () => {
  window = await bigWindowDb(60);
  await partnershipPrefix(WINDOW[0], { wait: true }); // the finished seasons' pair history, ready (kv) for both builds
}, 300_000);
beforeEach(() => { setDb(window.client); resetForecasters(); });
afterAll(() => { resetForecasters(); stopRebuildWorker(); window.close(); });

describe("the forecaster rebuilt on the worker", () => {
  it("is exactly the one the server's own thread builds", async () => {
    const runs = offThreadRebuilds();
    const there = await buildForecaster(S);
    expect(offThreadRebuilds()).toBe(runs + 1);
    const here = new ScoutForecaster(S);
    await here.rebuild();
    expectSame(there, here);
  }, 120_000);

  it("keeps an unchanged part (a frozen season's events) and takes in the changed one, the same as a fresh build", async () => {
    const first = await buildForecaster(S);
    await run("UPDATE matches SET red_auto = red_auto + 40, red_np = red_np + 40, red_total = red_total + 40 WHERE season = ? AND code = 'E3' AND number = 1", [S]);
    const second = await buildForecaster(S);
    // The frozen season's events weren't sent again (the same objects); the current season's were, with the change.
    expect(second.seasonEvents(S - 2)).toBe(first.seasonEvents(S - 2));
    expect(second.seasonEvents(S)).not.toBe(first.seasonEvents(S));
    const here = new ScoutForecaster(S);
    await here.rebuild();
    expectSame(second, here);
    expect(second.book(S)!.ratings).not.toStrictEqual(first.book(S)!.ratings);
  }, 120_000);

  it("pre-event forecasts come out the same", async () => {
    const there = await buildForecaster(S);
    const here = new ScoutForecaster(S);
    await here.rebuild();
    const ev = { ...there.seasonEvents(S)[5] };
    const input = {
      season: S, code: ev.code, type: ev.type, region: ev.region ?? null, start: ev.start,
      field: ev.teams.map((t) => ({ teamNumber: t, rank: null })), alliances: [],
      matches: ev.matches.map((m) => ({ level: m.level, series: m.series, number: m.number, played: true, red: { teams: m.red.teams, score: m.red.total }, blue: { teams: m.blue.teams, score: m.blue.total } })),
    };
    const call = (f: ScoutForecaster) => ({ ...f.preEventForecast(input as never, null, 200), generatedAt: null });
    expect(call(there)).toStrictEqual(call(here));
  }, 120_000);

  it("is rebuilt once the worker's pair history is ready, when it went ahead without it", async () => {
    // This test changes the shared database: the data version and a season row before the window. Both are put
    // back afterwards, so later tests never build from this test's stale pair-history prefix.
    const version = await kvGet<string>("data:version");
    const prefixKv = `partnership:prefix:${WINDOW[0]}`, prefix = await kvGet<unknown>(prefixKv);
    const older = await all<{ season: number; name: string; frozen: number; last_sync: string | null; last_complete: string | null }>("SELECT season, name, frozen, last_sync, last_complete FROM seasons WHERE season = ?", [WINDOW[0] - 1]);
    try {
      await kvSet("data:version", `pairs-${Date.now()}`);
      // A season before the window synced again: its pair history (the prefix) is stale everywhere, so the first
      // build goes ahead with the window's pairs only and the worker builds the history meanwhile.
      await run("INSERT OR REPLACE INTO seasons (season, name, frozen, last_sync) VALUES (?, 'older', 0, ?)", [WINDOW[0] - 1, new Date().toISOString()]);
      const first = await forecasterFor(S);
      expect(first.partnershipComplete).toBe(false);
      let f = first;
      for (let i = 0; i < 200 && !f.partnershipComplete; i++) { await new Promise((r) => setTimeout(r, 50)); f = await forecasterFor(S); }
      expect(f.partnershipComplete).toBe(true);
    } finally {
      // The worker may still be writing this test's prefix: stopped first, so nothing overwrites the restored one.
      await stopRebuildWorker();
      await run("DELETE FROM seasons WHERE season = ?", [WINDOW[0] - 1]);
      for (const r of older) await run("INSERT INTO seasons (season, name, frozen, last_sync, last_complete) VALUES (?, ?, ?, ?, ?)", [r.season, r.name, r.frozen, r.last_sync, r.last_complete]);
      await kvSet("data:version", version);
      // The worker stored a prefix built with that row: the one beforeAll left is put back.
      await kvSet(prefixKv, prefix);
      resetForecasters();
    }
  }, 120_000);
});

describe("a child script (replayOnThisThread)", () => {
  it("replays on its own thread with a database file the worker could open, and builds the same forecaster", async () => {
    const there = await buildForecaster(S);
    resetForecasters();
    replayOnThisThread();
    try {
      const runs = offThreadRebuilds();
      expect(await replayOffThread(S, WINDOW)).toBeNull();
      const here = await buildForecaster(S);
      expect(offThreadRebuilds()).toBe(runs);
      expectSame(there, here);
    } finally {
      replayOnThisThread(false);
    }
    // Put back, the next build goes to the worker again.
    const runs = offThreadRebuilds();
    await buildForecaster(S);
    expect(offThreadRebuilds()).toBe(runs + 1);
  }, 120_000);
});

describe("when the worker can't be used", () => {
  it("replays on this thread for a database in memory (no worker)", async () => {
    const c = openDb(":memory:");
    setDb(c);
    await migrate(c);
    const runs = offThreadRebuilds();
    expect(await replayOffThread(S, WINDOW)).toBeNull();
    const f = await buildForecaster(S);
    expect(offThreadRebuilds()).toBe(runs);
    expect(f.builtAt).not.toBeNull();
  });

  it("stops a worker that runs past its time, and the next build starts a new one", async () => {
    await expect(replayOffThread(S, WINDOW, 1)).rejects.toThrow(/took over/);
    expect(rebuildWorkerAlive()).toBe(false);
    const there = await buildForecaster(S);
    expect(rebuildWorkerAlive()).toBe(true);
    const here = new ScoutForecaster(S);
    await here.rebuild();
    expectSame(there, here);
  }, 120_000);
});

describe("rebuildWorkerEntry", () => {
  it("starts the bundled worker next to the server bundle, with no loader", () => {
    const e = rebuildWorkerEntry(pathToFileURL(join("/app", "build", "server", "index.mjs")).href, ["--enable-source-maps"]);
    expect(e.url.href).toBe(pathToFileURL(join("/app", "build", "server", "forecasterWorker.mjs")).href);
    expect(e.execArgv).toBeUndefined();
  });

  it("starts the TypeScript source through tsx from the source tree", () => {
    const e = rebuildWorkerEntry(pathToFileURL(join("/app", "server", "predict", "offThread.ts")).href, []);
    expect(e.url.href).toBe(pathToFileURL(join("/app", "server", "predict", "rebuildWorker.ts")).href);
    expect(e.execArgv).toEqual(["--import", "tsx"]);
  });
});
