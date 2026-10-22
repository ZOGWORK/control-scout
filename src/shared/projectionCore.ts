// Monte Carlo core: the rest of an event simulated N times with the shared engine's simulateEvent,
// one run at a time, into per-team distributions (rank histogram, playoff, advancement, win odds).
//
// Why one run per call: simulateEvent only returns averages and the P10/P90 of the rank, and the
// projection needs the median too. Calling it with runs: 1 returns that run's outcome (rank,
// captain/picked, advanced, won), so every number here is the engine's own, unchanged — score noise,
// bonus RPs, official tiebreakers, the fitted pick model, the double-elimination bracket and the
// advancement points — and the loop can stop between runs to let the server answer requests.
//
// Deterministic: run i is seeded from (seed, i), so the same input and seed give the same result,
// however the work is sliced. Pure (no Node APIs, no database): the server's projections job
// (server/projections/job.ts) and the device's local estimate (src/lib/localProjection, in a Web
// Worker) both run it, so a local estimate follows the server's method exactly.
import { simulateEvent, type SimInput } from "@control-scout/predict-engine";
import type { AdvanceStatus, ProjectionTeam } from "./projections.js";

export interface CoreOptions {
  /** Simulations wanted. */
  runs: number;
  /** Fewer simulations to fall back to when `runs` would take longer than budgetMs. */
  floor: number;
  /** Compute-time budget for the whole run (ms). */
  budgetMs: number;
  seed: number;
  /** Compute this long, then pause (yield to the event loop). */
  sliceMs?: number;
  pause?: () => Promise<void>;
  clock?: () => number;
  /**
   * A hard stop (compute ms): once a slice ends past it, the run ends with the simulations done so
   * far (at least one slice's worth). The device's local estimate caps itself this way, so a slow
   * phone reports the real count; the server leaves it unset.
   */
  stopAtMs?: number;
  /** Called at each pause with the simulations done and the current target. */
  onProgress?: (done: number, target: number) => void;
  /** Checked after each pause: true ends the run early, like stopAtMs. */
  cancelled?: () => boolean;
}

export interface CoreResult {
  /** Simulations run: `runs`, or `floor` when the budget forced it (fewer when stopAtMs or cancelled ended it). */
  runs: number;
  /** True when stopAtMs or cancelled ended the run before its target. */
  stopped: boolean;
  /** Compute time (pauses excluded) and wall time. */
  computeMs: number;
  wallMs: number;
  teams: ProjectionTeam[];
}

/** Runs measured before deciding whether the full count fits the budget. */
const PROBE_RUNS = 200;

/** Seed of run i: an integer hash of (seed, i), so neighbouring runs aren't correlated. */
export function runSeed(seed: number, i: number): number {
  let z = (seed + Math.imul(i + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}

/** A 32-bit seed from text (FNV-1a), e.g. `season|code|stateKey`. */
export function textSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The seed of a projection: fixed per (event, kind, results state), so repeat runs of one state agree. The
 *  server's job and the device's local estimate (kind "current") use the same one. */
export function projectionSeed(season: number, code: string, kind: string, stateKey: string): number {
  return textSeed(`${season}|${code}|${kind}|${stateKey}`);
}

const immediate =() => new Promise<void>((r) => (typeof setImmediate === "function" ? setImmediate(r) : setTimeout(r, 0)));

/** The q-quantile of a rank histogram (counts[r] = runs at rank r), the way the engine takes P10/P90: sorted[floor(q·n)]. */
export function quantile(counts: ArrayLike<number>, total: number, q: number): number {
  const k = Math.min(total - 1, Math.floor(q * total));
  let seen = 0;
  for (let r = 0; r < counts.length; r++) { seen += counts[r]; if (seen > k) return r; }
  return counts.length - 1;
}

interface Acc { counts: Int32Array; ranked: number; sum: number; cap: number; picked: number; adv: number; win: number; fin: number }

export async function simulateProjection(input: SimInput, o: CoreOptions): Promise<CoreResult> {
  const clock = o.clock ?? (() => performance.now());
  const pause = o.pause ?? immediate;
  const sliceMs = o.sliceMs ?? 20;
  // Performance only: award points are left out (the advancement label says so), and the run count is ours.
  const one: SimInput = { ...input, awards: { mode: "none" }, runs: 1 };
  const acc = new Map<number, Acc>();
  const started = clock();
  let target = o.runs, done = 0, compute = 0, stopped = false;
  while (done < target) {
    const t0 = clock();
    // At least one run per slice, so a slow machine still makes progress.
    do {
      const out = simulateEvent({ ...one, seed: runSeed(o.seed, done) });
      for (const [team, x] of out) {
        let a = acc.get(team);
        if (!a) { a = { counts: new Int32Array(out.size + 2), ranked: 0, sum: 0, cap: 0, picked: 0, adv: 0, win: 0, fin: 0 }; acc.set(team, a); }
        if (Number.isFinite(x.meanRank)) {
          const r = Math.round(x.meanRank);
          if (r >= a.counts.length) { const grown = new Int32Array(r + 2); grown.set(a.counts); a.counts = grown; }
          a.counts[r]++; a.ranked++; a.sum += r;
        }
        a.cap += x.pCaptain; a.picked += x.pPicked; a.adv += x.pAdvance; a.win += x.pWin; a.fin += x.pFinalist;
      }
      done++;
    } while (done < target && clock() - t0 < sliceMs);
    compute += clock() - t0;
    // Over budget at this pace: settle for the floor (never fewer runs than already done).
    if (target > o.floor && done >= Math.min(PROBE_RUNS, target) && (compute / done) * target > o.budgetMs) target = Math.max(o.floor, done);
    if (done < target && o.stopAtMs != null && compute >= o.stopAtMs) { stopped = true; target = done; }
    if (done < target) {
      o.onProgress?.(done, target);
      await pause();
      if (o.cancelled?.()) { stopped = true; target = done; }
    }
  }
  o.onProgress?.(done, done);
  // Already qualified elsewhere and not eligible are different facts, kept apart: only the first is "qualified".
  const status = (team: number): AdvanceStatus => (input.prequalified.has(team) ? "qualified" : input.ineligible?.has(team) ? "ineligible" : "odds");
  const teams: ProjectionTeam[] = [...acc.entries()].map(([team, a]) => ({
    team,
    rank: a.ranked ? { p10: quantile(a.counts, a.ranked, 0.1), p50: quantile(a.counts, a.ranked, 0.5), p90: quantile(a.counts, a.ranked, 0.9), mean: a.sum / a.ranked } : null,
    pPlayoff: (a.cap + a.picked) / done, pCaptain: a.cap / done, pPicked: a.picked / done,
    pAdvance: status(team) === "odds" ? a.adv / done : null,
    advance: status(team),
    pWin: a.win / done, pFinalist: a.fin / done,
  })).sort((x, y) => (x.rank?.mean ?? Infinity) - (y.rank?.mean ?? Infinity) || x.team - y.team);
  return { runs: done, stopped, computeMs: compute, wallMs: clock() - started, teams };
}
