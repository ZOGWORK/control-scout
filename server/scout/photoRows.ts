// Reading entry photo records (entry_photos) for the entries the API sends:
// each workspace entry carries its photos (ready and expired; uploads still in
// progress aren't shown). Kept apart from photos.ts so entries.ts can use it
// without an import cycle.
import { all } from "../db.js";
import type { EntryPhoto } from "../../src/shared/photos.js";

export const photoOut = (r: any): EntryPhoto => ({
  id: String(r.id), bytes: Number(r.bytes), addedByAccountId: Number(r.added_by_account_id), addedByName: String(r.added_by_name ?? ""),
  createdAt: Number(r.created_at), expired: r.status === "expired",
});

/** The photos of these entries of one workspace (its row id), oldest first, by entry uuid. */
export async function photosByEntry(workspaceDbId: number, uuids: string[]): Promise<Map<string, EntryPhoto[]>> {
  const out = new Map<string, EntryPhoto[]>();
  if (!uuids.length) return out;
  const rows = await all<any>(
    `SELECT * FROM entry_photos WHERE workspace_id = ? AND entry_uuid IN (${uuids.map(() => "?").join(", ")}) AND status IN ('ready', 'expired') ORDER BY created_at, id`,
    [workspaceDbId, ...uuids]);
  for (const r of rows) {
    const list = out.get(String(r.entry_uuid)) ?? [];
    list.push(photoOut(r));
    out.set(String(r.entry_uuid), list);
  }
  return out;
}
