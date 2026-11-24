// The follow-ups' checks run one at a time, giving the event loop a turn between them (followUps.ts inTurn): the
// database never gives it back on its own, so 40 searches asked at once held every other request for seconds.
import { describe, expect, it } from "vitest";
import { holdChecks, inTurn, inTurns } from "./followUps";

/** A search that holds the thread for its whole run, as one answered from the database does. */
const busy = (ms: number) => { const end = performance.now() + ms; while (performance.now() < end) { /* the database at work */ } };

describe("inTurn", () => {
  it("runs the calls one at a time, in the order they were made, each with its own result", async () => {
    const log: string[] = [];
    const f = inTurn(async (x: string) => { log.push(`start ${x}`); await Promise.resolve(); log.push(`end ${x}`); return x.toUpperCase(); });
    const out = await Promise.all(["a", "b", "c"].map((x) => f(x)));
    expect(out).toEqual(["A", "B", "C"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("lets other work in between: a timer due meanwhile runs before the next call, not after all of them", async () => {
    const log: string[] = [];
    const f = inTurn(async (x: number) => { busy(20); log.push(`search ${x}`); });
    const all = Promise.all([1, 2, 3, 4].map((x) => f(x)));
    setTimeout(() => log.push("other request"), 0);
    await all;
    expect(log.indexOf("other request")).toBeGreaterThan(-1);
    expect(log.indexOf("other request")).toBeLessThan(log.indexOf("search 4"));
  });

  it("goes on after a call that failed, and that call's caller sees the failure", async () => {
    const f = inTurn(async (x: number) => { if (x === 2) throw new Error("no"); return x; });
    const [a, b, c] = await Promise.allSettled([f(1), f(2), f(3)]);
    expect(a).toEqual({ status: "fulfilled", value: 1 });
    expect(b.status).toBe("rejected");
    expect(c).toEqual({ status: "fulfilled", value: 3 });
  });

  it("is one line for the whole process: two requests' checks made at once never run in the same turn of the loop", async () => {
    // A turn counter: a timer re-armed each turn of the loop. Each check notes the turn it ran in.
    let turn = 0, on = true;
    const tick = () => { turn++; if (on) setTimeout(tick, 0); };
    setTimeout(tick, 0);
    const ran: { who: string; turn: number }[] = [];
    const check = (who: string) => inTurns(async () => { busy(5); ran.push({ who, turn }); }, who[0]);
    // Two follow-up requests, each asking for its checks all at once (followUps.ts run), each in its own lane.
    await Promise.all([...["a1", "a2", "a3"].map(check), ...["b1", "b2", "b3"].map(check)]);
    on = false;
    expect(new Set(ran.map((r) => r.turn)).size).toBe(ran.length);
  });

  it("takes turns between lanes: a second search's first check runs next, not after the first's every check", async () => {
    const ran: string[] = [];
    const check = (who: string, later = false) => inTurns(async () => { ran.push(who); }, who[0], later);
    await Promise.all([...["a1", "a2", "a3", "a4"].map((x) => check(x)), ...["b1", "b2"].map((x) => check(x))]);
    expect(ran).toEqual(["a1", "b1", "a2", "b2", "a3", "a4"]);
  });

  it("runs `later` checks only once no lane has one that isn't", async () => {
    const ran: string[] = [];
    const check = (who: string, later = false) => inTurns(async () => { ran.push(who); }, who[0], later);
    await Promise.all([check("a-later", true), check("a1"), check("b1"), check("b-later", true), check("b2")]);
    expect(ran).toEqual(["a1", "b1", "b2", "a-later", "b-later"]);
  });

  it("a failed check is its caller's alone: the next goes on", async () => {
    const [x, y] = await Promise.allSettled([inTurns(async () => { throw new Error("no"); }, "x"), inTurns(async () => 2, "x")]);
    expect(x.status).toBe("rejected");
    expect(y).toEqual({ status: "fulfilled", value: 2 });
  });
  it("holds a search's checks while an answer is made, but never the answer's own (default lane)", async () => {
    const ran: string[] = [];
    const release = holdChecks();
    const follow = inTurns(async () => { ran.push("follow"); }, "f");
    const own = inTurns(async () => { ran.push("own"); });
    await own;
    expect(ran).toEqual(["own"]);
    release();
    release(); // twice is once
    await follow;
    expect(ran).toEqual(["own", "follow"]);
  });

  it("runs a held check anyway once its wait is up, so answers never starve the follow-ups", async () => {
    const release = holdChecks();
    const t = performance.now();
    await inTurns(async () => {}, "f");
    expect(performance.now() - t).toBeGreaterThanOrEqual(150);
    release();
  });
});
