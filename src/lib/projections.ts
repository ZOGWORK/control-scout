// Event projections on the page: read the stored runs (GET /api/projections/:season/:code) and follow
// new ones live. While the event isn't finished an EventSource on …/stream hears each new run and the
// page re-reads the stored runs at once (no reload). When the stream can't be had (the owner's realtime
// switch is off, too many open, no EventSource, a proxy cut it), the page re-reads them whenever the
// event's own results refresh (`refreshKey`, the live poll's check time), so it still keeps up.
import { useEffect, useRef } from "react";
import { load, useApi, type ApiState } from "./api";
import type { ConfidenceTier } from "../shared/api";
import type { ProjectionRun, ProjectionsView, ProjectionTeam } from "../shared/projections";

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
