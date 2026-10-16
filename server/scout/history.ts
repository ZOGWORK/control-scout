// Version history of workspace scout entries (Task 16; table workspace_entry_versions, migration 20).
//
// - Every accepted write that changes an entry (entries.ts, pushWorkspaceEntries) adds a version in the
//   same transaction as the write: who wrote it (the editor), when (its updatedAt), and the text: data,
//   notes, team, event, match, kind, deleted, and the template it was made with. A refused write, an older
//   version beaten by a newer one, or a resend that changes nothing adds none.
// - The last HISTORY_LIMIT (20) versions per entry are kept; older ones are pruned in the same transaction.
// - Photos aren't versioned (their own list, photos.ts); personal entries have no history.
// - A restore is an ordinary write (same permission check, a fresh updatedAt, attributed to whoever restores)
//   that carries `restoredFrom`: the updatedAt of the version it brings back. Its version is marked restored,
//   with the version number it came from when the server has it (NULL: an edit that never reached the server,
//   kept on the loser's device); the activity feed logs it as entry.version_restored.
//
// GET /api/scout/workspaces/:workspaceId/entries/:uuid/history: the versions, newest first, for members
// (401 signed out, 503 paused, 400 bad id, 403 not a member, 404 no such entry).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { InStatement } from "@libsql/client";
import { all } from "../db.js";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { HISTORY_LIMIT, type EntryVersion } from "../../src/shared/entryHistory.js";
import { workspaceAccess, workspacePaused } from "./entries.js";

const WS = "(SELECT id FROM workspaces WHERE cp_workspace_id = ?)";

/**
 * The statements that record an entry's new version and prune the old ones, to run right after its upsert
 * in the same batch. They copy the row only if this batch wrote it (its seq is past `beforeSeq`, the
 * workspace's last seq when the serialized write began), so a refused or beaten write records nothing.
 */
export function versionStatements(workspaceId: string, uuid: string, beforeSeq: number, restore: { restored: boolean; fromVersion: number | null }): InStatement[] {
  return [
    {
      sql: `INSERT INTO workspace_entry_versions (workspace_id, uuid, version_no, season, team, event_code, match_label, kind, data, notes, deleted, updated_at,
              written_by_account_id, written_by_name, template_id, template_version, restored, restored_from_version)
            SELECT w.workspace_id, w.uuid,
              COALESCE((SELECT MAX(v.version_no) FROM workspace_entry_versions v WHERE v.workspace_id = w.workspace_id AND v.uuid = w.uuid), 0) + 1,
              w.season, w.team, w.event_code, w.match_label, w.kind, w.data, w.notes, w.deleted, w.updated_at,
              w.editor_account_id, w.editor_name, w.template_id, w.template_version, ?, ?
            FROM workspace_scout_entries w WHERE w.workspace_id = ${WS} AND w.uuid = ? AND w.seq > ?`,
      args: [restore.restored ? 1 : 0, restore.fromVersion, workspaceId, uuid, beforeSeq],
    },
    {
      sql: `DELETE FROM workspace_entry_versions WHERE workspace_id = ${WS} AND uuid = ?
              AND version_no <= (SELECT MAX(version_no) FROM workspace_entry_versions WHERE workspace_id = ${WS} AND uuid = ?) - ?`,
      args: [workspaceId, uuid, workspaceId, uuid, HISTORY_LIMIT],
    },
  ];
}

/** The kept version of these entries with these updatedAts (what a restore brings back), by uuid. */
export async function versionsAt(workspaceId: string, wanted: { uuid: string; updatedAt: number }[]): Promise<Map<string, { versionNo: number; name: string }>> {
  const out = new Map<string, { versionNo: number; name: string }>();
  for (const w of wanted) {
    const r = (await all<any>(
      `SELECT version_no, written_by_name FROM workspace_entry_versions WHERE workspace_id = ${WS} AND uuid = ? AND updated_at = ? ORDER BY version_no DESC LIMIT 1`,
      [workspaceId, w.uuid, w.updatedAt]))[0];
    if (r) out.set(w.uuid, { versionNo: Number(r.version_no), name: String(r.written_by_name ?? "") });
  }
  return out;
}

const parse = (raw: unknown): Record<string, number | boolean | string> => {
  try { const v = JSON.parse(String(raw)); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

const toVersion = (r: any): EntryVersion => ({
  versionNo: Number(r.version_no), updatedAt: Number(r.updated_at),
  writtenBy: { accountId: Number(r.written_by_account_id), name: String(r.written_by_name ?? "") },
  season: Number(r.season), team: Number(r.team), eventCode: r.event_code ?? null, matchLabel: r.match_label ?? null, kind: r.kind === "pit" ? "pit" : "match",
  data: parse(r.data), notes: String(r.notes ?? ""), deleted: !!Number(r.deleted),
  ...(r.template_id ? { templateId: String(r.template_id), templateVersion: Number(r.template_version ?? 0) } : {}),
  restored: !!Number(r.restored), restoredFromVersion: r.restored_from_version == null ? null : Number(r.restored_from_version),
});

/** An entry's kept versions, newest first (null: the workspace has no such entry). */
export async function entryHistory(workspaceId: string, uuid: string): Promise<EntryVersion[] | null> {
  const rows = await all<any>(
    `SELECT * FROM workspace_entry_versions WHERE workspace_id = ${WS} AND uuid = ? ORDER BY version_no DESC LIMIT ?`, [workspaceId, uuid, HISTORY_LIMIT]);
  if (rows.length) return rows.map(toVersion);
  const exists = await all<any>(`SELECT 1 FROM workspace_scout_entries WHERE workspace_id = ${WS} AND uuid = ?`, [workspaceId, uuid]);
  return exists.length ? [] : null;
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

/** Mounted under /api/scout. */
export function historyRouter(): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/entries/:uuid/history", h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    if (await workspacePaused(res)) return;
    const { workspaceId, uuid } = req.params;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(uuid)) { res.status(400).json({ error: "Invalid entry id" }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    const versions = await entryHistory(workspaceId, uuid);
    if (!versions) { res.status(404).json({ error: "No such entry in this workspace." }); return; }
    return { uuid, limit: HISTORY_LIMIT, versions };
  }));
  return r;
}
