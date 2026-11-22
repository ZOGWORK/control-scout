// The sitemap's database reads (sitemap.ts sitemapRows) on a worker thread, so the web process's event loop never runs
// them.
//
// They are seven statements over whole tables (every played match, every team, every event's highlights): on the prod
// data copy 20 s together, held as one block, the two largest 7.0 s (team highlights) and 8.3 s (record splits). The
// driver reads on this process's one thread, and the sitemap is rebuilt at most once an hour, on the first request
// after that: on 2026-11-22 the site answered nothing 07:35:48–36:02 and 09:24:53–25:07Z, each gap ended by the
// crawler's /sitemap.xml. Here a worker opens the same database file and runs the very sitemapRows for the same day:
// same code, same data, same rows. The URLs are still put together here, from those rows.
//
// A database that isn't a file of its own (a remote one, an in-memory test database) is read here, as before.
import { Worker } from "node:worker_threads";
import { localDbFile } from "./db.js";
import { entryFor } from "./projections/offThread.js";
import { sitemapRows, type SitemapRows } from "./sitemap.js";

export type FromSitemapWorker = { rows: SitemapRows } | { error: string };

/** Reads still going after this long are given up on (the worker stopped, the request answers 500, the next one retries). */
export const SITEMAP_TIMEOUT_MS = 5 * 60_000;

/** The worker's entry: build/server/sitemapWorker.mjs next to the server bundle, or the source through tsx. */
export const sitemapWorkerEntry = (moduleUrl = import.meta.url, execArgv: readonly string[] = process.execArgv) =>
  entryFor("./sitemapWorker.mjs", "./sitemapWorker.ts", moduleUrl, execArgv);

let runs = 0;
/** Reads run on a worker in this process (tests). */
export const offThreadSitemaps = () => runs;

/** sitemapRows(today), on a worker when the database is a file of its own. */
export async function sitemapRowsOffThread(today: string, timeoutMs = SITEMAP_TIMEOUT_MS): Promise<SitemapRows> {
  const file = await localDbFile();
  if (!file) return sitemapRows(today);
  runs++;
  const { url, execArgv } = sitemapWorkerEntry();
  return new Promise<SitemapRows>((resolve, reject) => {
    const w = new Worker(url, { workerData: { file, today }, ...(execArgv ? { execArgv } : {}) });
    let settled = false;
    const done = (f: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void w.terminate();
      f();
    };
    const timer = setTimeout(() => done(() => reject(new Error(`the sitemap's reads took over ${Math.round(timeoutMs / 1000)} s`))), timeoutMs);
    w.once("message", (m: FromSitemapWorker) => done(() => ("rows" in m ? resolve(m.rows) : reject(new Error(m.error)))));
    w.once("error", (e) => done(() => reject(e)));
    w.once("exit", (code) => done(() => reject(new Error(`the sitemap's worker exited with code ${code}`))));
  });
}
