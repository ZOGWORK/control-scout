// A new process's warm-up: every step timed in the log, then the whole; a failure never stops the others; held for at
// most the cap (well under nginx's proxy_read_timeout), the rest going on in the background; no cap waits for all.
import { afterEach, describe, expect, it, vi } from "vitest";
import { STARTUP_CYCLE_MS, WARM_CAP_MS, scheduleCycles, warmUp } from "./warm";

afterEach(() => vi.useRealTimers());
const after = (ms: number, fail = false) => () => new Promise<void>((ok, no) => setTimeout(() => (fail ? no(new Error("no data")) : ok()), ms));

describe("boot warm-up", () => {
  it("times each step and the whole, a failure logged without stopping the others", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const run = warmUp([["names", after(1200)], ["spelling", after(3400)], ["ratings", after(500, true)]], (m) => log.push(m), 20_000);
    await vi.advanceTimersByTimeAsync(3400);
    const r = await run;
    expect(r.inTime).toBe(true);
    expect(log).toEqual(["warm: ratings failed after 0.5s: no data", "warm: names 1.2s", "warm: spelling 3.4s", "warm in 3.4s"]);
  });

  it("answers after the cap, says so, and logs the rest when they're done", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const run = warmUp([["index", after(1000)], ["rebuild", after(30_000)]], (m) => log.push(m), 20_000);
    await vi.advanceTimersByTimeAsync(20_000);
    const r = await run;
    expect(r.inTime).toBe(false);
    expect(log).toEqual(["warm: index 1.0s", "warm: still going after 20.0s, answering anyway (the rest goes on in the background)"]);
    let settled = false;
    void r.settled.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(settled).toBe(true);
    expect(log.slice(2)).toEqual(["warm: rebuild 30.0s", "warm in 30.0s (after answering)"]);
  });

  it("with no cap, waits for every step, under its own label", async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    const run = warmUp([["ratings", after(25_000)]], (m) => log.push(m), Infinity, Date.now, "warm (background)");
    await vi.advanceTimersByTimeAsync(25_000);
    expect((await run).inTime).toBe(true);
    expect(log).toEqual(["warm (background): ratings 25.0s", "warm (background) in 25.0s"]);
  });

  it("holds requests well under nginx's 60 s read timeout, and starts the first data cycle minutes after", () => {
    expect(WARM_CAP_MS).toBeLessThanOrEqual(30_000);
    expect(STARTUP_CYCLE_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });
});

describe("the data cycle's schedule after a restart", () => {
  const run = (eventDay: boolean, backfill: boolean) => {
    const cycles: [number, string][] = [];
    const stop = scheduleCycles({ cycle: (r) => cycles.push([Date.now(), r]), eventDay: async () => eventDay, backfillDue: async () => backfill, eventDayMinutes: 15 });
    return { cycles, stop };
  };

  it("starts no cycle, not even a backfill, before the startup one, then one at ten minutes", async () => {
    vi.useFakeTimers({ now: 0 });
    const { cycles, stop } = run(true, true);
    await vi.advanceTimersByTimeAsync(STARTUP_CYCLE_MS - 1);
    expect(cycles).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(cycles).toEqual([[STARTUP_CYCLE_MS, "startup"]]);
    stop();
  });

  it("then keeps the regular schedule, never a second cycle at once", async () => {
    vi.useFakeTimers({ now: 0 });
    const { cycles, stop } = run(true, false);
    await vi.advanceTimersByTimeAsync(STARTUP_CYCLE_MS + 5 * 60_000);
    // The first tick after the startup cycle (5 minutes on): the event-day gap (15 minutes) hasn't passed.
    expect(cycles.map(([, r]) => r)).toEqual(["startup"]);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(cycles.map(([, r]) => r)).toEqual(["startup", "every 15 min, event day"]);
    expect(cycles[1][0] - cycles[0][0]).toBe(15 * 60_000);
    stop();
  });

  it("backfills between regular cycles once the startup one has run", async () => {
    vi.useFakeTimers({ now: 0 });
    const { cycles, stop } = run(false, true);
    await vi.advanceTimersByTimeAsync(STARTUP_CYCLE_MS + 5 * 60_000);
    expect(cycles.map(([, r]) => r)).toEqual(["startup", "backfill"]);
    stop();
  });
});
