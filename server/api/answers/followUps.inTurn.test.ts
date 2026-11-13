// The follow-ups' checks run one at a time, giving the event loop a turn between them (followUps.ts inTurn): the
// database never gives it back on its own, so 40 searches asked at once held every other request for seconds.
import { describe, expect, it } from "vitest";
import { inTurn } from "./followUps";

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
});
