// A stopping server's schedule runs nothing more (server/stopping.ts); a request's own timers still do.
import { afterEach, describe, expect, it } from "vitest";
import { guardSchedule, markStopping, resetStopping, scheduleStarted } from "./stopping";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
afterEach(() => { resetStopping(); });

describe("the schedule once a server is stopping", () => {
  it("skips the schedule's timers, the ones they set too, and leaves a request's alone", async () => {
    const ran = { every: 0, later: 0, nested: 0, request: 0 };
    guardSchedule();
    const every = setInterval(() => { ran.every++; }, 20);
    setTimeout(() => { ran.later++; }, 150);
    // Like scheduleCycles: a one-off whose callback starts the regular ticks.
    setTimeout(() => { setInterval(() => { ran.nested++; }, 20).unref(); }, 10);
    scheduleStarted();
    await wait(80);
    expect(ran.every).toBeGreaterThan(0);
    expect(ran.nested).toBeGreaterThan(0);
    markStopping();
    // A request in progress at the stop: its timer was set outside the schedule.
    setTimeout(() => { ran.request++; }, 30);
    const before = { ...ran };
    await wait(200);
    expect(ran.every).toBe(before.every);
    expect(ran.nested).toBe(before.nested);
    expect(ran.later).toBe(0);
    expect(ran.request).toBe(1);
    clearInterval(every);
  });

  it("runs everything as before while serving", async () => {
    let n = 0;
    guardSchedule();
    const t = setInterval(() => { n++; }, 10);
    scheduleStarted();
    await wait(60);
    clearInterval(t);
    expect(n).toBeGreaterThan(1);
  });
});
