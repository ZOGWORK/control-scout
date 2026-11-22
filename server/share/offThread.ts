// Share cards drawn on a worker thread, so the web process's event loop never runs resvg.
//
// A card is ~120–170 ms of synchronous wasm (the SVG render, the font parse and the PNG encode), and link-preview
// crawlers ask for thousands a day (PerplexityBot: 37,020 of 37,242 card requests from 11-08 to 11-22, nearly every
// one a new card). On the main thread each was that long with every other request on the lane waiting behind it.
// Here one long-lived worker draws them in turn (wasm and fonts loaded once); the main thread only posts the model
// and gets the PNG back.
//
// Same code, same inputs, same bytes: the worker runs the very renderCard (card.ts) on the structured-cloned model.
// If the worker can't start or dies, that card is drawn here instead, so a card never fails for the thread's sake.
import { Worker } from "node:worker_threads";
import { entryFor } from "../projections/offThread.js";
import { renderCard, type CardModel } from "./card.js";

export interface ToCardWorker { id: number; model: CardModel }
export type FromCardWorker = { id: number; png: Uint8Array } | { id: number; error: string };

/** A card still not drawn after this long: the worker is stopped (and the card drawn here). */
export const CARD_WORKER_TIMEOUT_MS = 30_000;

/** The worker's entry: build/server/shareCardWorker.mjs next to the server bundle, or the source through tsx. */
export const cardWorkerEntry = (moduleUrl = import.meta.url, execArgv: readonly string[] = process.execArgv) =>
  entryFor("./shareCardWorker.mjs", "./cardWorker.ts", moduleUrl, execArgv);

interface Waiting { resolve: (png: Buffer) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
let worker: Worker | null = null;
const waiting = new Map<number, Waiting>();
let nextId = 0;
let drawnOff = 0, drawnHere = 0;
/** Cards drawn on the worker and on this thread (tests, logs). */
export const cardRenderCounts = () => ({ offThread: drawnOff, here: drawnHere });

/** Stop the worker, failing whatever it still had (tests; a stuck or dead worker). */
export function stopCardWorker(why = "card worker stopped"): void {
  const w = worker;
  worker = null;
  for (const [id, x] of waiting) { clearTimeout(x.timer); waiting.delete(id); x.reject(new Error(why)); }
  if (w) void w.terminate();
}

function start(): Worker {
  const { url, execArgv } = cardWorkerEntry();
  const w = new Worker(url, execArgv ? { execArgv } : {});
  w.unref(); // an idle card worker never keeps the process alive
  w.on("message", (m: FromCardWorker) => {
    const x = waiting.get(m.id);
    if (!x) return;
    waiting.delete(m.id);
    clearTimeout(x.timer);
    if ("error" in m) x.reject(new Error(m.error));
    else x.resolve(Buffer.from(m.png.buffer, m.png.byteOffset, m.png.byteLength));
  });
  const gone = (why: string) => { if (worker === w) stopCardWorker(why); };
  w.once("error", (e) => gone(`card worker failed: ${e.message}`));
  w.once("exit", (code) => gone(`card worker exited with code ${code}`));
  return w;
}

function drawOffThread(model: CardModel): Promise<Buffer> {
  worker ??= start();
  const w = worker;
  const id = ++nextId;
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => { if (worker === w) stopCardWorker(`card took over ${CARD_WORKER_TIMEOUT_MS / 1000} s`); }, CARD_WORKER_TIMEOUT_MS);
    timer.unref?.();
    waiting.set(id, { resolve, reject, timer });
    try {
      w.postMessage({ id, model } satisfies ToCardWorker);
    } catch (e) {
      clearTimeout(timer);
      waiting.delete(id);
      reject(e as Error);
    }
  });
}

/** The card as a PNG, drawn on the worker (or here when the worker can't). Byte for byte renderCard's. */
export async function renderCardOffThread(model: CardModel): Promise<Buffer> {
  try {
    const png = await drawOffThread(model);
    drawnOff++;
    return png;
  } catch (e) {
    console.error(`[share] ${(e as Error).message}: card drawn on the main thread`);
    drawnHere++;
    return renderCard(model);
  }
}
