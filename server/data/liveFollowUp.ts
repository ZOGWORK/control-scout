// The live fast lane's follow-up after new results (server/data/live.ts): the data version, the events' stats and
// their teams' season rows, the season's record tables (throttled by the caller), the live ledger (scored calls,
// their report cards, new pre-match calls) and the home page's coin flips.
//
// That is seconds of synchronous CPU at a busy weekend's 70 live events (measured on the VM 11-21: the event loop
// stood still 12–13 s after the records rebuild, 5–9 s after report cards and coin flips), so where the data cycle
// runs in a child process (DATA_CYCLE=child, a local database file) the follow-up runs in one too
// (scripts/live-follow-up.ts) and the web process only waits for it with its event loop free. It writes the same
// SQLite file (WAL); the server's caches are keyed by the data version and data:settled, which the follow-up moves,
// so nothing else needs to be signalled. Elsewhere (a remote database, a host too small for a second process) it
// runs in the server process as before. Same steps, same order, either way.
import { kvSet } from "../db.js";
import { refreshEventStats, logLivePredictions, scoreLivePredictions } from "../stats/job.js";
import { refreshReportCards } from "../stats/reportCards.js";
import { computeRecords } from "../stats/records.js";
import { loadSeason } from "../stats/load.js";
import { resultsAtKey } from "../api/readiness.js";
import { childCycle } from "./jobs.js";
import { runScriptInChild, withHeapCap } from "./cycle.js";
import { appPath } from "../appRoot.js";

type Log = (m: string) => void;

export interface FollowUpJob {
  /** Events whose new results are stored. */
  due: { season: number; code: string }[];
  /** Seasons whose record tables are rewritten this time (the caller's throttle, RECORDS_EVERY_MS). */
  records: number[];
}

export interface FollowUpResult { scored: number; logged: number }

export interface FollowUpHooks {
  log?: Log;
  now?: () => number;
  /** Called as a season's records rebuild starts (the caller's throttle counts from then, success or not). */
  onRecords?: (season: number) => void;
}

/** How many follow-ups ran in this process (tests: where DATA_CYCLE=child, never the web process). */
let runsHere = 0;
export const followUpRunsHere = () => runsHere;

/** The follow-up itself, in whatever process calls it. */
export async function runFollowUp(job: FollowUpJob, h: FollowUpHooks = {}): Promise<FollowUpResult> {
  runsHere++;
  const log = h.log ?? (() => {});
  const now = h.now ?? Date.now;
  // New data version first: the season rows read ratings, and the live calls must use the newest ones.
  await kvSet("data:version", new Date(now()).toISOString());
  const bySeason = new Map<number, string[]>();
  for (const e of job.due) bySeason.set(e.season, [...(bySeason.get(e.season) ?? []), e.code]);
  for (const [s, codes] of bySeason) {
    // New results are stored for this season: until its records are rebuilt (below, or by a later tick
    // when that's throttled) the season reads as catching up (api/readiness.ts).
    await kvSet(resultsAtKey(s), { at: new Date(now()).toISOString() });
    await refreshEventStats(s, codes, log);
    // The record tables (/api/records, CSV) are season-wide rewrites: at most every 5 minutes while
    // results come in (the 15-minute cycle rewrites them too); the engine's exclusives carry over.
    if (job.records.includes(s)) { h.onRecords?.(s); await computeRecords(s, await loadSeason(s), log); await kvSet("records:last", { at: new Date(now()).toISOString() }); }
  }
  const scored = await scoreLivePredictions(log);
  // Newly scored live calls: the report cards of every season they changed (a per-season rewrite of a few thousand rows at most).
  if (scored) await refreshReportCards(log);
  const logged = await logLivePredictions(log);
  // New results (and any schedule changes) at today's events: the home page's coin flips follow.
  await (await import("../api/coinFlips.js")).refreshCoinFlips(log); // (dynamic: coinFlips imports live.ts)
  // The follow-up's writes are done (see runStats: caches keyed by the data version are keyed by this too).
  await kvSet("data:settled", new Date(now()).toISOString());
  return { scored, logged };
}

/** Run the follow-up in a child process where the data cycle has one (LIVE_FOLLOW_UP=inline keeps it here). */
export const childFollowUp = () => process.env.LIVE_FOLLOW_UP !== "inline" && childCycle();

const SCRIPT = appPath("scripts", "live-follow-up.ts");

/** Messages from the child (scripts/live-follow-up.ts). */
export type FollowUpMessage =
  | { records: number }
  | { done: FollowUpResult }
  | { error: { message: string; code?: string } };

/**
 * The child's heap limit (MB). Without one V8 sizes a short-lived process's heap for the machine (about 4 GB on the VM)
 * and barely collects before it exits: the child held 1.3 GB for a job whose heap was under 400 MB, every minute of an
 * event day, on top of the web process. With 1024 it peaked at 0.88 GB in the same time (measured on the VM
 * 2026-11-22, on a copy of its data: 16 live events and the season's records).
 */
export const FOLLOW_UP_HEAP_MB = 1024;

/** Starts a child script (runScriptInChild's shape; tests pass a stand-in). */
export type ChildRunner = typeof runScriptInChild;

/**
 * The follow-up in a child Node process; resolves with its counts. A failure in the child is rethrown here with its
 * message and code, so the caller tells "database busy" from a real failure as it would in-process. The child gets
 * FOLLOW_UP_HEAP_MB of heap; one that runs out of it (a weekend busier than any measured) runs once more without the
 * limit (cycle.ts withHeapCap), so live results never stop on it. Each step rewrites what it covers, so the second run
 * stores what one would.
 */
export function runFollowUpInChild(job: FollowUpJob, h: Omit<FollowUpHooks, "now" | "log"> = {}, timeoutMs = 10 * 60_000, run: ChildRunner = runScriptInChild): Promise<FollowUpResult> {
  return withHeapCap(FOLLOW_UP_HEAP_MB, "live follow-up", (execArgv) => followUpOnce(job, h, timeoutMs, execArgv, run));
}

async function followUpOnce(job: FollowUpJob, h: Omit<FollowUpHooks, "now" | "log">, timeoutMs: number, execArgv: readonly string[], run: ChildRunner): Promise<FollowUpResult> {
  let result: FollowUpResult | null = null;
  let failure: { message: string; code?: string } | null = null;
  try {
    await run(SCRIPT, "live follow-up", timeoutMs, execArgv, [JSON.stringify(job)], {
      onMessage: (m) => {
        const msg = m as FollowUpMessage;
        if ("records" in msg) h.onRecords?.(msg.records);
        else if ("done" in msg) result = msg.done;
        else if ("error" in msg) failure = msg.error;
      },
    });
  } catch (e) {
    if (!failure) throw e;
  }
  const f = failure as { message: string; code?: string } | null;
  if (f) throw Object.assign(new Error(f.message), f.code ? { code: f.code } : {});
  if (!result) throw new Error("live follow-up process ended without a result");
  return result;
}
