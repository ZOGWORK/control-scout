// Event projections (Monte Carlo): the stored simulations of the rest of an event, as the API
// returns them (GET /api/projections/:season/:code) and the event page, Predict and offline packs
// read them. Written only by the background job (server/projections/job.ts); no page or request
// ever runs a simulation.

/** Simulations per run, and the floor an event that blows the time budget drops to. */
export const PROJECTION_RUNS = 10_000;
export const PROJECTION_FLOOR = 5_000;

/** The one label advancement odds carry wherever they show. */
export const ADVANCE_LABEL = "performance-based — awards can also advance teams";

/** Event stage as the engine names it: before quals, quals under way, quals over, alliances set. */
export type ProjectionStage = "pre" | "live" | "quals" | "selected";

/** Which stored run: the latest, the pre-event baseline, or the last one made while quals were still open. */
export type ProjectionKind = "current" | "baseline" | "last_open";

export interface ProjectionTeam {
  team: number;
  /** Quals rank over all simulations: P10, median, P90 (1 = top seed) and the mean. Null when the team isn't ranked. */
  rank: { p10: number; p50: number; p90: number; mean: number } | null;
  /** Plays in the playoffs: captain or picked. */
  pPlayoff: number;
  pCaptain: number;
  pPicked: number;
  /** Advances through competition-performance slots (no award points). Null = already qualified elsewhere or ineligible. */
  pAdvance: number | null;
  pWin: number;
  pFinalist: number;
}

export interface ProjectionRun {
  kind: ProjectionKind;
  /** Simulations actually run (PROJECTION_RUNS, or the floor when the event blew the time budget). */
  runs: number;
  target: number;
  stage: ProjectionStage;
  /** Qualification matches played / scheduled when this run was made. */
  played: number;
  scheduled: number;
  /** The last played match ("Q24", "M3"), or null before any. */
  through: string | null;
  /** Advancement slots and where the count comes from (official, estimated, …); null when none. */
  slots: number | null;
  slotsSource: string | null;
  /** Fixed per (event, results state): the same results always give the same numbers. */
  seed: number;
  engineVersion: string;
  /** Wall time of the run, and when it finished. */
  ms: number;
  computedAt: string;
  teams: ProjectionTeam[];
}

export interface ProjectionsView {
  season: number;
  code: string;
  current: ProjectionRun | null;
  /** The projection before any match was played (movement is measured against it). */
  baseline: ProjectionRun | null;
  /** The last run made while qualification matches were still to play (the bands a finished event is judged by). */
  lastOpen: ProjectionRun | null;
}

/** A stored event_projections row as a run (the server's store and the offline packs read the same columns). */
export function projectionRunFromRow(r: Record<string, unknown>): ProjectionRun {
  return {
    kind: r.kind as ProjectionKind, runs: Number(r.runs), target: Number(r.target_runs), stage: r.stage as ProjectionStage,
    played: Number(r.played), scheduled: Number(r.scheduled), through: (r.through as string | null) ?? null, slots: r.slots == null ? null : Number(r.slots),
    slotsSource: (r.slots_source as string | null) ?? null, seed: Number(r.seed), engineVersion: String(r.engine_version), ms: Number(r.ms),
    computedAt: String(r.computed_at), teams: JSON.parse(String(r.teams)) as ProjectionTeam[],
  };
}

/** The view from an event's stored rows (any order, any subset of kinds). */
export function projectionsViewFromRows(season: number, code: string, rows: Record<string, unknown>[]): ProjectionsView {
  const by = new Map(rows.map((r) => [String(r.kind), projectionRunFromRow(r)]));
  return { season, code, current: by.get("current") ?? null, baseline: by.get("baseline") ?? null, lastOpen: by.get("last_open") ?? null };
}

/** "Match 24" for Q24; other labels as they are. */
export function throughText(label: string | null): string | null {
  if (!label) return null;
  const q = /^Q(\d+)$/.exec(label);
  return q ? `Match ${q[1]}` : label;
}
