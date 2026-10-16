// Scout entries on the server: the personal set (scout_entries, keyed by the
// Scout user, unchanged) and the shared set of each Control Point workspace
// (workspace_scout_entries, keyed by workspace + uuid).
//
// Workspace rules:
// - Every read and write needs the signed-in user's linked Control Point
//   account to be a member of the workspace right now (the cached membership,
//   re-checked with Control Point once on a miss). Otherwise 403.
// - Newer updatedAt wins, on the server too: an older write never replaces a
//   newer row. Deletes are tombstones.
// - Authorship is stamped by the server, never taken from the client: the
//   first writer is the author (it never changes after); every accepted write
//   records its editor.
// - Permissions (docs/workspaces.md), checked in the upsert itself so the
//   check and the write can't be split by another write: any member creates
//   and edits; deleting, and editing an entry that's already deleted
//   (bringing it back), is for its author or a workspace admin. A refused
//   write is reported per entry ("forbidden", with the server's copy), never
//   stored and never published.
// - The workspace mirror row is created by the first entry written, not before.
// - Pull is by cursor: `seq`, the server's per-workspace write order, not the
//   writers' clocks (an entry synced late with an old updatedAt would slip
//   behind a timestamp cursor).
// - Every accepted write is published to the workspace's live streams
//   (bus.ts, stream.ts), in seq order, and logged in the workspace's activity
//   feed (activityLog.ts) as added / edited / deleted / restored; a refused
//   write or one that changed nothing is not.
// - Every write that changed an entry also adds a version to its history
//   (history.ts, the last 20 kept), in the same transaction. A restore of an
//   earlier version (`restoredFrom`) is an ordinary write: the same permission
//   check, a fresh updatedAt, attributed to whoever restores; it's logged as
//   entry.version_restored.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, get, writeBatch } from "../db.js";
import { controlPointEnabled, isWorkspaceId, linkedAccountId, workspaceMembership, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { isEnabled } from "../flags.js";
import { publishEntries, serialized, type LiveEntry } from "./bus.js";
import { photosByEntry } from "./photoRows.js";
import { entryChange, logEntryWrites, type EntryBefore } from "./activityLog.js";
import { versionsAt, versionStatements } from "./history.js";
import type { EntryPhoto } from "../../src/shared/photos.js";

export interface ScoutEntryInput {
  uuid: string; season: number; team: number; eventCode: string | null; matchLabel: string | null; kind: "match" | "pit"; data: Record<string, unknown>; notes: string; updatedAt: number; deleted?: boolean;
  /** The template it was made with (workspace entries; see src/shared/scoutTemplate.ts). Null: unknown (made before templates). */
  templateId?: string | null; templateVersion?: number | null;
  /** Workspace entries: the stored version this edit was based on (the writer's last copy from the server). Absent: unknown. */
  baseUpdatedAt?: number;
  /** Workspace entries: this write restores an earlier version, the one with this updatedAt (history.ts). */
  restoredFrom?: number;
}

const TEMPLATE_ID = /^[A-Za-z0-9:_-]{1,100}$/;

export function cleanScoutEntry(x: any): ScoutEntryInput | null {
  if (!x || typeof x !== "object") return null;
  if (typeof x.uuid !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(x.uuid)) return null;
  const season = Number(x.season), team = Number(x.team), updatedAt = Number(x.updatedAt);
  if (!Number.isInteger(season) || season < 2000 || !Number.isInteger(team) || team < 1 || team > 999999 || !Number.isFinite(updatedAt)) return null;
  if (x.kind !== "match" && x.kind !== "pit") return null;
  const data = x.data && typeof x.data === "object" ? x.data : {};
  if (JSON.stringify(data).length > 20_000) return null;
  return {
    uuid: x.uuid, season, team, eventCode: typeof x.eventCode === "string" ? x.eventCode.slice(0, 24) : null, matchLabel: typeof x.matchLabel === "string" ? x.matchLabel.slice(0, 24) : null,
    kind: x.kind, data, notes: typeof x.notes === "string" ? x.notes.slice(0, 4000) : "", updatedAt, deleted: !!x.deleted,
    ...(typeof x.templateId === "string" && TEMPLATE_ID.test(x.templateId)
      ? { templateId: x.templateId, templateVersion: Number.isSafeInteger(x.templateVersion) && x.templateVersion >= 0 ? x.templateVersion : 0 }
      : {}),
    ...(Number.isFinite(x.baseUpdatedAt) ? { baseUpdatedAt: Number(x.baseUpdatedAt) } : {}),
    ...(Number.isFinite(x.restoredFrom) ? { restoredFrom: Number(x.restoredFrom) } : {}),
  };
}

/** A shared entry as the API sends it (the client's ScoutEntry, plus who last edited it). */
export interface WorkspaceEntryOut extends Omit<ScoutEntryInput, "restoredFrom"> {
  workspaceId: string; deleted: boolean;
  authorAccountId: number; authorDisplayName: string;
  editorAccountId: number; editorDisplayName: string;
  /** Its photos (photos.ts), the server's list: photosRev goes up on every photo change, so a device takes the newer list. */
  photos: EntryPhoto[]; photoExpired: boolean; photosRev: number;
}

const workspaceRow = (workspaceId: string, r: any, photos: EntryPhoto[] = []): WorkspaceEntryOut => ({
  uuid: r.uuid, workspaceId, season: Number(r.season), team: Number(r.team), eventCode: r.event_code, matchLabel: r.match_label, kind: r.kind,
  data: JSON.parse(r.data), notes: r.notes, updatedAt: Number(r.updated_at), deleted: !!r.deleted,
  authorAccountId: Number(r.author_account_id), authorDisplayName: r.author_name,
  editorAccountId: Number(r.editor_account_id), editorDisplayName: r.editor_name,
  ...(r.template_id ? { templateId: String(r.template_id), templateVersion: Number(r.template_version ?? 0) } : {}),
  ...(r.base_updated_at != null ? { baseUpdatedAt: Number(r.base_updated_at) } : {}),
  photos, photoExpired: photos.some((p) => p.expired), photosRev: Number(r.photos_rev ?? 0),
});
/** Stored rows (of one workspace) as live entries, each with its photos. */
async function liveRows(workspaceId: string, rows: any[]): Promise<LiveEntry[]> {
  if (!rows.length) return [];
  const photos = await photosByEntry(Number(rows[0].workspace_id), rows.map((r) => String(r.uuid)));
  return rows.map((r) => ({ ...workspaceRow(workspaceId, r, photos.get(String(r.uuid))), seq: Number(r.seq) }));
}

/** What's stored for these entries of a workspace now, with seq and photos (to publish a change). */
export async function readLiveEntries(workspaceId: string, uuids: string[]): Promise<Map<string, LiveEntry>> {
  if (!uuids.length) return new Map();
  const rows = await all<any>(
    `SELECT w.* FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id WHERE ws.cp_workspace_id = ? AND w.uuid IN (${uuids.map(() => "?").join(", ")})`,
    [workspaceId, ...uuids]);
  return new Map((await liveRows(workspaceId, rows)).map((e) => [e.uuid, e]));
}

/** How a writer is named on shared entries: their display name, else the part of their email before the @. */
export const writerName = (u: User) => (u.displayName?.trim() || u.email?.split("@")[0] || "Member").slice(0, 60);

export type Access = { ok: true; membership: Membership } | { ok: false; status: 403; error: string };

/** May this signed-in user read and write this workspace's entries right now? */
export async function workspaceAccess(user: User, workspaceId: string): Promise<Access> {
  const accountId = controlPointEnabled() ? await linkedAccountId(user.id) : null;
  if (accountId == null) return { ok: false, status: 403, error: "Workspace scouting needs an account linked with Control Point." };
  const membership = await workspaceMembership(accountId, workspaceId);
  if (!membership) return { ok: false, status: 403, error: "You're not a member of this workspace in Control Point." };
  return { ok: true, membership };
}

/** Roles come from Control Point (workspace_members, refreshed from it); Scout has none of its own. */
export type WorkspaceRole = Membership["role"];

/**
 * May this writer put this version over the stored one? (null stored: a new
 * entry, always allowed; that includes a tombstone for an entry created and
 * deleted on a device before it ever synced: it's the writer's own.) The same
 * rule as the upsert's WHERE, for the client and for explaining a refusal.
 */
export function mayWrite(role: WorkspaceRole, writerAccountId: number, stored: { authorAccountId: number; deleted: boolean } | null, deleting: boolean): boolean {
  if (!stored || role === "admin" || stored.authorAccountId === writerAccountId) return true;
  return !deleting && !stored.deleted; // a member edits anyone's live entry; deleting it, or reviving a deleted one, is the author's or an admin's
}

export const FORBIDDEN = "forbidden";

export const ADMIN_ONLY = "Only workspace admins can change this. Roles are managed in Control Point.";

/**
 * Workspace admins only (templates, workspace settings: Tasks 5 and 6). Same
 * membership check as workspaceAccess, then the role Control Point gave: a
 * member gets 403. A promotion in Control Point counts from the next
 * membership refresh (sign-in, /me, or within MEMBERSHIP_TTL).
 */
export async function workspaceAdminAccess(user: User, workspaceId: string): Promise<Access> {
  const access = await workspaceAccess(user, workspaceId);
  if (access.ok && access.membership.role !== "admin") return { ok: false, status: 403, error: ADMIN_ONLY };
  return access;
}

/**
 * Express guard for admin-only workspace routes: the workspace id from
 * `req.params.workspaceId`, else the query, else the body. 401 signed out,
 * 503 while workspace scouting is paused, 400 bad id, 403 not a member or not an admin; otherwise the membership is
 * on `res.locals.membership` for the handler.
 */
export function requireWorkspaceAdmin() {
  return (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const user = await currentUser(req);
      if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
      if (await workspacePaused(res)) return; // workspace scouting switched off in the owner portal: 503
      const workspaceId = req.params?.workspaceId ?? req.query?.workspaceId ?? req.body?.workspaceId;
      if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
      const access = await workspaceAdminAccess(user, workspaceId);
      if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
      res.locals.user = user;
      res.locals.membership = access.membership;
      next();
    })().catch(next);
  };
}

const UPSERT = `INSERT INTO workspace_scout_entries
    (workspace_id, uuid, season, team, event_code, match_label, kind, data, notes, updated_at, deleted, author_account_id, author_name, editor_account_id, editor_name, template_id, template_version, base_updated_at, seq)
  VALUES ((SELECT id FROM workspaces WHERE cp_workspace_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
    (SELECT COALESCE(MAX(s.seq), 0) + 1 FROM workspace_scout_entries s WHERE s.workspace_id = (SELECT id FROM workspaces WHERE cp_workspace_id = ?)))
  ON CONFLICT(workspace_id, uuid) DO UPDATE SET
    season = excluded.season, team = excluded.team, event_code = excluded.event_code, match_label = excluded.match_label, kind = excluded.kind,
    data = excluded.data, notes = excluded.notes, updated_at = excluded.updated_at, deleted = excluded.deleted,
    editor_account_id = excluded.editor_account_id, editor_name = excluded.editor_name, seq = excluded.seq, base_updated_at = excluded.base_updated_at,
    -- Devices send the template the entry was made with (an edit keeps it); one that sends none (an older build) leaves the stored one.
    template_id = COALESCE(excluded.template_id, workspace_scout_entries.template_id),
    template_version = CASE WHEN excluded.template_id IS NULL THEN workspace_scout_entries.template_version ELSE excluded.template_version END
  WHERE excluded.updated_at > workspace_scout_entries.updated_at
    AND (? = 1 OR workspace_scout_entries.author_account_id = excluded.editor_account_id
      OR (excluded.deleted = 0 AND workspace_scout_entries.deleted = 0))`; // mayWrite, in the same statement as the write

/** Per entry. ok: the stored copy (ours, or a newer edit that beat it). error "forbidden": refused by mayWrite; `entry` is the server's copy for the device to put back. */
export interface PushResult { uuid: string; ok: boolean; error?: string; entry?: WorkspaceEntryOut }

/**
 * Write a batch of entries into a workspace (membership already checked).
 * Each result carries the stored version, which is the sent one unless a newer
 * edit was already there, so the device can adopt the server's copy (and the
 * authorship the server stamped).
 */
export async function pushWorkspaceEntries(user: User, m: Membership, raw: unknown[]): Promise<PushResult[]> {
  const results: PushResult[] = [];
  const good: ScoutEntryInput[] = [];
  for (const x of raw) {
    const e = cleanScoutEntry(x);
    const space = (x as { workspaceId?: unknown } | null)?.workspaceId;
    if (!e) { results.push({ uuid: String((x as any)?.uuid ?? ""), ok: false, error: "invalid entry" }); continue; }
    if (space !== undefined && space !== m.workspaceId) { results.push({ uuid: e.uuid, ok: false, error: "wrong space" }); continue; }
    // One version per entry per push (a device sends each queued entry once): a second one would make
    // the per-entry result ambiguous (which version was refused?), so it's refused itself.
    if (good.some((x) => x.uuid === e.uuid)) { results.push({ uuid: e.uuid, ok: false, error: "duplicate entry" }); continue; }
    good.push(e);
    results.push({ uuid: e.uuid, ok: true });
  }
  if (!good.length) return results;
  // One write at a time per workspace, so the live streams get entries in seq order (bus.ts).
  const stored = await serialized(m.workspaceId, async () => {
    const before = await lastSeq(m.workspaceId);
    const prior = await storedVersions(m.workspaceId, good.map((e) => e.uuid));
    // Restores: which kept version each brings back (for its history row and the activity feed).
    const restored = await versionsAt(m.workspaceId, good.filter((e) => e.restoredFrom != null).map((e) => ({ uuid: e.uuid, updatedAt: e.restoredFrom! })));
    const rows = await writeWorkspaceEntries(user, m, good, before, prior, restored);
    // Written by this push: a new seq (an entry beaten by a newer edit, refused, or resent unchanged, keeps its old one).
    const written = [...rows.values()].filter((e) => e.seq > before).sort((a, b) => a.seq - b.seq);
    publishEntries(m.workspaceId, written);
    // The activity feed, once the write has committed: only entries this push changed (never throws).
    const sentNow = new Map(good.map((e) => [e.uuid, e]));
    await logEntryWrites(m.workspaceId, { accountId: m.accountId, name: writerName(user) }, written.map((after) => {
      const fromAt = sentNow.get(after.uuid)?.restoredFrom;
      const from = restored.get(after.uuid);
      return { before: prior.get(after.uuid), after, ...(fromAt != null ? { restore: { fromAt, fromVersion: from?.versionNo ?? null, fromName: from?.name ?? null } } : {}) };
    }));
    return rows;
  });
  const sent = new Map(good.map((e) => [e.uuid, e]));
  for (const r of results) {
    if (!r.ok) continue;
    const e = stored.get(r.uuid);
    r.entry = e && withoutSeq(e);
    // Newer than the stored copy, yet not written: only the permission check refuses that.
    if (e && e.updatedAt < sent.get(r.uuid)!.updatedAt) { r.ok = false; r.error = FORBIDDEN; }
  }
  return results;
}

const withoutSeq = ({ seq: _s, ...e }: LiveEntry): WorkspaceEntryOut => e;

/**
 * Upsert the entries (newer updatedAt wins) and read back what's stored for each, with its seq. Each write that
 * changes its entry (against `prior`, the stored versions read in this serialized section) also records a
 * version, in the same transaction, if the upsert took it (history.ts).
 */
async function writeWorkspaceEntries(user: User, m: Membership, good: ScoutEntryInput[], beforeSeq: number, prior: Map<string, EntryBefore>,
  restored: Map<string, { versionNo: number }>): Promise<Map<string, LiveEntry>> {
  const now = new Date().toISOString(), name = writerName(user);
  await writeBatch([
    // Lazily: the workspace's first entry creates its mirror row.
    { sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [m.workspaceId, m.workspaceName, now, now] },
    ...good.flatMap((e) => [
      {
        sql: UPSERT,
        args: [m.workspaceId, e.uuid, e.season, e.team, e.eventCode, e.matchLabel, e.kind, JSON.stringify(e.data), e.notes, e.updatedAt, e.deleted ? 1 : 0,
          m.accountId, name, m.accountId, name, e.templateId ?? null, e.templateId ? e.templateVersion ?? 0 : null, e.baseUpdatedAt ?? null, m.workspaceId, m.role === "admin" ? 1 : 0],
      },
      // A write that changes nothing (or a tombstone for an entry never seen) is no version; a new template for the same answers is one.
      ...(entryChange(prior.get(e.uuid), { ...e, deleted: !!e.deleted }) || templateChanged(prior.get(e.uuid), e)
        ? versionStatements(m.workspaceId, e.uuid, beforeSeq, { restored: e.restoredFrom != null && !e.deleted, fromVersion: e.deleted ? null : restored.get(e.uuid)?.versionNo ?? null })
        : []),
    ]),
  ]);
  return readLiveEntries(m.workspaceId, good.map((e) => e.uuid));
}

/**
 * Does this write give a stored, live entry a different template (the same answers read with other fields)?
 * A write that sends none keeps the stored one (the upsert's COALESCE), so that's no change.
 */
function templateChanged(before: EntryBefore | undefined, e: ScoutEntryInput): boolean {
  if (!before || e.deleted || !e.templateId) return false;
  return e.templateId !== (before.templateId ?? null) || (e.templateVersion ?? 0) !== (before.templateVersion ?? null);
}

/** The stored version of these entries before a write (for the activity feed: added, edited, deleted, or nothing). */
async function storedVersions(workspaceId: string, uuids: string[]): Promise<Map<string, EntryBefore>> {
  if (!uuids.length) return new Map();
  const rows = await all<any>(
    `SELECT w.uuid, w.deleted, w.season, w.team, w.event_code, w.match_label, w.kind, w.data, w.notes, w.template_id, w.template_version FROM workspace_scout_entries w
       JOIN workspaces ws ON ws.id = w.workspace_id WHERE ws.cp_workspace_id = ? AND w.uuid IN (${uuids.map(() => "?").join(", ")})`,
    [workspaceId, ...uuids]);
  return new Map(rows.map((r) => [String(r.uuid), {
    deleted: !!Number(r.deleted), season: Number(r.season), team: Number(r.team), eventCode: r.event_code ?? null, matchLabel: r.match_label ?? null,
    kind: String(r.kind), data: String(r.data), notes: String(r.notes ?? ""),
    templateId: r.template_id ?? null, templateVersion: r.template_version == null ? null : Number(r.template_version),
  }]));
}

/** The workspace's latest seq (0 before its first entry). */
export async function lastSeq(workspaceId: string): Promise<number> {
  const r = await get<{ seq: number | null }>(
    "SELECT MAX(w.seq) seq FROM workspace_scout_entries w JOIN workspaces ws ON ws.id = w.workspace_id WHERE ws.cp_workspace_id = ?", [workspaceId]);
  return Number(r?.seq ?? 0);
}

export const PULL_LIMIT = 500;

/** Entries written to the workspace after `since` (a cursor from an earlier pull; 0 = everything), tombstones included, in write order. */
export async function pullWorkspaceEntries(workspaceId: string, since: number): Promise<{ entries: WorkspaceEntryOut[]; cursor: number; more: boolean }> {
  const page = await pullWorkspaceLive(workspaceId, since);
  return { ...page, entries: page.entries.map(withoutSeq) };
}

/** pullWorkspaceEntries with each entry's seq (the live stream's event ids). */
export async function pullWorkspaceLive(workspaceId: string, since: number): Promise<{ entries: LiveEntry[]; cursor: number; more: boolean }> {
  const ws = await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]);
  if (!ws) return { entries: [], cursor: since, more: false }; // nothing written yet (and reading never creates the row)
  const rows = await all<any>("SELECT * FROM workspace_scout_entries WHERE workspace_id = ? AND seq > ? ORDER BY seq LIMIT ?", [ws.id, since, PULL_LIMIT]);
  return { entries: await liveRows(workspaceId, rows), cursor: rows.length ? Number(rows.at(-1).seq) : since, more: rows.length === PULL_LIMIT };
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

/** Workspace scouting switched off in the owner portal (the workspaceScouting flag): shared pushes and pulls answer this
 *  (503, nothing read or written, the device keeps its queue for later); personal scouting carries on. */
export const WORKSPACE_PAUSED = "Workspace scouting is paused right now. Your entries stay on this device and sync once it's back; personal scouting still syncs.";
export async function workspacePaused(res: Response): Promise<boolean> {
  if (await isEnabled("workspaceScouting")) return false;
  res.set("Cache-Control", "no-store");
  res.status(503).json({ error: WORKSPACE_PAUSED, paused: true });
  return true;
}

/** /api/scout: the workspace pull. (The push is the existing /api/me/scout/sync, with a workspaceId.) */
export function scoutRouter(): Router {
  const r = express.Router();
  r.get("/sync", h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in to sync this across devices." }); return; }
    if (await workspacePaused(res)) return;
    const workspaceId = req.query.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    const since = req.query.since === undefined ? 0 : Number(req.query.since);
    if (!Number.isSafeInteger(since) || since < 0) { res.status(400).json({ error: "since must be a cursor from an earlier pull" }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    res.set("Cache-Control", "no-store");
    return pullWorkspaceEntries(workspaceId, since);
  }));
  return r;
}
