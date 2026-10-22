// The local estimate's Web Worker: the simulation runs here so the page never freezes (protocol.ts).
import { workerHandler, type FromWorker, type ToWorker } from "./protocol";

const scope = self as unknown as { postMessage(m: FromWorker): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const handle = workerHandler((m) => scope.postMessage(m));
scope.onmessage = (e) => { void handle(e.data); };
