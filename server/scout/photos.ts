// Entry photos (docs/r2-photos.md): pit and match photos on workspace scout
// entries, stored in Cloudflare R2, recorded in entry_photos.
//
// Upload, three steps, so the image never passes through this server:
//  1. POST /api/scout/photos/presign: membership checked, the entry must be on
//     the server, then one statement reserves the photo's declared bytes: it
//     inserts a pending row only while the entry has fewer than 6 photos, the
//     member has few uploads in flight, and storage stays under the soft cap.
//     One statement, so two uploads at once can't both take the last space.
//     Answers a short-lived presigned PUT URL.
//  2. The browser PUTs the (compressed, EXIF-free) JPEG straight to R2.
//  3. POST /api/scout/photos/:id/complete: HEAD the object; it must be there
//     and no larger than declared (else it's deleted). The row becomes ready
//     with the stored size (the meter), and the entry streams to the workspace.
//
// Viewing: GET /api/scout/photos/:id redirects members to a 15-minute
// presigned GET. Removing (DELETE) deletes the R2 object first, then the row.
// Who may remove: whoever added the photo, the entry's author, or a workspace
// admin (the same shape as Task 3's delete rule); anyone in the workspace may add.
//
// Every photo change gives the entry a new seq and photos_rev, in the
// workspace's write order (bus.ts), so it reaches the other members' live
// streams and pulls like any edit; the entry's text and updatedAt are untouched.
//
// Expiry and the meter (the nightly job, runPhotoMaintenance): a photo is
// deleted 2 days after its event ended (the event's end date from the synced
// events table), or 14 days after upload when that's unknown. Its row stays,
// marked expired, so the entry shows "photo expired". Storage guardrails:
// notice at 7 GB, warning plus an owner alert at 9 GB, new uploads refused at
// the soft cap (R2_SOFT_CAP_GB, 9.5), all under R2's 10 GB free tier.
//
// Off (404 for every photo route, UI hidden) when R2 isn't configured or the
// owner switched the `photos` flag off. Workspace scouting paused: 503.
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import type { InStatement } from "@libsql/client";
import { all, db, get, kvGet, kvSet, run, writeBatch } from "../db.js";
import { env } from "../env.js";
import { isWorkspaceId, type Membership } from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { isEnabled } from "../flags.js";
import { publishEntries, serialized, type LiveEntry } from "./bus.js";
import { lastSeq, readLiveEntries, workspaceAccess, workspacePaused, writerName, type WorkspaceEntryOut } from "./entries.js";
import { deleteObject, headObject, listObjects, r2, uploadUrl, viewUrl, type R2Config } from "./r2.js";
import { openAlert, raiseAlert, resolveAlert } from "../portal/alerts.js";
import { PHOTO_LIMITS, STORAGE_FULL, type OwnerStorage, type StorageLevel } from "../../src/shared/photos.js";

const GB = 1e9;
const DAY = 864e5;

/** Storage thresholds in bytes (10^9 per GB: the cautious reading of the free tier). */
export const storageThresholds = () => ({ limit: 10 * GB, notice: 7 * GB, warning: 9 * GB, softCap: env.r2SoftCapGb * GB });

export const levelFor = (bytes: number): StorageLevel => {
  const t = storageThresholds();
  return bytes >= t.softCap ? "full" : bytes >= t.warning ? "warning" : bytes >= t.notice ? "notice" : "ok";
};

export const PHOTO_TIMING = {
  /** How long an upload URL works. */
  uploadTtlSec: 300,
  /** How long a view URL works; the redirect to it is cached a bit less. */
  viewTtlSec: 900,
  /** A reservation never completed is released (and its object, if any, deleted) after this. */
  staleReservationMs: 30 * 60_000,
  /** An object in the bucket with no record is deleted once it's this old. */
  orphanGraceMs: 6 * 3600_000,
  /** Uploads one member may have in flight at once. */
  pendingPerAccount: 12,
};

/** When a photo's image is deleted: 2 days after the event's last day (from the end of it), else 14 days after upload. */
export function expiresAt(eventEnd: string | null, createdAt: number): number {
  const end = eventEnd && /^\d{4}-\d{2}-\d{2}$/.test(eventEnd) ? Date.parse(`${eventEnd}T00:00:00Z`) : NaN;
  return Number.isFinite(end) ? end + 3 * DAY : createdAt + 14 * DAY;
}

/** Photos on: R2 configured and the owner's switch on. */
export async function photosAvailable(): Promise<boolean> {
  return !!r2() && (await isEnabled("photos"));
}

const safeEvent = (code: string) => code.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "no-event";
export const objectKey = (season: number, eventCode: string, entryUuid: string, photoId: string) =>
  `photos/${season}/${safeEvent(eventCode)}/${entryUuid}/${photoId}.jpg`;

async function eventEndFor(season: number, eventCode: string): Promise<string | null> {
  if (!eventCode) return null;
  const r = await get<{ end: string | null; start: string | null }>("SELECT end, start FROM events WHERE season = ? AND code = ?", [season, eventCode.toUpperCase()]);
  return r?.end ?? r?.start ?? null;
}

/** Stored and reserved photo bytes. */
export async function usedBytes(): Promise<{ bytes: number; photos: number }> {
  const r = await get<{ b: number | null; n: number }>("SELECT COALESCE(SUM(bytes), 0) b, COUNT(*) n FROM entry_photos WHERE status IN ('pending', 'ready', 'cancelled')");
  return { bytes: Number(r?.b ?? 0), photos: Number(r?.n ?? 0) };
}

export const STORAGE_ALERT = "photo-storage";

/** At 9 GB: the owner alert (once, kept open while usage stays there); below it again: resolved. */
export async function checkStorageAlerts(used?: number): Promise<void> {
  const bytes = used ?? (await usedBytes()).bytes;
  const t = storageThresholds();
  if (bytes >= t.warning) {
    const gb = (x: number) => (x / GB).toFixed(1);
    await raiseAlert(STORAGE_ALERT, "warning", "Photo storage approaching the 10 GB free tier limit",
      `Photo storage approaching the 10 GB free tier limit — purge an event or uploads will pause. ${gb(bytes)} GB of 10 GB used; new uploads stop at ${gb(t.softCap)} GB.`,
      { usedBytes: bytes, softCapBytes: t.softCap });
  } else await resolveAlert(STORAGE_ALERT);
}

// --- Recording changes ----------------------------------------------------------------------

const BUMP = `UPDATE workspace_scout_entries SET photos_rev = photos_rev + 1,
    seq = (SELECT COALESCE(MAX(s.seq), 0) + 1 FROM workspace_scout_entries s WHERE s.workspace_id = ?)
  WHERE workspace_id = ? AND uuid = ?`;

/**
 * Write a photo change and give each entry touched a new seq, in the workspace's write order, then
 * publish the entries (with their photo lists) to its live streams. Returns what's stored now.
 */
async function commitPhotoChange(workspaceId: string, workspaceDbId: number, uuids: string[], stmts: InStatement[]): Promise<Map<string, LiveEntry>> {
  const unique = [...new Set(uuids)];
  return serialized(workspaceId, async () => {
    const before = await lastSeq(workspaceId);
    await writeBatch([...stmts, ...unique.map((u) => ({ sql: BUMP, args: [workspaceDbId, workspaceDbId, u] }))]);
    const rows = await readLiveEntries(workspaceId, unique);
    publishEntries(workspaceId, [...rows.values()].filter((e) => e.seq > before).sort((a, b) => a.seq - b.seq));
    return rows;
  });
}

const withoutSeq = (e: LiveEntry | undefined): WorkspaceEntryOut | null => {
  if (!e) return null;
  const { seq: _s, ...rest } = e;
  return rest;
};

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

// --- Upload ---------------------------------------------------------------------------------

export const NOT_SYNCED = "Sync this entry first, then add photos.";
export const TOO_MANY = `An entry can have up to ${PHOTO_LIMITS.perEntry} photos. Remove one to add another.`;

/** Step 1: reserve a photo on the entry and hand out the upload URL. */
export async function reservePhoto(user: User, m: Membership, entryUuid: unknown, declared: unknown, now = Date.now()):
  Promise<{ ok: true; photoId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: number } | Fail> {
  const c = r2();
  if (!c) return fail(404, "Not found");
  if (typeof entryUuid !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(entryUuid)) return fail(400, "entryUuid required");
  const bytes = Number(declared);
  if (!Number.isInteger(bytes) || bytes < 1) return fail(400, "bytes must be the photo's size");
  if (bytes > PHOTO_LIMITS.maxBytes) return fail(413, "This photo is too large even after compressing it. Try another.");
  const entry = await get<any>(
    "SELECT e.workspace_id, e.season, e.event_code, e.deleted FROM workspace_scout_entries e JOIN workspaces w ON w.id = e.workspace_id WHERE w.cp_workspace_id = ? AND e.uuid = ?",
    [m.workspaceId, entryUuid]);
  if (!entry) return fail(404, NOT_SYNCED);
  if (Number(entry.deleted)) return fail(404, "This entry was deleted.");
  const wsId = Number(entry.workspace_id), season = Number(entry.season), eventCode = String(entry.event_code ?? "").toUpperCase();
  const eventEnd = await eventEndFor(season, eventCode);
  const id = randomUUID();
  const key = objectKey(season, eventCode, entryUuid, id);
  const cap = storageThresholds().softCap;
  // The reservation: one statement, so the count and the cap hold even with uploads racing.
  const [res] = await db().batch([{
    sql: `INSERT INTO entry_photos (id, workspace_id, entry_uuid, season, event_code, object_key, bytes, status, added_by_account_id, added_by_name, created_at, event_end, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM entry_photos WHERE workspace_id = ? AND entry_uuid = ? AND status IN ('pending', 'ready')) < ?
        AND (SELECT COUNT(*) FROM entry_photos WHERE added_by_account_id = ? AND status IN ('pending', 'cancelled')) < ?
        AND (SELECT COALESCE(SUM(bytes), 0) FROM entry_photos WHERE status IN ('pending', 'ready', 'cancelled')) + ? <= ?
        AND EXISTS (SELECT 1 FROM workspace_scout_entries WHERE workspace_id = ? AND uuid = ? AND deleted = 0)`,
    args: [id, wsId, entryUuid, season, eventCode, key, bytes, m.accountId, writerName(user), now, eventEnd, expiresAt(eventEnd, now),
      wsId, entryUuid, PHOTO_LIMITS.perEntry, m.accountId, PHOTO_TIMING.pendingPerAccount, bytes, cap, wsId, entryUuid],
  }], "write");
  if (!res.rowsAffected) {
    // Why not: in the order the conditions are worth explaining.
    const n = await get<{ n: number }>("SELECT COUNT(*) n FROM entry_photos WHERE workspace_id = ? AND entry_uuid = ? AND status IN ('pending', 'ready')", [wsId, entryUuid]);
    if (Number(n?.n) >= PHOTO_LIMITS.perEntry) return fail(409, TOO_MANY);
    if ((await usedBytes()).bytes + bytes > cap) return fail(507, STORAGE_FULL);
    const p = await get<{ n: number }>("SELECT COUNT(*) n FROM entry_photos WHERE added_by_account_id = ? AND status IN ('pending', 'cancelled')", [m.accountId]);
    if (Number(p?.n) >= PHOTO_TIMING.pendingPerAccount) return fail(429, "Too many uploads at once. Wait for these to finish.");
    return fail(404, "This entry was deleted.");
  }
  // The browser sends Content-Length itself (it can't set it); the URL is signed for exactly `bytes`.
  return { ok: true, photoId: id, uploadUrl: uploadUrl(c, key, "image/jpeg", bytes, PHOTO_TIMING.uploadTtlSec), headers: { "Content-Type": "image/jpeg" }, expiresAt: now + PHOTO_TIMING.uploadTtlSec * 1000 };
}

/**
 * One change at a time per photo: completing an upload and anything that deletes the image (removal,
 * expiry, purge, the sweeps) each hold this from their storage call to their row change, so a
 * deletion can never land between an upload's check and its record (a "ready" photo with no image).
 * In-process, like the workspace write order (bus.ts): one server process writes photos.
 */
const photoLock = <T>(id: string, fn: () => Promise<T>) => serialized(`photo:${id}`, fn);
const statusOf = async (id: string) => (await get<{ status: string }>("SELECT status FROM entry_photos WHERE id = ?", [id]))?.status ?? null;

async function photoRow(m: Membership, photoId: unknown): Promise<any | null> {
  if (typeof photoId !== "string" || !/^[0-9a-f-]{36}$/.test(photoId)) return null;
  const r = await get<any>(
    `SELECT p.*, w.cp_workspace_id, e.author_account_id entry_author FROM entry_photos p JOIN workspaces w ON w.id = p.workspace_id
       LEFT JOIN workspace_scout_entries e ON e.workspace_id = p.workspace_id AND e.uuid = p.entry_uuid WHERE p.id = ?`, [photoId]);
  // Another workspace's photo is as unknown as a missing one.
  return r && r.cp_workspace_id === m.workspaceId ? r : null;
}

/** Step 3: the upload is in R2: check it, record it, stream the entry. */
export async function completePhoto(m: Membership, photoId: unknown): Promise<{ ok: true; entry: WorkspaceEntryOut | null } | Fail> {
  const c = r2();
  if (!c) return fail(404, "Not found");
  const p = await photoRow(m, photoId);
  if (!p) return fail(404, "No such photo.");
  if (Number(p.added_by_account_id) !== m.accountId) return fail(403, "Only the person uploading a photo can finish it.");
  const out = await photoLock(p.id, async (): Promise<{ ok: true; entry: WorkspaceEntryOut | null } | Fail> => {
    const status = await statusOf(p.id);
    if (status === "ready") return { ok: true, entry: withoutSeq((await readLiveEntries(m.workspaceId, [p.entry_uuid])).get(p.entry_uuid)) }; // a retry
    if (status === "expired") return fail(410, "This photo has expired.");
    if (status !== "pending") return fail(409, "This upload was cancelled. Try again.");
    const head = await headObject(c, p.object_key).catch(() => undefined);
    if (head === undefined) return fail(502, "Couldn't reach photo storage. Try again.");
    // Not there (yet): the reservation stays (its URL still works for a few minutes, so its bytes stay
    // counted); completing again once the upload lands works, and the stale sweep releases it otherwise.
    if (!head) return fail(409, "The photo didn't finish uploading. Try again.");
    if (head.bytes !== Number(p.bytes)) {
      // Not what was reserved against the cap (storage should have refused it already): the object goes, and the
      // reservation is cancelled, still counted until the sweep (its URL may still be live).
      await deleteObject(c, p.object_key).catch(() => undefined); // the sweep deletes it again otherwise
      await run("UPDATE entry_photos SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [p.id]);
      return fail(413, "The uploaded photo wasn't the size it said. Try again.");
    }
    const rows = await commitPhotoChange(m.workspaceId, Number(p.workspace_id), [p.entry_uuid], [
      { sql: "UPDATE entry_photos SET status = 'ready', recorded_at = ? WHERE id = ? AND status = 'pending'", args: [Date.now(), p.id] },
    ]);
    return { ok: true, entry: withoutSeq(rows.get(p.entry_uuid)) };
  });
  if (out.ok) await checkStorageAlerts().catch((e) => console.error("[photos] storage alert check failed", e));
  return out;
}

export const MAY_NOT_REMOVE = "You can remove photos you added, or any photo on your own entry. A workspace admin can remove the rest.";

/** Who may remove a photo: whoever added it, the entry's author, or an admin. */
export const mayRemovePhoto = (m: Pick<Membership, "accountId" | "role">, p: { addedByAccountId: number; entryAuthorAccountId: number | null }) =>
  m.role === "admin" || p.addedByAccountId === m.accountId || p.entryAuthorAccountId === m.accountId;

/** Remove a photo: its R2 object first, then its record; the entry streams. */
export async function removePhoto(m: Membership, photoId: unknown): Promise<{ ok: true; entry: WorkspaceEntryOut | null } | Fail> {
  const c = r2();
  if (!c) return fail(404, "Not found");
  const first = await photoRow(m, photoId);
  if (!first) return fail(404, "No such photo.");
  return photoLock(first.id, async () => {
    const p = await photoRow(m, photoId); // as it is now, under the lock
    // Only photos (ready or expired): a reservation (pending or cancelled) is released by the sweep alone,
    // never early, since its upload URL may still work.
    if (!p || (p.status !== "ready" && p.status !== "expired")) return fail(404, "No such photo.");
    if (!mayRemovePhoto(m, { addedByAccountId: Number(p.added_by_account_id), entryAuthorAccountId: p.entry_author == null ? null : Number(p.entry_author) })) return fail(403, MAY_NOT_REMOVE);
    if (p.status === "ready") {
      try { await deleteObject(c, p.object_key); } catch { return fail(502, "Couldn't reach photo storage, so the photo is still there. Try again."); }
    }
    const rows = await commitPhotoChange(m.workspaceId, Number(p.workspace_id), [p.entry_uuid], [{ sql: "DELETE FROM entry_photos WHERE id = ?", args: [p.id] }]);
    return { ok: true as const, entry: withoutSeq(rows.get(p.entry_uuid)) };
  });
}

// --- Expiry, purge and the meter ------------------------------------------------------------

interface DueRow { id: string; workspace_id: number; cp_workspace_id: string; entry_uuid: string; object_key: string; status: string }

/**
 * Delete one photo's image, then change its record, under the photo's lock, and only if its status is
 * still one of `from` (re-read under the lock: an upload may have completed, or a removal won, meanwhile).
 * "expire": a ready photo's row stays as expired ("photo expired"); "forget": the row goes. Ready ones
 * stream to the workspace. An unfinished upload (pending) is cancelled instead: its upload URL may still
 * work, so the row stays as `cancelled`, its bytes still counted against the cap and completion refused,
 * until the stale sweep (long after the URL has expired) deletes the object again and then the row.
 */
async function dropPhoto(c: R2Config, p: DueRow, how: "expire" | "forget", reason: string, from: string[]): Promise<"done" | "skipped" | "failed"> {
  return photoLock(p.id, async () => {
    const status = await statusOf(p.id);
    if (!status || !from.includes(status)) return "skipped";
    p.status = status; // what it was when dropped (the caller counts by it)
    try { await deleteObject(c, p.object_key); } catch { return "failed"; } // tried again next time
    if (status === "pending" || status === "cancelled") {
      await run(reason === "abandoned"
        ? "DELETE FROM entry_photos WHERE id = ? AND status IN ('pending', 'cancelled')"
        : "UPDATE entry_photos SET status = 'cancelled' WHERE id = ? AND status = 'pending'", [p.id]);
      return "done";
    }
    await commitPhotoChange(p.cp_workspace_id, Number(p.workspace_id), [p.entry_uuid], [how === "expire"
      ? { sql: "UPDATE entry_photos SET status = 'expired', expired_at = ?, expired_reason = ? WHERE id = ? AND status = ?", args: [Date.now(), reason, p.id, status] }
      : { sql: "DELETE FROM entry_photos WHERE id = ?", args: [p.id] }]);
    return "done";
  });
}

/** Delete the images of these photos and mark them expired (rows kept: "photo expired"); pending ones are just released. */
async function expirePhotos<R extends DueRow>(c: R2Config, rows: R[], reason: string, from = ["ready"]): Promise<{ expired: number; failures: number; done: R[] }> {
  let failures = 0;
  const done: R[] = [];
  for (const p of rows) {
    const r = await dropPhoto(c, p, "expire", reason, from);
    if (r === "failed") failures++;
    else if (r === "done") done.push(p);
  }
  return { expired: done.filter((p) => p.status === "ready").length, failures, done };
}

export interface MaintenanceResult { at: string; usedBytes: number; bucketBytes: number | null; bucketObjects: number | null; expired: number; removed: number; orphans: number; failures: number }

/**
 * Release reservations never completed, and cancelled ones, once their upload URL is long expired
 * (staleReservationMs, well past uploadTtlSec): the object (if any) is deleted, then the row. Cheap: run often.
 */
export async function sweepStaleReservations(now = Date.now()): Promise<{ removed: number; failures: number }> {
  const c = r2();
  if (!c) return { removed: 0, failures: 0 };
  const stale = await all<DueRow>(`SELECT p.id, p.workspace_id, w.cp_workspace_id, p.entry_uuid, p.object_key, p.status
    FROM entry_photos p JOIN workspaces w ON w.id = p.workspace_id WHERE p.status IN ('pending', 'cancelled') AND p.created_at < ?`, [now - PHOTO_TIMING.staleReservationMs]);
  let removed = 0, failures = 0;
  for (const p of stale) {
    // Still pending under the lock: an upload completing right now wins and keeps its photo.
    const r = await dropPhoto(c, p, "forget", "abandoned", ["pending", "cancelled"]);
    if (r === "done") removed++; else if (r === "failed") failures++;
  }
  return { removed, failures };
}

/**
 * The nightly job: refresh event end dates, expire photos whose event ended more than 2 days ago (or
 * uploaded 14+ days ago with no known end), remove photos of deleted entries and stale reservations,
 * delete untracked objects, total the bucket, and raise or clear the storage alert.
 */
export async function runPhotoMaintenance(now = Date.now()): Promise<MaintenanceResult | null> {
  const c = r2();
  if (!c) return null;
  // A photo follows its entry: an entry corrected to another event (or season) moves its photos' expiry with it.
  // (The object key keeps the event it was uploaded under: keys are never renamed.)
  await run(`UPDATE entry_photos SET
      season = (SELECT e.season FROM workspace_scout_entries e WHERE e.workspace_id = entry_photos.workspace_id AND e.uuid = entry_photos.entry_uuid),
      event_code = (SELECT UPPER(COALESCE(e.event_code, '')) FROM workspace_scout_entries e WHERE e.workspace_id = entry_photos.workspace_id AND e.uuid = entry_photos.entry_uuid)
    WHERE status IN ('pending', 'ready') AND EXISTS (SELECT 1 FROM workspace_scout_entries e WHERE e.workspace_id = entry_photos.workspace_id AND e.uuid = entry_photos.entry_uuid
      AND (e.season <> entry_photos.season OR UPPER(COALESCE(e.event_code, '')) <> entry_photos.event_code))`);
  // End dates arrive (or move) with the event sync: take the latest for every live photo. An event that
  // isn't known (any more) leaves the end unknown, so the 14-day fallback applies.
  const live = await all<any>("SELECT id, season, event_code, event_end, created_at, expires_at FROM entry_photos WHERE status IN ('pending', 'ready')");
  const ends = new Map<string, string | null>();
  const updates: InStatement[] = [];
  for (const p of live) {
    const k = `${p.season}:${p.event_code}`;
    if (!ends.has(k)) ends.set(k, await eventEndFor(Number(p.season), String(p.event_code)));
    const end = ends.get(k) ?? null;
    const exp = expiresAt(end, Number(p.created_at));
    if (end !== p.event_end || exp !== Number(p.expires_at)) updates.push({ sql: "UPDATE entry_photos SET event_end = ?, expires_at = ? WHERE id = ?", args: [end, exp, p.id] });
  }
  await writeBatch(updates);

  const join = "FROM entry_photos p JOIN workspaces w ON w.id = p.workspace_id";
  const due = await all<DueRow>(`SELECT p.id, p.workspace_id, w.cp_workspace_id, p.entry_uuid, p.object_key, p.status ${join} WHERE p.status = 'ready' AND p.expires_at <= ?`, [now]);
  const ex = await expirePhotos(c, due, "event-ended");
  let failures = ex.failures, removed = 0;

  // Photos of deleted entries: nothing shows them any more.
  const orphaned = await all<DueRow>(`SELECT p.id, p.workspace_id, w.cp_workspace_id, p.entry_uuid, p.object_key, p.status ${join}
    JOIN workspace_scout_entries e ON e.workspace_id = p.workspace_id AND e.uuid = p.entry_uuid WHERE e.deleted = 1 AND p.status IN ('pending', 'ready')`);
  for (const p of orphaned) {
    const r = await dropPhoto(c, p, "forget", "entry-deleted", ["pending", "ready"]);
    if (r === "done") removed++; else if (r === "failed") failures++;
  }
  const sweep = await sweepStaleReservations(now);
  removed += sweep.removed; failures += sweep.failures;

  // The bucket itself: objects with no record (an upload whose reservation was released) go, and so does
  // a stored photo whose object is larger than its record says (storage should never allow it; the meter
  // and the cap read the records, so nothing may hide outside them).
  let bucketBytes: number | null = null, bucketObjects: number | null = null, orphans = 0;
  try {
    const known = new Map((await all<DueRow & { bytes: number }>(
      "SELECT p.id, p.workspace_id, w.cp_workspace_id, p.entry_uuid, p.object_key, p.status, p.bytes FROM entry_photos p JOIN workspaces w ON w.id = p.workspace_id WHERE p.status IN ('pending', 'ready', 'cancelled')",
    )).map((r) => [r.object_key, r]));
    bucketBytes = 0; bucketObjects = 0;
    for (const o of await listObjects(c, "photos/")) {
      const rec = known.get(o.key);
      if (!rec && o.lastModified < now - PHOTO_TIMING.orphanGraceMs) {
        try { await deleteObject(c, o.key); orphans++; continue; } catch { failures++; }
      } else if (rec && o.bytes > Number(rec.bytes)) {
        const r = await dropPhoto(c, rec, "forget", "oversize", ["pending", "ready"]);
        if (r === "done") { orphans++; continue; }
        if (r === "failed") failures++;
      }
      bucketBytes += o.bytes; bucketObjects++;
    }
  } catch (e) {
    console.error("[photos] couldn't list the bucket", (e as Error).message);
    failures++;
  }

  const used = (await usedBytes()).bytes;
  const result: MaintenanceResult = { at: new Date(now).toISOString(), usedBytes: used, bucketBytes, bucketObjects, expired: ex.expired, removed, orphans, failures };
  await kvSet("photos:maintenance", result);
  // The records are the meter (the cap reads them too); the listing above makes sure nothing hides outside them.
  await checkStorageAlerts(used);
  return result;
}

/** The owner's manual purge of one event's photos (everywhere): deleted from R2, entries show "photo expired". */
export async function purgeEvent(season: number, eventCode: string): Promise<{ photos: number; bytes: number; failures: number }> {
  const c = r2();
  if (!c) return { photos: 0, bytes: 0, failures: 0 };
  const rows = await all<DueRow & { bytes: number }>(
    "SELECT p.id, p.workspace_id, w.cp_workspace_id, p.entry_uuid, p.object_key, p.status, p.bytes FROM entry_photos p JOIN workspaces w ON w.id = p.workspace_id WHERE p.season = ? AND p.event_code = ? AND p.status IN ('pending', 'ready')",
    [season, eventCode]);
  // Unfinished uploads too: their objects go and their reservations are cancelled, under the same lock
  // (a completion that comes after finds its reservation gone and answers 409).
  const r = await expirePhotos(c, rows, "purged", ["pending", "ready"]);
  await checkStorageAlerts();
  return { photos: r.done.length, bytes: r.done.reduce((s, p) => s + Number(p.bytes), 0), failures: r.failures };
}

/** The owner portal's storage panel. */
export async function ownerStorage(): Promise<OwnerStorage> {
  const configured = !!r2();
  const [used, enabled] = await Promise.all([usedBytes(), isEnabled("photos")]);
  const t = storageThresholds();
  const last = await kvGet<MaintenanceResult>("photos:maintenance");
  await checkStorageAlerts(used.bytes).catch(() => undefined);
  const events = await all<any>(`SELECT p.season, p.event_code, COUNT(*) n, SUM(p.bytes) b, MAX(p.event_end) event_end, MIN(p.expires_at) expires,
      (SELECT ev.name FROM events ev WHERE ev.season = p.season AND ev.code = p.event_code) name
    FROM entry_photos p WHERE p.status IN ('pending', 'ready', 'cancelled') GROUP BY p.season, p.event_code ORDER BY b DESC LIMIT 200`);
  return {
    configured, enabled, usedBytes: used.bytes, photos: used.photos,
    limitBytes: t.limit, noticeBytes: t.notice, warningBytes: t.warning, softCapBytes: t.softCap, level: levelFor(used.bytes),
    events: events.map((e) => ({ season: Number(e.season), eventCode: String(e.event_code), eventName: e.name ?? null, eventEnd: e.event_end ?? null, photos: Number(e.n), bytes: Number(e.b), expiresAt: e.expires == null ? null : Number(e.expires) })),
    lastRun: last ? { at: last.at, usedBytes: last.usedBytes, bucketBytes: last.bucketBytes, bucketObjects: last.bucketObjects, expired: last.expired, removed: last.removed, orphans: last.orphans, failures: last.failures } : null,
    alert: await openAlert(STORAGE_ALERT),
  };
}

/** The scheduler's hourly-ish tick: stale reservations every time; the full job once a day after 08:00 UTC (night in the Americas). */
export async function photoSchedulerTick(log: (m: string) => void, now = new Date()): Promise<void> {
  if (!r2()) return;
  await sweepStaleReservations(now.getTime());
  if (now.getUTCHours() < 8) return;
  const day = JSON.stringify(now.toISOString().slice(0, 10));
  // One server a day: the first to move the marker runs it.
  const claimed = await run(
    "INSERT INTO kv (key, value, updated_at) VALUES ('photos:nightly-day', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE kv.value <> excluded.value",
    [day, now.toISOString()]);
  if (!claimed) return;
  const r = await runPhotoMaintenance(now.getTime());
  if (r) log(`photos: ${r.expired} expired, ${r.removed} removed, ${r.orphans} untracked objects deleted, ${(r.usedBytes / GB).toFixed(2)} GB in use${r.failures ? `, ${r.failures} failures (retried tomorrow)` : ""}`);
}

// --- Routes ---------------------------------------------------------------------------------

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

/** Signed in, a member of the workspace in `workspaceId` (body or query), photos on and workspace scouting not paused. */
async function member(req: Request, res: Response): Promise<{ user: User; m: Membership } | null> {
  const user = await currentUser(req);
  if (!user) { res.status(401).json({ error: "Sign in to add photos." }); return null; }
  const workspaceId = req.body?.workspaceId ?? req.query.workspaceId;
  if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return null; }
  const access = await workspaceAccess(user, workspaceId);
  if (!access.ok) { res.status(access.status).json({ error: access.error }); return null; }
  return { user, m: access.membership };
}

const answer = (res: Response, out: { ok: true } | Fail, body: () => unknown) => {
  if (!out.ok) { res.status(out.status).json({ error: out.error }); return undefined; }
  return body();
};

/** /api/scout/photos */
export function photosRouter(): Router {
  const r = express.Router();
  // Off: as if the routes didn't exist. Then the workspace switch, like every shared read and write.
  r.use((req, res, next) => {
    (async () => {
      res.set("Cache-Control", "no-store");
      if (!(await photosAvailable())) { res.status(404).json({ error: "Not found" }); return; }
      if (await workspacePaused(res)) return;
      next();
    })().catch(next);
  });

  r.post("/presign", h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const out = await reservePhoto(who.user, who.m, req.body?.entryUuid, req.body?.bytes);
    return answer(res, out, () => out.ok && { photoId: out.photoId, uploadUrl: out.uploadUrl, headers: out.headers, expiresAt: out.expiresAt });
  }));

  r.post("/:id/complete", h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const out = await completePhoto(who.m, req.params.id);
    return answer(res, out, () => out.ok && { entry: out.entry });
  }));

  r.delete("/:id", h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const out = await removePhoto(who.m, req.params.id);
    return answer(res, out, () => out.ok && { entry: out.entry });
  }));

  // An <img src> target: redirects members to a short-lived signed URL.
  r.get("/:id", h(async (req, res) => {
    const who = await member(req, res);
    if (!who) return;
    const c = r2();
    const p = c && await photoRow(who.m, req.params.id);
    if (!c || !p || (p.status !== "ready" && p.status !== "expired")) { res.status(404).json({ error: "No such photo." }); return; }
    if (p.status === "expired") { res.status(410).json({ error: "photo expired" }); return; }
    res.set("Cache-Control", `private, max-age=${PHOTO_TIMING.viewTtlSec - 120}`);
    res.redirect(302, viewUrl(c, p.object_key, PHOTO_TIMING.viewTtlSec));
  }));
  return r;
}
