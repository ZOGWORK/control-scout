// FIRST's official advancement points for events whose detail the sync already considers settled (fetched after
// their last refresh window), so a finished event fetched before the points were read still gets them. The event
// bundle reads the points for every event it fetches (sources/first.ts); this only fills the gaps, a few events per
// sync, and never asks again about an event FIRST answered with no points.
import { all, kvGet, kvSet, writeBatch } from "../db.js";
import type { InStatement } from "@libsql/client";
import { firstGet, advancementPointRows } from "../sources/first.js";
import type { AdvancementPointsRow } from "./bundle.js";

/** Events per sync: one request each. */
export const POINTS_BACKFILL_PER_SYNC = 20;
const NONE_KEY = (season: number) => `advancementPoints:none:${season}`;

/** Store one event's points (replacing what's there). */
export function pointsStatements(season: number, code: string, rows: AdvancementPointsRow[]): InStatement[] {
  return [
    { sql: "DELETE FROM advancement_points WHERE season = ? AND code = ?", args: [season, code] },
    ...rows.map((p) => ({ sql: "INSERT OR REPLACE INTO advancement_points (season, code, team, total, awards, playoffs, alliance, quals) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [season, code, p.team, p.total, p.awards, p.playoffs, p.alliance, p.quals] })),
  ];
}

/**
 * Finished events of the season (2025–26 on) with a published advancement list and no stored points: read their
 * points, at most `limit` of them. A failed request is retried next sync; an empty answer is remembered.
 */
export async function backfillAdvancementPoints(season: number, o: { limit?: number; today?: string; fetch?: (path: string) => Promise<unknown> } = {}): Promise<{ filled: number; none: number; failed: number }> {
  const out = { filled: 0, none: 0, failed: 0 };
  if (season < 2025) return out;
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  const none = new Set(await kvGet<string[]>(NONE_KEY(season)) ?? []);
  const due = (await all<{ code: string }>(
    `SELECT a.code FROM advancement a JOIN events e ON e.season = a.season AND e.code = a.code
     WHERE a.season = ? AND a.slots > 0 AND COALESCE(e.end, e.start) < ?
       AND NOT EXISTS (SELECT 1 FROM advancement_points p WHERE p.season = a.season AND p.code = a.code)
     ORDER BY e.start, a.code`, [season, today])).map((r) => r.code).filter((c) => !none.has(c)).slice(0, o.limit ?? POINTS_BACKFILL_PER_SYNC);
  const get = o.fetch ?? ((path: string) => firstGet<any>(path));
  for (const code of due) {
    let rows: AdvancementPointsRow[] | undefined;
    try { rows = advancementPointRows(await get(`/${season}/advancement/${encodeURIComponent(code)}/points`)); } catch { rows = undefined; }
    if (rows === undefined) { out.failed++; continue; }
    if (!rows.length) { none.add(code); out.none++; continue; }
    await writeBatch(pointsStatements(season, code, rows));
    out.filled++;
  }
  if (out.none) await kvSet(NONE_KEY(season), [...none]);
  return out;
}
