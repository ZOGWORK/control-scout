// The share cards' drawing thread (offThread.ts): one renderCard per message, in turn, nothing else. Built as
// build/server/shareCardWorker.mjs next to the server bundle (scripts/build-server.mjs); run from source through tsx.
import { parentPort } from "node:worker_threads";
import { renderCard } from "./card.js";
import type { FromCardWorker, ToCardWorker } from "./offThread.js";

parentPort!.on("message", async (m: ToCardWorker) => {
  try {
    const png = await renderCard(m.model);
    parentPort!.postMessage({ id: m.id, png } satisfies FromCardWorker);
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: e instanceof Error ? e.message : String(e) } satisfies FromCardWorker);
  }
});
