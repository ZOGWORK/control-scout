// A workspace's scout template (Task 5): the fields its members' match and pit
// entries ask for, per season. docs/shared-accounts.md, "Workspace templates".
//
// Storage:
// - The current template of each season lives in the workspace mirror row's
//   settings JSON, under scoutTemplate.<season> = { version, match, pit,
//   updatedAt, updatedBy }. Other keys of that JSON (Task 6's defaults and
//   entry policy) are kept as they are. `match` / `pit` null: that kind uses
//   the built-in default (src/lib/scouting.ts).
// - Every admin change bumps the season's template version and the row's
//   settings_version, and writes the new version to workspace_template_versions,
//   whose rows never change: an entry records the template id and version it
//   was made with, so it renders with those fields after the template moves on.
// - Writes are admin-only (requireWorkspaceAdmin, roles from Control Point),
//   JSON only (CSRF, as /api/me), validated field by field (src/shared/scoutTemplate.ts).
//   The mirror row is created by the first save if no entry made it yet.
// - Each change is announced on the workspace's live streams (`event: template`)
//   and logged in its activity feed (template.changed; a save that changes nothing isn't).
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { db, get } from "../db.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { cleanFields, type DroppedField, type ScoutField, type TemplateKind, type WorkspaceTemplate } from "../../src/shared/scoutTemplate.js";
import { publishTemplate, serialized } from "./bus.js";
import { logActivity } from "./activityLog.js";
import { requireWorkspaceAdmin, workspaceAccess, workspacePaused, writerName } from "./entries.js";

/** One season's current template, as kept in workspaces.settings.scoutTemplate. */
interface StoredSeason { version: number; match: ScoutField[] | null; pit: ScoutField[] | null; updatedAt: string; updatedBy: string }
type Settings = Record<string, unknown> & { scoutTemplate?: Record<string, StoredSeason> };

const SEASON_MIN = 2000, SEASON_MAX = 2100;
/** One queue per workspace for every change to its settings JSON (template and settings saves alike). */
export const settingsLock = (workspaceId: string) => `settings:${workspaceId}`;
const isSeason = (n: number) => Number.isInteger(n) && n >= SEASON_MIN && n <= SEASON_MAX;

/** settings JSON, read leniently: anything unreadable is an empty object (never a 500). */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== "string" || !raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

/** A stored field list, re-checked on the way out (a list written by hand, or by an older build, can't break a form). */
function storedList(raw: unknown, kind: TemplateKind): ScoutField[] | null {
  if (raw == null) return null;
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { return null; } }
  return Array.isArray(raw) ? cleanFields(raw, kind).fields : null;
}

const defaults = (workspaceId: string, season: number, settingsVersion: number): WorkspaceTemplate =>
  ({ workspaceId, season, version: 0, settingsVersion, match: null, pit: null, updatedAt: null, updatedBy: null });

/** The workspace's current template for a season (version 0, built-in defaults, when never customised). Never writes. */
export async function currentTemplate(workspaceId: string, season: number): Promise<WorkspaceTemplate> {
  const row = await get<{ settings: string | null; settings_version: number }>("SELECT settings, settings_version FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]);
  if (!row) return defaults(workspaceId, season, 0);
  const settingsVersion = Number(row.settings_version);
  const s = parseSettings(row.settings).scoutTemplate?.[String(season)];
  if (!s || !Number.isSafeInteger(s.version) || s.version < 1) return defaults(workspaceId, season, settingsVersion);
  return {
    workspaceId, season, version: s.version, settingsVersion,
    match: storedList(s.match, "match"), pit: storedList(s.pit, "pit"),
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : null, updatedBy: typeof s.updatedBy === "string" ? s.updatedBy : null,
  };
}

/** One version from the history (what an older entry was made with). Null: no such version. Version 0: the defaults. */
export async function templateVersion(workspaceId: string, season: number, version: number): Promise<WorkspaceTemplate | null> {
  const ws = await get<{ id: number; settings_version: number }>("SELECT id, settings_version FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]);
  const settingsVersion = Number(ws?.settings_version ?? 0);
  if (version === 0) return defaults(workspaceId, season, settingsVersion);
  if (!ws) return null;
  const r = await get<any>("SELECT * FROM workspace_template_versions WHERE workspace_id = ? AND season = ? AND version = ?", [ws.id, season, version]);
  if (!r) return null;
  return {
    workspaceId, season, version, settingsVersion,
    match: storedList(r.match, "match"), pit: storedList(r.pit, "pit"), updatedAt: r.created_at, updatedBy: r.created_by_name || null,
  };
}

export type SaveResult =
  | { ok: true; changed: boolean; template: WorkspaceTemplate; dropped: (DroppedField & { kind: TemplateKind })[] }
  | { ok: false; status: 400 | 409; error: string; template?: WorkspaceTemplate; dropped?: (DroppedField & { kind: TemplateKind })[] };

const sameList = (a: ScoutField[] | null, b: ScoutField[] | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Save an admin's template for a season (membership and role already checked).
 * `body.match` / `body.pit`: a field list, null for the built-in default, absent
 * to keep the current one. `baseVersion` (optional): the version the admin
 * edited; another admin's save since then is a 409 with the current template.
 * Bad fields are dropped and reported, never the whole template; but a
 * non-empty list with no usable field at all is refused (400), so a broken
 * client can't wipe a form by accident. Saving what's already there changes nothing.
 */
export async function saveTemplate(user: User, m: Membership, body: any): Promise<SaveResult> {
  const season = Number(body?.season);
  if (!isSeason(season)) return { ok: false, status: 400, error: "season required" };
  const baseVersion = body?.baseVersion === undefined || body?.baseVersion === null ? null : Number(body.baseVersion);
  if (baseVersion !== null && (!Number.isSafeInteger(baseVersion) || baseVersion < 0)) return { ok: false, status: 400, error: "baseVersion must be a template version" };
  const dropped: (DroppedField & { kind: TemplateKind })[] = [];
  const incoming: Partial<Record<TemplateKind, ScoutField[] | null>> = {};
  for (const kind of ["match", "pit"] as const) {
    if (!body || !(kind in body)) continue;
    const raw = body[kind];
    if (raw === null) { incoming[kind] = null; continue; }
    if (!Array.isArray(raw)) return { ok: false, status: 400, error: `${kind} must be a list of fields, or null for the built-in default` };
    const c = cleanFields(raw, kind);
    dropped.push(...c.dropped.map((d) => ({ ...d, kind })));
    if (raw.length && !c.fields.length) return { ok: false, status: 400, error: `None of the ${kind} fields could be used.`, dropped };
    incoming[kind] = c.fields;
  }
  return serialized(settingsLock(m.workspaceId), async () => {
    const cur = await currentTemplate(m.workspaceId, season);
    if (baseVersion !== null && baseVersion !== cur.version) {
      return { ok: false as const, status: 409 as const, error: "Another admin changed this template meanwhile. Here's their version; make your change again on top of it.", template: cur };
    }
    const next = { match: "match" in incoming ? incoming.match! : cur.match, pit: "pit" in incoming ? incoming.pit! : cur.pit };
    if (sameList(next.match, cur.match) && sameList(next.pit, cur.pit)) return { ok: true as const, changed: false, template: cur, dropped };
    await writeVersion(user, m, season, cur, next);
    const saved = await currentTemplate(m.workspaceId, season);
    publishTemplate(m.workspaceId, { season, version: saved.version, settingsVersion: saved.settingsVersion });
    const kinds = (["match", "pit"] as const).filter((k) => !sameList(next[k], cur[k]));
    await logActivity(m.workspaceId, { accountId: m.accountId, name: writerName(user) }, "template.changed", `template:${season}`, { season, version: saved.version, kinds });
    return { ok: true as const, changed: true, template: saved, dropped };
  });
}

/** Write version cur.version + 1: the settings JSON (other keys kept) and the history row, in one transaction. */
async function writeVersion(user: User, m: Membership, season: number, cur: WorkspaceTemplate, next: { match: ScoutField[] | null; pit: ScoutField[] | null }) {
  const now = new Date().toISOString(), name = writerName(user), version = cur.version + 1;
  // Lazily: the workspace's first save creates its mirror row (when no entry has yet).
  await db().execute({ sql: "INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", args: [m.workspaceId, m.workspaceName, now, now] });
  const row = await get<{ id: number; settings: string | null; settings_version: number }>("SELECT id, settings, settings_version FROM workspaces WHERE cp_workspace_id = ?", [m.workspaceId]);
  if (!row) throw new Error("workspace row missing after insert");
  const settings = parseSettings(row.settings);
  const seasons = settings.scoutTemplate && typeof settings.scoutTemplate === "object" && !Array.isArray(settings.scoutTemplate) ? settings.scoutTemplate : {};
  settings.scoutTemplate = { ...seasons, [String(season)]: { version, match: next.match, pit: next.pit, updatedAt: now, updatedBy: name } };
  const before = Number(row.settings_version);
  const [upd] = await db().batch([
    // Guarded by the settings version read above: a change in between (another process) fails the whole save.
    { sql: "UPDATE workspaces SET settings = ?, settings_version = settings_version + 1, updated_at = ? WHERE id = ? AND settings_version = ?", args: [JSON.stringify(settings), now, row.id, before] },
    { sql: `INSERT INTO workspace_template_versions (workspace_id, season, version, match, pit, created_at, created_by_account_id, created_by_name)
            SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM workspaces WHERE id = ? AND settings_version = ?)`,
      args: [row.id, season, version, next.match && JSON.stringify(next.match), next.pit && JSON.stringify(next.pit), now, m.accountId, name, row.id, before + 1] },
  ], "write");
  if (!upd.rowsAffected) throw new Error("workspace settings changed during a template save");
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET" && !req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};

/**
 * /api/scout/workspaces/:workspaceId/template
 *   GET ?season=YYYY[&version=n]  any member. The current template (ETag: the season's version and the
 *                                 workspace's settings version, so a revalidation is a 304), or one version
 *                                 from the history (immutable). 404 for a version that never existed.
 *   PUT {season, match?, pit?, baseVersion?}  admins only. 200 {changed, template, dropped}; 409 another
 *                                 admin saved first (with theirs); 400 nothing usable.
 */
export function templateRouter(): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/template", h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    if (await workspacePaused(res)) return;
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    const season = Number(req.query.season);
    if (!isSeason(season)) { res.status(400).json({ error: "season required" }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    // Private: never in a shared cache; the browser revalidates with the ETag.
    res.set("Cache-Control", "private, no-cache");
    if (req.query.version !== undefined) {
      const version = Number(req.query.version);
      if (!Number.isSafeInteger(version) || version < 0) { res.status(400).json({ error: "version must be a template version" }); return; }
      const t = await templateVersion(workspaceId, season, version);
      if (!t) { res.status(404).json({ error: "No such template version." }); return; }
      res.set("ETag", `"tv-${season}-${version}"`);
      return { template: t };
    }
    const t = await currentTemplate(workspaceId, season);
    res.set("ETag", `"t-${season}-${t.version}-${t.settingsVersion}"`);
    return { template: t };
  }));
  r.put("/workspaces/:workspaceId/template", jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    const out = await saveTemplate(res.locals.user as User, res.locals.membership as Membership, req.body);
    if (!out.ok) { res.status(out.status).json({ error: out.error, template: out.template, dropped: out.dropped }); return; }
    return { changed: out.changed, template: out.template, dropped: out.dropped };
  }));
  return r;
}
