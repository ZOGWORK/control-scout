// Event projections on the page: read the stored runs (GET /api/projections/:season/:code) and follow
// new ones live. While the event isn't finished an EventSource on …/stream hears each new run and the
// page re-reads the stored runs at once (no reload). When the stream can't be had (the owner's realtime
// switch is off, too many open, no EventSource, a proxy cut it), the page re-reads them whenever the
// event's own results refresh (`refreshKey`, the live poll's check time), so it still keeps up.
import { useEffect, useRef, useState } from "react";
import { load, useApi, type ApiState } from "./api";
import { packStatus } from "./packPolicy";
import { savedSeasons } from "./offline/saved";
import type { ConfidenceTier, EventDetail } from "../shared/api";
import { PROJECTION_RUNS, type ProjectionRun, type ProjectionsView, type ProjectionTeam } from "../shared/projections";

export const projectionsPath = (season: number, code: string) => `/api/projections/${season}/${encodeURIComponent(code)}`;

/** Reconnect delays after a stream error; past the last, give up (the refreshKey fallback keeps the page current). */
export const STREAM_BACKOFF_MS = [2_000, 10_000, 30_000];

interface Deps { EventSource?: typeof EventSource | undefined }

/** Call `onRun` each time a new run of the event is stored, until the returned stop() is called. */
export function followProjections(season: number, code: string, onRun: () => void, deps: Deps = {}): () => void {
  const ES = "EventSource" in deps ? deps.EventSource : (globalThis as { EventSource?: typeof EventSource }).EventSource;
  let es: EventSource | null = null;
  let stopped = false, failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const close = () => { if (es) { es.close(); es = null; } };
  function connect() {
    retry = null;
    if (stopped || !ES) return;
    const s = new ES(`${projectionsPath(season, code)}/stream`);
    es = s;
    s.addEventListener("ready", () => { if (es === s) failures = 0; });
    s.addEventListener("projections", () => { if (es === s) { failures = 0; onRun(); } });
    s.onerror = () => {
      if (es !== s) return;
      close();
      if (stopped || failures >= STREAM_BACKOFF_MS.length) return;
      retry = setTimeout(connect, STREAM_BACKOFF_MS[failures++]);
    };
  }
  connect();
  return () => { stopped = true; close(); if (retry) clearTimeout(retry); };
}

/** The stored projections, kept current while `live` (the event isn't over). */
export function useProjections(season: number, code: string, o: { live: boolean; refreshKey?: string }): ApiState<ProjectionsView> {
  const path = projectionsPath(season, code);
  const state = useApi<ProjectionsView>(path);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    load(path, true, true).catch(() => {});
  }, [path, o.refreshKey]);
  useEffect(() => {
    if (!o.live) return;
    return followProjections(season, code, () => { load(path, true, true).catch(() => {}); });
  }, [season, code, path, o.live]);
  return state;
}

/** How sure a projection is: the stage of the event and how much of it is still to simulate (shown on the page). */
export function projectionTier(run: ProjectionRun): { tier: ConfidenceTier; reason: string } {
  if (run.stage === "selected") return { tier: "confident", reason: "Alliances are set: seeds are final and only the playoffs are simulated." };
  if (run.stage === "quals") return { tier: "confident", reason: "Quals are over: seeds are official; alliance selection and playoffs are simulated." };
  const left = run.scheduled ? 1 - run.played / run.scheduled : 1;
  if (run.played === 0) return { tier: "provisional", reason: "Before the first match every result is simulated from ratings." };
  if (left > 0.5) return { tier: "provisional", reason: `${run.played} of ${run.scheduled} qualification matches played: most of the event is still simulated.` };
  return { tier: "moderate", reason: `${run.played} of ${run.scheduled} qualification matches played; the rest are simulated.` };
}

// ---------------------------------------------------------------------------
// Local estimate: the fallback simulated on this device (src/lib/localProjection)
// ---------------------------------------------------------------------------

/** A projection simulated on this device from the offline packs. Never stored with, or shown as, a server run. */
export interface LocalProjection {
  local: true;
  run: ProjectionRun;
  /** The lite pack the ratings came from, and when it was built (the ratings are as of then). */
  packVersion: string;
  ratingsAsOf: string;
  computeMs: number;
  /** The time cap ended it before its target: run.runs is the real count. */
  stopped: boolean;
  cacheKey: string;
}

/** "Local estimate · 1,500 simulations on this device": the label a local estimate carries wherever it shows. */
export function localLabel(runs: number): string {
  return `Local estimate · ${runs.toLocaleString("en-US")} simulation${runs === 1 ? "" : "s"} on this device`;
}

const STEP_DOWN: Record<ConfidenceTier, ConfidenceTier> = { confident: "moderate", moderate: "provisional", provisional: "provisional" };

/** A local estimate's tier: one step below what the server's run of the same state would get (fewer simulations,
 *  ratings as of the offline pack), and provisional when it managed under 1,000 simulations. */
export function localTier(l: Pick<LocalProjection, "run" | "ratingsAsOf">): { tier: ConfidenceTier; reason: string } {
  const server = projectionTier(l.run);
  const tier = l.run.runs < 1000 ? "provisional" : STEP_DOWN[server.tier];
  const asOf = new Date(l.ratingsAsOf);
  const when = Number.isNaN(asOf.getTime()) ? "" : ` (ratings as of ${asOf.toLocaleDateString("en-US", { month: "short", day: "numeric" })})`;
  return { tier, reason: `Estimated on this device: ${l.run.runs.toLocaleString("en-US")} simulations from your offline pack${when}, one tier below the server's ${PROJECTION_RUNS.toLocaleString("en-US")}-simulation projection. ${server.reason}` };
}

export type ProjectionSource = "server" | "local";

/**
 * Which projection the page shows. The server's stored run whenever there is one (online, or in a saved pack);
 * a local estimate only when there's none to be had (no stored run for an open event, or the projections
 * couldn't be read) and this device can make one. A finished event is never estimated locally: its stored
 * runs are history, and there's nothing left to simulate.
 */
export function projectionSource(o: { finished: boolean; hasCurrent: boolean; loaded: boolean; failed: boolean; hasSchedule: boolean; canRunLocal: boolean }): ProjectionSource {
  if (o.finished || o.hasCurrent || !o.hasSchedule || !o.canRunLocal) return "server";
  return o.failed || o.loaded ? "local" : "server";
}

/** Can this device make a local estimate for the season: a saved season pack, the lite pack and Web Workers. */
export function canRunLocal(season: number, deps: { saved?: () => { season: number }[]; lite?: () => unknown; worker?: boolean } = {}): boolean {
  const worker = deps.worker ?? typeof Worker !== "undefined";
  return worker && !!(deps.lite ?? packStatus)() && (deps.saved ?? savedSeasons)().some((s) => s.season === season);
}

export type LocalState =
  | { status: "idle" }
  | { status: "running"; done: number; target: number }
  | { status: "done"; value: LocalProjection }
  | { status: "unavailable"; reason: string }
  | { status: "error"; message: string };

/**
 * The local estimate while `enabled`: loads the simulator lazily and, on every new payload, rebuilds the
 * simulation input and its results-state key (the server's SHA-256 of everything the simulation reads:
 * lineups, surrogates, DQs, scores, bonus RPs, ranks, alliances, playoff results, advancement facts).
 * A new key (with the pack and engine) starts a new run and cancels the old one; the same key leaves the
 * run going, or the result standing. Each key simulates once (run.ts caches it).
 */
export function useLocalProjection(d: EventDetail, enabled: boolean): LocalState {
  const [state, setState] = useState<LocalState>({ status: "idle" });
  const current = useRef<{ key: string; ctrl: AbortController } | null>(null);
  useEffect(() => {
    const stop = () => { current.current?.ctrl.abort(); current.current = null; };
    if (!enabled) { stop(); setState({ status: "idle" }); return; }
    let stale = false;
    setState((s) => (s.status === "idle" ? { status: "running", done: 0, target: 0 } : s));
    import("./localProjection/run").then(async (m) => {
      const p = await m.prepareLocal(d);
      if (stale) return;
      if ("unavailable" in p) { stop(); setState({ status: "unavailable", reason: p.unavailable }); return; }
      const key = m.cacheKey(p);
      if (current.current?.key === key) return; // same results state: nothing to redo
      stop();
      const ctrl = new AbortController();
      current.current = { key, ctrl };
      let last = 0;
      try {
        const r = await m.localProjectionFor(p, (done, target) => {
          // A few updates a second are plenty for a progress bar.
          const now = performance.now();
          if (now - last < 120 || ctrl.signal.aborted) return;
          last = now;
          setState({ status: "running", done, target });
        }, ctrl.signal);
        if (!ctrl.signal.aborted) setState({ status: "done", value: r });
      } catch (e) {
        if (!ctrl.signal.aborted) { current.current = null; setState({ status: "error", message: e instanceof Error ? e.message : String(e) }); }
      }
    }).catch((e) => { if (!stale) setState({ status: "error", message: e instanceof Error ? e.message : String(e) }); });
    return () => { stale = true; };
  }, [enabled, d]);
  // Leaving the page cancels a run still going.
  useEffect(() => () => { current.current?.ctrl.abort(); current.current = null; }, []);
  return state;
}

/** Projected median rank movement since the pre-event baseline: positive = moved up (a better rank). */
export function rankMovement(now: ProjectionTeam | undefined, before: ProjectionTeam | undefined): number | null {
  if (!now?.rank || !before?.rank) return null;
  return before.rank.p50 - now.rank.p50;
}

/** Final seeds against the bands they were judged by: how many landed inside. */
export function bandHits(run: ProjectionRun | null, actual: Map<number, number>): { inside: number; total: number } {
  let inside = 0, total = 0;
  for (const t of run?.teams ?? []) {
    const a = actual.get(t.team);
    if (a == null || !t.rank) continue;
    total++;
    if (a >= t.rank.p10 && a <= t.rank.p90) inside++;
  }
  return { inside, total };
}
