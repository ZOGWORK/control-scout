// The forecaster's rebuild thread (offThread.ts): one replayWindow per message, on its own connection to the server's
// database file, nothing else. Built as build/server/forecasterWorker.mjs next to the server bundle
// (scripts/build-server.mjs); run from source through tsx. Its season reads and pair-history prefix are kept here
// between rebuilds, as the server kept them before.
import { parentPort, workerData } from "node:worker_threads";
import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import type { EventRecord, PartnershipTable } from "@control-scout/predict-engine";
import { configure, openDb, setDb } from "../db.js";
import { dataVersion, replayWindow, resetForecasters } from "./engine.js";
import { sharedReplay } from "./sharedRatings.js";
import { onPartnershipPrefixReady } from "./partnerships.js";
import type { FromRebuildWorker, PartKind, TableFields, ToRebuildWorker } from "./offThread.js";

/** Matches per events message, and entries per table message: each a few tens of ms to take in on the server's thread. */
const MATCHES_PER_CHUNK = 3000;
const ENTRIES_PER_CHUNK = 20_000;

const db = openDb(`file:${(workerData as { file: string }).file.replace(/\\/g, "/")}`);
setDb(db);
const ready = configure(db);
const port = parentPort!;
const post = (m: FromRebuildWorker) => port.postMessage(m);
/** The server takes each slice in on a turn of its own and then asks for the next (ack): sent all at once, they would
 *  queue up and be taken in back to back, holding its loop for the whole lot. */
let acked: (() => void) | null = null;
const slice = (m: FromRebuildWorker) => new Promise<void>((go) => { acked = go; post(m); });

onPartnershipPrefixReady((before) => post({ t: "prefixReady", before }));

const hashOf = (v: unknown) => createHash("sha1").update(serialize(v)).digest("hex");

async function rebuild(m: Extract<ToRebuildWorker, { t: "rebuild" }>): Promise<void> {
  await ready;
  // Shared with the machine's other processes (sharedRatings.ts): a build already made for this data is loaded here,
  // on this thread, instead of replayed; one made here is saved for them.
  const p = await sharedReplay(m.anchor, m.seasons, await dataVersion(), replayWindow);
  const parts: { name: string; kind: PartKind; hash: string | null }[] = [];
  /** A part by its content: not sent when the server already holds the same. */
  const send = async (name: string, kind: PartKind, value: unknown, hashed: boolean, chunks: () => Promise<void>) => {
    const hash = hashed ? hashOf(value) : null;
    parts.push({ name, kind, hash });
    if (hash && m.have[name] === hash) return;
    await chunks();
  };
  const whole = (name: string, value: unknown, hashed = true) => send(name, "whole", value, hashed, () => slice({ t: "chunk", id: m.id, name, kind: "whole", data: value }));
  const tableOf = (name: string, t: PartnershipTable) => {
    const f = t as unknown as TableFields;
    return send(name, "table", f, true, async () => {
      await slice({ t: "chunk", id: m.id, name, kind: "table", data: null, season: f.season });
      for (const map of ["tog", "ag", "names"] as const) {
        const entries = [...(f[map] as Map<unknown, unknown>)];
        for (let i = 0; i < entries.length; i += ENTRIES_PER_CHUNK) await slice({ t: "chunk", id: m.id, name, kind: "table", map, data: entries.slice(i, i + ENTRIES_PER_CHUNK) });
      }
    });
  };
  // Books change with every rebuild and are small: always sent, as their own fields.
  for (const [s, b] of p.books) await whole(`book:${s}`, { ...b }, false);
  for (const [s, evs] of p.events) {
    const name = `events:${s}`;
    await send(name, "events", evs, true, async () => {
      let part: EventRecord[] = [], n = 0;
      const flush = async () => { const data = part; part = []; n = 0; await slice({ t: "chunk", id: m.id, name, kind: "events", data }); };
      for (const e of evs) { part.push(e); n += e.matches.length + 1; if (n >= MATCHES_PER_CHUNK) await flush(); }
      await flush(); // an empty season still arrives as one
    });
  }
  for (const [s, a] of p.advancement) await whole(`advancement:${s}`, a);
  if (p.partnershipData) await whole("pairs", p.partnershipData);
  if (p.pairTable) await tableOf("table", p.pairTable);
  for (const [s, t] of p.pastPairTables) await tableOf(`past:${s}`, t);
  post({ t: "done", id: m.id, parts, meta: { regionByCode: [...p.regionByCode], regions: [...p.regions], partnershipComplete: p.partnershipComplete } });
}

let queue = Promise.resolve();
port.on("message", (m: ToRebuildWorker) => {
  if (m.t === "ack") { const go = acked; acked = null; go?.(); return; }
  if (m.t === "reset") { queue = queue.then(() => resetForecasters()); return; }
  queue = queue.then(() => rebuild(m).catch((e) => post({ t: "error", id: m.id, error: e instanceof Error ? e.message : String(e) })));
});
