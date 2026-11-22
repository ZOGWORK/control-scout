// The live follow-up child's heap limit (liveFollowUp.ts FOLLOW_UP_HEAP_MB): it's started with one, and a child that
// runs out of it runs once more without, so live results never stop on it; any other failure isn't run again.
import { afterEach, describe, expect, it, vi } from "vitest";
import { FOLLOW_UP_HEAP_MB, runFollowUpInChild, type ChildRunner } from "./liveFollowUp";

const job = { due: [{ season: 2026, code: "E1" }], records: [2026] };
const done = { done: { scored: 2, logged: 3 } };
const CAP = `--max-old-space-size=${FOLLOW_UP_HEAP_MB}`;

/** A stand-in runner: each start gets the next behaviour, and its Node flags are kept. */
function runner(...runs: ((send: (m: unknown) => void) => Promise<void>)[]) {
  const flags: string[][] = [];
  const run: ChildRunner = async (_script, _what, _timeout, execArgv = [], _args = [], o = {}) => {
    flags.push([...execArgv]);
    await runs[flags.length - 1]((m) => o.onMessage?.(m));
  };
  return { run, flags };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the live follow-up child's heap", () => {
  it("starts the child with the limit, after this process's own flags", async () => {
    const { run, flags } = runner(async (send) => send(done));
    await expect(runFollowUpInChild(job, {}, 1000, run)).resolves.toEqual(done.done);
    expect(flags).toHaveLength(1);
    expect(flags[0].at(-1)).toBe(CAP);
    expect(flags[0].slice(0, -1)).toEqual(process.execArgv);
  });

  it("runs once more without the limit when the child ran out of it (V8 aborts it: SIGABRT)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run, flags } = runner(
      async () => { throw new Error("live follow-up process exited with SIGABRT"); },
      async (send) => send(done),
    );
    await expect(runFollowUpInChild(job, {}, 1000, run)).resolves.toEqual(done.done);
    expect(flags).toHaveLength(2);
    expect(flags[0]).toContain(CAP);
    expect(flags[1]).not.toContain(CAP);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/ran out of its 1024 MB heap/));
  });

  it("doesn't run again on any other failure: the child's error comes through as it was", async () => {
    const { run, flags } = runner(async (send) => { send({ error: { message: "database is locked", code: "SQLITE_BUSY" } }); throw new Error("live follow-up process exited with code 1"); });
    await expect(runFollowUpInChild(job, {}, 1000, run)).rejects.toMatchObject({ message: "database is locked", code: "SQLITE_BUSY" });
    expect(flags).toHaveLength(1);
  });

  it("doesn't run again after a timeout (SIGKILL)", async () => {
    const { run, flags } = runner(async () => { throw new Error("live follow-up process exited with SIGKILL"); });
    await expect(runFollowUpInChild(job, {}, 1000, run)).rejects.toThrow(/SIGKILL/);
    expect(flags).toHaveLength(1);
  });
});
