// Profile pictures (docs/shared-accounts.md "Profile pictures"): any account can have one, and it is the same picture
// in Control Point and here. Control Point keeps the shared account's picture; Scout keeps a copy of it
// (user_avatars), served from its own address, so a page never needs Control Point to show one.
//
//   Set or removed here: stored at once, marked pending, and sent to Control Point (PUT / DELETE
//     /internal/accounts/:id/avatar). If Control Point can't take it now, the next account read sends it again.
//   Set or removed in Control Point: every account answer carries its picture id (accountAvatar). When that id
//     differs from the one Scout last synced, Scout fetches the picture (or drops its copy), unless a change made
//     here is still pending, or was made after the answer was asked for (a stale answer never undoes a new picture).
//   An older Control Point sends no avatar field: nothing is pulled or dropped, and changes made here wait, pending.
//
// A picture's URL is /api/avatars/<user>/<version>: the version is new with every picture, so a URL always shows the
// same image and is cached for good. Pictures are public (they show next to a contributor's name on videos), but a
// URL can't be guessed: the version is random.
import { randomBytes } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { get, run } from "../db.js";
import {
  CP_AVATAR_MAX, CP_PROVIDER, accountAskedAt, accountAvatar, controlPointEnabled, deleteAccountAvatar, fetchAccountAvatar,
  linkedAccountId, logFailure, pushAccountAvatar, type SharedAccount,
} from "./controlPoint.js";

/** The largest picture this app takes in an upload (the app sends a 512 px square, far smaller). */
export const AVATAR_MAX_BYTES = 512 * 1024;

/** What an image's first bytes say it is: only the formats every browser shows. Never the type a client claims. */
export function sniffImage(b: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (b.length >= 6 && (at(0, 0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || at(0, 0x47, 0x49, 0x46, 0x38, 0x39, 0x61))) return "image/gif";
  return null;
}

export const avatarPath = (userId: number, version: string) => `/api/avatars/${userId}/${version}`;
/** A stored picture's URL, from a row's user id and version (null: none). */
export const avatarUrlOf = (userId: number, version: string | null | undefined): string | null => (version ? avatarPath(userId, version) : null);

const newVersion = () => randomBytes(9).toString("base64url");
const now = () => new Date().toISOString();

interface Row { data: ArrayBuffer | Uint8Array | null; mime: string | null; version: string | null; cp_id: string | null; pending: string | null; updated_at: string }
const readRow = (userId: number) => get<Row>("SELECT data IS NOT NULL AS data, mime, version, cp_id, pending, updated_at FROM user_avatars WHERE user_id = ?", [userId]);

/** This account's picture URL, or null. */
export async function avatarUrlFor(userId: number): Promise<string | null> {
  const r = await get<{ version: string | null }>("SELECT version FROM user_avatars WHERE user_id = ? AND data IS NOT NULL", [userId]);
  return avatarUrlOf(userId, r?.version);
}

/** Changes made here, counted per account: a pull that started before one never writes over it (a remove leaves no
 *  row for the database to guard). */
const localChanges = new Map<number, number>();
const changeCount = (userId: number) => localChanges.get(userId) ?? 0;
function noteLocalChange(userId: number) {
  localChanges.set(userId, changeCount(userId) + 1);
  if (localChanges.size > 50_000) localChanges.clear();
}

/** Keep pushes for one account in order: a remove right after a set must reach Control Point after it. */
const queues = new Map<number, Promise<unknown>>();
function inOrder<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(userId) ?? Promise.resolve();
  const p = prev.then(fn, fn);
  const tail = p.catch(() => {});
  queues.set(userId, tail);
  void tail.then(() => { if (queues.get(userId) === tail) queues.delete(userId); });
  return p;
}

/**
 * Send this account's pending change to Control Point, if it has one and the account is linked. Never throws: what
 * Control Point couldn't take stays pending for the next account read.
 */
export function pushPending(userId: number, accountId?: number | null): Promise<void> {
  return inOrder(userId, async () => {
    if (!controlPointEnabled()) return;
    const id = accountId ?? await linkedAccountId(userId);
    if (id == null) return;
    const r = await get<Row>("SELECT data, mime, version, pending FROM user_avatars WHERE user_id = ? AND pending IS NOT NULL", [userId]);
    if (!r) return;
    try {
      if (r.pending === "push" && r.data && r.mime && r.version) {
        const cpId = await pushAccountAvatar(id, r.mime, new Uint8Array(r.data as ArrayBuffer));
        // Only if this is still the picture that was sent (a newer one waits for its own push).
        await run("UPDATE user_avatars SET cp_id = ?, pending = NULL WHERE user_id = ? AND version = ? AND pending = 'push'", [cpId, userId, r.version]);
      } else if (r.pending === "delete") {
        await deleteAccountAvatar(id);
        await run("DELETE FROM user_avatars WHERE user_id = ? AND pending = 'delete'", [userId]);
      }
    } catch (e) { logFailure("avatar push", e); }
  });
}

export type SetAvatarResult = { ok: true; avatarUrl: string } | { ok: false; error: "invalid_image" | "too_large" };

/** What an upload may be: what Control Point takes too (a GIF it would refuse, so it could never sync). The app always
 *  sends WebP or JPEG; a GIF only ever arrives from Control Point itself. */
const UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Make `data` this account's picture (here at once, then Control Point). */
export async function setAvatar(userId: number, data: Uint8Array): Promise<SetAvatarResult> {
  if (data.length > AVATAR_MAX_BYTES) return { ok: false, error: "too_large" };
  const mime = sniffImage(data);
  if (!mime || !UPLOAD_TYPES.has(mime)) return { ok: false, error: "invalid_image" };
  noteLocalChange(userId);
  const version = newVersion();
  await run(
    `INSERT INTO user_avatars (user_id, data, mime, version, cp_id, pending, updated_at) VALUES (?, ?, ?, ?, NULL, 'push', ?)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, mime = excluded.mime, version = excluded.version, pending = 'push', updated_at = excluded.updated_at`,
    [userId, data, mime, version, now()],
  );
  await pushPending(userId);
  return { ok: true, avatarUrl: avatarPath(userId, version) };
}

/** This account has no picture any more (here at once, then Control Point). */
export async function removeAvatar(userId: number): Promise<void> {
  noteLocalChange(userId);
  const linked = controlPointEnabled() ? await linkedAccountId(userId) : null;
  if (linked == null) {
    // Nothing to tell Control Point, though a picture set before linking may still be waiting to go: drop it too.
    await run("DELETE FROM user_avatars WHERE user_id = ?", [userId]);
    return;
  }
  await run(
    `INSERT INTO user_avatars (user_id, data, mime, version, cp_id, pending, updated_at) VALUES (?, NULL, NULL, NULL, NULL, 'delete', ?)
     ON CONFLICT(user_id) DO UPDATE SET data = NULL, mime = NULL, version = NULL, pending = 'delete', updated_at = excluded.updated_at`,
    [userId, now()],
  );
  await pushPending(userId, linked);
}

/**
 * Follow the picture an account answer reports (called for every answer, from rememberInfo). Never throws, and
 * stays quiet unless the picture changed.
 */
export async function syncAvatarFrom(account: SharedAccount): Promise<void> {
  try {
    const remote = accountAvatar(account);
    const owner = await get<{ user_id: number }>("SELECT user_id FROM identities WHERE provider = ? AND subject = ?", [CP_PROVIDER, String(account.id)]);
    if (!owner) return;
    const userId = Number(owner.user_id);
    const row = await readRow(userId);
    // A change made here goes first, whatever this answer says; an older Control Point (remote undefined) keeps it waiting.
    if (row?.pending) { if (remote !== undefined) await pushPending(userId, account.id); return; }
    if (remote === undefined) return;
    // A change made after this answer was asked for is newer than what it says.
    if (row && Date.parse(row.updated_at) > (accountAskedAt(account) || Date.now())) return;
    if (remote === null) {
      // Removed in Control Point: drop the synced copy. A copy Control Point never had (cp_id NULL) is sent instead.
      if (!row) return;
      if (row.cp_id != null) await run("DELETE FROM user_avatars WHERE user_id = ? AND pending IS NULL AND cp_id = ?", [userId, row.cp_id]);
      else { await run("UPDATE user_avatars SET pending = 'push' WHERE user_id = ? AND pending IS NULL AND cp_id IS NULL", [userId]); await pushPending(userId, account.id); }
      return;
    }
    if (row?.cp_id === remote.id) return;
    const before = changeCount(userId);
    const pic = await fetchAccountAvatar(account.id);
    // Changed here while the picture was on its way: this answer is older than that change.
    if (changeCount(userId) !== before) return;
    if (!pic) {
      if (row?.cp_id != null) await run("DELETE FROM user_avatars WHERE user_id = ? AND pending IS NULL AND cp_id = ?", [userId, row.cp_id]);
      return;
    }
    const mime = sniffImage(pic.data);
    if (pic.data.length > CP_AVATAR_MAX || mime == null) return;
    // Never over a change made here meanwhile: replace exactly the row that was read, or add one only while there is
    // still none and the account still exists.
    if (row) {
      await run("UPDATE user_avatars SET data = ?, mime = ?, version = ?, cp_id = ?, updated_at = ? WHERE user_id = ? AND pending IS NULL AND updated_at = ?",
        [pic.data, mime, newVersion(), pic.id, now(), userId, row.updated_at]);
    } else {
      await run(
        `INSERT INTO user_avatars (user_id, data, mime, version, cp_id, pending, updated_at)
         SELECT ?, ?, ?, ?, ?, NULL, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM user_avatars WHERE user_id = ?)`,
        [userId, pic.data, mime, newVersion(), pic.id, now(), userId, userId]);
    }
  } catch (e) { logFailure("avatar sync", e); }
}

// --- Routes -----------------------------------------------------------------------------------------------------

/** GET /api/avatars/:user/:version: the picture, cached for good (a new picture gets a new URL). Public. */
export function avatarsRouter(): Router {
  const r = express.Router();
  r.get("/:user/:version", async (req: Request, res: Response, next) => {
    try {
      const user = Number(req.params.user);
      const version = String(req.params.version);
      if (!Number.isInteger(user) || user <= 0 || !/^[A-Za-z0-9_-]{1,32}$/.test(version)) { res.status(404).end(); return; }
      const row = await get<{ data: ArrayBuffer | null; mime: string | null }>("SELECT data, mime FROM user_avatars WHERE user_id = ? AND version = ? AND data IS NOT NULL", [user, version]);
      if (!row?.data || !row.mime) { res.setHeader("Cache-Control", "no-store"); res.status(404).end(); return; }
      const buf = Buffer.from(row.data as ArrayBuffer);
      const mime = sniffImage(buf);
      if (!mime) { res.status(404).end(); return; }
      res.setHeader("Content-Type", mime);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cross-Origin-Resource-Policy", "same-site");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Length", String(buf.length));
      res.end(buf);
    } catch (e) { next(e); }
  });
  return r;
}

/** Picture changes an hour per account: generous for trying a few crops, short of a flood. */
const UPLOADS_PER_HOUR = 30;
const uploads = new Map<number, number[]>();
export const resetAvatarLimits = () => uploads.clear();
function allowUpload(userId: number): boolean {
  const t = Date.now();
  const list = (uploads.get(userId) ?? []).filter((x) => t - x < 3600_000);
  if (list.length >= UPLOADS_PER_HOUR) { uploads.set(userId, list); return false; }
  list.push(t);
  uploads.set(userId, list);
  if (uploads.size > 20000) uploads.clear();
  return true;
}

/** PUT body: `{ image: "<base64>" }` (a data: URL prefix is allowed). */
export async function handleSetAvatar(userId: number, body: unknown, res: Response): Promise<unknown> {
  if (!allowUpload(userId)) { res.status(429).json({ error: "Too many picture changes. Try again later." }); return; }
  const raw = typeof (body as { image?: unknown } | null)?.image === "string" ? (body as { image: string }).image : "";
  const b64 = raw.replace(/^data:image\/[a-z+.-]+;base64,/i, "");
  if (!b64 || b64.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
    res.status(b64.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 4 ? 413 : 400).json({ error: b64 ? "That picture is too large." : "Pick a picture." });
    return;
  }
  const out = await setAvatar(userId, new Uint8Array(Buffer.from(b64, "base64")));
  if (!out.ok) {
    res.status(out.error === "too_large" ? 413 : 400).json({ error: out.error === "too_large" ? "That picture is too large." : "That file isn't a PNG, JPEG or WebP picture." });
    return;
  }
  return { ok: true, avatarUrl: out.avatarUrl };
}
