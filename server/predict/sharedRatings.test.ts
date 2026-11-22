// Ratings shared between processes (sharedRatings.ts): a forecaster from a saved build is exactly the one a replay
// gives; a saved build is loaded instead of replayed, only for exactly what it was built from; a build in progress
// elsewhere is waited for, a dead or stale one taken over; incomplete or unreadable builds are never used.
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PartnershipTable, RatingBook } from "@control-scout/predict-engine";
import { setDb } from "../db";
import { CURRENT_SEASON } from "../data/seasons";
import { ScoutForecaster, replayWindow, resetForecasters, type ForecasterParts } from "./engine";
import { partnershipPrefix } from "./partnerships";
import { KEEP, buildFile, clearShared, loadBuild, saveBuild, shareDir, sharedCounts, sharedReplay } from "./sharedRatings";
import { bigWindowDb, WINDOW } from "./__fixtures__/bigWindow";
import type { Client } from "@libsql/client";

const S = CURRENT_SEASON;
const FIELDS = ["books", "events", "stored", "advancement", "awardHistory", "regionByCode", "regions", "partnershipData", "pairTable", "pastPairTables", "partnershipComplete"] as const;
const fields = (f: ScoutForecaster) => f as unknown as Record<string, unknown>;

let window: { client: Client; close: () => void };
let parts: ForecasterParts;
let dir = "";
beforeAll(async () => {
  window = await bigWindowDb(30);
  setDb(window.client);
  await partnershipPrefix(WINDOW[0], { wait: true });
  parts = await replayWindow(S, WINDOW);
}, 300_000);
beforeEach(() => { setDb(window.client); dir = mkdtempSync(join(tmpdir(), "cs-ratings-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
afterAll(() => { resetForecasters(); window.close(); });

describe("a saved build", () => {
  it("gives exactly the forecaster a replay gives, classes and calls included", async () => {
    expect(parts.partnershipComplete).toBe(true);
    const file = buildFile(dir, S, WINDOW, "v1");
    expect(saveBuild(file, S, parts)).toBe(true);
    const loaded = loadBuild(file)!;
    for (const b of loaded.books.values()) expect(b).toBeInstanceOf(RatingBook);
    expect(loaded.pairTable).toBeInstanceOf(PartnershipTable);
    for (const t of loaded.pastPairTables.values()) expect(t).toBeInstanceOf(PartnershipTable);
    const there = new ScoutForecaster(S), here = new ScoutForecaster(S);
    await there.install(loaded);
    await here.install(await replayWindow(S, WINDOW));
    for (const k of FIELDS) expect(fields(there)[k], k).toStrictEqual(fields(here)[k]);
    // The current season's ratings are grown to the moment a call is made (the engine's book.setTime(Date.now())):
    // the calls are compared at one frozen moment, so only what was built can differ.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    try {
      const teams = [...here.book(S - 1)!.ratings.keys()].slice(0, 24);
      for (let i = 0; i + 3 < teams.length; i += 4) for (const s of [S, S - 1]) {
        const [red, blue] = [teams.slice(i, i + 2), teams.slice(i + 2, i + 4)];
        expect(there.explain(s, red, blue, "qual", "E1")).toStrictEqual(here.explain(s, red, blue, "qual", "E1"));
      }
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);

  it("is never saved incomplete (the pair history not in yet)", () => {
    expect(saveBuild(buildFile(dir, S, WINDOW, "v1"), S, { ...parts, partnershipComplete: false })).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is removed when it can't be read, and reads as none", () => {
    const file = buildFile(dir, S, WINDOW, "v1");
    writeFileSync(file, "not a build");
    expect(loadBuild(file)).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it("is keyed by exactly what it was built from", () => {
    const a = buildFile(dir, S, WINDOW, "v1");
    expect(buildFile(dir, S, WINDOW, "v1")).toBe(a);
    expect(buildFile(dir, S, WINDOW, "v2")).not.toBe(a);
    expect(buildFile(dir, S, WINDOW.slice(1), "v1")).not.toBe(a);
    expect(buildFile(dir, S - 1, WINDOW, "v1")).not.toBe(a);
  });

  it("keeps only the newest KEEP per anchor", () => {
    for (let i = 0; i < KEEP + 2; i++) {
      const f = buildFile(dir, S, WINDOW, `v${i}`);
      saveBuild(f, S, parts);
      utimesSync(f, new Date(Date.now() - (KEEP + 2 - i) * 1000), new Date(Date.now() - (KEEP + 2 - i) * 1000));
    }
    saveBuild(buildFile(dir, S, WINDOW, "newest"), S, parts);
    const left = readdirSync(dir).filter((f) => f.endsWith(".v8"));
    expect(left).toHaveLength(KEEP);
    expect(left).toContain(buildFile(dir, S, WINDOW, "newest").split(/[\\/]/).pop());
  });
});

describe("sharedReplay", () => {
  it("replays and saves the first time, then loads instead of replaying", async () => {
    const replay = vi.fn(async () => parts);
    const before = sharedCounts();
    await sharedReplay(S, WINDOW, "v1", replay, { dir });
    const second = await sharedReplay(S, WINDOW, "v1", replay, { dir });
    expect(replay).toHaveBeenCalledTimes(1);
    expect(second.books.get(S)).toBeInstanceOf(RatingBook);
    const after = sharedCounts();
    expect([after.built - before.built, after.saved - before.saved, after.loaded - before.loaded]).toEqual([1, 1, 1]);
    // Another data version: replayed again.
    await sharedReplay(S, WINDOW, "v2", replay, { dir });
    expect(replay).toHaveBeenCalledTimes(2);
  });

  it("waits for another live process's build of the same version instead of replaying it too", async () => {
    const file = buildFile(dir, S, WINDOW, "v1");
    writeFileSync(`${file}.building`, String(process.pid)); // held by a live process (this one)
    setTimeout(() => saveBuild(file, S, parts), 400);
    const replay = vi.fn(async () => parts);
    const p = await sharedReplay(S, WINDOW, "v1", replay, { dir, waitMs: 10_000 });
    expect(replay).not.toHaveBeenCalled();
    expect(p.books.get(S)).toBeInstanceOf(RatingBook);
  });

  it("holds the lock with its own pid in it from the moment it exists, with nothing left beside it", async () => {
    const file = buildFile(dir, S, WINDOW, "v1"), lock = `${file}.building`;
    let during = "";
    const replay = vi.fn(async () => { during = readFileSync(lock, "utf8"); expect(readdirSync(dir).filter((f) => f.includes(".building"))).toEqual([lock.split(/[\\/]/).pop()]); return parts; });
    await sharedReplay(S, WINDOW, "v1", replay, { dir });
    expect(during).toBe(String(process.pid));
    expect(readdirSync(dir).filter((f) => f.includes(".building"))).toEqual([]);
  });

  it("waits on a lock just made with no pid yet, instead of taking it over", async () => {
    const file = buildFile(dir, S, WINDOW, "v1");
    writeFileSync(`${file}.building`, "");
    setTimeout(() => saveBuild(file, S, parts), 400);
    const replay = vi.fn(async () => parts);
    await sharedReplay(S, WINDOW, "v1", replay, { dir, waitMs: 10_000 });
    expect(replay).not.toHaveBeenCalled();
  });

  it("takes over a build whose process is gone", async () => {
    const file = buildFile(dir, S, WINDOW, "v1");
    writeFileSync(`${file}.building`, "999999999");
    const replay = vi.fn(async () => parts);
    await sharedReplay(S, WINDOW, "v1", replay, { dir, waitMs: 10_000 });
    expect(replay).toHaveBeenCalledTimes(1);
    expect(readdirSync(dir).filter((f) => f.endsWith(".building"))).toEqual([]);
    expect(loadBuild(file)).not.toBeNull();
  });

  it("replays here, saving nothing, when sharing is off", async () => {
    const replay = vi.fn(async () => parts);
    await sharedReplay(S, WINDOW, "v1", replay, { dir: null });
    await sharedReplay(S, WINDOW, "v1", replay, { dir: null });
    expect(replay).toHaveBeenCalledTimes(2);
  });
});

describe("where builds are shared", () => {
  it("is off outside production unless a directory is set, and RATINGS_SHARE=off turns it off", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("RATINGS_SHARE_DIR", "");
    expect(shareDir()).toBeNull();
    vi.stubEnv("RATINGS_SHARE_DIR", dir);
    expect(shareDir()).toBe(dir);
    vi.stubEnv("RATINGS_SHARE", "off");
    expect(shareDir()).toBeNull();
  });

  it("is emptied by Clear caches (clearShared)", () => {
    vi.stubEnv("RATINGS_SHARE_DIR", dir);
    saveBuild(buildFile(dir, S, WINDOW, "v1"), S, parts);
    clearShared();
    expect(readdirSync(dir)).toEqual([]);
  });
});
