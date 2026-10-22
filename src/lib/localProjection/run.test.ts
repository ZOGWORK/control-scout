// The local estimate on the page's side: its input comes from the packs the way the server builds its own
// (official slots, already-qualified teams, recorded bonus RPs, no result learned twice), its seed is the
// server's for the same results state, the same state never simulates twice, and leaving cancels the worker.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FITTED_MODEL, RatingBook, type BonusFlags } from "@control-scout/predict-engine";
import type { EventDetail } from "../../shared/api";
import { projectionSeed } from "../../shared/projectionCore";
import { inputKey } from "../../../server/projections/state";
import { projectionInput } from "../../shared/projectionInput";
import { toEventInput } from "../../shared/eventInput";
import { readEventDetail, wrap, type SeasonDb } from "../offline/readers";
import { packDb } from "../offline/testFixture";
import type { LitePack } from "../packs";
import { PackForecaster, readPackFacts } from "./forecaster";
import { LOCAL_RUNS, workerHandler, type FromWorker, type ToWorker } from "./protocol";
import { localProjection, prepareLocal, resetLocalCache, runInWorker, withNewerRatings, type Prepared } from "./run";

const S = 2025, CODE = "USNJQ5";
const TEAMS = [101, 102, 103, 104, 105, 106, 107, 108];
const bonus = (movement: boolean, goal: boolean, pattern: boolean): string => JSON.stringify({ movement, goal, pattern } satisfies BonusFlags);
const matchRow = (n: number, played: boolean, red: number, blue: number, redBonus: string | null = null) => ({
  season: S, code: CODE, level: "qual", series: 0, number: n, label: `Q${n}`, description: `Q${n}`, time: `2025-11-08T09:${String(n * 7).padStart(2, "0")}:00`, played: played ? 1 : 0,
  ...(played ? { red_total: red, red_np: red, red_auto: 20, red_teleop: red - 40, red_endgame: 20, red_pen: 0, red_bonus: redBonus, blue_total: blue, blue_np: blue, blue_auto: 15, blue_teleop: blue - 35, blue_endgame: 20, blue_pen: 0, blue_bonus: null } : {}),
  source: "first",
});
const lineup = (n: number, red: number[], blue: number[]) => [...red.map((t, i) => ({ t, a: "red", s: i + 1 })), ...blue.map((t, i) => ({ t, a: "blue", s: i + 1 }))]
  .map(({ t, a, s }) => ({ season: S, code: CODE, level: "qual", series: 0, number: n, team: t, alliance: a, station: s, surrogate: 0, dq: 0, on_field: 1 }));

let sdb: SeasonDb;
beforeAll(async () => {
  const db = await packDb(S, {
    teams: TEAMS.map((n) => ({ number: n, name: `Team ${n}` })),
    events: [{ season: S, code: CODE, name: "NJ Qualifier 5", type: "Qualifier", region: "USNJ", city: "Edison", state: "NJ", country: "USA", start: "2025-11-08", end: "2025-11-08", timezone: "America/New_York", remote: 0, source: "first" }],
    event_teams: TEAMS.map((t) => ({ season: S, code: CODE, team: t })),
    matches: [matchRow(1, true, 120, 80, bonus(true, false, true)), matchRow(2, true, 90, 110), matchRow(3, false, 0, 0), matchRow(4, false, 0, 0)],
    match_teams: [...lineup(1, [101, 102], [103, 104]), ...lineup(2, [105, 106], [107, 108]), ...lineup(3, [101, 103], [105, 107]), ...lineup(4, [102, 104], [106, 108])],
    advancement: [{ season: S, code: CODE, slots: 3, advances_to: "USNJCMP", rows: JSON.stringify([{ team: 104, status: "ALREADY_ADVANCING", declined: false }, { team: 108, status: "INELIGIBLE", declined: false }]) }],
  });
  sdb = { season: S, db: wrap(db) };
});

const book = () => { const b = new RatingBook(FITTED_MODEL.rating); b.startSeason(S); return b; };
const lite = (version = "v1", builtAt = "2025-11-07T00:00:00Z"): LitePack => ({ format: 1, version, builtAt, engineVersion: "x", books: { [S]: book().toData() }, teams: [] });
const detail = () => readEventDetail(sdb, CODE)!;
const deps = (o: { version?: string; packVersion?: string } = {}) => ({
  lite: async () => lite(o.version),
  facts: async () => ({ facts: readPackFacts(sdb.db, S, CODE), version: o.packVersion ?? "v1" }),
  now: Date.parse("2025-11-08T12:00:00Z"),
});

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

  it("says why there's no estimate instead of guessing", async () => {
    expect(await prepareLocal(detail(), { ...deps(), lite: async () => null })).toEqual({ unavailable: expect.stringMatching(/offline ratings/) });
    expect(await prepareLocal(detail(), { ...deps(), facts: async () => null })).toEqual({ unavailable: expect.stringMatching(/Save this season/) });
    const noSchedule = { ...detail(), matches: [] };
    expect(await prepareLocal(noSchedule, deps())).toEqual({ unavailable: expect.stringMatching(/No qualification schedule/) });
  });

  it("a newer lite pack learned what the saved season pack hasn't: no result is folded in twice", () => {
    const facts = { ...readPackFacts(sdb.db, S, CODE), storedKeys: new Set<string>() };
    const ev = toEventInput(detail().event, detail().field, detail().matches, detail().alliances);
    expect([...withNewerRatings(facts, ev, "2025-11-08T09:10:00Z").storedKeys]).toEqual(["qual:0:1"]);
    expect([...withNewerRatings(facts, ev, "2025-11-09T00:00:00Z").storedKeys].sort()).toEqual(["qual:0:1", "qual:0:2"]);
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
