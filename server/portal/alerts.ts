// Owner alerts: things the owner has to act on, kept as rows (owner_alerts) until
// they're resolved. At most one open alert per kind: raising it again only
// refreshes its text and details.
//
// Today the owner portal shows the open ones (the storage panel's warning).
// Hand-off to the owner inbox (Task 14, docs/r2-photos.md): the inbox reads
// open alerts with inbox_item_id IS NULL, makes one inbox item (and
// notification) for each, and stores the item's id in inbox_item_id, so each
// alert notifies once; a resolved alert can close its item.
import { get, run } from "../db.js";
import type { OwnerAlert } from "../../src/shared/photos.js";

const toAlert = (r: any): OwnerAlert => ({ id: Number(r.id), kind: r.kind, level: r.level, title: r.title, body: r.body, createdAt: r.created_at, resolvedAt: r.resolved_at ?? null });

/** Open (or refresh) the alert of this kind. Returns it, and whether it was new. */
export async function raiseAlert(kind: string, level: OwnerAlert["level"], title: string, body: string, details?: Record<string, unknown>): Promise<{ alert: OwnerAlert; created: boolean }> {
  const now = new Date().toISOString();
  const json = details ? JSON.stringify(details).slice(0, 2000) : null;
  // The partial unique index (one open alert per kind) makes a second insert a no-op.
  const created = await run(
    "INSERT OR IGNORE INTO owner_alerts (kind, level, title, body, details, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [kind, level, title, body, json, now, now]) > 0;
  if (!created) await run("UPDATE owner_alerts SET level = ?, title = ?, body = ?, details = ?, updated_at = ? WHERE kind = ? AND resolved_at IS NULL", [level, title, body, json, now, kind]);
  return { alert: (await openAlert(kind))!, created };
}

/** Close the open alert of this kind, if any. */
export async function resolveAlert(kind: string): Promise<boolean> {
  return await run("UPDATE owner_alerts SET resolved_at = ?, updated_at = ? WHERE kind = ? AND resolved_at IS NULL", [new Date().toISOString(), new Date().toISOString(), kind]) > 0;
}

export async function openAlert(kind: string): Promise<OwnerAlert | null> {
  const r = await get<any>("SELECT * FROM owner_alerts WHERE kind = ? AND resolved_at IS NULL", [kind]);
  return r ? toAlert(r) : null;
}
