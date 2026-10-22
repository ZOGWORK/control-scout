// The Web Worker protocol: run → progress… → done (the real count), cancel stops it quietly, the time cap
// reports what it managed, a broken input answers "error", and the same seed gives the same numbers.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deserializeInput, type FixtureEvent } from "../../../server/projections/fixture";
import { workerHandler, type FromWorker, type ToWorker } from "./protocol";

const fx = JSON.parse(readFileSync(join(__dirname, "../../../server/projections/__fixtures__/midpoint.json"), "utf8")) as { events: FixtureEvent[] };
const input = deserializeInput(fx.events.find((e) => e.code === "USTXHOCMP")!.input);
const run = (o: Partial<Extract<ToWorker, { type: "run" }>> = {}): ToWorker => ({ type: "run", id: 1, input, seed: 11, runs: 120, stopAtMs: Infinity, ...o });

/** A clock that moves 1 ms per reading: slices end after a fixed number of runs, whatever the machine. */
const ticking = () => { let t = 0; return () => t++; };

describe("worker protocol", () => {
  it("posts progress between slices, then done with the full count", async () => {
    const out: FromWorker[] = [];
    await workerHandler((m) => out.push(m), { clock: ticking(), sliceMs: 10, pause: () => Promise.resolve() })(run());
    const progress = out.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(2);
    for (let i = 1; i < progress.length; i++) expect((progress[i] as { done: number }).done).toBeGreaterThan((progress[i - 1] as { done: number }).done);
    const done = out.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type !== "done") return;
    expect(done.id).toBe(1);
    expect(done.result.runs).toBe(120);
    expect(done.result.stopped).toBe(false);
    expect(done.result.teams).toHaveLength(36);
  });

  it("the time cap ends the run early and reports the real count", async () => {
    const out: FromWorker[] = [];
    await workerHandler((m) => out.push(m), { clock: ticking(), sliceMs: 10, pause: () => Promise.resolve() })(run({ stopAtMs: 30 }));
    const done = out.at(-1)!;
    if (done.type !== "done") throw new Error(`expected done, got ${done.type}`);
    expect(done.result.stopped).toBe(true);
    expect(done.result.runs).toBeGreaterThan(0);
    expect(done.result.runs).toBeLessThan(120);
    // Every odd is over the runs actually made (a probability, never a share of the target).
    for (const t of done.result.teams) expect(t.pPlayoff).toBeLessThanOrEqual(1);
  });

  it("cancel stops a run at its next slice and posts nothing more", async () => {
    const out: FromWorker[] = [];
    let handle!: (m: ToWorker) => Promise<void>;
    handle = workerHandler((m) => { out.push(m); if (m.type === "progress") void handle({ type: "cancel", id: 1 }); }, { clock: ticking(), sliceMs: 5, pause: () => Promise.resolve() });
    await handle(run());
    expect(out.map((m) => m.type)).toEqual(["progress"]);
  });

  it("a broken input answers error", async () => {
    const out: FromWorker[] = [];
    await workerHandler((m) => out.push(m))(run({ input: { ...input, ratings: null as never } }));
    expect(out.at(-1)).toMatchObject({ type: "error", id: 1 });
  });

  it("the same seed gives the same numbers; another seed doesn't", async () => {
    const result = async (seed: number) => {
      let r: FromWorker | undefined;
      await workerHandler((m) => { r = m; }, { pause: () => Promise.resolve() })(run({ seed }));
      return r?.type === "done" ? r.result.teams : null;
    };
    const a = await result(5);
    expect(await result(5)).toEqual(a);
    expect(await result(6)).not.toEqual(a);
  });
});
