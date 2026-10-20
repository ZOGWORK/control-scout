// The official-result change timeline (data/resultChanges.ts) for an event or one match.
// Public FTC data only: what FIRST (or the fallback feed) posted and when the sync saw it.
import { all, get } from "../db.js";
import { resultFieldLabels } from "../data/seasons.js";
import { RESULT_CHANGES_PER_EVENT } from "../data/resultChanges.js";
import type { ResultChange, ResultChangesView } from "../../src/shared/api.js";

const parse = (x: unknown) => (x == null ? null : JSON.parse(String(x)));

/** Null when the event doesn't exist (or, with `match`, that match doesn't). */
export async function resultChanges(season: number, code: string, match?: string): Promise<ResultChangesView | null> {
  const ev = await get<any>("SELECT code, detail_synced_at, live_checked_at FROM events WHERE season = ? AND code = ?", [season, code]);
  if (!ev) return null;
  const c = String(ev.code);
  let where = "season = ? AND code = ?";
  const args: (string | number)[] = [season, c];
  if (match) {
    const [level, series, number] = match.split(":");
    const m = await get("SELECT 1 FROM matches WHERE season = ? AND code = ? AND level = ? AND series = ? AND number = ?", [season, c, level, Number(series), Number(number)]);
    if (!m) return null;
    where += " AND level = ? AND series = ? AND number = ?";
    args.push(level, Number(series), Number(number));
  }
  const watch = await get<any>("SELECT since, pruned FROM result_watch WHERE season = ? AND code = ?", [season, c]);
  const rows = await all<any>(`SELECT id, level, series, number, label, kind, fields, before, after, source, prev_source, checked_at FROM result_changes WHERE ${where} ORDER BY id DESC LIMIT ?`, [...args, RESULT_CHANGES_PER_EVENT]);
  const changes = rows.map((r) => ({
    id: Number(r.id),
    match: { key: `${r.level}:${r.series}:${r.number}`, label: String(r.label) },
    kind: r.kind, fields: parse(r.fields) ?? [], before: parse(r.before), after: parse(r.after),
    source: r.source, prevSource: r.prev_source ?? null, checkedAt: String(r.checked_at),
  }) as ResultChange);
  const checked = [ev.live_checked_at, ev.detail_synced_at].filter(Boolean).map(String).sort().pop() ?? null;
  return {
    season, code: c, match: match ?? null,
    trackedSince: watch ? String(watch.since) : null,
    lastChecked: checked,
    labels: resultFieldLabels(season),
    changes, cap: RESULT_CHANGES_PER_EVENT, pruned: watch ? Number(watch.pruned) : 0,
  };
}
