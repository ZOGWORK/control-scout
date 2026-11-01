// The shared optimistic-change helper: shown before the answer, the server's copy taken when it comes, and a failure
// put back and reported ("Didn't save"), with only the newest change to a key deciding what shows.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../components/ui/sonner", () => ({ toast: { error: vi.fn() } }));
const { toast } = await import("../components/ui/sonner");
const { ApiError } = await import("./api");
const { didntSave, optimistic, resetOptimistic } = await import("./optimistic");

afterEach(() => { resetOptimistic(); vi.mocked(toast.error).mockClear(); });

/** A request answered when the test says. */
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

/** One value on "screen", changed by `set`. */
function screenValue<T>(v: T) {
  const s = { v };
  const set = (to: T) => () => { const was = s.v; s.v = to; return () => { s.v = was; }; };
  return { s, set };
}

describe("optimistic", () => {
  it("success: shows at once, before the answer, and keeps it", async () => {
    const { s, set } = screenValue("open");
    const req = deferred<{ status: string }>();
    const done = optimistic({ key: "a1", apply: set("done"), send: () => req.promise, what: "team 1 marked done" });
    expect(s.v).toBe("done"); // before any answer
    req.resolve({ status: "done" });
    expect(await done).toEqual({ ok: true, value: { status: "done" }, current: true });
    expect(s.v).toBe("done");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reconcile: the server's copy replaces the guess", async () => {
    const { s, set } = screenValue({ status: "open", version: 1 });
    const done = optimistic({
      key: "a1", apply: set({ status: "done", version: 1 }), send: async () => ({ status: "done", version: 2 }),
      reconcile: (r) => { s.v = r; }, what: "team 1 marked done",
    });
    expect(s.v).toEqual({ status: "done", version: 1 });
    await done;
    expect(s.v).toEqual({ status: "done", version: 2 });
  });

  it("failure: rolls back and says it didn't save", async () => {
    const { s, set } = screenValue("open");
    const report = vi.fn();
    const r = await optimistic({ key: "a1", apply: set("done"), send: async () => { throw new ApiError(500, "Server error"); }, what: "team 1 marked done", report });
    expect(r.ok).toBe(false);
    expect(s.v).toBe("open");
    expect(report).toHaveBeenCalledWith("Didn't save: team 1 marked done. Server error. It's back as it was.", expect.any(ApiError));
  });

  it("failure with no report given: an error toast", async () => {
    const { set } = screenValue(false);
    await optimistic({ key: "s1", apply: set(true), send: async () => { throw new ApiError(0, "Offline", true); }, what: "shared" });
    expect(toast.error).toHaveBeenCalledWith("Didn't save: shared. No connection reached the server. It's back as it was.");
  });

  it("sends a key's changes in order, one at a time", async () => {
    const { set } = screenValue("open");
    const order: string[] = [];
    const first = deferred<string>();
    const a = optimistic({ key: "a1", apply: set("done"), send: () => { order.push("done"); return first.promise; }, what: "x" });
    const b = optimistic({ key: "a1", apply: set("open"), send: async () => { order.push("open"); return "open"; }, what: "x" });
    await Promise.resolve();
    expect(order).toEqual(["done"]); // the second waits for the first's answer
    first.resolve("done");
    await Promise.all([a, b]);
    expect(order).toEqual(["done", "open"]);
  });

  it("an older change's answer never overwrites a newer change on screen", async () => {
    const { s, set } = screenValue("open");
    const reconcile = vi.fn((r: string) => { s.v = r; });
    const a = optimistic({ key: "a1", apply: set("done"), send: async () => "done", reconcile, what: "x" });
    const b = optimistic({ key: "a1", apply: set("open"), send: async () => "open", reconcile, what: "x" });
    expect((await a).current).toBe(false);
    expect(s.v).toBe("open");
    await b;
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(s.v).toBe("open");
  });

  it("a newer change that fails goes back to what the server last took, not to before both", async () => {
    const { s, set } = screenValue("open");
    const report = vi.fn();
    const a = optimistic({ key: "a1", apply: set("done"), send: async () => "done", reconcile: (r) => { s.v = r; }, what: "x" });
    const b = optimistic({ key: "a1", apply: set("open"), send: async () => { throw new Error("nope"); }, reconcile: (r) => { s.v = r; }, what: "reopened", report });
    await Promise.all([a, b]);
    expect(s.v).toBe("done");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("both fail: back to before the first, said once", async () => {
    const { s, set } = screenValue("open");
    const report = vi.fn();
    const fail = async () => { throw new Error("nope"); };
    await Promise.all([
      optimistic({ key: "a1", apply: set("done"), send: fail, what: "x", report }),
      optimistic({ key: "a1", apply: set("open"), send: fail, what: "x", report }),
      optimistic({ key: "a1", apply: set("done"), send: fail, what: "x", report }),
    ]);
    expect(s.v).toBe("open");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("keys are independent", async () => {
    const one = screenValue("open"), two = screenValue("open");
    await Promise.all([
      optimistic({ key: "a1", apply: one.set("done"), send: async () => { throw new Error("nope"); }, what: "x", report: () => {} }),
      optimistic({ key: "a2", apply: two.set("done"), send: async () => "done", what: "x" }),
    ]);
    expect(one.s.v).toBe("open");
    expect(two.s.v).toBe("done");
  });

  it("didntSave words a plain error and an unknown throw", () => {
    expect(didntSave("note", new Error("Too long"))).toBe("Didn't save: note. Too long. It's back as it was.");
    expect(didntSave("note", "??")).toBe("Didn't save: note. Something went wrong. It's back as it was.");
  });
});
