// Version history of workspace scout entries (Task 16): the server keeps the
// last HISTORY_LIMIT versions of each one (server/scout/history.ts); the app
// shows them in the entry's History sheet with field-level diffs.
// Personal entries have no history (they're one person's, on their own devices).

/** How many versions the server keeps per entry. */
export const HISTORY_LIMIT = 20;

/** One stored version, as GET /api/scout/workspaces/:id/entries/:uuid/history sends it (newest first). */
export interface EntryVersion {
  /** Counts up per entry, never reused (older ones are pruned past HISTORY_LIMIT). */
  versionNo: number;
  /** The writer's clock for this version (the entry's updatedAt when it was written). */
  updatedAt: number;
  /** Who wrote this version (the editor; not the entry's author unless they wrote it). */
  writtenBy: { accountId: number; name: string };
  season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit";
  data: Record<string, number | boolean | string>;
  notes: string;
  deleted: boolean;
  templateId?: string; templateVersion?: number;
  /** This version was a restore: of version restoredFromVersion, or (null) of an edit kept on the loser's device. */
  restored: boolean;
  restoredFromVersion: number | null;
}
