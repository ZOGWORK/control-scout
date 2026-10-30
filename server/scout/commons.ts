// The scouting commons (docs/scouting-commons.md): pit entries a workspace chooses to share with every signed-in
// Scout user at an event, credited to the workspace by name. Match entries are never shared.
//
// Three switches, all off by default, and an entry is in the commons only while all three are on:
// - the event's: the owner opens the commons one event at a time (commons_events), so moderation stays reviewable;
// - the workspace's: its admins opt in (commons_workspaces); opting out withdraws everything it shared;
// - the entry's: its author or a workspace admin shares it (commons_entries, status "published").
// The entry itself is read live from workspace_scout_entries: an edit shows at once, a deleted entry (or one edited
// into a match entry) drops out, and commons_entries' event + team key follows the entry on every write (bus.ts).
// Above all three, the owner's `scoutingCommons` feature toggle (src/shared/flags.ts): off globally, no commons route
// reads or writes anything (403 feature_disabled), whatever the event switches say; off for one workspace (an
// override), that workspace's shares are hidden and it can't share or opt in. Workspace scouting switched off for a
// workspace hides its shares too. The owner console's routes are never gated, so the switches stay reachable.
//
// Reading (any signed-in account): GET /api/scout/commons?season=&team=[&event=]. The reader's own workspaces'
// entries are left out (they read those as their own scouting, which always comes first). Photos are the
// workspace's photos (entry_photos: same caps, same expiry), viewed through GET /api/scout/commons/photos/:id.
// Nothing here names a person: the credit is the workspace.
//
// Moderation (migration 59): any reader reports a shared entry (one open report per reader per entry, a few a day)
// and mutes a source workspace for themself; the owner takes an entry down (status "removed": hidden, and its
// workspace can't share it again until the owner restores it) or suspends a whole workspace from the commons.
// Every owner action is in the audit log.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { all, get, run, writeBatch } from "../db.js";
import { controlPointInfo, isWorkspaceId, linkedAccountId } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { featureDisabled, isEnabledFor, requireFeature } from "../flags.js";
import { aggregateConsensus, type ConsensusEntry } from "../../src/shared/consensus.js";
import type { ScoutField } from "../../src/shared/scoutTemplate.js";
import {
  COMMONS_REFUSAL, isReportReason, REPORT_NOTE_MAX, REPORT_REASONS, type CommonsAnswer, type CommonsEntry, type CommonsEvent, type CommonsPhoto, type CommonsRefusal,
  type CommonsRemoved, type CommonsReportGroup, type CommonsReportReason, type CommonsSource, type CommonsStatus, type CommonsWorkspaceRow, type WorkspaceCommons,
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

/**
 * Every event the owner has switched (on or off), newest change first, with how many entries are shared there now:
 * counted as a reader would see them (a live pit entry on its shared key, its workspace opted in and not paused),
 * whether or not the event is open right now.
 */
export async function listCommonsEvents(): Promise<CommonsEventSwitch[]> {
  const rows = await all<any>(
    `SELECT ce.season, ce.event_code, ce.enabled, ce.updated_at, ce.updated_by, e.name, e.start, e.end, e.timezone
       FROM commons_events ce LEFT JOIN events e ON e.season = ce.season AND e.code = ce.event_code
      ORDER BY ce.updated_at DESC`);
  const counts = await all<any>(`SELECT c.season, c.event_code, ws.cp_workspace_id, COUNT(*) n FROM ${FROM} WHERE ${SHARED} GROUP BY c.season, c.event_code, ws.cp_workspace_id`);
  const paused = await pausedSources(counts.map((r) => String(r.cp_workspace_id)));
  const shared = new Map<string, number>();
  for (const r of counts) {
    if (paused.has(String(r.cp_workspace_id))) continue;
    const k = `${Number(r.season)}:${String(r.event_code)}`;
    shared.set(k, (shared.get(k) ?? 0) + Number(r.n));
  }
  return rows.map((r) => ({
    season: Number(r.season), code: String(r.event_code), name: String(r.name ?? r.event_code), start: r.start ?? null, end: r.end ?? null, timezone: r.timezone ?? null,
    enabled: Number(r.enabled) === 1, updatedAt: String(r.updated_at), updatedBy: String(r.updated_by), shared: shared.get(`${Number(r.season)}:${String(r.event_code)}`) ?? 0,
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
  const opt = id == null ? undefined : await get<any>("SELECT opted_in, updated_at, updated_by, suspended_at, suspended_reason FROM commons_workspaces WHERE workspace_id = ?", [id]);
  const shares = id == null ? [] : await all<any>("SELECT entry_uuid, status, published_at, event_code, team, removed_reason FROM commons_entries WHERE workspace_id = ? ORDER BY published_at DESC", [id]);
  return {
    workspaceId,
    optedIn: Number(opt?.opted_in ?? 0) === 1,
    updatedAt: opt?.updated_at ?? null, updatedBy: opt?.updated_by ?? null,
    suspended: opt?.suspended_at ? { at: String(opt.suspended_at), reason: String(opt.suspended_reason ?? "") } : null,
    shares: shares.map((r) => ({
      uuid: String(r.entry_uuid), status: r.status as CommonsStatus, publishedAt: Number(r.published_at), eventCode: String(r.event_code), team: Number(r.team),
      removedReason: r.status === "removed" ? String(r.removed_reason ?? "") : null,
    })),
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
    // A takedown stays a takedown: unsharing a removed entry leaves it removed (only the owner restores it).
    await run("UPDATE commons_entries SET status = 'withdrawn', updated_at = ? WHERE workspace_id = ? AND entry_uuid = ? AND status <> 'removed'", [Date.now(), id, uuid]);
    return { ok: true, commons: await workspaceCommons(m.workspaceId) };
  }
  const opt = await get<{ opted_in: number; suspended_at: string | null }>("SELECT opted_in, suspended_at FROM commons_workspaces WHERE workspace_id = ?", [id]);
  if (Number(opt?.opted_in ?? 0) !== 1) return refuse(409, "not_opted_in");
  if (opt?.suspended_at) return refuse(403, "suspended");
  if ((await get<{ status: string }>("SELECT status FROM commons_entries WHERE workspace_id = ? AND entry_uuid = ?", [id, uuid]))?.status === "removed") return refuse(403, "removed");
  if (e.kind !== "pit") return refuse(409, "not_pit");
  const code = String(e.event_code ?? "").toUpperCase();
  if (!code) return refuse(409, "no_event");
  if (!(await eventOpen(Number(e.season), code))) return refuse(409, "event_off");
  const now = Date.now();
  // The opt-in and the event switch are checked again in the write itself, so an opt-out (or the event closing) that
  // lands between the checks above and this write can't leave a share behind: one statement, one answer.
  const wrote = await run(
    `INSERT INTO commons_entries (workspace_id, entry_uuid, season, event_code, team, status, published_at, published_by_account_id, updated_at)
     SELECT ?, ?, ?, ?, ?, 'published', ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM commons_workspaces WHERE workspace_id = ? AND opted_in = 1 AND suspended_at IS NULL)
        AND EXISTS (SELECT 1 FROM commons_events WHERE season = ? AND event_code = ? AND enabled = 1)
     ON CONFLICT(workspace_id, entry_uuid) DO UPDATE SET season = excluded.season, event_code = excluded.event_code, team = excluded.team,
       status = 'published', published_at = excluded.published_at, published_by_account_id = excluded.published_by_account_id, updated_at = excluded.updated_at
       WHERE commons_entries.status <> 'removed'`,
    [id, uuid, Number(e.season), code, Number(e.team), now, m.accountId, now, id, Number(e.season), code]);
  if (!wrote) return whyNotWritten(id!, uuid, Number(e.season), code);
  return { ok: true, commons: await workspaceCommons(m.workspaceId) };
}

/** Which check refused a publish write that wrote nothing (something changed between the checks and the write). */
async function whyNotWritten(id: number, uuid: string, season: number, code: string): Promise<PublishResult> {
  if ((await get<{ status: string }>("SELECT status FROM commons_entries WHERE workspace_id = ? AND entry_uuid = ?", [id, uuid]))?.status === "removed") return refuse(403, "removed");
  const opt = await get<{ opted_in: number; suspended_at: string | null }>("SELECT opted_in, suspended_at FROM commons_workspaces WHERE workspace_id = ?", [id]);
  if (opt?.suspended_at) return refuse(403, "suspended");
  return refuse(409, Number(opt?.opted_in ?? 0) !== 1 ? "not_opted_in" : "event_off");
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
 * shared (not withdrawn, not taken down), the entry live, a pit entry still on the key it was shared under, the event
 * open, and the workspace opted in and not suspended by the owner.
 */
const SHARED = `c.status = 'published' AND w.deleted = 0 AND w.kind = 'pit'
  AND w.season = c.season AND UPPER(w.event_code) = c.event_code AND w.team = c.team AND cw.opted_in = 1 AND cw.suspended_at IS NULL`;
const VISIBLE = `${SHARED} AND ce.enabled = 1`;
const FROM = `commons_entries c
  JOIN workspace_scout_entries w ON w.workspace_id = c.workspace_id AND w.uuid = c.entry_uuid
  JOIN commons_events ce ON ce.season = c.season AND ce.event_code = c.event_code
  JOIN commons_workspaces cw ON cw.workspace_id = c.workspace_id
  JOIN workspaces ws ON ws.id = c.workspace_id`;

/**
 * The workspaces (Control Point ids) a signed-in user belongs to: their entries aren't commons to them. Asked through
 * the same refreshing path as /api/auth/me (controlPointInfo: Control Point's answer reused for a minute), so joining or
 * leaving a workspace changes the split within a minute; the cached memberships stand in when Control Point can't answer.
 */
async function ownWorkspaces(user: User): Promise<Set<string>> {
  const accountId = await linkedAccountId(user.id).catch(() => null);
  if (accountId == null) return new Set();
  const info = await controlPointInfo(accountId).catch(() => null);
  if (info) return new Set(info.workspaces.map((w) => String(w.id)));
  return new Set((await all<{ cp_workspace_id: string }>("SELECT cp_workspace_id FROM workspace_members WHERE account_id = ?", [accountId])).map((r) => String(r.cp_workspace_id)));
}

/** Source workspaces the owner switched off (workspace scouting, or the commons, for that workspace): their shares are hidden. */
async function pausedSources(cpIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const id of new Set(cpIds)) if (!(await sourceOn(id))) out.add(id);
  return out;
}
const sourceOn = async (cpId: string) => (await isEnabledFor("workspaceScouting", cpId)) && (await isEnabledFor("scoutingCommons", null)) && (await isEnabledFor("scoutingCommons", cpId));

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
  const muted = await mutedSources(user.id);
  const kept = rows.filter((r) => !paused.has(String(r.cp_workspace_id)) && !muted.some((m) => m.id === Number(r.workspace_id)));
  const mine = kept.filter((r) => own.has(String(r.cp_workspace_id)));
  const theirs = kept.filter((r) => !own.has(String(r.cp_workspace_id)));
  const photos = await commonsPhotos(season, team, event);
  const readers = new Map<string, ReturnType<typeof fieldReader>>();
  const layerFields = fieldGrouper();
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
    // One "scout" per source workspace (aggregateConsensus counts distinct authors); fields grouped by what they ask.
    const grouped = layerFields(fields, data);
    layer.push({ team, kind: "pit", authorAccountId: Number(r.workspace_id), updatedAt: Number(r.updated_at), data: grouped.data, fields: grouped.fields });
  }
  return { season, team, events: await commonsEvents(season, event), entries, layer: aggregateConsensus(team, layer), ownHidden: mine.length, muted };
}

// ---------------------------------------------------------------------------
// Readers: report an entry, mute a source workspace
// ---------------------------------------------------------------------------

/** The source workspaces this reader muted, by name. */
export async function mutedSources(userId: number): Promise<CommonsSource[]> {
  const rows = await all<any>("SELECT m.workspace_id, ws.name FROM commons_mutes m JOIN workspaces ws ON ws.id = m.workspace_id WHERE m.user_id = ? ORDER BY ws.name", [userId]);
  return rows.map((r) => ({ id: Number(r.workspace_id), name: String(r.name || "A workspace") }));
}

/** Mute or unmute a source workspace for this reader (a workspace that never shared can't be muted: 404). */
export async function setMute(userId: number, sourceId: number, muted: boolean): Promise<CommonsSource[] | null> {
  if (!(await get("SELECT 1 FROM commons_workspaces WHERE workspace_id = ?", [sourceId]))) return null;
  if (muted) await run("INSERT OR IGNORE INTO commons_mutes (user_id, workspace_id, created_at) VALUES (?, ?, ?)", [userId, sourceId, new Date().toISOString()]);
  else await run("DELETE FROM commons_mutes WHERE user_id = ? AND workspace_id = ?", [userId, sourceId]);
  return mutedSources(userId);
}

/** Open reports one reader may file in a day: plenty for real problems, too few to flood the queue. */
export const REPORTS_PER_DAY = 20;

/** "12:abc…" -> its parts (a commons entry id). */
export function parseEntryId(raw: unknown): { sourceId: number; uuid: string } | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,12}):([A-Za-z0-9_-]{1,80})$/.exec(raw);
  return m ? { sourceId: Number(m[1]), uuid: m[2] } : null;
}

export type ReportResult = { ok: true; already: boolean } | { ok: false; status: 400 | 404 | 429; error: string };

/** A reader's report of an entry they can see in the commons now. Reporting it again while open changes nothing. */
export async function reportEntry(user: User, entryId: unknown, reason: unknown, note: unknown): Promise<ReportResult> {
  const id = parseEntryId(entryId);
  if (!id) return { ok: false, status: 400, error: "entryId required" };
  if (!isReportReason(reason)) return { ok: false, status: 400, error: `reason must be one of ${REPORT_REASONS.join(", ")}` };
  const text = typeof note === "string" ? note.trim().slice(0, REPORT_NOTE_MAX) : "";
  const e = await get<any>(`SELECT c.season, c.event_code, c.team FROM ${FROM} WHERE c.workspace_id = ? AND c.entry_uuid = ? AND ${VISIBLE}`, [id.sourceId, id.uuid]);
  if (!e) return { ok: false, status: 404, error: "That entry isn't in the scouting commons any more." };
  const since = new Date(Date.now() - 864e5).toISOString();
  const recent = await get<{ n: number }>("SELECT COUNT(*) n FROM commons_reports WHERE reporter_user_id = ? AND created_at > ?", [user.id, since]);
  if (Number(recent?.n ?? 0) >= REPORTS_PER_DAY) return { ok: false, status: 429, error: "That's a lot of reports for one day. Thanks: they're being looked at. Try again tomorrow." };
  const wrote = await run(
    `INSERT INTO commons_reports (workspace_id, entry_uuid, season, event_code, team, reporter_user_id, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (workspace_id, entry_uuid, reporter_user_id) WHERE resolved_at IS NULL DO NOTHING`,
    [id.sourceId, id.uuid, Number(e.season), String(e.event_code), Number(e.team), user.id, reason, text, new Date().toISOString()]);
  return { ok: true, already: !wrote };
}

// ---------------------------------------------------------------------------
// The owner: the report queue, takedowns, suspending a workspace
// ---------------------------------------------------------------------------

/** The open reports, one group per entry, the most reported (then the oldest) first. */
export async function reportQueue(limit = 100): Promise<CommonsReportGroup[]> {
  const rows = await all<any>(
    `SELECT r.id, r.workspace_id, r.entry_uuid, r.season, r.event_code, r.team, r.reason, r.note, r.created_at, ws.name ws_name,
            w.notes, w.updated_at, w.deleted, c.status
       FROM commons_reports r JOIN workspaces ws ON ws.id = r.workspace_id
       LEFT JOIN workspace_scout_entries w ON w.workspace_id = r.workspace_id AND w.uuid = r.entry_uuid
       LEFT JOIN commons_entries c ON c.workspace_id = r.workspace_id AND c.entry_uuid = r.entry_uuid
      WHERE r.resolved_at IS NULL ORDER BY r.created_at`);
  const groups = new Map<string, CommonsReportGroup>();
  for (const r of rows) {
    const key = `${Number(r.workspace_id)}:${String(r.entry_uuid)}`;
    let g = groups.get(key);
    if (!g) {
      const live = r.updated_at != null && !Number(r.deleted);
      g = {
        entryId: key, source: { id: Number(r.workspace_id), name: String(r.ws_name || "A workspace") },
        season: Number(r.season), eventCode: String(r.event_code), team: Number(r.team),
        notes: live ? String(r.notes ?? "") : null, scoutedAt: live ? Number(r.updated_at) : null, status: (r.status ?? null) as CommonsStatus | null, reports: [],
      };
      groups.set(key, g);
    }
    g.reports.push({ id: Number(r.id), reason: r.reason as CommonsReportReason, note: String(r.note ?? ""), createdAt: String(r.created_at) });
  }
  return [...groups.values()].sort((a, b) => b.reports.length - a.reports.length || a.reports[0].createdAt.localeCompare(b.reports[0].createdAt)).slice(0, limit);
}

/**
 * Take an entry down (removed: true) or restore it (false: shared again, as it was). A takedown resolves the entry's
 * open reports as "removed". Returns what it was before, or null for an entry that was never shared.
 */
export async function setTakedown(entryId: unknown, removed: boolean, reason: string, by: string): Promise<{ was: CommonsStatus } | null> {
  const id = parseEntryId(entryId);
  if (!id) return null;
  const cur = await get<{ status: string }>("SELECT status FROM commons_entries WHERE workspace_id = ? AND entry_uuid = ?", [id.sourceId, id.uuid]);
  if (!cur) return null;
  const now = new Date().toISOString();
  if (removed) {
    await writeBatch([
      { sql: "UPDATE commons_entries SET status = 'removed', removed_at = ?, removed_by = ?, removed_reason = ?, updated_at = ? WHERE workspace_id = ? AND entry_uuid = ?", args: [now, by, reason.slice(0, 300), Date.now(), id.sourceId, id.uuid] },
      { sql: "UPDATE commons_reports SET resolved_at = ?, resolved_by = ?, resolution = 'removed' WHERE workspace_id = ? AND entry_uuid = ? AND resolved_at IS NULL", args: [now, by, id.sourceId, id.uuid] },
    ]);
  } else if (cur.status === "removed") {
    await run("UPDATE commons_entries SET status = 'published', removed_at = NULL, removed_by = NULL, removed_reason = NULL, updated_at = ? WHERE workspace_id = ? AND entry_uuid = ?", [Date.now(), id.sourceId, id.uuid]);
  }
  return { was: cur.status as CommonsStatus };
}

/** Entries the owner took down, newest first, to restore from the console. */
export async function removedEntries(limit = 100): Promise<CommonsRemoved[]> {
  const rows = await all<any>(
    `SELECT c.workspace_id, c.entry_uuid, c.season, c.event_code, c.team, c.removed_at, c.removed_by, c.removed_reason, ws.name ws_name
       FROM commons_entries c JOIN workspaces ws ON ws.id = c.workspace_id WHERE c.status = 'removed' ORDER BY c.removed_at DESC LIMIT ?`, [limit]);
  return rows.map((r) => ({
    entryId: `${Number(r.workspace_id)}:${String(r.entry_uuid)}`, source: { id: Number(r.workspace_id), name: String(r.ws_name || "A workspace") },
    season: Number(r.season), eventCode: String(r.event_code), team: Number(r.team),
    removedAt: String(r.removed_at ?? ""), removedBy: String(r.removed_by ?? ""), reason: String(r.removed_reason ?? ""),
  }));
}

/** The console's moderation answer: the open queue and what's taken down. */
const moderation = async () => ({ reports: await reportQueue(), removed: await removedEntries() });

/** Dismiss an entry's open reports (nothing wrong with it). How many were dismissed. */
export async function dismissReports(entryId: unknown, by: string): Promise<number | null> {
  const id = parseEntryId(entryId);
  if (!id) return null;
  return run("UPDATE commons_reports SET resolved_at = ?, resolved_by = ?, resolution = 'dismissed' WHERE workspace_id = ? AND entry_uuid = ? AND resolved_at IS NULL",
    [new Date().toISOString(), by, id.sourceId, id.uuid]);
}

/** Every workspace that has joined (or left) the commons, with what it shares now and what was taken down. */
export async function commonsWorkspaces(): Promise<CommonsWorkspaceRow[]> {
  const rows = await all<any>(
    `SELECT cw.workspace_id, ws.name, cw.opted_in, cw.suspended_at, cw.suspended_by, cw.suspended_reason,
            (SELECT COUNT(*) FROM commons_entries c WHERE c.workspace_id = cw.workspace_id AND c.status = 'published') shared,
            (SELECT COUNT(*) FROM commons_entries c WHERE c.workspace_id = cw.workspace_id AND c.status = 'removed') removed
       FROM commons_workspaces cw JOIN workspaces ws ON ws.id = cw.workspace_id
      ORDER BY (cw.suspended_at IS NULL), removed DESC, ws.name`);
  return rows.map((r) => ({
    source: { id: Number(r.workspace_id), name: String(r.name || "A workspace") }, optedIn: Number(r.opted_in) === 1, shared: Number(r.shared), removed: Number(r.removed),
    suspended: r.suspended_at ? { at: String(r.suspended_at), by: String(r.suspended_by ?? ""), reason: String(r.suspended_reason ?? "") } : null,
  }));
}

/** Suspend a workspace from the commons, or lift it. Null: the workspace never joined. */
export async function setSuspended(sourceId: number, suspended: boolean, reason: string, by: string): Promise<{ was: boolean } | null> {
  const cur = await get<{ suspended_at: string | null }>("SELECT suspended_at FROM commons_workspaces WHERE workspace_id = ?", [sourceId]);
  if (!cur) return null;
  if (suspended) await run("UPDATE commons_workspaces SET suspended_at = ?, suspended_by = ?, suspended_reason = ? WHERE workspace_id = ?", [new Date().toISOString(), by, reason.slice(0, 300), sourceId]);
  else await run("UPDATE commons_workspaces SET suspended_at = NULL, suspended_by = NULL, suspended_reason = NULL WHERE workspace_id = ?", [sourceId]);
  return { was: !!cur.suspended_at };
}

/**
 * Workspaces' templates are their own: the same field id can mean different things (an admin can relabel `weight` as
 * kilograms, or widen a rating's scale). aggregateConsensus groups by id, so for the layer each field is re-keyed by
 * its whole definition (type, label, scale, options): only fields that ask the same question are averaged together.
 * The first definition seen for an id keeps it; another gets `id~2`, `id~3`... (shown under its own label).
 */
export function fieldGrouper() {
  const ids = new Map<string, string>(); // definition -> layer id
  const taken = new Map<string, number>(); // id -> definitions seen
  const keyOf = (f: ScoutField) => JSON.stringify([f.id, f.type, f.label.trim().toLowerCase(), f.max ?? null, f.options ?? null]);
  return (fields: ScoutField[], data: Record<string, unknown>) => {
    const out: ScoutField[] = [];
    const d: Record<string, unknown> = {};
    for (const f of fields) {
      const k = keyOf(f);
      let id = ids.get(k);
      if (!id) {
        const n = (taken.get(f.id) ?? 0) + 1;
        taken.set(f.id, n);
        id = n === 1 ? f.id : `${f.id}~${n}`;
        ids.set(k, id);
      }
      out.push({ ...f, id });
      if (f.id in data) d[id] = data[f.id];
    }
    return { fields: out, data: d };
  };
}

async function commonsEvents(season: number, event: string | null): Promise<CommonsEvent[]> {
  const rows = await all<any>(
    `SELECT ce.event_code, e.name, e.start, e.end, e.timezone FROM commons_events ce LEFT JOIN events e ON e.season = ce.season AND e.code = ce.event_code
      WHERE ce.season = ? AND ce.enabled = 1 ${event ? "AND ce.event_code = ?" : ""} ORDER BY e.start, ce.event_code`,
    event ? [season, event] : [season]);
  return rows.map((r) => ({ code: String(r.event_code), name: String(r.name ?? r.event_code), start: r.start ?? null, end: r.end ?? null, timezone: r.timezone ?? null }));
}

/**
 * The ready and expired photos of the commons entries on this team (the same key and checks as the entries, so the
 * query stays the same size however large the pool grows), oldest first, by `${workspace_id}:${uuid}`. The caller
 * only reads those of the entries it kept.
 */
async function commonsPhotos(season: number, team: number, event: string | null): Promise<Map<string, CommonsPhoto[]>> {
  const out = new Map<string, CommonsPhoto[]>();
  if (!(await photosAvailable())) return out;
  const found = await all<any>(
    `SELECT p.id, p.workspace_id, p.entry_uuid, p.created_at, p.status FROM ${FROM}
       JOIN entry_photos p ON p.workspace_id = c.workspace_id AND p.entry_uuid = c.entry_uuid
      WHERE c.season = ? AND c.team = ? ${event ? "AND c.event_code = ?" : ""} AND ${VISIBLE} AND p.status IN ('ready', 'expired')
      ORDER BY p.created_at, p.id`,
    event ? [season, team, event] : [season, team]);
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
  if (!r || !(await sourceOn(String(r.cp_workspace_id)))) return null;
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
/**
 * The commons switched off by the owner everywhere, or for this workspace: 403 feature_disabled, nothing read or
 * written. The global switch is checked first, so a workspace's own "on" override can't open it while it's off everywhere.
 */
async function commonsPaused(res: Response, workspaceId: string): Promise<boolean> {
  if ((await isEnabledFor("scoutingCommons", null)) && (await isEnabledFor("scoutingCommons", workspaceId))) return false;
  featureDisabled(res, "scoutingCommons");
  return true;
}

export function commonsRouter(): Router {
  const r = express.Router();
  // The readers' routes follow the global switch (a workspace's own override is checked on its shares, as it's read).
  r.use("/commons", requireFeature("scoutingCommons"));
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
  r.post("/commons/reports", jsonOnly, h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const out = await reportEntry(user, req.body?.entryId, req.body?.reason, req.body?.note);
    if (!out.ok) { res.status(out.status).json({ error: out.error }); return; }
    return { reported: true, already: out.already };
  }));
  r.put("/commons/mutes/:sourceId", jsonOnly, h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const sourceId = Number(req.params.sourceId);
    if (!Number.isSafeInteger(sourceId) || sourceId < 1 || typeof req.body?.muted !== "boolean") { res.status(400).json({ error: "Send {\"muted\": true | false} for a workspace" }); return; }
    const muted = await setMute(user.id, sourceId, req.body.muted);
    if (!muted) { res.status(404).json({ error: "No such workspace in the scouting commons." }); return; }
    return { muted };
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
    if (await workspacePaused(res, workspaceId) || await commonsPaused(res, workspaceId)) return;
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
    return workspaceCommons(workspaceId);
  }));
  r.put("/workspaces/:workspaceId/commons", jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    if (await commonsPaused(res, req.params.workspaceId)) return;
    if (typeof req.body?.optedIn !== "boolean") { res.status(400).json({ error: "Send {\"optedIn\": true | false}" }); return; }
    return setWorkspaceOptIn(res.locals.user as User, res.locals.membership as Membership, req.body.optedIn);
  }));
  r.put("/workspaces/:workspaceId/commons/entries/:uuid", jsonOnly, h(async (req, res) => {
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (typeof req.body?.publish !== "boolean") { res.status(400).json({ error: "Send {\"publish\": true | false}" }); return; }
    if (await workspacePaused(res, workspaceId) || await commonsPaused(res, workspaceId)) return;
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
 *   GET /commons/reports                        the open report queue, grouped by entry, and the entries taken down.
 *   PUT /commons/entries/:entryId {removed, reason?}   take an entry down (resolving its reports) or restore it; audited.
 *   POST /commons/entries/:entryId/dismiss      dismiss an entry's open reports; audited.
 *   GET /commons/workspaces                     workspaces in the commons.
 *   PUT /commons/workspaces/:sourceId {suspended, reason?}  suspend a workspace from the commons, or lift it; audited.
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
  r.get("/commons/reports", wrap(moderation));
  r.put("/commons/entries/:entryId", wrap(async (req, res) => {
    if (typeof req.body?.removed !== "boolean") { res.status(400).json({ error: "Send {\"removed\": true | false, \"reason\": \"…\"}" }); return; }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    const out = await setTakedown(req.params.entryId, req.body.removed, reason, actor(req));
    if (!out) { res.status(404).json({ error: "That entry was never in the scouting commons." }); return; }
    await recordAudit(actor(req), req.body.removed ? "commons.entry.remove" : "commons.entry.restore", { entryId: req.params.entryId, ...(reason ? { reason } : {}) }, null,
      { from: out.was, to: req.body.removed ? "removed" : out.was === "removed" ? "published" : out.was });
    return moderation();
  }));
  r.post("/commons/entries/:entryId/dismiss", wrap(async (req, res) => {
    const n = await dismissReports(req.params.entryId, actor(req));
    if (n == null) { res.status(400).json({ error: "Not a commons entry" }); return; }
    await recordAudit(actor(req), "commons.reports.dismiss", { entryId: req.params.entryId, reports: n });
    return moderation();
  }));
  r.get("/commons/workspaces", wrap(async () => ({ workspaces: await commonsWorkspaces() })));
  r.put("/commons/workspaces/:sourceId", wrap(async (req, res) => {
    const sourceId = Number(req.params.sourceId);
    if (!Number.isSafeInteger(sourceId) || typeof req.body?.suspended !== "boolean") { res.status(400).json({ error: "Send {\"suspended\": true | false, \"reason\": \"…\"}" }); return; }
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    const out = await setSuspended(sourceId, req.body.suspended, reason, actor(req));
    if (!out) { res.status(404).json({ error: "That workspace never joined the scouting commons." }); return; }
    await recordAudit(actor(req), req.body.suspended ? "commons.workspace.suspend" : "commons.workspace.unsuspend", { sourceId, ...(reason ? { reason } : {}) }, null, { from: out.was, to: req.body.suspended });
    return { workspaces: await commonsWorkspaces() };
  }));
}
