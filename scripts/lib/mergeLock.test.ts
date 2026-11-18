// The merge lock every merger to main takes (scripts/merge-lock.mjs): its message, who holds it, and when it's stale.
import { describe, expect, it } from "vitest";
import { LOCK_REF, LOCK_STALE_MS, lockMessage, lockStale, readLock } from "../merge-lock.mjs";

const NOW = Date.parse("2026-11-18T12:00:00Z");

describe("merge lock", () => {
  it("is one ref, outside branches and tags", () => {
    expect(LOCK_REF).toBe("locks/merge");
  });
  it("says who holds it, for which PR, since when", () => {
    const m = lockMessage("clip-autopilot", 1900, NOW);
    expect(m).toBe("merge lock 2026-11-18T12:00:00.000Z clip-autopilot #1900");
    expect(readLock(m)).toEqual({ at: NOW, holder: "clip-autopilot", pr: 1900 });
    expect(readLock(lockMessage("main-driver", 7, NOW))?.holder).toBe("main-driver");
  });
  it("is stale only past 45 min, or when its message isn't a lock's (it would block every merger forever)", () => {
    const m = lockMessage("main-driver", 1, NOW);
    expect(LOCK_STALE_MS).toBe(45 * 60_000);
    expect(lockStale(m, NOW + LOCK_STALE_MS)).toBe(false);
    expect(lockStale(m, NOW + LOCK_STALE_MS + 1)).toBe(true);
    for (const bad of ["", "hello", "merge lock yesterday main-driver #1", "merge lock 2026-11-18T12:00:00Z main-driver"]) expect(lockStale(bad, NOW)).toBe(true);
    expect(readLock("merge lock 2026-11-18T12:00:00Z main-driver")).toBeNull();
  });
});
