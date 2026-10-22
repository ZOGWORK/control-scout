// The local estimate on the page's side: its input comes from the packs the way the server builds its own
// (official slots, already-qualified teams, recorded bonus RPs, no result learned twice), its seed is the
// server's for the same results state, the same state never simulates twice, and leaving cancels the worker.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { projectionSeed } from "../../shared/projectionCore";
import { inputKey } from "../../../server/projections/state";
import { projectionInput } from "../../shared/projectionInput";
import { toEventInput } from "../../shared/eventInput";
import type { SeasonDb } from "../offline/readers";
import type { LiteLearned } from "../../shared/liteLearned";
import { PackForecaster, readPackFacts } from "./forecaster";
import { LOCAL_RUNS, workerHandler, type FromWorker, type ToWorker } from "./protocol";
import { cacheKey, localProjection, prepareLocal, ratingsLearned, resetLocalCache, runInWorker, type Prepared } from "./run";
import { CODE, S, book, deps as packDeps, detail as packDetail, lite, seasonPack } from "./testPack";

let sdb: SeasonDb;
beforeAll(async () => { sdb = await seasonPack(); });
const detail = () => packDetail(sdb);
const deps = (o: Parameters<typeof packDeps>[1] = {}) => packDeps(sdb, o);

/** A stand-in Worker that runs the real message handler in this thread. */
function fakeWorker(log: ToWorker[] = []) {
  let terminated = false;
  const listeners: ((e: { data: FromWorker }) => void)[] = [];
  const handle = workerHandler((m) => { if (!terminated) for (const l of listeners) l({ data: m }); }, { pause: () => new Promise((r) => setTimeout(r, 0)), sliceMs: 1 });
  return {
    get terminated() { return terminated; },
    postMessage: (m: ToWorker) => { log.push(m); void handle(m); },
    terminate: () => { terminated = true; },
    addEventListener: (type: string, fn: (e: any) => void) => { if (type === "message") listeners.push(fn); },
  };
}

describe("the local estimate's input", () => {
  it("reads the event's facts from the season pack the way the server stores them", () => {
    const f = readPackFacts(sdb.db, S, CODE);
    expect([...f.storedKeys].sort()).toEqual(["qual:0:1", "qual:0:2"]);
    expect(f.recordedBonus.get("qual:0:1|red")).toEqual({ movement: true, goal: false, pattern: true });
    expect(f.recordedBonus.has("qual:0:2|red")).toBe(false);
    expect(f.advancement.get(S)?.[0]).toMatchObject({ code: CODE, region: "USNJ", advancement: { slots: 3, advancesTo: "USNJCMP" } });
    expect(f.regions.get(CODE)).toBe("USNJ");
  });

  it("is the engine's own input: official slots, already-qualified and ineligible teams, recorded bonus RPs kept", async () => {
    const p = (await prepareLocal(detail(), deps())) as Prepared;
    expect(p.slots).toBe(3);
    expect(p.slotsSource).toBe("official");
    expect([...p.input.prequalified]).toEqual([104]);
    expect([...(p.input.ineligible ?? [])]).toEqual([108]);
    expect(p.stage).toBe("live");
    expect([p.played, p.scheduled, p.through]).toEqual([2, 4, "Q2"]);
    expect(p.input.quals[0].result?.red.bonus).toEqual({ movement: true, goal: false, pattern: true });
    expect(p.input.awards).toEqual({ mode: "none" });
  });

  it("seeds from the server's results-state key: the same state gives the server's seed, every time", async () => {
    const a = (await prepareLocal(detail(), deps())) as Prepared;
    const b = (await prepareLocal(detail(), deps())) as Prepared;
    const f = new PackForecaster(S, book(), readPackFacts(sdb.db, S, CODE), deps().now);
    const serverKey = inputKey(projectionInput(f, toEventInput(detail().event, detail().field, detail().matches, detail().alliances))!);
    expect(a.stateKey).toBe(serverKey);
    expect(a.seed).toBe(projectionSeed(S, CODE, "current", serverKey));
    expect(b.seed).toBe(a.seed);
    // A new result is a new state, so a new seed.
    const d = detail();
    const q3 = d.matches.find((m) => m.label === "Q3")!;
    Object.assign(q3, { played: true, red: { ...q3.red, score: { total: 100, np: 100, auto: 20, teleop: 60, endgame: 20, pen: 0 } }, blue: { ...q3.blue, score: { total: 70, np: 70, auto: 10, teleop: 40, endgame: 20, pen: 0 } } });
    expect(((await prepareLocal(d, deps())) as Prepared).seed).not.toBe(a.seed);
  });

  it("simulates bonus RPs from the server's season bonus model (shipped in the lite pack) and the per-team spread (engine 2.6)", async () => {
    const model = { movement: [0.1, 0.2], goal: [0.3, 0.4], pattern: [0.5, 0.6] } as never;
    const withBonus = async () => ({ ...lite(), bonus: { [S]: { model, source: "season" as const, samples: 400 } } });
    const p = (await prepareLocal(detail(), { ...deps(), lite: withBonus })) as Prepared;
    expect(p.input.bonus).toEqual(model);
    expect(p.input.variance?.size).toBe(8);
    expect(p.input.band).toBeTruthy();
    // A pack whose server had no model for the season: none, as on the server (event samples instead).
    const without = (await prepareLocal(detail(), { ...deps(), lite: async () => ({ ...lite(), bonus: {} }) })) as Prepared;
    expect(without.input.bonus).toBeUndefined();
  });

  it("says why there's no estimate instead of guessing", async () => {
    expect(await prepareLocal(detail(), { ...deps(), lite: async () => null })).toEqual({ unavailable: expect.stringMatching(/offline ratings/) });
    expect(await prepareLocal(detail(), { ...deps(), facts: async () => null })).toEqual({ unavailable: expect.stringMatching(/Save this season/) });
    const noSchedule = { ...detail(), matches: [] };
    expect(await prepareLocal(noSchedule, deps())).toEqual({ unavailable: expect.stringMatching(/No qualification schedule/) });
  });

  // The lite pack's record says which results its ratings learned; every other played result is folded in.
  const record = (keys: string[]): LiteLearned => ({ since: "2025-11-01", events: { [S]: { [CODE]: keys } } });
  const n = async (o: Parameters<typeof deps>[0], team: number) => ((await prepareLocal(detail(), deps(o))) as Prepared).input.ratings.get(team)!.n;

  it("folds in a result the lite pack's ratings didn't learn, even one scheduled before the pack was built", async () => {
    // Q2 (09:14, before the 09:30 build) arrived after the build: the record lists only Q1.
    const late = await n({ learned: record(["qual:0:1"]), packVersion: "v2" }, 105);
    const both = await n({ learned: record(["qual:0:1", "qual:0:2"]), packVersion: "v2" }, 105);
    expect(late).toBe(both + 1); // learned once from this event's Q2, not skipped
    expect(ratingsLearned(lite("v1", record(["qual:0:1"])), { facts: readPackFacts(sdb.db, S, CODE), version: "v2" }, S, CODE, "2025-11-08")).toEqual(new Set(["qual:0:1"]));
  });

  it("a newer season pack with an older lite pack never counts results the ratings didn't learn", async () => {
    // The record covers the event: a newer season pack's stored Q1–Q2 don't matter.
    expect(ratingsLearned(lite("v1", record([])), { facts: readPackFacts(sdb.db, S, CODE), version: "v2" }, S, CODE, "2025-11-08")).toEqual(new Set());
    // Covered by the window but not listed: none learned.
    expect(ratingsLearned(lite("v1", { since: "2025-11-01", events: {} }), { facts: readPackFacts(sdb.db, S, CODE), version: "v2" }, S, CODE, "2025-11-08")).toEqual(new Set());
    // No record (an older lite pack) and another release: can't know, so no estimate, and the page says why.
    expect(await prepareLocal(detail(), deps({ version: "v1", packVersion: "v2" }))).toEqual({ unavailable: expect.stringMatching(/different releases/) });
    // An event older than the record's window, other release: same.
    expect(ratingsLearned(lite("v1", { since: "2025-12-01", events: {} }), { facts: readPackFacts(sdb.db, S, CODE), version: "v2" }, S, CODE, "2025-11-08")).toBeNull();
  });

  it("an older lite pack from the same release as the season pack: the pack's stored results are what it learned", async () => {
    expect(ratingsLearned(lite("v1"), { facts: readPackFacts(sdb.db, S, CODE), version: "v1" }, S, CODE, "2025-11-08")).toEqual(new Set(["qual:0:1", "qual:0:2"]));
    expect("unavailable" in (await prepareLocal(detail(), deps()))).toBe(false);
  });

  it("a schedule correction or a DQ is a new results state (new key, so a new run)", async () => {
    const key = async (d: ReturnType<typeof detail>) => cacheKey((await prepareLocal(d, deps())) as Prepared);
    const base = await key(detail());
    expect(await key(detail())).toBe(base);
    // Team swap in an unplayed match: same totals, same played count.
    const swap = detail();
    const q3 = swap.matches.find((m) => m.label === "Q3")!;
    [q3.red.teams[0], q3.blue.teams[0]] = [q3.blue.teams[0], q3.red.teams[0]];
    expect(await key(swap)).not.toBe(base);
    // A DQ on a played match: scores unchanged.
    const dq = detail();
    dq.matches.find((m) => m.label === "Q1")!.red.teams[0].dq = true;
    expect(await key(dq)).not.toBe(base);
  });
});

describe("running it", () => {
  beforeEach(() => resetLocalCache());

  it("the same seed gives the same numbers on every run", async () => {
    const p = (await prepareLocal(detail(), deps())) as Prepared;
    const a = await runInWorker(p, () => {}, undefined, { worker: fakeWorker });
    const b = await runInWorker(p, () => {}, undefined, { worker: fakeWorker });
    expect(a.runs).toBe(LOCAL_RUNS);
    expect(b.teams).toEqual(a.teams);
  });

  it("simulates a results state once: a repeat open reads the cache, and a run already going is joined", async () => {
    let spawned = 0;
    const worker = () => { spawned++; return fakeWorker(); };
    const progress: number[] = [];
    const [a, b] = await Promise.all([localProjection(detail(), (d) => progress.push(d), undefined, { ...deps(), worker }), localProjection(detail(), () => {}, undefined, { ...deps(), worker })]);
    expect(spawned).toBe(1);
    expect(b).toBe(a);
    expect(progress.length).toBeGreaterThan(0);
    const again = await localProjection(detail(), () => {}, undefined, { ...deps(), worker });
    expect(again).toBe(a);
    expect(spawned).toBe(1);
    if (!("local" in a)) throw new Error("expected an estimate");
    expect(a.run).toMatchObject({ kind: "current", runs: LOCAL_RUNS, target: LOCAL_RUNS, stage: "live", through: "Q2", slots: 3 });
    // Another lite pack is other ratings: simulated again.
    await localProjection(detail(), () => {}, undefined, { ...deps({ version: "v2", packVersion: "v2" }), worker });
    expect(spawned).toBe(2);
  });

  it("leaving the page cancels the worker", async () => {
    const log: ToWorker[] = [];
    const w = fakeWorker(log);
    const ctrl = new AbortController();
    const p = (await prepareLocal(detail(), deps())) as Prepared;
    const run = runInWorker(p, () => ctrl.abort(), ctrl.signal, { worker: () => w });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(log.map((m) => m.type)).toEqual(["run", "cancel"]);
    expect(w.terminated).toBe(true);
  });
});
