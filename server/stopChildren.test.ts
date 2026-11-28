// A stopping server's children (server/stopChildren.ts): ended at once, except a data cycle a zero-gap hand-off lets
// finish, capped; and the incoming lane can't start a second cycle while that one still holds the writer lease.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate, openDb, setDb } from "./db";
import { release, tryAcquire } from "./data/lock";
import { runCycle, type RunningChild } from "./data/cycle";
import { stopChildren } from "./stopChildren";

/** A child that exits `afterMs` after it starts, or as soon as it's stopped. */
function child(what: string, afterMs = Infinity): RunningChild & { stopped: number } {
  let exit!: () => void;
  const done = new Promise<void>((r) => { exit = r; });
  if (Number.isFinite(afterMs)) setTimeout(exit, afterMs);
  const c = { what, done, stopped: 0, stop: () => { c.stopped++; exit(); } };
  return c;
}

describe("stopping a server's children", () => {
  it("ends every child at once on an ordinary stop, a data cycle too", async () => {
    const cycle = child("data cycle"), live = child("live follow-up");
    const t0 = Date.now();
    await stopChildren([cycle, live], { finishCycle: false, log: () => {} });
    expect([cycle.stopped, live.stopped]).toEqual([1, 1]);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("in a hand-off, lets the data cycle finish and ends the others at once", async () => {
    const cycle = child("data cycle", 150), live = child("live follow-up");
    const logs: string[] = [];
    await stopChildren([cycle, live], { finishCycle: true, capMs: 5_000, log: (m) => logs.push(m) });
    expect(live.stopped).toBe(1);
    expect(cycle.stopped).toBe(0);
    expect(logs.join("\n")).toMatch(/letting the data cycle finish[\s\S]*the data cycle finished/);
  });

  it("ends a data cycle still running at the cap", async () => {
    const cycle = child("data cycle");
    const logs: string[] = [];
    const t0 = Date.now();
    await stopChildren([cycle], { finishCycle: true, capMs: 100, log: (m) => logs.push(m) });
    expect(cycle.stopped).toBe(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
    expect(logs.at(-1)).toMatch(/still ran after 0 s, ending it/);
  });

  it("exits anyway when a child ignores its stop", async () => {
    const stuck: RunningChild = { what: "pack build", done: new Promise(() => {}), stop: () => {} };
    const t0 = Date.now();
    await stopChildren([stuck], { finishCycle: false, log: () => {}, exitWaitMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe("the incoming lane while the outgoing lane's cycle finishes", () => {
  beforeAll(async () => { const c = openDb(":memory:"); setDb(c); await migrate(c); });
  afterAll(() => { vi.restoreAllMocks(); });

  it("never runs a second cycle beside it: the incoming lane's cycle waits for the writer lease", async () => {
    // The outgoing lane's child cycle holds the lease (data/lock.ts), as runCycle takes it.
    const held = await tryAcquire("cycle", 60_000);
    expect(held).toBeTruthy();
    const lines: [number, string][] = [];
    let released = 0;
    const second = runCycle((m) => lines.push([Date.now(), m]));
    await new Promise((r) => setTimeout(r, 2_500));
    // While the first holds the lease, nothing of the second has run: no sync, no stats, not a line.
    expect(lines).toEqual([]);
    released = Date.now();
    await release(held!);
    await second;
    // Once it's free, the second runs (every line after the release).
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every(([t]) => t >= released)).toBe(true);
  }, 120_000);
});
