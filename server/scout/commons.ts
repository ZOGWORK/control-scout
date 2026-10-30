// The scouting commons (docs/scouting-commons.md): pit entries a workspace chooses to share with every signed-in
// Scout user at an event, credited to the workspace by name. Match entries are never shared.
//
// Three switches, all off by default, and an entry is in the commons only while all three are on:
// - the event's: the owner opens the commons one event at a time (commons_events), so moderation stays reviewable;
// - the workspace's: its admins opt in (commons_workspaces); opting out withdraws everything it shared;
// - the entry's: its author or a workspace admin shares it (commons_entries, status "published").
// The entry itself is read live from workspace_scout_entries: an edit shows at once, a deleted entry (or one edited
// into a match entry) drops out, and commons_entries' event + team key follows the entry on every write (bus.ts).
// Workspace scouting switched off for a workspace (the owner's per-workspace flag) hides its shares too.
//
// Reading (any signed-in account): GET /api/scout/commons?season=&team=[&event=]. The reader's own workspaces'
// entries are left out (they read those as their own scouting, which always comes first). Photos are the
// workspace's photos (entry_photos: same caps, same expiry), viewed through GET /api/scout/commons/photos/:id.
// Nothing here names a person: the credit is the workspace.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, get, run } from "../db.js";
import { isWorkspaceId, linkedAccountId } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { isEnabledFor } from "../flags.js";
import { aggregateConsensus, type ConsensusEntry } from "../../src/shared/consensus.js";
import {
  COMMONS_REFUSAL, type CommonsAnswer, type CommonsEntry, type CommonsEvent, type CommonsPhoto, type CommonsRefusal, type CommonsStatus, type WorkspaceCommons,
} from "../../src/shared/commons.js";
import { accessError, requireWorkspaceAdmin, workspaceAccess, workspacePaused, writerName } from "./entries.js";
import { fieldReader } from "./consensus.js";
import { onEntriesWritten } from "./bus.js";
import { photosAvailable, PHOTO_TIMING } from "./photos.js";
import { r2, viewUrl } from "./r2.js";
import type { Membership } from "../auth/controlPoint.js";
import { recordAudit } from "../portal/audit.js";

const EVENT_CODE = /^[A-Z0-9_-]{1,40}$/;
const isSeason = (n: number) => Number.isSafeInteger(n) && n >= 2000 && n <= 2100;
const isTeam = (n: number) => Number.isSafeInteger(n) && n >= 1 && n <= 999_999;

// ---------------------------------------------------------------------------
// The event switch (owner)
// ---------------------------------------------------------------------------

export interface CommonsEventSwitch extends CommonsEvent { season: number; enabled: boolean; updatedAt: string; updatedBy: string; shared: number }

/** Every event the owner has switched (on or off), newest change first, with how many entries are shared there now. */
export async function listCommonsEvents(): Promise<CommonsEventSwitch[]> {
  const rows = await all<any>(
    `SELECT ce.season, ce.event_code, ce.enabled, ce.updated_at, ce.updated_by, e.name, e.start, e.end,
            (SELECT COUNT(*) FROM commons_entries c WHERE c.season = ce.season AND c.event_code = ce.event_code AND c.status = 'published') shared
       FROM commons_events ce LEFT JOIN events e ON e.season = ce.season AND e.code = ce.event_code
      ORDER BY ce.updated_at DESC`);
  return rows.map((r) => ({
    season: Number(r.season), code: String(r.event_code), name: String(r.name ?? r.event_code), start: r.start ?? null, end: r.end ?? null,
    enabled: Number(r.enabled) === 1, updatedAt: String(r.updated_at), updatedBy: String(r.updated_by), shared: Number(r.shared ?? 0),
  }));
}

export class CommonsError extends Error { constructor(readonly status: number, message: string) { super(message); } }

/** Switch the commons on or off for one event (an event Scout knows). Returns what it was before (null: never set). */
export async function setCommonsEvent(season: number, code: string, enabled: boolean, by: string): Promise<{ was: boolean | null }> {
  const c = code.toUpperCase();
  if (!isSeason(season) || !EVENT_CODE.test(c)) throw new CommonsError(400, "Not an event");
  if (!(await get("SELECT 1 FROM events WHERE season = ? AND code = ?", [season, c]))) throw new CommonsError(404, `No event ${c} in ${season}`);
  const before = await get<{ enabled: number }>("SELECT enabled FROM commons_events WHERE season = ? AND event_code = ?", [season, c]);
  await run(
    `INSERT INTO commons_events (season, event_code, enabled, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(season, event_code) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [season, c, enabled ? 1 : 0, new Date().toISOString(), by]);
  return { was: before ? Number(before.enabled) === 1 : null };
}

async function eventOpen(season: number, code: string): Promise<boolean> {
  return !!(await get("SELECT 1 FROM commons_events WHERE season = ? AND event_code = ? AND enabled = 1", [season, code]));
}

// ---------------------------------------------------------------------------
// The workspace side (members read, admins opt in, author or admin shares)
// ---------------------------------------------------------------------------

const workspaceDbId = async (workspaceId: string) =>
  (await get<{ id: number }>("SELECT id FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]))?.id ?? null;

/** The workspace's opt-in and its shares (members). Never writes. */
export async function workspaceCommons(workspaceId: string): Promise<WorkspaceCommons> {
  const id = await workspaceDbId(workspaceId);
  const opt = id == null ? undefined : await get<any>("SELECT opted_in, updated_at, updated_by FROM commons_workspaces WHERE workspace_id = ?", [id]);
  const shares = id == null ? [] : await all<any>("SELECT entry_uuid, status, published_at, event_code, team FROM commons_entries WHERE workspace_id = ? ORDER BY published_at DESC", [id]);
  return {
    workspaceId,
    optedIn: Number(opt?.opted_in ?? 0) === 1,
    updatedAt: opt?.updated_at ?? null, updatedBy: opt?.updated_by ?? null,
    shares: shares.map((r) => ({ uuid: String(r.entry_uuid), status: r.status as CommonsStatus, publishedAt: Number(r.published_at), eventCode: String(r.event_code), team: Number(r.team) })),
  };
}

/** An admin's opt-in or opt-out. Opting out withdraws every share, so opting back in never republishes anything by itself. */
export async function setWorkspaceOptIn(user: User, m: Membership, optedIn: boolean): Promise<WorkspaceCommons> {
  const now = new Date().toISOString();
  await run("INSERT INTO workspaces (cp_workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(cp_workspace_id) DO NOTHING", [m.workspaceId, m.workspaceName, now, now]);
  const id = (await workspaceDbId(m.workspaceId))!;
  await run(
    `INSERT INTO commons_workspaces (workspace_id, opted_in, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET opted_in = excluded.opted_in, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    [id, optedIn ? 1 : 0, now, writerName(user)]);
  if (!optedIn) await run("UPDATE commons_entries SET status = 'withdrawn', updated_at = ? WHERE workspace_id = ? AND status = 'published'", [Date.now(), id]);
  return workspaceCommons(m.workspaceId);
}

export type PublishResult = { ok: true; commons: WorkspaceCommons } | { ok: false; status: 403 | 404 | 409; code: CommonsRefusal; error: string };

const refuse = (status: 403 | 404 | 409, code: CommonsRefusal): PublishResult => ({ ok: false, status, code, error: COMMONS_REFUSAL[code] });

/**
 * Share (publish) or unshare one pit entry. Unsharing is always allowed to the same people; sharing needs the
 * workspace opted in, a live pit entry with an event, and the commons open at that event.
 */
export async function publishEntry(m: Membership, uuid: string, publish: boolean): Promise<PublishResult> {
  const id = await workspaceDbId(m.workspaceId);
  const e = id == null ? undefined : await get<any>(
    "SELECT season, team, event_code, kind, deleted, author_account_id FROM workspace_scout_entries WHERE workspace_id = ? AND uuid = ?", [id, uuid]);
  if (!e || Number(e.deleted)) return refuse(404, "no_entry");
  // The same shape as deleting (entries.ts mayWrite): the author's call, or an admin's.
  if (m.role !== "admin" && Number(e.author_account_id) !== m.accountId) return refuse(403, "forbidden");
  if (!publish) {
    await run("UPDATE commons_entries SET status = 'withdrawn', updated_at = ? WHERE workspace_id = ? AND entry_uuid = ?", [Date.now(), id, uuid]);
    return { ok: true, commons: await workspaceCommons(m.workspaceId) };
  }
  const opt = await get<{ opted_in: number }>("SELECT opted_in FROM commons_workspaces WHERE workspace_id = ?", [id]);
  if (Number(opt?.opted_in ?? 0) !== 1) return refuse(409, "not_opted_in");
  if (e.kind !== "pit") return refuse(409, "not_pit");
  const code = String(e.event_code ?? "").toUpperCase();
  if (!code) return refuse(409, "no_event");
  if (!(await eventOpen(Number(e.season), code))) return refuse(409, "event_off");
  const now = Date.now();
  await run(
    `INSERT INTO commons_entries (workspace_id, entry_uuid, season, event_code, team, status, published_at, published_by_account_id, updated_at)
     VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)
     ON CONFLICT(workspace_id, entry_uuid) DO UPDATE SET season = excluded.season, event_code = excluded.event_code, team = excluded.team,
       status = 'published', published_at = excluded.published_at, published_by_account_id = excluded.published_by_account_id, updated_at = excluded.updated_at`,
    [id, uuid, Number(e.season), code, Number(e.team), now, m.accountId, now]);
  return { ok: true, commons: await workspaceCommons(m.workspaceId) };
}

/** Keep the commons' event + team key on the entry: an edit can move a pit entry to another team or event. */
export async function followEntryKeys(workspaceId: string, uuids: string[]): Promise<void> {
  if (!uuids.length) return;
  await run(
    `UPDATE commons_entries SET
       season = (SELECT w.season FROM workspace_scout_entries w WHERE w.workspace_id = commons_entries.workspace_id AND w.uuid = commons_entries.entry_uuid),
       team = (SELECT w.team FROM workspace_scout_entries w WHERE w.workspace_id = commons_entries.workspace_id AND w.uuid = commons_entries.entry_uuid),
       event_code = COALESCE((SELECT UPPER(w.event_code) FROM workspace_scout_entries w WHERE w.workspace_id = commons_entries.workspace_id AND w.uuid = commons_entries.entry_uuid), '')
     WHERE workspace_id = (SELECT id FROM workspaces WHERE cp_workspace_id = ?) AND entry_uuid IN (${uuids.map(() => "?").join(", ")})`,
    [workspaceId, ...uuids]);
}
onEntriesWritten((workspaceId, entries) => {
  followEntryKeys(workspaceId, entries.map((e) => e.uuid)).catch((err) => console.error("[commons] couldn't follow an entry's event and team", err));
});

// ---------------------------------------------------------------------------
// Reading the commons (any signed-in account)
// ---------------------------------------------------------------------------

/**
 * What's in the commons now, as SQL over commons_entries c, the entry w, the event switch ce and the opt-in cw:
 * shared, the entry live, a pit entry still on the key it was shared under, the event open and the workspace opted in.
 */
const VISIBLE = `c.status = 'published' AND w.deleted = 0 AND w.kind = 'pit'
  AND w.season = c.season AND UPPER(w.event_code) = c.event_code AND w.team = c.team
  AND ce.enabled = 1 AND cw.opted_in = 1`;
const FROM = `commons_entries c
  JOIN workspace_scout_entries w ON w.workspace_id = c.workspace_id AND w.uuid = c.entry_uuid
  JOIN commons_events ce ON ce.season = c.season AND ce.event_code = c.event_code
  JOIN commons_workspaces cw ON cw.workspace_id = c.workspace_id
  JOIN workspaces ws ON ws.id = c.workspace_id`;

/** The workspaces (Control Point ids) a signed-in user belongs to, as last cached: their entries aren't commons to them. */
async function ownWorkspaces(user: User): Promise<Set<string>> {
  const accountId = await linkedAccountId(user.id).catch(() => null);
  if (accountId == null) return new Set();
  return new Set((await all<{ cp_workspace_id: string }>("SELECT cp_workspace_id FROM workspace_members WHERE account_id = ?", [accountId])).map((r) => String(r.cp_workspace_id)));
}

/** Source workspaces whose scouting the owner paused (the workspaceScouting flag): their shares are hidden too. */
async function pausedSources(cpIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of new Set(cpIds)) if (!(await isEnabledFor("workspaceScouting", id))) out.add(id);
  return out;
}

/** The commons on one team in one season: at `event`, or at every event the commons is open at. */
export async function readCommons(user: User, season: number, team: number, event: string | null): Promise<CommonsAnswer> {
  const rows = await all<any>(
    `SELECT c.workspace_id, c.entry_uuid, c.published_at, ws.cp_workspace_id, ws.name ws_name,
            w.season, w.team, w.event_code, w.data, w.notes, w.updated_at, w.template_id, w.template_version
       FROM ${FROM}
      WHERE c.season = ? AND c.team = ? ${event ? "AND c.event_code = ?" : ""} AND ${VISIBLE}
      ORDER BY w.updated_at DESC`,
    event ? [season, team, event] : [season, team]);
  const own = await ownWorkspaces(user);
  const paused = await pausedSources(rows.map((r) => String(r.cp_workspace_id)));
  const kept = rows.filter((r) => !paused.has(String(r.cp_workspace_id)));
  const mine = kept.filter((r) => own.has(String(r.cp_workspace_id)));
  const theirs = kept.filter((r) => !own.has(String(r.cp_workspace_id)));
  const photos = await commonsPhotos(theirs);
  const readers = new Map<string, ReturnType<typeof fieldReader>>();
  const entries: CommonsEntry[] = [];
  const layer: ConsensusEntry[] = [];
  for (const r of theirs) {
    const cpId = String(r.cp_workspace_id);
    let read = readers.get(cpId);
    if (!read) { read = fieldReader(cpId); readers.set(cpId, read); }
    const fields = await read(Number(r.season), "pit", r.template_id ?? null, r.template_version == null ? 0 : Number(r.template_version));
    let data: Record<string, unknown> = {};
    try { const d = JSON.parse(String(r.data)); if (d && typeof d === "object" && !Array.isArray(d)) data = d; } catch { /* unreadable: no answers */ }
    const key = `${Number(r.workspace_id)}:${String(r.entry_uuid)}`;
    entries.push({
      id: key, source: { id: Number(r.workspace_id), name: String(r.ws_name || "A workspace") },
      season: Number(r.season), eventCode: String(r.event_code).toUpperCase(), team: Number(r.team),
      data, notes: String(r.notes ?? ""), fields, scoutedAt: Number(r.updated_at), publishedAt: Number(r.published_at), photos: photos.get(key) ?? [],
    });
    // One "scout" per source workspace (aggregateConsensus counts distinct authors).
    layer.push({ team, kind: "pit", authorAccountId: Number(r.workspace_id), updatedAt: Number(r.updated_at), data, fields });
  }
  return { season, team, events: await commonsEvents(season, event), entries, layer: aggregateConsensus(team, layer), ownHidden: mine.length };
}

async function commonsEvents(season: number, event: string | null): Promise<CommonsEvent[]> {
  const rows = await all<any>(
    `SELECT ce.event_code, e.name, e.start, e.end FROM commons_events ce LEFT JOIN events e ON e.season = ce.season AND e.code = ce.event_code
      WHERE ce.season = ? AND ce.enabled = 1 ${event ? "AND ce.event_code = ?" : ""} ORDER BY e.start, ce.event_code`,
    event ? [season, event] : [season]);
  return rows.map((r) => ({ code: String(r.event_code), name: String(r.name ?? r.event_code), start: r.start ?? null, end: r.end ?? null }));
}

/** The ready and expired photos of these commons entries, oldest first, by `${workspace_id}:${uuid}`. */
async function commonsPhotos(rows: any[]): Promise<Map<string, CommonsPhoto[]>> {
  const out = new Map<string, CommonsPhoto[]>();
  if (!rows.length || !(await photosAvailable())) return out;
  const pairs = rows.map((r) => [Number(r.workspace_id), String(r.entry_uuid)] as const);
  const found = await all<any>(
    `SELECT id, workspace_id, entry_uuid, created_at, status FROM entry_photos
      WHERE status IN ('ready', 'expired') AND (${pairs.map(() => "(workspace_id = ? AND entry_uuid = ?)").join(" OR ")}) ORDER BY created_at, id`,
    pairs.flat());
  for (const p of found) {
    const key = `${Number(p.workspace_id)}:${String(p.entry_uuid)}`;
    const list = out.get(key) ?? [];
    list.push({ id: String(p.id), createdAt: Number(p.created_at), expired: p.status === "expired" });
    out.set(key, list);
  }
  return out;
}

/** A photo, if it's on an entry in the commons right now (and its source isn't paused). */
async function commonsPhoto(id: string): Promise<{ object_key: string; status: string } | null> {
  const r = await get<any>(
    `SELECT p.object_key, p.status, ws.cp_workspace_id FROM ${FROM}
       JOIN entry_photos p ON p.workspace_id = c.workspace_id AND p.entry_uuid = c.entry_uuid
      WHERE p.id = ? AND ${VISIBLE}`, [id]);
  if (!r || !(await isEnabledFor("workspaceScouting", String(r.cp_workspace_id)))) return null;
  return { object_key: String(r.object_key), status: String(r.status) };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};

/**
 * /api/scout/commons and /api/scout/workspaces/:workspaceId/commons:
 *   GET  /commons?season=&team=[&event=]          signed in. CommonsAnswer. private, no-store.
 *   GET  /commons/photos/:id                       signed in; 302 to a short-lived signed URL, 410 expired, 404 not in the commons.
 *   GET  /workspaces/:id/commons                   members. WorkspaceCommons.
 *   PUT  /workspaces/:id/commons {optedIn}         admins. WorkspaceCommons.
 *   PUT  /workspaces/:id/commons/entries/:uuid {publish}   the entry's author or an admin. {commons}; 4xx {error, code}.
 */
export function commonsRouter(): Router {
  const r = express.Router();
  r.get("/commons", h(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in to read the scouting commons." }); return; }
    const season = Number(req.query.season), team = Number(req.query.team);
    if (!isSeason(season) || !isTeam(team)) { res.status(400).json({ error: "season and team required" }); return; }
    const event = typeof req.query.event === "string" && req.query.event ? req.query.event.toUpperCase() : null;
    if (event != null && !EVENT_CODE.test(event)) { res.status(400).json({ error: "Not an event code" }); return; }
    return readCommons(user, season, team, event);
  }));
  r.get("/commons/photos/:id", h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const c = r2();
    const p = c && (await photosAvailable()) ? await commonsPhoto(String(req.params.id)) : null;
    if (!c || !p || (p.status !== "ready" && p.status !== "expired")) { res.status(404).json({ error: "No such photo." }); return; }
    if (p.status === "expired") { res.status(410).json({ error: "photo expired" }); return; }
    res.set("Cache-Control", `private, max-age=${PHOTO_TIMING.viewTtlSec - 120}`);
    res.redirect(302, viewUrl(c, p.object_key, PHOTO_TIMING.viewTtlSec));
  }));

  r.get("/workspaces/:workspaceId/commons", h(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (await workspacePaused(res, workspaceId)) return;
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
    return workspaceCommons(workspaceId);
  }));
  r.put("/workspaces/:workspaceId/commons", jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    if (typeof req.body?.optedIn !== "boolean") { res.status(400).json({ error: "Send {\"optedIn\": true | false}" }); return; }
    return setWorkspaceOptIn(res.locals.user as User, res.locals.membership as Membership, req.body.optedIn);
  }));
  r.put("/workspaces/:workspaceId/commons/entries/:uuid", jsonOnly, h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (typeof req.body?.publish !== "boolean") { res.status(400).json({ error: "Send {\"publish\": true | false}" }); return; }
    if (await workspacePaused(res, workspaceId)) return;
    const access = await workspaceAccess(user, workspaceId, { write: true });
    if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
    const out = await publishEntry(access.membership, String(req.params.uuid), req.body.publish);
    if (!out.ok) { res.status(out.status).json({ error: out.error, code: out.code }); return; }
    return { commons: out.commons };
  }));
  return r;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
/**
 * The owner console's commons routes (mounted under /api/owner, behind its owner gate and JSON-only rule):
 *   GET /commons/events                         every event switched, with what's shared there.
 *   PUT /commons/events/:season/:code {enabled}  open or close the commons at one event; audited.
 */
export function commonsOwnerRoutes(r: Router, wrap: (fn: Handler) => (req: Request, res: Response, next: NextFunction) => void, actor: (req: Request) => string) {
  r.get("/commons/events", wrap(async () => ({ events: await listCommonsEvents() })));
  r.put("/commons/events/:season/:code", wrap(async (req, res) => {
    if (typeof req.body?.enabled !== "boolean") { res.status(400).json({ error: "Send {\"enabled\": true | false}" }); return; }
    const season = Number(req.params.season), code = String(req.params.code).toUpperCase();
    try {
      const { was } = await setCommonsEvent(season, code, req.body.enabled, actor(req));
      await recordAudit(actor(req), req.body.enabled ? "commons.event.open" : "commons.event.close", { season, code }, null, { from: was, to: req.body.enabled });
      return { events: await listCommonsEvents() };
    } catch (e) {
      if (e instanceof CommonsError) { res.status(e.status).json({ error: e.message }); return; }
      throw e;
    }
  }));
}
