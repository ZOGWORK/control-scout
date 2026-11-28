// The pack build's cadence (packs/due.ts): on an event day the lite pack is rebuilt as soon as a sync has brought new
// data (the sync runs every 15 minutes on the VM) and the current season's full pack at most hourly, catching up when
// it's behind; any other day the whole set is rebuilt once a day, and anything missing or stale by engine rebuilds
// everything at once.
import { describe, expect, it } from "vitest";
import { CURRENT_PACK_EVERY_MS, PACKS_EVERY_MS, onlySeasons, packsDue, type PackBuildState } from "./due";

const at = (iso: string) => Date.parse(iso);
const base = (over: Partial<PackBuildState> = {}): PackBuildState => ({
  lastBuiltAt: "2026-11-27T09:00:00.000Z",
  builtFrom: "v41",
  currentBuiltAt: "2026-11-27T09:00:00.000Z",
  currentFrom: "v41",
  dataVersion: "v41",
  now: at("2026-11-27T09:15:00.000Z"),
  eventDay: true,
  present: true,
  packsEngine: "3.5.0",
  engine: "3.5.0",
  ...over,
});

describe("when the offline packs are rebuilt", () => {
  it("on an event day, the lite pack as soon as the sync has brought new data, every full pack carried", () => {
    // The first cycle after a result came in, 15 minutes after the last build: the lite pack only.
    expect(packsDue(base({ dataVersion: "v42" }))).toEqual({ due: true, scope: "lite" });
    // Nothing new since the last build (a cycle that found no results): nothing to do, however long ago it was.
    expect(packsDue(base({ now: at("2026-11-27T12:00:00.000Z") }))).toEqual({ due: false, scope: "lite" });
    // A build that finished after this cycle started still counts as having the new data: the test is the version, not
    // a clock measured from the finish (which would have rebuilt only every second cycle).
    expect(packsDue(base({ lastBuiltAt: "2026-11-27T09:14:30.000Z", now: at("2026-11-27T09:15:00.000Z"), dataVersion: "v42" })))
      .toEqual({ due: true, scope: "lite" });
    // Nothing recorded from the last build (packs built before this rule, or a stamp that couldn't be written): rebuild.
    expect(packsDue(base({ builtFrom: null }))).toEqual({ due: true, scope: "lite" });
  });

  it("the current season's full pack follows at most hourly, and catches up within the hour with no more data", () => {
    // New data, the season's pack built 59 minutes ago: still carried.
    expect(packsDue(base({ builtFrom: "v45", dataVersion: "v46", now: at("2026-11-27T09:59:00.000Z") }))).toEqual({ due: true, scope: "lite" });
    // An hour since its build, and behind: rebuilt (with the lite pack).
    expect(packsDue(base({ builtFrom: "v45", dataVersion: "v46", now: at("2026-11-27T10:00:00.000Z") }))).toEqual({ due: true, scope: "current" });
    // The day's last result went into the lite pack, then nothing more came: the season's pack still catches up.
    expect(packsDue(base({ builtFrom: "v46", dataVersion: "v46", now: at("2026-11-27T10:00:00.000Z") }))).toEqual({ due: true, scope: "current" });
    // Up to date: nothing, however long ago it was built.
    expect(packsDue(base({ now: at("2026-11-27T18:00:00.000Z") }))).toEqual({ due: false, scope: "lite" });
    expect(CURRENT_PACK_EVERY_MS).toBe(60 * 60_000);
  });

  it("the season pack's stamps missing or unreadable (before this rule, or a build time in the future): rebuilt", () => {
    expect(packsDue(base({ currentBuiltAt: null, currentFrom: null }))).toEqual({ due: true, scope: "current" });
    expect(packsDue(base({ currentBuiltAt: undefined, currentFrom: undefined }))).toEqual({ due: true, scope: "current" });
    expect(packsDue(base({ currentFrom: null }))).toEqual({ due: false, scope: "lite" }); // built 15 min ago: waits for the hour
    expect(packsDue(base({ currentFrom: "v40", currentBuiltAt: "not a date" }))).toEqual({ due: true, scope: "current" });
    expect(packsDue(base({ currentFrom: "v40", currentBuiltAt: "2026-11-27T11:00:00.000Z" }))).toEqual({ due: true, scope: "current" });
    expect(packsDue(base({ dataVersion: null }))).toEqual({ due: true, scope: "lite" });
  });

  it("a result that lands while a build runs is still new data on the next cycle", () => {
    // The cycle reads the version before building and stamps that one; here the build was asked for v42 and v43 landed
    // while it ran, so the next cycle must rebuild the lite pack rather than consider it packed.
    expect(packsDue(base({ builtFrom: "v41", dataVersion: "v42" }))).toEqual({ due: true, scope: "lite" });
    expect(packsDue(base({ builtFrom: "v42", dataVersion: "v43" }))).toEqual({ due: true, scope: "lite" });
  });

  it("any other day, once a day, and every season's pack is rebuilt", () => {
    expect(packsDue(base({ eventDay: false, now: at("2026-11-28T07:59:00.000Z"), dataVersion: "v99" }))).toEqual({ due: false, scope: "all" });
    expect(packsDue(base({ eventDay: false, now: at("2026-11-28T08:00:00.000Z") }))).toEqual({ due: true, scope: "all" });
    expect(PACKS_EVERY_MS).toBe(23 * 3600_000);
  });

  it("rebuilds everything when nothing is built, a file is missing, or the engine moved", () => {
    expect(packsDue(base({ lastBuiltAt: null }))).toEqual({ due: true, scope: "all" });
    expect(packsDue(base({ lastBuiltAt: "not a date" }))).toEqual({ due: true, scope: "all" });
    expect(packsDue(base({ present: false }))).toEqual({ due: true, scope: "all" });
    // An imported database carries packs:last without the files, and a new engine's ratings carry state older packs lack.
    expect(packsDue(base({ packsEngine: "3.4.0" }))).toEqual({ due: true, scope: "all" });
    expect(packsDue(base({ packsEngine: null }))).toEqual({ due: true, scope: "all" });
  });

  it("each scope as the build's seasons: none rebuilt, the current one, or every one", () => {
    expect(onlySeasons("lite", 2026)).toEqual([]);
    expect(onlySeasons("current", 2026)).toEqual([2026]);
    expect(onlySeasons("all", 2026)).toBeNull();
  });
});
