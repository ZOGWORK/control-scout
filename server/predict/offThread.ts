// The forecaster rebuild's replay on a worker thread, so the web process's event loop never runs it.
//
// Every new data version rebuilt the forecaster on the server's own thread: the window's seasons read and every rated
// match replayed into the ratings and the pair history, pausing every 4,000 matches. On the VM a rebuild took 12.9 s
// with the loop busy throughout (gaps up to 670 ms), and 21 s after a restart; every request shared what was left.
// Here one long-lived worker (rebuildWorker.ts) opens the same database file, runs the very replay the server ran
// (replayWindow in engine.ts, same code, same data, same numbers) and sends back what it worked out. Its season reads
// are kept there between rebuilds, as they were here (a frozen season is read once).
//
// What comes back is plain data in many small messages, so no single one holds the loop for long: the rating books as
// their own fields (their prototype put back here), each season's events a few thousand matches at a time, and the
// pair tables' entries in slices. A part that hasn't changed since the last rebuild (a frozen season's events, its
// pair table) isn't sent again: the worker names it by a hash of its content and this side keeps the one it has.
// ScoutForecaster.install then works out the derived indexes here, a season at a time.
import { Worker } from "node:worker_threads";
import { RatingBook, PartnershipTable, type AdvancementRecord, type EventRecord, type PartnershipData } from "@control-scout/predict-engine";
import { localDbFile } from "../db.js";
import { entryFor } from "../projections/offThread.js";
import type { ForecasterParts } from "./engine.js";

/** A rebuild still going after this long is stopped (the worker with it; the next rebuild starts a new one). */
export const REBUILD_TIMEOUT_MS = 5 * 60_000;

/** A pair table as its fields (PartnershipTable's private maps). */
export interface TableFields { tog: Map<number, unknown>; ag: Map<number, unknown>; names: Map<string, string>; season: number | null }

export type ToRebuildWorker =
  | { t: "rebuild"; id: number; anchor: number; seasons: number[]; have: Record<string, string> }
  /** The last slice is taken in: send the next. */
  | { t: "ack" }
  | { t: "reset" };
export type PartKind = "events" | "whole" | "table";
export type FromRebuildWorker =
  /** One slice of a part: events (an array to append), whole (the value), table (entries of one of its maps). */
  | { t: "chunk"; id: number; name: string; kind: PartKind; data: unknown; map?: "tog" | "ag" | "names"; season?: number | null }
  /** Every part of the rebuild by name and content hash (one not sent: the same as the last one sent). */
  | { t: "done"; id: number; parts: { name: string; kind: PartKind; hash: string | null }[]; meta: { regionByCode: [string, string][]; regions: string[]; partnershipComplete: boolean } }
  | { t: "error"; id: number; error: string }
  /** The finished seasons' pair history finished building on the worker (engine.ts rebuilds the forecasters that went without it). */
  | { t: "prefixReady"; before: number };

/** The worker's entry: build/server/forecasterWorker.mjs next to the server bundle, or the source through tsx. */
export const rebuildWorkerEntry = (moduleUrl = import.meta.url, execArgv: readonly string[] = process.execArgv) =>
  entryFor("./forecasterWorker.mjs", "./rebuildWorker.ts", moduleUrl, execArgv);

interface Pending {
  resolve: (p: ForecasterParts) => void; reject: (e: Error) => void; anchor: number; timer: NodeJS.Timeout;
  /** Parts sent for this rebuild, and the kept ones it was told about (as they were when asked: another rebuild may replace them meanwhile). */
  got: Map<string, { kind: PartKind; value: unknown }>; had: Map<string, { hash: string; value: unknown }>;
}

let worker: Worker | null = null;
let workerFile: string | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
/** Parts kept from earlier rebuilds, by `anchor|name`: the content hash the worker gave and the value built here. */
const held = new Map<string, { hash: string; value: unknown }>();
let prefixListener: (before: number) => void = () => {};
let runs = 0;

/** Rebuilds sent to the worker in this process (tests). */
export const offThreadRebuilds = () => runs;
/** Whether the rebuild worker is running (tests). */
export const rebuildWorkerAlive = () => worker != null;
/** Called when the worker's pair-history prefix finishes building (engine.ts registers its handler). */
export function onWorkerPrefixReady(fn: (before: number) => void): void { prefixListener = fn; }

function stop(reason: Error): void {
  const w = worker;
  worker = null;
  workerFile = null;
  for (const [id, p] of pending) { clearTimeout(p.timer); pending.delete(id); p.reject(reason); }
  if (w) void w.terminate();
}

function start(file: string): Worker {
  const { url, execArgv } = rebuildWorkerEntry();
  const w = new Worker(url, { workerData: { file }, ...(execArgv ? { execArgv } : {}) });
  w.unref(); // a script or test that's done exits without stopping it
  w.on("message", (m: FromRebuildWorker) => { if (worker === w) onMessage(m); });
  w.once("error", (e) => { if (worker === w) stop(e); });
  w.once("exit", (code) => { if (worker === w) stop(new Error(`forecaster rebuild worker exited with code ${code}`)); });
  worker = w;
  workerFile = file;
  return w;
}

function onMessage(m: FromRebuildWorker): void {
  if (m.t === "prefixReady") { prefixListener(m.before); return; }
  const p = pending.get(m.id);
  if (m.t === "chunk") {
    if (p) take(p, m);
    // The next slice only after the loop has turned: requests waiting meanwhile go first.
    const w = worker;
    setImmediate(() => { if (worker === w) w?.postMessage({ t: "ack" } satisfies ToRebuildWorker); });
    return;
  }
  if (!p) return;
  if (m.t === "error") { finish(m.id, p); p.reject(new Error(m.error)); return; }
  finish(m.id, p);
  try {
    p.resolve(assemble(p, m));
  } catch (e) {
    p.reject(e as Error);
  }
}

function finish(id: number, p: Pending): void {
  clearTimeout(p.timer);
  pending.delete(id);
}

/** One slice in: appended to its part (events), the part itself (whole), or entries into its table's maps. */
function take(p: Pending, m: Extract<FromRebuildWorker, { t: "chunk" }>): void {
  let part = p.got.get(m.name);
  if (m.kind === "events") {
    if (!part) p.got.set(m.name, (part = { kind: "events", value: [] }));
    for (const e of m.data as EventRecord[]) (part.value as EventRecord[]).push(e);
  } else if (m.kind === "table") {
    if (!part) p.got.set(m.name, (part = { kind: "table", value: { tog: new Map(), ag: new Map(), names: new Map(), season: null } satisfies TableFields }));
    const t = part.value as TableFields;
    if (m.season !== undefined) t.season = m.season;
    if (m.map) { const into = t[m.map] as Map<unknown, unknown>; for (const [k, v] of m.data as [unknown, unknown][]) into.set(k, v); }
  } else {
    p.got.set(m.name, { kind: "whole", value: m.data });
  }
}

/** Engine objects back from their fields: a PartnershipTable from its maps, a RatingBook from its own properties. */
const table = (t: TableFields): PartnershipTable => Object.assign(Object.create(PartnershipTable.prototype) as PartnershipTable, t);
const book = (fields: object): RatingBook => Object.setPrototypeOf(fields, RatingBook.prototype) as RatingBook;

function assemble(p: Pending, done: Extract<FromRebuildWorker, { t: "done" }>): ForecasterParts {
  const value = (name: string, hash: string | null, kind: PartKind): unknown => {
    const key = `${p.anchor}|${name}`;
    const got = p.got.get(name);
    if (got) {
      const v = kind === "table" ? table(got.value as TableFields) : got.value;
      if (hash) held.set(key, { hash, value: v }); else held.delete(key);
      return v;
    }
    const kept = p.had.get(name);
    if (!kept || kept.hash !== hash) throw new Error(`forecaster rebuild: part ${name} was neither sent nor kept`);
    held.set(key, kept);
    return kept.value;
  };
  const parts: ForecasterParts = {
    books: new Map(), events: new Map(), advancement: new Map(),
    regionByCode: new Map(done.meta.regionByCode), regions: new Set(done.meta.regions),
    partnershipData: null, pairTable: null, pastPairTables: new Map(), partnershipComplete: done.meta.partnershipComplete,
  };
  const names = new Set<string>();
  for (const { name, kind, hash } of done.parts) {
    names.add(name);
    const v = value(name, hash, kind);
    const [what, s] = name.split(":");
    const season = Number(s);
    if (what === "book") parts.books.set(season, book(v as object));
    else if (what === "events") parts.events.set(season, v as EventRecord[]);
    else if (what === "advancement") parts.advancement.set(season, v as AdvancementRecord[]);
    else if (what === "pairs") parts.partnershipData = v as PartnershipData;
    else if (what === "table") parts.pairTable = v as PartnershipTable;
    else if (what === "past") parts.pastPairTables.set(season, v as PartnershipTable);
  }
  // A part the window no longer has (a season that went): not kept.
  for (const key of [...held.keys()]) if (key.startsWith(`${p.anchor}|`) && !names.has(key.slice(`${p.anchor}|`.length))) held.delete(key);
  return parts;
}

/**
 * The window's replay (replayWindow) on the rebuild worker. Null when the database isn't a file the worker can open
 * (in memory, an embedded replica, remote): the caller replays on this thread as before. Rejects if the worker fails.
 */
export async function replayOffThread(anchor: number, seasons: number[], timeoutMs = REBUILD_TIMEOUT_MS): Promise<ForecasterParts | null> {
  const file = await localDbFile();
  if (!file) return null;
  if (worker && workerFile !== file) stop(new Error("database changed"));
  const w = worker ?? start(file);
  const id = nextId++;
  runs++;
  const have: Record<string, string> = {};
  const had = new Map<string, { hash: string; value: unknown }>();
  for (const [key, v] of held) if (key.startsWith(`${anchor}|`)) { const name = key.slice(`${anchor}|`.length); have[name] = v.hash; had.set(name, v); }
  return new Promise<ForecasterParts>((resolve, reject) => {
    const timer = setTimeout(() => stop(new Error(`forecaster rebuild took over ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    timer.unref();
    pending.set(id, { resolve, reject, anchor, got: new Map(), had, timer });
    w.postMessage({ t: "rebuild", id, anchor, seasons, have } satisfies ToRebuildWorker);
  });
}

/** Drop the worker's kept season reads and what this side kept (resetForecasters). */
export function resetOffThread(): void {
  held.clear();
  worker?.postMessage({ t: "reset" } satisfies ToRebuildWorker);
}

/** Stop the worker (tests). */
export function stopRebuildWorker(): void { stop(new Error("stopped")); held.clear(); }
