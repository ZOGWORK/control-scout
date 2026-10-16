// A workspace's settings (Task 6, Tier 2; docs/settings.md): the defaults for new entries in its
// scout space, and its entry policy. Shared by every member, written by admins only.
//
// Storage: the workspace mirror row's settings JSON, next to the template (templates.ts):
//   { scoutTemplate: {...}, defaults: { season, eventCode, updatedAt, updatedBy }, entryPolicy: {...} }
// - Other keys are kept as they are; every change bumps settings_version, guarded by the version read
//   (UPDATE … WHERE settings_version = ?), in the same per-workspace queue as template saves.
// - entryPolicy is fixed for now (ENTRY_POLICY: Task 3's rules, still enforced in entries.ts) and
//   written explicitly with every save, so a later change can read it without a migration.
// - Validation is field by field (src/shared/workspaceSettings.ts): a bad field is dropped and
//   reported, the rest kept; personal settings (theme, density, notifications) are never stored here.
// - Each change is announced on the workspace's live streams (`event: settings`).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { db, get } from "../db.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import {
  cleanSettingsPatch, ENTRY_POLICY, readDefaults, type DroppedSetting, type WorkspaceDefaults, type WorkspaceSettings,
} from "../../src/shared/workspaceSettings.js";
import { publishSettings, serialized } from "./bus.js";
import { requireWorkspaceAdmin, workspaceAccess, workspacePaused, writerName } from "./entries.js";
import { parseSettings, settingsLock } from "./templates.js";

/** The workspace's settings as members read them (defaults and the fixed policy when never written). Never writes. */
export async function currentSettings(workspaceId: string): Promise<WorkspaceSettings> {
  const row = await get<{ settings: string | null; settings_version: number }>("SELECT settings, settings_version FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]);
  const s = parseSettings(row?.settings);
  const d = s.defaults && typeof s.defaults === "object" ? s.defaults as Record<string, unknown> : {};
  return {
    workspaceId,
    settingsVersion: Number(row?.settings_version ?? 0),
    defaults: readDefaults(d),
    // Fixed for now: what's stored can't widen it (the server enforces Task 3's rules either way).
    entryPolicy: { ...ENTRY_POLICY },
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null,
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null,
  };
}

export type SettingsSaveResult =
  | { ok: true; changed: boolean; settings: WorkspaceSettings; dropped: DroppedSetting[] }
  | { ok: false; status: 400 | 409; error: string; settings?: WorkspaceSettings; dropped?: DroppedSetting[] };

/**
 * Save an admin's change (membership and role already checked). `baseVersion` (required): the
 * settings version the admin edited; anything saved since (another admin's settings or template) is
 * a 409 with the current settings. Bad fields are dropped and reported; saving what's already there
 * changes nothing (no version bump).
 */
export async function saveSettings(user: User, m: Membership, body: unknown): Promise<SettingsSaveResult> {
  const raw = (body && typeof body === "object" ? body as Record<string, unknown> : {}).baseVersion;
  const baseVersion = typeof raw === "number" ? raw : NaN;
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) return { ok: false, status: 400, error: "baseVersion must be the settingsVersion you edited" };
  const { defaults: patch, dropped } = cleanSettingsPatch(body);
  return serialized(settingsLock(m.workspaceId), async () => {
    const cur = await currentSettings(m.workspaceId);
    if (baseVersion !== cur.settingsVersion) {
      return { ok: false as const, status: 409 as const, error: "Another admin changed this workspace's settings meanwhile. Here are theirs; make your change again on top of them.", settings: cur, dropped };
    }
    const next: WorkspaceDefaults = { ...cur.defaults, ...patch };
    if (next.season === cur.defaults.season && next.eventCode === cur.defaults.eventCode) return { ok: true as const, changed: false, settings: cur, dropped };
    await write(user, m, cur.settingsVersion, next);
    const saved = await currentSettings(m.workspaceId);
    publishSettings(m.workspaceId, { settingsVersion: saved.settingsVersion });
    return { ok: true as const, changed: true, settings: saved, dropped };
  });
}

/** Write the new defaults (other keys kept) and bump settings_version, guarded by the version read. */
async function write(user: User, m: Membership, before: number, next: WorkspaceDefaults) {
  const now = new Date().toISOString();
  // Lazily: the first save creates the workspace's mirror row (when no entry or template has yet).
  await db().execute({ sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [m.workspaceId, m.workspaceName, now, now] });
  const row = await get<{ id: number; settings: string | null; settings_version: number }>("SELECT id, settings, settings_version FROM workspaces WHERE cp_workspace_id = ?", [m.workspaceId]);
  if (!row) throw new Error("workspace row missing after insert");
  if (Number(row.settings_version) !== before) throw new Error("workspace settings changed during a settings save");
  const settings = parseSettings(row.settings);
  settings.defaults = { season: next.season, eventCode: next.eventCode, updatedAt: now, updatedBy: writerName(user) };
  settings.entryPolicy = { ...ENTRY_POLICY };
  const upd = await db().execute({
    sql: "UPDATE workspaces SET settings = ?, settings_version = settings_version + 1, updated_at = ? WHERE id = ? AND settings_version = ?",
    args: [JSON.stringify(settings), now, row.id, before],
  });
  if (!upd.rowsAffected) throw new Error("workspace settings changed during a settings save");
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};

/**
 * /api/scout/workspaces/:workspaceId/settings
 *   GET  any member. {settings}, ETag by settings version (a revalidation is a 304).
 *   PUT  {defaults?: {season?, eventCode?}, baseVersion}  admins only, JSON only (CSRF, as /api/me).
 *        200 {changed, settings, dropped}; 409 stale baseVersion (with the current settings); 400 no baseVersion.
 */
export function settingsRouter(): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/settings", h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    if (await workspacePaused(res)) return;
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    const s = await currentSettings(workspaceId);
    // Private: never in a shared cache; the browser revalidates with the ETag.
    res.set("Cache-Control", "private, no-cache");
    res.set("ETag", `"ws-${workspaceId}-${s.settingsVersion}"`);
    return { settings: s };
  }));
  r.put("/workspaces/:workspaceId/settings", jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    const out = await saveSettings(res.locals.user as User, res.locals.membership as Membership, req.body);
    if (!out.ok) { res.status(out.status).json({ error: out.error, settings: out.settings, dropped: out.dropped }); return; }
    return { changed: out.changed, settings: out.settings, dropped: out.dropped };
  }));
  return r;
}
