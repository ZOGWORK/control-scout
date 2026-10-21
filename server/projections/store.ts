// Stored projections (migration 36): written by the job, read by pages. Reading never simulates.
import type { InStatement } from "@libsql/client";
import { all, writeBatch } from "../db.js";
import { projectionRunFromRow, type ProjectionKind, type ProjectionRun, type ProjectionsView } from "../../src/shared/projections.js";

export interface StoredRun extends ProjectionRun { stateKey: string }

/** A row of event_projections as a run (shared with the offline reader's shape). */
export function rowToRun(r: any): StoredRun {
  return { ...projectionRunFromRow(r), stateKey: String(r.state_key) };
}

export async function storedRuns(season: number, code: string): Promise<Map<ProjectionKind, StoredRun>> {
  const rows = await all<any>("SELECT * FROM event_projections WHERE season = ? AND code = ?", [season, code]);
  return new Map(rows.map((r) => { const x = rowToRun(r); return [x.kind, x]; }));
}

const publicRun = (r: StoredRun | undefined): ProjectionRun | null => {
  if (!r) return null;
  const { stateKey: _k, ...rest } = r;
  return rest;
};

export function viewOf(season: number, code: string, runs: Map<ProjectionKind, StoredRun>): ProjectionsView {
  return { season, code, current: publicRun(runs.get("current")), baseline: publicRun(runs.get("baseline")), lastOpen: publicRun(runs.get("last_open")) };
}

/** What GET /api/projections/:season/:code answers: the stored runs, nothing computed. */
export async function readProjections(season: number, code: string): Promise<ProjectionsView> {
  return viewOf(season, code, await storedRuns(season, code));
}

/** Store runs (one transaction); a current run also replaces the event's per-team advancement odds. */
export async function saveRuns(season: number, code: string, runs: StoredRun[]): Promise<void> {
  const stmts: InStatement[] = [];
  for (const r of runs) {
    stmts.push({
      sql: `INSERT OR REPLACE INTO event_projections (season, code, kind, state_key, seed, runs, target_runs, stage, played, scheduled, through, slots, slots_source, engine_version, ms, computed_at, teams)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [season, code, r.kind, r.stateKey, r.seed, r.runs, r.target, r.stage, r.played, r.scheduled, r.through, r.slots, r.slotsSource, r.engineVersion, Math.round(r.ms), r.computedAt, JSON.stringify(r.teams)],
    });
    if (r.kind === "current") {
      stmts.push({ sql: "DELETE FROM event_projection_odds WHERE season = ? AND code = ?", args: [season, code] });
      for (const t of r.teams) stmts.push({ sql: "INSERT INTO event_projection_odds (season, code, team, p_advance) VALUES (?, ?, ?, ?)", args: [season, code, t.team, t.pAdvance] });
    }
  }
  await writeBatch(stmts);
}
