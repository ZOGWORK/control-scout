// The projections job end to end on a small synthetic event: a burst of new results → exactly one
// debounced re-run → an open stream hears about it → the stored projection moved. And no request
// path ever runs a simulation: pages only read what the job stored.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Count every simulation, wherever it would come from: the engine's simulateEvent (as the projection
// core imports it) and the core's own entry point.
const sims = vi.hoisted(() => ({ engine: 0, core: 0 }));
vi.mock("@control-scout/predict-engine", async (orig) => {
  const m = await orig<typeof import("@control-scout/predict-engine")>();
  return { ...m, simulateEvent: (...a: Parameters<typeof m.simulateEvent>) => { sims.engine++; return m.simulateEvent(...a); } };
});
vi.mock("./core", async (orig) => {
  const m = await orig<typeof import("./core")>();
  return { ...m, simulateProjection: (...a: Parameters<typeof m.simulateProjection>) => { sims.core++; return m.simulateProjection(...a); } };
});

import { kvSet, migrate, openDb, run, setDb } from "../db";
import { clearAllCaches } from "../caches";
import { resetForecasters } from "../predict/engine";
import { CURRENT_SEASON } from "../data/seasons";
import { createApp } from "../app";
import { DEBOUNCE_MS, Debouncer, MAX_WAIT_MS, jobIo, newJobState, projectEvent, projectionTick } from "./job";
import { readProjections } from "./store";
import { closeProjectionStreams } from "./routes";

const S = CURRENT_SEASON;
const CODE = "TESTQ1";
const TEAMS = [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112];
const day = new Date().toISOString().slice(0, 10);

/** 18 quals: each round pairs the 12 teams into three matches. */
function schedule(): { n: number; red: number[]; blue: number[] }[] {
  const out = [];
  for (let r = 0; r < 6; r++) {
    const order = TEAMS.map((t, i) => TEAMS[(i * (r + 1) * 5 + r) % TEAMS.length]).filter((t, i, a) => a.indexOf(t) === i);
    const rest = TEAMS.filter((t) => !order.includes(t));
    const all = [...order, ...rest];
    for (let k = 0; k < 3; k++) out.push({ n: r * 3 + k + 1, red: [all[k * 4], all[k * 4 + 1]], blue: [all[k * 4 + 2], all[k * 4 + 3]] });
  }
  return out;
}
const SCHED = schedule();
const strength = (t: number) => (t - 100) * 8;

async function setup() {
  await run("INSERT INTO events (season, code, name, type, start, end, remote, hybrid, source) VALUES (?, ?, 'Test Qualifier', 'Qualifier', ?, ?, 0, 0, 'test')", [S, CODE, day, day]);
  for (const t of TEAMS) {
    await run("INSERT OR IGNORE INTO teams (number, name) VALUES (?, ?)", [t, `Team ${t}`]);
    await run("INSERT INTO event_teams (season, code, team) VALUES (?, ?, ?)", [S, CODE, t]);
  }
  for (const m of SCHED) {
    await run("INSERT INTO matches (season, code, level, series, number, label, time, played, source) VALUES (?, ?, 'qual', 0, ?, ?, ?, 0, 'test')", [S, CODE, m.n, `Q${m.n}`, `${day}T09:${String(m.n).padStart(2, "0")}:00`]);
    for (const [alliance, ts] of [["red", m.red], ["blue", m.blue]] as const) for (const t of ts)
      await run("INSERT INTO match_teams (season, code, level, series, number, team, alliance, on_field) VALUES (?, ?, 'qual', 0, ?, ?, ?, 1)", [S, CODE, m.n, t, alliance]);
  }
}

/** Post match n's result (as a sync would), and move the data version. */
async function post(n: number) {
  const m = SCHED[n - 1];
  const red = 40 + m.red.reduce((s, t) => s + strength(t), 0), blue = 40 + m.blue.reduce((s, t) => s + strength(t), 0);
  await run(`UPDATE matches SET played = 1, red_total = ?, red_np = ?, red_auto = 10, red_teleop = ?, red_endgame = 5, red_pen = 0,
    blue_total = ?, blue_np = ?, blue_auto = 10, blue_teleop = ?, blue_endgame = 5, blue_pen = 0 WHERE season = ? AND code = ? AND level = 'qual' AND number = ?`,
  [red, red, red - 15, blue, blue, blue - 15, S, CODE, n]);
  await kvSet("data:version", `v-${n}-${Math.random()}`);
}

const fast = (season: number, code: string, log: (m: string) => void) => projectEvent(season, code, { runs: 400, floor: 400, log });
const realRun = jobIo.run;

beforeEach(async () => {
  const c = openDb(":memory:");
  setDb(c);
  await migrate(c);
  clearAllCaches();
  resetForecasters();
  await setup();
  for (let n = 1; n <= 6; n++) await post(n);
  sims.engine = 0; sims.core = 0;
});
afterEach(() => { jobIo.run = realRun; });

describe("Debouncer", () => {
  it("collapses a burst into one run, and never waits past MAX_WAIT_MS", () => {
    const d = new Debouncer();
    d.note("e", "a", 0);
    d.note("e", "b", 5_000);
    d.note("e", "c", 10_000);
    expect(d.take(10_000 + DEBOUNCE_MS - 1)).toEqual([]);
    expect(d.take(10_000 + DEBOUNCE_MS)).toEqual(["e"]);
    expect(d.take(10_000 + DEBOUNCE_MS + 1)).toEqual([]);
    d.note("e", "c", 50_000); // same signature: nothing to do
    expect(d.size).toBe(0);
    // A steady trickle of changes still runs MAX_WAIT_MS after the first one.
    for (let t = 100_000; t < 100_000 + MAX_WAIT_MS; t += 5_000) { d.note("e", `s${t}`, t); expect(d.take(t)).toEqual([]); }
    expect(d.take(100_000 + MAX_WAIT_MS)).toEqual(["e"]);
  });
});

describe("projections job", () => {
  it("runs once per burst of results, stores the run and tells an open stream", async () => {
    const runs: string[] = [];
    jobIo.run = async (s, c, log) => { runs.push(c); return fast(s, c, log); };
    const st = newJobState();
    const t0 = Date.now();
    expect(await projectionTick(t0, () => {}, st)).toEqual([]); // seen, debouncing
    expect(await projectionTick(t0 + DEBOUNCE_MS, () => {}, st)).toEqual([`${S}|${CODE}`]);
    expect(runs).toEqual([CODE]);
    const first = await readProjections(S, CODE);
    expect(first.current?.played).toBe(6);
    expect(first.current?.runs).toBe(400);
    expect(first.baseline?.played).toBe(0);
    expect(first.lastOpen?.played).toBe(6);
    expect(first.current?.teams).toHaveLength(12);

    // An event page with the stream open.
    const server: Server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const ac = new AbortController();
    const res = await fetch(`${base}/api/projections/${S}/${CODE}/stream`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    let text = "";
    const until = async (re: RegExp) => { while (!re.test(text)) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); } };
    await until(/event: ready/);

    // Three results land within seconds (several syncs): one re-run, after the burst.
    let t = t0 + DEBOUNCE_MS + 1_000;
    for (const n of [7, 8, 9]) { await post(n); expect(await projectionTick(t, () => {}, st)).toEqual([]); t += 2_000; }
    expect(runs).toHaveLength(1);
    expect(await projectionTick(t + DEBOUNCE_MS, () => {}, st)).toEqual([`${S}|${CODE}`]);
    expect(runs).toHaveLength(2);
    await until(/event: projections/);
    expect(text).toMatch(/"through":"Q9"/);
    const after = await (await fetch(`${base}/api/projections/${S}/${CODE}`)).json();
    expect(after.current.played).toBe(9);
    expect(after.current.through).toBe("Q9");
    expect(after.baseline.computedAt).toBe(first.baseline!.computedAt); // the pre-event baseline stays put
    // Nothing new: later ticks don't run again.
    expect(await projectionTick(t + DEBOUNCE_MS * 3, () => {}, st)).toEqual([]);
    expect(runs).toHaveLength(2);
    ac.abort();
    closeProjectionStreams();
    await new Promise((r) => server.close(r));
  });

  it("the same results state gives the same numbers (seeded by it) and is not re-simulated", async () => {
    const a = await projectEvent(S, CODE, { runs: 300, floor: 300 });
    expect(a.status).toBe("ran");
    const before = await readProjections(S, CODE);
    expect(await projectEvent(S, CODE, { runs: 300, floor: 300 })).toEqual({ status: "unchanged" });
    await run("DELETE FROM event_projections WHERE season = ? AND code = ?", [S, CODE]);
    await projectEvent(S, CODE, { runs: 300, floor: 300 });
    const again = await readProjections(S, CODE);
    expect(again.current!.teams).toEqual(before.current!.teams);
    expect(again.current!.seed).toBe(before.current!.seed);
  });

  it("re-runs for facts the simulation reads that the event payload doesn't carry: recorded bonus RPs, official slots", async () => {
    expect((await projectEvent(S, CODE, { runs: 200, floor: 200 })).status).toBe("ran");
    const before = (await readProjections(S, CODE)).current!;
    expect(await projectEvent(S, CODE, { runs: 200, floor: 200 })).toEqual({ status: "unchanged" });
    // The sync records bonus RPs for a played match (scores and ranks unchanged).
    await run("UPDATE matches SET red_bonus = ? WHERE season = ? AND code = ? AND level = 'qual' AND number = 1", [JSON.stringify({ movement: true, goal: true, pattern: false }), S, CODE]);
    await kvSet("data:version", "bonus");
    const st = newJobState(); const t0 = Date.now();
    jobIo.run = fast;
    await projectionTick(t0, () => {}, st);
    await run("UPDATE matches SET blue_bonus = ? WHERE season = ? AND code = ? AND level = 'qual' AND number = 2", [JSON.stringify({ movement: true, goal: false, pattern: false }), S, CODE]);
    await kvSet("data:version", "bonus2");
    expect(await projectionTick(t0 + 1_000, () => {}, st)).toEqual([]);
    expect(await projectionTick(t0 + 1_000 + DEBOUNCE_MS, () => {}, st)).toEqual([`${S}|${CODE}`]); // the scan saw it
    const afterBonus = (await readProjections(S, CODE)).current!;
    expect(afterBonus.seed).not.toBe(before.seed);
    // FIRST publishes the official slot count and an already-qualified team.
    await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (?, ?, 2, 'STATE', ?)", [S, CODE, JSON.stringify([{ team: 112, status: "ALREADY_ADVANCING", declined: false }, { team: 111, status: "INELIGIBLE", declined: false }])]);
    await kvSet("data:version", "adv");
    expect(await projectionTick(t0 + 100_000, () => {}, st)).toEqual([]);
    expect(await projectionTick(t0 + 100_000 + DEBOUNCE_MS, () => {}, st)).toEqual([`${S}|${CODE}`]);
    const afterSlots = (await readProjections(S, CODE)).current!;
    expect(afterSlots.slots).toBe(2);
    expect(afterSlots.slotsSource).toBe("official");
    expect(afterSlots.teams.find((t) => t.team === 112)).toMatchObject({ pAdvance: null, advance: "qualified" });
    expect(afterSlots.teams.find((t) => t.team === 111)).toMatchObject({ pAdvance: null, advance: "ineligible" }); // not eligible is never "qualified"
    expect(afterSlots.teams.find((t) => t.team === 110)!.advance).toBe("odds");
  });

  it("never invents a projection for an event that finished before it was ever projected", async () => {
    const old = "2026-01-10";
    await run("UPDATE events SET start = ?, end = ? WHERE season = ? AND code = ?", [old, old, S, CODE]);
    for (let n = 7; n <= 18; n++) await post(n);
    expect(await projectEvent(S, CODE, { runs: 200, floor: 200 })).toEqual({ status: "skipped", reason: "finished before it was projected" });
    expect((await readProjections(S, CODE)).baseline).toBeNull();
  });

  it("an event already tracked keeps updating after it finishes", async () => {
    await projectEvent(S, CODE, { runs: 200, floor: 200 });
    const old = "2026-01-10";
    await run("UPDATE events SET start = ?, end = ? WHERE season = ? AND code = ?", [old, old, S, CODE]);
    for (let n = 7; n <= 18; n++) await post(n);
    expect((await projectEvent(S, CODE, { runs: 200, floor: 200 })).status).toBe("ran");
    const v = await readProjections(S, CODE);
    expect(v.current!.played).toBe(18);
    expect(v.lastOpen!.played).toBe(6); // judged by the last run while quals were open
  });

  it("the records' Advancement Odds read the projection once there is one", async () => {
    const server: Server = createApp().listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const t of [101, 102]) await run("INSERT INTO team_event_records (season, code, team, event_name, adv_odds) VALUES (?, ?, ?, 'Test Qualifier', 12.5)", [S, CODE, t]);
    await run("INSERT INTO team_event_records (season, code, team, event_name, adv_odds) VALUES (?, 'OTHER', 101, 'Other', 33)", [S]);
    const odds = async () => {
      const recs = await (await fetch(`${base}/api/records/${S}/teams?sort=teamNumber&dir=asc`)).json();
      return recs.rows.map((r: any) => [r.eventCode, r.team, r.stats.advancementOdds]);
    };
    expect(await odds()).toEqual(expect.arrayContaining([[CODE, 101, 12.5], ["OTHER", 101, 33], [CODE, 102, 12.5]]));
    await projectEvent(S, CODE, { runs: 300, floor: 300 });
    const p = new Map((await readProjections(S, CODE)).current!.teams.map((x) => [x.team, x.pAdvance! * 100]));
    const after = await odds();
    expect(after.find((r: any[]) => r[0] === CODE && r[1] === 101)[2]).toBeCloseTo(p.get(101)!, 1);
    expect(after.find((r: any[]) => r[0] === CODE && r[1] === 102)[2]).toBeCloseTo(p.get(102)!, 1);
    expect(after.find((r: any[]) => r[0] === "OTHER")[2]).toBe(33); // never projected: the static estimate stays
    // A team FIRST lists as not eligible: no odds in the records (empty, not 0% and not "qualified").
    await run("INSERT INTO team_event_records (season, code, team, event_name, adv_odds) VALUES (?, ?, 103, 'Test Qualifier', 12.5)", [S, CODE]);
    await run("INSERT INTO advancement (season, code, slots, advances_to, rows) VALUES (?, ?, 2, 'STATE', ?)", [S, CODE, JSON.stringify([{ team: 103, status: "INELIGIBLE", declined: false }])]);
    await kvSet("data:version", "adv-ineligible");
    await projectEvent(S, CODE, { runs: 300, floor: 300 });
    expect((await odds()).find((r: any[]) => r[0] === CODE && r[1] === 103)[2]).toBeNull();
    await new Promise((r) => server.close(r));
  });
});

describe("no request runs a simulation", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => { server = createApp().listen(0); await new Promise((r) => server.once("listening", r)); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; });
  afterAll(async () => { closeProjectionStreams(); await new Promise((r) => server.close(r)); });

  it("projections, the event page, its records and team pages only read stored results", async () => {
    await projectEvent(S, CODE, { runs: 200, floor: 200 }); // the job's run (counted, then reset)
    sims.engine = 0; sims.core = 0;
    // A visit with nothing stored for another event, and with a stored run for this one.
    for (const path of [
      `/api/projections/${S}/${CODE}`, `/api/projections/${S}/NOPE`, `/api/events/${S}/${CODE}`,
      `/api/records/${S}/teams?event=${CODE}`, `/api/teams/101?season=${S}`, `/api/teams-summary?season=${S}&teams=101,102`,
    ]) {
      const r = await fetch(base + path);
      expect(r.status, path).toBeLessThan(500);
      await r.arrayBuffer();
    }
    const ac = new AbortController();
    const stream = await fetch(`${base}/api/projections/${S}/${CODE}/stream`, { signal: ac.signal });
    await stream.body!.getReader().read();
    ac.abort();
    expect(sims).toEqual({ engine: 0, core: 0 });
  });
});
