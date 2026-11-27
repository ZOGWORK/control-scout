// The pack build's cadence (packs/due.ts): on an event day the lite pack and the current season's follow the sync
// (15 minutes on the VM), any other day the whole set is rebuilt once a day, and anything missing or stale by engine
// rebuilds everything at once.
import { describe, expect, it } from "vitest";
import { PACKS_EVERY_MS, packsDue, type PackBuildState } from "./due";

const at = (iso: string) => Date.parse(iso);
const base = (over: Partial<PackBuildState> = {}): PackBuildState => ({
  lastBuiltAt: "2026-11-27T09:00:00.000Z",
  now: at("2026-11-27T09:15:00.000Z"),
  eventDay: true,
  eventDayMinutes: 15,
  present: true,
  packsEngine: "3.5.0",
  engine: "3.5.0",
  ...over,
});

describe("when the offline packs are rebuilt", () => {
  it("on an event day, at the sync's pace, and only the current season's pack is rebuilt", () => {
    // The first sync after the last build went in: due, and the frozen seasons are carried instead of rebuilt.
    expect(packsDue(base())).toEqual({ due: true, scope: "current" });
    // Half a sync later: the pack that exists is this morning's build, and nothing has changed since it.
    expect(packsDue(base({ now: at("2026-11-27T09:14:00.000Z") }))).toEqual({ due: false, scope: "current" });
    // A slower event-day interval (60 in-process, the Render default): the same build waits for it.
    expect(packsDue(base({ eventDayMinutes: 60, now: at("2026-11-27T09:45:00.000Z") }))).toEqual({ due: false, scope: "current" });
    expect(packsDue(base({ eventDayMinutes: 60, now: at("2026-11-27T10:00:00.000Z") }))).toEqual({ due: true, scope: "current" });
    // EVENT_DAY_SYNC_MINUTES=0 or nonsense never means "build every second": one minute at the least.
    expect(packsDue(base({ eventDayMinutes: 0, now: at("2026-11-27T09:15:00.000Z") }))).toEqual({ due: true, scope: "current" });
  });

  it("any other day, once a day, and every season's pack is rebuilt", () => {
    expect(packsDue(base({ eventDay: false, now: at("2026-11-28T07:59:00.000Z") }))).toEqual({ due: false, scope: "all" });
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
