// The local estimate, on the page's side. Loaded lazily (src/lib/projections.ts useLocalProjection), and only
// when the server's stored projection can't be had: an online visit with a stored run never loads this file,
// the engine, the packs or the worker.
//
//   1. Input: the engine's own forecaster steps (src/shared/projectionInput.ts) on a Forecaster fed from the
//      offline packs (forecaster.ts): the same SimInput the server's projections job builds, from this
//      device's ratings (the lite pack) and the event as the page has it.
//   2. Seed and cache key: the results-state key (src/shared/projectionState.ts, the server's SHA-256), so a
//      results state always gives the same numbers, here and on a repeat open.
//   3. Run: LOCAL_RUNS simulations in a Web Worker (protocol.ts), stopping at LOCAL_STOP_MS of compute.
//   4. Cache: in memory and IndexedDB per (event, results state, pack, engine), so the same state never
//      simulates twice on this device; a run already going for that state is shared, not started again.
import { ENGINE_VERSION, RatingBook } from "@control-scout/predict-engine";
import type { EventDetail } from "../../shared/api";
import { toEventInput } from "../../shared/eventInput";
import { projectionInput } from "../../shared/projectionInput";
import { eventState, inputKeyAsync } from "../../shared/projectionState";
import { projectionSeed } from "../../shared/projectionCore";
import type { CoreResult } from "../../shared/projectionCore";
import type { ProjectionRun } from "../../shared/projections";
import { loadLite, type LitePack } from "../packs";
import { readSaved, savedSeasons } from "../offline/seasons";
import { PackForecaster, readAdvancement, readPackFacts, type PackFacts } from "./forecaster";
import { LOCAL_RUNS, LOCAL_STOP_MS, type FromWorker, type ToWorker } from "./protocol";
import type { LocalProjection } from "../projections";
import type { SimInput } from "@control-scout/predict-engine";

export type Unavailable = { unavailable: string };

export interface Prepared {
  season: number;
  code: string;
  input: SimInput;
  stateKey: string;
  seed: number;
  stage: ProjectionRun["stage"];
  slots: number;
  slotsSource: string;
  played: number;
  scheduled: number;
  through: string | null;
  packVersion: string;
  ratingsAsOf: string;
}

/** The simulation input for the event as the page has it, from the packs on this device (or why there's none). */
export async function prepareLocal(d: EventDetail, deps: { lite?: () => Promise<LitePack | null>; facts?: (season: number, code: string) => Promise<{ facts: PackFacts; version: string } | null>; now?: number } = {}): Promise<Prepared | Unavailable> {
  const season = d.event.season, code = d.event.code;
  const lite = await (deps.lite ?? loadLite)().catch(() => null);
  const data = lite?.books[String(season)];
  if (!lite || !data) return { unavailable: "This device has no offline ratings for this season yet." };
  const got = await (deps.facts ?? packFacts)(season, code).catch(() => null);
  if (!got) return { unavailable: "Save this season for offline use to get a local estimate." };
  const ev = toEventInput(d.event, d.field, d.matches, d.alliances);
  if (!ev.matches.some((m) => m.level === "qual")) return { unavailable: "No qualification schedule yet." };
  const facts = got.version === lite.version ? got.facts : withNewerRatings(got.facts, ev, lite.builtAt);
  const now = deps.now ?? Date.now();
  const f = new PackForecaster(season, RatingBook.fromData(data), facts, now);
  const pi = projectionInput(f, ev);
  if (!pi) return { unavailable: "This event can't be simulated." };
  const stateKey = await inputKeyAsync(pi);
  const st = eventState(ev);
  return {
    season, code, input: { ...pi.input, awards: { mode: "none" }, runs: 1 }, stateKey, seed: projectionSeed(season, code, "current", stateKey),
    stage: pi.stage, slots: pi.slots, slotsSource: pi.slotsSource, played: st.played, scheduled: st.scheduled, through: st.through,
    packVersion: lite.version, ratingsAsOf: lite.builtAt,
  };
}

/**
 * The season pack and the lite pack come from one build, so the pack's played matches are exactly the ones
 * the ratings learned. When the lite pack is a newer build, it learned more: every played match of the event
 * from before it was built counts as learned too (match times read as the server reads them), so no result
 * is folded into the ratings twice.
 */
/** Match time → epoch ms as the server reads it (server/stats/load.ts matchTimeMs): zone-less FIRST times as UTC. */
const matchTimeMs = (t: string | null | undefined) => (t ? Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(t) ? t : `${t}Z`) : NaN);

export function withNewerRatings(facts: PackFacts, ev: ReturnType<typeof toEventInput>, builtAt: string): PackFacts {
  const built = Date.parse(builtAt);
  const storedKeys = new Set(facts.storedKeys);
  for (const m of ev.matches) if (m.played && matchTimeMs(m.time) < built) storedKeys.add(m.key);
  return { ...facts, storedKeys };
}

/** The projected event's facts from the saved season pack (and the season before, when saved). */
async function packFacts(season: number, code: string): Promise<{ facts: PackFacts; version: string } | null> {
  const saved = savedSeasons().find((s) => s.season === season);
  if (!saved) return null;
  // Rows are read inside readSaved: an open database may be closed once it returns.
  const facts = await readSaved(season, ([s]) => (s ? readPackFacts(s.db, season, code.toUpperCase()) : null));
  if (!facts) return null;
  // The server also estimates slots from the season before; this device knows it only when that season is saved too.
  if (savedSeasons().some((s) => s.season === season - 1)) facts.advancement.set(season - 1, await readSaved(season - 1, ([p]) => (p ? readAdvancement(p.db, season - 1) : [])));
  return { facts, version: saved.version };
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

export interface RunDeps { worker?: () => Pick<Worker, "postMessage" | "terminate" | "addEventListener"> }

let nextId = 1;

/** Run the prepared input in a Web Worker; resolves with the core's result (the real count when it stopped early). */
export function runInWorker(p: Prepared, onProgress: (done: number, target: number) => void, signal: AbortSignal | undefined, deps: RunDeps = {}): Promise<CoreResult> {
  if (!deps.worker && typeof Worker === "undefined") return Promise.reject(new Error("This browser can't run simulations in the background."));
  const w = deps.worker ? deps.worker() : new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "local-estimate" });
  const id = nextId++;
  return new Promise<CoreResult>((resolve, reject) => {
    const end = () => { signal?.removeEventListener("abort", abort); w.terminate(); };
    const abort = () => { w.postMessage({ type: "cancel", id } satisfies ToWorker); end(); reject(new DOMException("Cancelled", "AbortError")); };
    if (signal?.aborted) { end(); reject(new DOMException("Cancelled", "AbortError")); return; }
    signal?.addEventListener("abort", abort, { once: true });
    w.addEventListener("message", (e: Event) => {
      const m = (e as MessageEvent<FromWorker>).data;
      if (!m || m.id !== id) return;
      if (m.type === "progress") onProgress(m.done, m.target);
      else if (m.type === "done") { end(); resolve(m.result); }
      else if (m.type === "error") { end(); reject(new Error(m.message)); }
    });
    w.addEventListener("error", (e: Event) => { end(); reject(new Error((e as ErrorEvent).message || "The background simulation failed.")); });
    w.postMessage({ type: "run", id, input: p.input, seed: p.seed, runs: LOCAL_RUNS, stopAtMs: LOCAL_STOP_MS } satisfies ToWorker);
  });
}

/** The result as a projection run, marked local. */
export function toLocal(p: Prepared, r: CoreResult, computedAt: string): LocalProjection {
  return {
    local: true, packVersion: p.packVersion, ratingsAsOf: p.ratingsAsOf, computeMs: Math.round(r.computeMs), stopped: r.stopped, cacheKey: cacheKey(p),
    run: {
      kind: "current", runs: r.runs, target: LOCAL_RUNS, stage: p.stage, played: p.played, scheduled: p.scheduled, through: p.through,
      slots: p.slots, slotsSource: p.slotsSource, seed: p.seed, engineVersion: ENGINE_VERSION, ms: Math.round(r.wallMs), computedAt, teams: r.teams,
    },
  };
}

// ---------------------------------------------------------------------------
// Cache: memory + IndexedDB, per (event, results state, pack, engine)
// ---------------------------------------------------------------------------

export const cacheKey = (p: Pick<Prepared, "season" | "code" | "stateKey" | "packVersion">) => `${p.season}|${p.code}|${p.stateKey}|${p.packVersion}|${ENGINE_VERSION}`;

const memory = new Map<string, LocalProjection>();
const inflight = new Map<string, { promise: Promise<LocalProjection>; listeners: Set<(done: number, target: number) => void>; users: number; ctrl: AbortController }>();
/** Estimates kept on the device (oldest dropped first). */
export const KEEP = 12;

const DB = "control-scout-local-estimates";
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("runs");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
interface Stored { savedAt: number; value: LocalProjection }
async function idbGet(key: string): Promise<LocalProjection | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await idb();
    return await new Promise<LocalProjection | null>((res) => {
      const r = db.transaction("runs").objectStore("runs").get(key);
      r.onsuccess = () => { db.close(); res((r.result as Stored | undefined)?.value ?? null); };
      r.onerror = () => { db.close(); res(null); };
    });
  } catch { return null; }
}
async function idbPut(key: string, value: LocalProjection): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await idb();
    await new Promise<void>((res) => {
      const t = db.transaction("runs", "readwrite");
      const store = t.objectStore("runs");
      store.put({ savedAt: Date.now(), value } satisfies Stored, key);
      // Keep the newest KEEP: one estimate per event state is a few KB, but states pile up over a season.
      const all = store.getAll(), keys = store.getAllKeys();
      t.oncomplete = () => { db.close(); res(); };
      t.onerror = () => { db.close(); res(); };
      keys.onsuccess = () => {
        const rows = (all.result as Stored[]).map((s, i) => ({ s, k: keys.result[i] })).sort((a, b) => b.s.savedAt - a.s.savedAt);
        for (const { k } of rows.slice(KEEP)) store.delete(k);
      };
    });
  } catch { /* storage blocked: the memory copy still serves this visit */ }
}

/** Test seam: forget everything kept in memory. */
export function resetLocalCache(): void { memory.clear(); for (const f of inflight.values()) f.ctrl.abort(); inflight.clear(); }

/**
 * The local estimate for the event as the page has it: from the cache when this results state was already
 * simulated on this device, else simulated once (a run already going for it is joined). `signal` leaves
 * the run; the last one to leave cancels it (the worker stops at its next slice).
 */
export async function localProjection(d: EventDetail, onProgress: (done: number, target: number) => void, signal?: AbortSignal, deps: RunDeps & Parameters<typeof prepareLocal>[1] = {}): Promise<LocalProjection | Unavailable> {
  const p = await prepareLocal(d, deps);
  if ("unavailable" in p) return p;
  const key = cacheKey(p);
  const hit = memory.get(key) ?? (await idbGet(key));
  if (hit) { memory.set(key, hit); return hit; }
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  let f = inflight.get(key);
  if (!f) {
    const ctrl = new AbortController();
    const listeners = new Set<(done: number, target: number) => void>();
    const promise = runInWorker(p, (done, target) => { for (const l of listeners) l(done, target); }, ctrl.signal, deps)
      .then((r) => {
        const out = toLocal(p, r, new Date().toISOString());
        memory.set(key, out);
        void idbPut(key, out);
        return out;
      })
      .finally(() => { if (inflight.get(key)?.promise === promise) inflight.delete(key); });
    f = { promise, listeners, users: 0, ctrl };
    inflight.set(key, f);
  }
  const flight = f;
  flight.users++;
  flight.listeners.add(onProgress);
  const leave = () => { flight.listeners.delete(onProgress); if (--flight.users === 0) flight.ctrl.abort(); };
  signal?.addEventListener("abort", leave, { once: true });
  try { return await flight.promise; }
  finally { signal?.removeEventListener("abort", leave); if (!signal?.aborted) { flight.listeners.delete(onProgress); flight.users--; } }
}
