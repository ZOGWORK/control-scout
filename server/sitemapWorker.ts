// The sitemap's database reads on a thread of its own (sitemapOffThread.ts): one sitemapRows on its own connection to the
// server's database file, posted back, nothing else. Built as build/server/sitemapWorker.mjs next to the server bundle
// (scripts/build-server.mjs); run from source through tsx.
import { parentPort, workerData } from "node:worker_threads";
import { configure, openDb, setDb } from "./db.js";
import type { FromSitemapWorker } from "./sitemapOffThread.js";

const { file, today } = workerData as { file: string; today: string };
const post = (m: FromSitemapWorker) => parentPort!.postMessage(m);
const db = openDb(`file:${file.replace(/\\/g, "/")}`);
setDb(db);
try {
  await configure(db);
  // The search modules first, as the server loads them (app.ts): the sitemap's imports reach them through a cycle that
  // only resolves in that order.
  await import("./api/search.js");
  const { sitemapRows } = await import("./sitemap.js");
  post({ rows: await sitemapRows(today) });
} catch (e) {
  post({ error: (e as Error).message });
}
