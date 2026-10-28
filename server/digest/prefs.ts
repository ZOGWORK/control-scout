// Who gets the weekly digest (docs/digest.md): the Settings switch, the one-click unsubscribe link, and hard bounces.
//
// The switch lives in its own table, not in the synced settings: an unsubscribe click or a bounce changes it on the
// server, and a device's older copy of the settings must never turn it back on. Off by default (no row: off).
import { timingSafeEqual } from "node:crypto";
import { get, run } from "../db.js";
import { token as randomToken } from "../auth/session.js";

export interface Prefs { enabled: boolean; token: string; bounced: boolean }

export async function prefsFor(userId: number): Promise<Prefs | null> {
  const r = await get<any>("SELECT enabled, token, bounced_at FROM digest_prefs WHERE user_id = ?", [userId]);
  return r ? { enabled: Number(r.enabled) === 1, token: String(r.token), bounced: r.bounced_at != null } : null;
}

/**
 * Turn the digest on or off for an account. Turning it on issues a new unsubscribe token (so a link in an
 * earlier email can't switch it off again) and clears a past hard bounce (the person chose to try again).
 */
export async function setDigest(userId: number, enabled: boolean, now = new Date()): Promise<void> {
  const at = now.toISOString();
  if (enabled) {
    await run(
      `INSERT INTO digest_prefs (user_id, enabled, token, updated_at) SELECT ?, 1, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)
       ON CONFLICT (user_id) DO UPDATE SET enabled = 1, token = excluded.token, updated_at = excluded.updated_at, bounced_at = NULL`,
      [userId, randomToken(32), at, userId]);
  } else {
    await run("UPDATE digest_prefs SET enabled = 0, updated_at = ? WHERE user_id = ?", [at, userId]);
  }
}

/** A well-formed token: 43 base64url characters (32 random bytes). */
export const tokenShape = (t: unknown): t is string => typeof t === "string" && /^[A-Za-z0-9_-]{43}$/.test(t);

/**
 * The unsubscribe link: switch the digest off for the account this token belongs to. True when the token
 * is the account's current one (whether or not the digest was still on); false for an unknown or replaced token.
 */
export async function unsubscribe(token: unknown, now = new Date()): Promise<boolean> {
  if (!tokenShape(token)) return false;
  const r = await get<{ user_id: number; token: string }>("SELECT user_id, token FROM digest_prefs WHERE token = ?", [token]);
  // The lookup is by an indexed equal match; the compare below keeps the final check constant-time anyway.
  if (!r || !timingSafeEqual(Buffer.from(r.token), Buffer.from(token))) return false;
  const at = now.toISOString();
  await run("UPDATE digest_prefs SET enabled = 0, unsubscribed_at = ?, updated_at = ? WHERE user_id = ? AND token = ?", [at, at, r.user_id, token]);
  return true;
}

/** A hard bounce or a spam complaint for an address: the digest goes off for its account. Returns how many accounts changed. */
export async function stopForAddress(email: string, why: "bounce" | "complaint", now = new Date()): Promise<number> {
  const at = now.toISOString();
  return run(
    `UPDATE digest_prefs SET enabled = 0, updated_at = ?${why === "bounce" ? ", bounced_at = ?" : ""}
     WHERE user_id IN (SELECT id FROM users WHERE email = ? COLLATE NOCASE)`,
    why === "bounce" ? [at, at, email] : [at, email]);
}
