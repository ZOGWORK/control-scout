// Share cards drawn on a worker thread, so the web process's event loop never runs resvg.
//
// A card is ~120–170 ms of synchronous wasm (the SVG render, the font parse and the PNG encode), and link-preview
// crawlers ask for thousands a day (PerplexityBot: 37,020 of 37,242 card requests from 11-08 to 11-22, nearly every
// one a new card). On the main thread each was that long with every other request on the lane waiting behind it.
// Here one long-lived worker draws them (wasm and fonts loaded once); the main thread only posts the model and gets
// the PNG back.
//
// One card at a time goes to the worker; the rest wait here, in order, at most MAX_QUEUED of them (a burst past that
// is told to come back: CardQueueFull, a 503). The time limit runs from when the worker gets a card, never while it
// waits, so a long queue never looks like a stuck worker. A worker that dies or takes over CARD_WORKER_TIMEOUT_MS on
// a card is replaced; only that one card is drawn here (it may be what broke the worker), and the queue goes on with
// the new worker.
//
// Same code, same inputs, same bytes: the worker runs the very renderCard (card.ts) on the structured-cloned model.
import { Worker } from "node:worker_threads";
import { entryFor } from "../projections/offThread.js";
import { renderCard, type CardModel } from "./card.js";

export interface ToCardWorker { id: number; model: CardModel }
export type FromCardWorker = { id: number; png: Uint8Array } | { id: number; error: string };

/** One card taking longer than this on the worker: the worker is replaced (and that card drawn here). */
export const CARD_WORKER_TIMEOUT_MS = 30_000;
/** Cards waiting for the worker at most (~15 s of drawing); more are refused (CardQueueFull). */
export const MAX_QUEUED = 100;
let timeoutMs = CARD_WORKER_TIMEOUT_MS, maxQueued = MAX_QUEUED;
/** Tests: other limits (no argument: the real ones). */
export function setCardQueueLimits(o: { timeoutMs?: number; maxQueued?: number } = {}): void {
  timeoutMs = o.timeoutMs ?? CARD_WORKER_TIMEOUT_MS;
  maxQueued = o.maxQueued ?? MAX_QUEUED;
}

/** Too many cards waiting to be drawn: ask again later (the route answers 503 with Retry-After). */
export class CardQueueFull extends Error { constructor() { super("Too many share cards are being drawn right now. Try again in a moment."); } }

/** The worker's entry: build/server/shareCardWorker.mjs next to the server bundle, or the source through tsx. */
export const cardWorkerEntry = (moduleUrl = import.meta.url, execArgv: readonly string[] = process.execArgv) =>
  entryFor("./shareCardWorker.mjs", "./cardWorker.ts", moduleUrl, execArgv);

interface Job { id: number; model: CardModel; resolve: (png: Buffer) => void; reject: (e: Error) => void }
let worker: Worker | null = null;
const queue: Job[] = [];
let current: { job: Job; worker: Worker; timer: ReturnType<typeof setTimeout> } | null = null;
let nextId = 0;
let drawnOff = 0, drawnHere = 0, refused = 0;
/** Cards drawn on the worker, drawn here (a worker failed on them) and refused (queue full): tests and logs. */
export const cardRenderCounts = () => ({ offThread: drawnOff, here: drawnHere, refused });
/** Cards waiting for the worker, plus the one it's drawing (tests). */
export const cardsPending = () => queue.length + (current ? 1 : 0);

/** The card being drawn: done with `png`, or failed on the worker (drawn here instead). Then the next one. */
function settle(w: Worker, out: { png: Buffer } | { error: Error }): void {
  if (!current || current.worker !== w) return;
  const { job, timer } = current;
  clearTimeout(timer);
  current = null;
  if ("png" in out) { drawnOff++; job.resolve(out.png); }
  else {
    console.error(`[share] ${out.error.message}: card drawn on the main thread`);
    drawnHere++;
    renderCard(job.model).then(job.resolve, job.reject);
  }
  pump();
}

/** Replace a dead or stuck worker: its card (if any) is drawn here, the queue goes to a new one. */
function lose(w: Worker, why: string): void {
  if (worker === w) worker = null;
  void w.terminate();
  settle(w, { error: new Error(why) });
}

function start(): Worker {
  const { url, execArgv } = cardWorkerEntry();
  const w = new Worker(url, execArgv ? { execArgv } : {});
  w.unref(); // an idle card worker never keeps the process alive
  w.on("message", (m: FromCardWorker) => {
    if (current?.worker !== w || current.job.id !== m.id) return;
    // A card the worker couldn't draw (an error in renderCard) is drawn here: the same error, or the card, either way.
    settle(w, "error" in m ? { error: new Error(m.error) } : { png: Buffer.from(m.png.buffer, m.png.byteOffset, m.png.byteLength) });
  });
  w.once("error", (e) => lose(w, `card worker failed: ${e.message}`));
  w.once("exit", (code) => lose(w, `card worker exited with code ${code}`));
  return w;
}

/** Hand the next waiting card to the worker (one at a time); its time limit starts now. */
function pump(): void {
  if (current || !queue.length) return;
  const job = queue.shift()!;
  let w: Worker;
  try { w = worker ??= start(); } catch (e) {
    console.error(`[share] card worker can't start (${(e as Error).message}): card drawn on the main thread`);
    drawnHere++;
    renderCard(job.model).then(job.resolve, job.reject).finally(pump);
    return;
  }
  const timer = setTimeout(() => lose(w, `card took over ${timeoutMs / 1000} s`), timeoutMs);
  timer.unref?.();
  current = { job, worker: w, timer };
  try {
    w.postMessage({ id: job.id, model: job.model } satisfies ToCardWorker);
  } catch (e) {
    settle(w, { error: e as Error });
  }
}

/** Stop the worker (tests): a card it was drawing is drawn here, waiting ones go to the next worker. */
export function stopCardWorker(why = "card worker stopped"): void {
  const w = worker;
  if (w) lose(w, why);
}

/** The card as a PNG, drawn on the worker (or here, if the worker fails on it). Byte for byte renderCard's.
 *  Throws CardQueueFull when MAX_QUEUED cards are already waiting. */
export function renderCardOffThread(model: CardModel): Promise<Buffer> {
  if (queue.length >= maxQueued) { refused++; return Promise.reject(new CardQueueFull()); }
  return new Promise<Buffer>((resolve, reject) => {
    queue.push({ id: ++nextId, model, resolve, reject });
    pump();
  });
}
