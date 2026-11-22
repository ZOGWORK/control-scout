// The owner console's Data report on a thread of its own (dataReportOffThread.ts): one computeDataReport on its own
// connection to the server's database file, posted back, nothing else. Built as build/server/dataReportWorker.mjs next to
// the server bundle (scripts/build-server.mjs); run from source through tsx.
import { parentPort, workerData } from "node:worker_threads";
import { configure, openDb, setDb } from "../db.js";
import type { FromDataReportWorker } from "./dataReportOffThread.js";

const { file, now } = workerData as { file: string; now: number };
const post = (m: FromDataReportWorker) => parentPort!.postMessage(m);
const db = openDb(`file:${file.replace(/\\/g, "/")}`);
setDb(db);
try {
  await configure(db);
  // The search modules first, as the server loads them (app.ts): dataReport's imports reach them through a cycle that
  // only resolves in that order.
  await import("../api/search.js");
  const { computeDataReport } = await import("./dataReport.js");
  post({ report: await computeDataReport(now) });
} catch (e) {
  post({ error: (e as Error).message });
}
