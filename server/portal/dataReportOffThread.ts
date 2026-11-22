// The owner console's Data report (dataReport.ts) worked out on a worker thread, so the web process's event loop never
// runs its reads.
//
// Its checks are each one statement over the whole match history (which team played when, record against record): on
// the prod data copy the report took 21.9 s, its longest single statements 7.3 s and 7.1 s. The driver reads on this
// process's one thread, so the site stood still while the owner console opened (05:23:27–44Z on 2026-11-22: 17 s with
// no request answered, the console's own requests the first ones out). Here a worker opens the same database file and
// runs the very computeDataReport, with the same `now`: same code, same data, same report.
//
// A database that isn't a file of its own (a remote one, an in-memory test database) is read here, as before.
import { Worker } from "node:worker_threads";
import type { OwnerDataReport } from "../../src/shared/ownerData.js";
import { localDbFile } from "../db.js";
import { entryFor } from "../projections/offThread.js";
import { computeDataReport } from "./dataReport.js";

export type FromDataReportWorker = { report: OwnerDataReport } | { error: string };

/** A report still going after this long is given up on (its worker stopped). */
export const DATA_REPORT_TIMEOUT_MS = 5 * 60_000;

/** The worker's entry: build/server/dataReportWorker.mjs next to the server bundle, or the source through tsx. */
export const dataReportWorkerEntry = (moduleUrl = import.meta.url, execArgv: readonly string[] = process.execArgv) =>
  entryFor("./dataReportWorker.mjs", "./dataReportWorker.ts", moduleUrl, execArgv);

let runs = 0;
/** Reports worked out on a worker in this process (tests). */
export const offThreadReports = () => runs;

/** computeDataReport(now), on a worker when the database is a file of its own. */
export async function dataReportOffThread(now = Date.now(), timeoutMs = DATA_REPORT_TIMEOUT_MS): Promise<OwnerDataReport> {
  const file = await localDbFile();
  if (!file) return computeDataReport(now);
  runs++;
  const { url, execArgv } = dataReportWorkerEntry();
  return new Promise<OwnerDataReport>((resolve, reject) => {
    const w = new Worker(url, { workerData: { file, now }, ...(execArgv ? { execArgv } : {}) });
    let settled = false;
    const done = (f: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void w.terminate();
      f();
    };
    const timer = setTimeout(() => done(() => reject(new Error(`the data report took over ${Math.round(timeoutMs / 1000)} s`))), timeoutMs);
    w.once("message", (m: FromDataReportWorker) => done(() => ("report" in m ? resolve(m.report) : reject(new Error(m.error)))));
    w.once("error", (e) => done(() => reject(e)));
    w.once("exit", (code) => done(() => reject(new Error(`the data report's worker exited with code ${code}`))));
  });
}
