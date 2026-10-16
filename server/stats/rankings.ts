// Weekly world-rankings snapshots (ranking_snapshots / ranking_weeks), for /rankings movement and
// anything else that needs "where was this team last week" (weekly power rankings).
//
// A week is the instant Monday 00:00 UTC. Its snapshot is every team's rating as the engine had it
// then: the season's rated matches before that instant replayed (ScoutForecaster.replayTo), the clock
// at the instant, ranked by src/shared/rankings.ts rankTeams (3+ rated matches). Because the snapshot
// is a replay, it doesn't matter when the job runs: the stats job (daily, and after syncs) writes
// every missing week, including weeks before this table existed (the backfill), up to a year back.
// A week is written once, rows and its ranking_weeks marker in one transaction, and never rewritten.
import type { InStatement } from "@libsql/client";
import { npOf } from "@control-scout/predict-engine";
import { all, run, writeBatch } from "../db.js";
import { CURRENT_SEASON } from "../data/seasons.js";
import { forecasterFor, type ScoutForecaster } from "../predict/engine.js";
import { RANKED_MIN_MATCHES, SNAPSHOT_RETAIN_WEEKS, WEEK_MS, rankTeams, weekOf, weekStartMs } from "../../src/shared/rankings.js";

type Log = (m: string) => void;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Oldest week kept at `now`. */
export const retainFrom = (now: number) => weekOf(now - SNAPSHOT_RETAIN_WEEKS * WEEK_MS);

/**
 * The weeks a season should have a snapshot for at `now`: every Monday after its first rated match,
 * up to and including the first Monday after its last one (its final standing), never in the future,
 * and no older than the retention window.
 */
export function wantedWeeks(firstMatch: number, lastMatch: number, now: number): string[] {
  const out: string[] = [];
  const from = Math.max(weekStartMs(weekOf(firstMatch)) + WEEK_MS, weekStartMs(retainFrom(now)));
  const to = Math.min(weekStartMs(weekOf(lastMatch)) + WEEK_MS, weekStartMs(weekOf(now)));
  for (let t = from; t <= to; t += WEEK_MS) out.push(weekOf(t));
  return out;
}

export interface SnapshotResult { written: { season: number; week: string; teams: number }[]; pruned: number }

/**
 * Write every missing week for the seasons in the current ratings window, then prune weeks past the
 * retention window. Idempotent: a second run at the same `now` writes nothing.
 */
export async function snapshotRankings(o: { now?: number; log?: Log; forecaster?: ScoutForecaster } = {}): Promise<SnapshotResult> {
  const now = o.now ?? Date.now();
  const log = o.log ?? (() => {});
  const f = o.forecaster ?? (await forecasterFor(CURRENT_SEASON));
  const written: SnapshotResult["written"] = [];
  for (const season of f.seasons) {
    const times = f.seasonEvents(season).flatMap((e) => e.matches.map((m) => m.time));
    if (!times.length) continue;
    let first = Infinity, last = -Infinity;
    for (const t of times) { if (t < first) first = t; if (t > last) last = t; }
    const have = new Set((await all<{ week: string }>("SELECT week FROM ranking_weeks WHERE season = ?", [season])).map((r) => r.week));
    const missing = wantedWeeks(first, last, now).filter((w) => !have.has(w));
    if (!missing.length) continue;
    const rowsByWeek = new Map<string, { team: number; rating: number; rank: number }[]>();
    f.replayTo(season, missing.map(weekStartMs), (ms, book) => {
      const rated: { team: number; rating: number }[] = [];
      for (const [team, r] of book.ratings) if (r.n >= RANKED_MIN_MATCHES) rated.push({ team, rating: r2(npOf(book.get(team))) });
      rowsByWeek.set(weekOf(ms), rankTeams(rated));
    });
    const takenAt = new Date(now).toISOString();
    for (const week of missing) {
      const rows = rowsByWeek.get(week) ?? [];
      const stmts: InStatement[] = [];
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        stmts.push({
          sql: `INSERT OR REPLACE INTO ranking_snapshots (season, week, team, rank, rating) VALUES ${chunk.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
          args: chunk.flatMap((r) => [season, week, r.team, r.rank, r.rating]),
        });
      }
      stmts.push({ sql: "INSERT OR IGNORE INTO ranking_weeks (season, week, teams, taken_at) VALUES (?, ?, ?, ?)", args: [season, week, rows.length, takenAt] });
      await writeBatch(stmts);
      written.push({ season, week, teams: rows.length });
    }
    log(`${season}: rankings snapshots for ${missing.length} week(s) (${missing[0]}${missing.length > 1 ? ` to ${missing[missing.length - 1]}` : ""})`);
  }
  const cutoff = retainFrom(now);
  const pruned = await run("DELETE FROM ranking_snapshots WHERE week < ?", [cutoff]);
  await run("DELETE FROM ranking_weeks WHERE week < ?", [cutoff]);
  if (pruned) log(`rankings snapshots: pruned ${pruned} rows older than ${cutoff}`);
  return { written, pruned };
}
