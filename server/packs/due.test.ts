// The pack build's cadence (packs/due.ts): on an event day the lite pack and the current season's are rebuilt as soon
// as a sync has brought new data (the sync runs every 15 minutes on the VM), any other day the whole set is rebuilt once
// a day, and anything missing or stale by engine rebuilds everything at once.
import { describe, expect, it } from "vitest";
import { PACKS_EVERY_MS, packsDue, type PackBuildState } from "./due";

const at = (iso: string) => Date.parse(iso);
const base = (over: Partial<PackBuildState> = {}): PackBuildState => ({
  lastBuiltAt: "2026-11-27T09:00:00.000Z",
  builtFrom: "v41",
  dataVersion: "v41",
  now: at("2026-11-27T09:15:00.000Z"),
  eventDay: true,
  present: true,
  packsEngine: "3.5.0",
  engine: "3.5.0",
  ...over,
});

describe("when the offline packs are rebuilt", () => {
  it("on an event day, as soon as the sync has brought new data, and only the current season's pack", () => {
    // The first cycle after a result came in: due, and the frozen seasons are carried instead of rebuilt.
    expect(packsDue(base({ dataVersion: "v42" }))).toEqual({ due: true, scope: "current" });
    // Nothing new since the last build (a cycle that found no results): nothing to do, however long ago it was.
    expect(packsDue(base({ now: at("2026-11-27T12:00:00.000Z") }))).toEqual({ due: false, scope: "current" });
    // A build that finished after this cycle started still counts as having the new data: the test is the version, not
    // a clock measured from the finish (which would have rebuilt only every second cycle).
    expect(packsDue(base({ lastBuiltAt: "2026-11-27T09:14:30.000Z", now: at("2026-11-27T09:15:00.000Z"), dataVersion: "v42" })))
      .toEqual({ due: true, scope: "current" });
    // Nothing recorded from the last build (packs built before this rule, or a stamp that couldn't be written): rebuild.
    expect(packsDue(base({ builtFrom: null }))).toEqual({ due: true, scope: "current" });
    expect(packsDue(base({ dataVersion: null }))).toEqual({ due: true, scope: "current" });
  });

  it("a result that lands while a build runs is still new data on the next cycle", () => {
    // The cycle reads the version before building and stamps that one; here the build was asked for v42 and v43 landed
    // while it ran, so the next cycle must rebuild the current season's pack rather than consider it packed.
    expect(packsDue(base({ builtFrom: "v41", dataVersion: "v42" }))).toEqual({ due: true, scope: "current" });
    expect(packsDue(base({ builtFrom: "v42", dataVersion: "v43" }))).toEqual({ due: true, scope: "current" });
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
});
