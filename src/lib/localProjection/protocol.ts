// The local estimate's Web Worker protocol. The page posts one "run" (the simulation input, built on
// the page by the engine's own steps, and the fixed seed); the worker runs the shared Monte Carlo core
// (src/shared/projectionCore.ts) in slices, posting "progress" between them, and answers "done" with
// the result or "error". "cancel" stops a run at its next slice (the page closed, or the server's run
// arrived). The handler is plain code over a post function, so tests drive it without a worker.
//
//   page → worker   { type: "run", id, input, seed, runs, stopAtMs }   input: SimInput with awards off
//                   { type: "cancel", id }
//   worker → page   { type: "progress", id, done, target }
//                   { type: "done", id, result }                        result: CoreResult (runs = the real count)
//                   { type: "error", id, message }
import type { SimInput } from "@control-scout/predict-engine";
import { simulateProjection, type CoreResult } from "../../shared/projectionCore";

export { LOCAL_RUNS, LOCAL_STOP_MS } from "../../shared/projections";
/** Compute per slice before the worker checks its messages and reports progress. */
export const LOCAL_SLICE_MS = 50;

export type ToWorker =
  | { type: "run"; id: number; input: SimInput; seed: number; runs: number; stopAtMs: number }
  | { type: "cancel"; id: number };

export type FromWorker =
  | { type: "progress"; id: number; done: number; target: number }
  | { type: "done"; id: number; result: CoreResult }
  | { type: "error"; id: number; message: string };

interface HandlerDeps { clock?: () => number; pause?: () => Promise<void>; sliceMs?: number }

/** The worker's message handler: runs one simulation per "run" message, honouring "cancel". */
export function workerHandler(post: (m: FromWorker) => void, deps: HandlerDeps = {}): (m: ToWorker) => Promise<void> {
  const cancelled = new Set<number>();
  return async (m) => {
    if (m.type === "cancel") { cancelled.add(m.id); return; }
    if (m.type !== "run") return;
    try {
      // Awards can't cross a worker boundary (a sampling function) and projections leave them out anyway.
      const input: SimInput = { ...m.input, awards: { mode: "none" }, runs: 1 };
      const result = await simulateProjection(input, {
        runs: m.runs, floor: m.runs, budgetMs: Infinity, seed: m.seed, stopAtMs: m.stopAtMs,
        sliceMs: deps.sliceMs ?? LOCAL_SLICE_MS, clock: deps.clock, pause: deps.pause ?? (() => new Promise((r) => setTimeout(r, 0))),
        onProgress: (done, target) => { if (done < target) post({ type: "progress", id: m.id, done, target }); },
        cancelled: () => cancelled.has(m.id),
      });
      if (cancelled.has(m.id)) return;
      post({ type: "done", id: m.id, result });
    } catch (e) {
      post({ type: "error", id: m.id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      cancelled.delete(m.id);
    }
  };
}
