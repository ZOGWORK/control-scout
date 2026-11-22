// Long GC pauses are named in the log (server/gcPauses.ts); short ones never are.
import { constants } from "node:perf_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { PAUSE_LOG_MS, pauseLine, stopWatchingGcPauses, watchGcPauses } from "./gcPauses";

const MB = 1048576;
afterEach(() => stopWatchingGcPauses());

describe("pauseLine", () => {
  it("names a long pause: its kind, length, and the heap after it", () => {
    expect(pauseLine({ duration: 2373.4, detail: { kind: constants.NODE_PERFORMANCE_GC_MAJOR } }, { used: 2210 * MB, limit: 4144 * MB }))
      .toBe("gc: major 2,373 ms, heap 2,210 of 4,144 MB after");
    expect(pauseLine({ duration: 300, detail: { kind: constants.NODE_PERFORMANCE_GC_MINOR } }, { used: 90 * MB, limit: 4144 * MB }))
      .toBe("gc: minor 300 ms, heap 90 of 4,144 MB after");
    expect(pauseLine({ duration: 400 }, { used: 1 * MB, limit: 2 * MB })).toBe("gc: gc 400 ms, heap 1 of 2 MB after");
  });

  it("says nothing of a pause shorter than PAUSE_LOG_MS", () => {
    expect(pauseLine({ duration: PAUSE_LOG_MS - 0.1, detail: { kind: constants.NODE_PERFORMANCE_GC_MAJOR } }, { used: MB, limit: MB })).toBeNull();
    expect(pauseLine({ duration: PAUSE_LOG_MS }, { used: MB, limit: MB })).not.toBeNull();
  });
});

describe("watchGcPauses", () => {
  it("starts once a process, and the ordinary collections of a busy test log nothing", async () => {
    const lines: string[] = [];
    watchGcPauses((s) => lines.push(s));
    watchGcPauses((s) => lines.push(`second: ${s}`));
    let junk: unknown[] = [];
    for (let i = 0; i < 200_000; i++) junk.push({ i, s: `x${i}` });
    junk = [];
    await new Promise((r) => setTimeout(r, 20));
    expect(lines.filter((l) => l.startsWith("second:"))).toEqual([]);
    expect(lines.every((l) => /^gc: \w+ [\d,]+ ms, heap [\d,]+ of [\d,]+ MB after$/.test(l))).toBe(true);
    expect(junk).toEqual([]);
  });
});
