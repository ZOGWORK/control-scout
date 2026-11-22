// The data cycle child's heap limit (cycle.ts CYCLE_HEAP_MB, withHeapCap): started with it after this process's own
// flags; a child that runs out of it (V8 aborts it: SIGABRT) runs once more without; any other failure isn't run again.
import { afterEach, describe, expect, it, vi } from "vitest";
import { CYCLE_HEAP_MB, runCycleInChild, withHeapCap } from "./cycle";

const CAP = `--max-old-space-size=${CYCLE_HEAP_MB}`;

/** A stand-in runner: each start gets the next behaviour; its Node flags and script are kept. */
function runner(...runs: (() => Promise<void>)[]) {
  const starts: { script: string; flags: string[] }[] = [];
  const run = async (script: string, _what: string, _timeout: number, execArgv: readonly string[] = []) => {
    starts.push({ script, flags: [...execArgv] });
    await runs[starts.length - 1]();
  };
  return { run, starts };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("the data cycle child's heap", () => {
  it("starts scripts/data-cycle.ts with the limit, after this process's own flags", async () => {
    const { run, starts } = runner(async () => {});
    await runCycleInChild(1000, run);
    expect(starts).toHaveLength(1);
    expect(starts[0].script).toMatch(/scripts[\\/]data-cycle\.ts$/);
    expect(starts[0].flags).toEqual([...process.execArgv, CAP]);
  });

  it("runs once more without the limit when the child ran out of it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run, starts } = runner(async () => { throw new Error("data cycle process exited with SIGABRT"); }, async () => {});
    await runCycleInChild(1000, run);
    expect(starts.map((s) => s.flags.includes(CAP))).toEqual([true, false]);
    expect(console.warn).toHaveBeenCalledWith(`data cycle ran out of its ${CYCLE_HEAP_MB} MB heap: running it again without the limit`);
  });

  it("doesn't run again on a failure or a timeout (SIGKILL)", async () => {
    for (const message of ["data cycle process exited with code 1", "data cycle process exited with SIGKILL"]) {
      const { run, starts } = runner(async () => { throw new Error(message); });
      await expect(runCycleInChild(1000, run)).rejects.toThrow(message);
      expect(starts).toHaveLength(1);
    }
  });

  it("withHeapCap hands back the second run's result, and its failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    await expect(withHeapCap(64, "job", async () => { if (n++ === 0) throw new Error("job process exited with SIGABRT"); return 7; })).resolves.toBe(7);
    await expect(withHeapCap(64, "job", async () => { throw new Error("job process exited with SIGABRT"); })).rejects.toThrow(/SIGABRT/);
  });
});
