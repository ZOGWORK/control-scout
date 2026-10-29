// Data operations the owner can start from the portal: re-sync now, rebuild the offline packs,
// clear the in-memory caches. Each one starts in the background (the request answers at once) and
// reports its progress through opsStatus().
//
// None of them ever runs alongside the scheduled data cycle or the live fast lane: a re-sync is the
// cycle itself (data/jobs.ts: one per process, and it takes the writer lease), and the other two
// hold the writer lease (data/lock.ts) while they work. When the lease is taken, or a job of the
// same kind is still running here, the op is refused with the reason instead of queued.
import { kvSet } from "../db.js";
import { lockHolder, LockBusy, withDataLock } from "../data/lock.js";
import { childCycle, cycleRunning, runDataCycle } from "../data/jobs.js";
import { runPacksInChild } from "../data/cycle.js";
import { buildPacks } from "../packs/build.js";
import { clearAllCaches, registerCache } from "../caches.js";
import { forecasterFor } from "../predict/engine.js";
import { warmTrackRecord } from "../api/accuracy.js";
import { resetWeatherCache } from "../weather.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { recordAudit, setAuditResult } from "./audit.js";
import { resetDataReport } from "./dataReport.js";
import type { OpJob, OpName, OpsStatus } from "../../src/shared/owner.js";

// The weather module is shared with Control Point as-is, so its cache is registered here.
registerCache("Weather", resetWeatherCache);

export const OPS: OpName[] = ["resync", "packs", "caches"];
export const isOp = (x: unknown): x is OpName => typeof x === "string" && (OPS as string[]).includes(x);

const OP_ACTION: Record<OpName, string> = { resync: "ops.resync", packs: "ops.packs", caches: "ops.caches" };

type Log = (m: string) => void;
/** What each op does (replaceable in tests, so they never run a real sync). */
const runners: Record<OpName, (log: Log) => Promise<string>> = {
  resync: async (log) => { await runDataCycle("owner", log); return "Data updated."; },
  packs: async (log) => withDataLock("owner: rebuild packs", async () => {
    // Where the cycle runs in a child process (DATA_CYCLE=child), so does this build: its long synchronous
    // stretches would otherwise stall every request this server answers.
    let msg: string;
    if (childCycle()) {
      log("building in a child process");
      await runPacksInChild();
      msg = "Packs built.";
    } else msg = `Packs ${(await buildPacks(log)).version} built.`;
    await kvSet("packs:last", new Date().toISOString());
    return msg;
  }, { ttlMs: 2 * 60_000, waitMs: 0 }),
  caches: async () => {
    const names = await withDataLock("owner: clear caches", async () => clearAllCaches(), { ttlMs: 60_000, waitMs: 0 });
    // Rebuild the expensive ones in the background, so no visitor waits for them.
    forecasterFor(CURRENT_SEASON).then(() => warmTrackRecord()).catch(() => {});
    return `Cleared ${names.length}: ${names.join(", ")}.`;
  },
};
/** Tests: run something else for an op (null restores the real one). */
const real = { ...runners };
export function setOpRunner(op: OpName, fn: ((log: Log) => Promise<string>) | null): void { runners[op] = fn ?? real[op]; }

const jobs = new Map<OpName, OpJob>();
const running = new Map<OpName, Promise<void>>();

/** Why this host can't run an op at all (null: it can). */
function unavailable(op: OpName): string | null {
  if (op === "packs" && process.env.CS_PACKS === "off") return "Offline packs are turned off on this host (CS_PACKS=off).";
  return null;
}

export async function opsStatus(): Promise<OpsStatus> {
  const w = await lockHolder();
  const out: OpsStatus["unavailable"] = {};
  for (const op of OPS) { const u = unavailable(op); if (u) out[op] = u; }
  return {
    jobs: Object.fromEntries(jobs),
    writer: w ? { what: w.what, until: new Date(w.until).toISOString() } : null,
    cycle: cycleRunning(),
    unavailable: out,
  };
}

/** Ops between "start" and running (checks and the audit row are awaited): reserved, so two clicks can't both start one. */
const starting = new Set<OpName>();

/** Why the op can't start right now, or null. */
async function refusal(op: OpName): Promise<string | null> {
  const u = unavailable(op);
  if (u) return u;
  const cycle = cycleRunning();
  if (cycle) return `A data update (${cycle.reason}) is running on this server. Try again once it's done.`;
  const w = await lockHolder();
  if (w) return `The data writer is busy (${w.what}). Try again in a minute.`;
  return null;
}

export type StartResult = { ok: true; job: OpJob } | { ok: false; error: string };

/** Start an op in the background for `actor` (the owner's email). Recorded in the audit log, refusals too. */
export async function startOp(op: OpName, actor: string): Promise<StartResult> {
  if (running.has(op) || starting.has(op)) {
    const error = "That's already running. Its progress shows below.";
    await recordAudit(actor, OP_ACTION[op], null, `refused: ${error}`);
    return { ok: false, error };
  }
  starting.add(op);
  let job: OpJob, auditId: number;
  try {
    const why = await refusal(op);
    if (why) {
      await recordAudit(actor, OP_ACTION[op], null, `refused: ${why}`);
      return { ok: false, error: why };
    }
    auditId = await recordAudit(actor, OP_ACTION[op], null, "started");
    job = { op, state: "running", startedAt: new Date().toISOString(), finishedAt: null, by: actor, message: null };
    jobs.set(op, job);
  } finally { starting.delete(op); }
  const log: Log = (m) => { job.message = m.trim().slice(0, 300); };
  const p = (async () => {
    try {
      const msg = await runners[op](log);
      Object.assign(job, { state: "done", finishedAt: new Date().toISOString(), message: msg });
      await setAuditResult(auditId, `done: ${msg}`).catch(() => {});
    } catch (e) {
      const msg = e instanceof LockBusy ? `The data writer is busy${e.holder ? ` (${e.holder.what})` : ""}. Try again in a minute.` : (e as Error)?.message ?? "failed";
      Object.assign(job, { state: "failed", finishedAt: new Date().toISOString(), message: msg });
      await setAuditResult(auditId, `failed: ${msg}`).catch(() => {});
      console.warn(`[owner] ${op} failed: ${msg}`);
    } finally {
      running.delete(op);
      // The Data & sync report kept from before the job is out of date now: the next read computes it afresh.
      resetDataReport();
    }
  })();
  running.set(op, p);
  return { ok: true, job: { ...job } };
}

/** Tests: wait for every op started so far to finish. */
export async function settleOps(): Promise<void> { await Promise.all([...running.values()]); }
/** Tests: forget finished jobs. */
export function resetOps(): void { jobs.clear(); }
