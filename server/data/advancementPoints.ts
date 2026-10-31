// FIRST's official advancement points for events whose detail the sync already considers settled (fetched after
// their last refresh window), so a finished event fetched before the points were read still gets them. The event
// bundle reads the points for every event it fetches (sources/first.ts); this only fills the gaps, a few events per
// sync. An event FIRST answered with no points is asked again a week later, until a month after it ended.
import { all, kvGet, kvSet, writeBatch } from "../db.js";
import type { InStatement } from "@libsql/client";
import { firstGet, advancementPointRows } from "../sources/first.js";
import type { AdvancementPointsRow } from "./bundle.js";

/** Events per sync: one request each. */
export const POINTS_BACKFILL_PER_SYNC = 20;
/** An empty answer is asked again after this many days, and no more once the event ended this long ago. */
export const RETRY_EMPTY_DAYS = 7;
export const GIVE_UP_DAYS = 30;
const NONE_KEY = (season: number) => `advancementPoints:empty:${season}`;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Store one event's points (replacing what's there). */
export function pointsStatements(season: number, code: string, rows: AdvancementPointsRow[]): InStatement[] {
  return [
    { sql: "DELETE FROM advancement_points WHERE season = ? AND code = ?", args: [season, code] },
    ...rows.map((p) => ({ sql: "INSERT OR REPLACE INTO advancement_points (season, code, team, total, awards, playoffs, alliance, quals) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", args: [season, code, p.team, p.total, p.awards, p.playoffs, p.alliance, p.quals] })),
  ];
}

/**
 * Finished events of the season (2025–26 on) with a published advancement list and no stored points: read their
 * points, at most `limit` of them. A failed request is retried next sync; an empty answer a week later, while the
 * event ended under a month ago (FIRST can publish points after the sync's own refreshes stop).
 */
export async function backfillAdvancementPoints(season: number, o: { limit?: number; today?: string; fetch?: (path: string) => Promise<unknown> } = {}): Promise<{ filled: number; none: number; failed: number }> {
  const out = { filled: 0, none: 0, failed: 0 };
  if (season < 2025) return out;
  const today = o.today ?? new Date().toISOString().slice(0, 10);
  // Event code → the day FIRST last answered with no points.
  const empty = (await kvGet<Record<string, string>>(NONE_KEY(season))) ?? {};
  const due = (await all<{ code: string; end: string }>(
    `SELECT a.code, COALESCE(e.end, e.start) end FROM advancement a JOIN events e ON e.season = a.season AND e.code = a.code
     WHERE a.season = ? AND a.slots > 0 AND COALESCE(e.end, e.start) < ?
       AND NOT EXISTS (SELECT 1 FROM advancement_points p WHERE p.season = a.season AND p.code = a.code)
     ORDER BY e.start, a.code`, [season, today]))
    .filter((r) => { const last = empty[r.code]; return !last || (last <= addDays(today, -RETRY_EMPTY_DAYS) && r.end >= addDays(today, -GIVE_UP_DAYS)); })
    .map((r) => r.code).slice(0, o.limit ?? POINTS_BACKFILL_PER_SYNC);
  const get = o.fetch ?? ((path: string) => firstGet<any>(path));
  for (const code of due) {
    let rows: AdvancementPointsRow[] | undefined;
    try { rows = advancementPointRows(await get(`/${season}/advancement/${encodeURIComponent(code)}/points`)); } catch { rows = undefined; }
    if (rows === undefined) { out.failed++; continue; }
    if (!rows.length) { empty[code] = today; out.none++; continue; }
    await writeBatch(pointsStatements(season, code, rows));
    delete empty[code];
    out.filled++;
  }
  if (out.none || out.filled) await kvSet(NONE_KEY(season), empty);
  return out;
}
