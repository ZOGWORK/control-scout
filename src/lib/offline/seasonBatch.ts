// Saving seasons on this device, one at a time: a single run for the whole app, not the page's, so leaving
// /download and coming back shows the same progress, and a second Download all can't start beside the first.
import { useSyncExternalStore } from "react";
import type { PackFile, PackManifest } from "../packs";
import { saveSeason } from "./seasons";

export interface BatchState {
  /** The season saving now and its progress (0–100). */
  busy: { season: number; pct: number } | null;
  /** Seasons waiting behind it. */
  queue: number[];
}

export interface BatchResult { saved: number[]; failed: { season: number; error: Error }[] }

let state: BatchState = { busy: null, queue: [] };
const subs = new Set<() => void>();
const set = (next: BatchState) => { state = next; for (const f of subs) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const batchState = () => state;
export const batchRunning = () => state.busy != null || state.queue.length > 0;
export function useSeasonBatch(): BatchState { return useSyncExternalStore(subscribe, batchState, batchState); }

/**
 * Save these files in order (each verified by saveSeason). Null when a run is already going: nothing starts
 * twice. A failure is kept and the rest still run.
 */
export async function runSeasonBatch(files: PackFile[], manifest: PackManifest): Promise<BatchResult | null> {
  if (batchRunning() || !files.length) return null;
  const out: BatchResult = { saved: [], failed: [] };
  set({ busy: null, queue: files.map((f) => f.seasons[0]) });
  for (const f of files) {
    const season = f.seasons[0];
    set({ busy: { season, pct: 0 }, queue: state.queue.filter((x) => x !== season) });
    try {
      await saveSeason(f, manifest, (got, total) => set({ ...state, busy: { season, pct: total ? Math.min(100, (got / total) * 100) : 0 } }));
      out.saved.push(season);
    } catch (e) {
      out.failed.push({ season, error: e instanceof Error ? e : new Error(String(e)) });
    }
  }
  set({ busy: null, queue: [] });
  return out;
}

/** Tests only: back to idle. */
export function resetSeasonBatch() { set({ busy: null, queue: [] }); }
