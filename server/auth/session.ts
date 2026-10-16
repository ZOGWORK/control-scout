// Sessions + identities. Pluggable: a provider proves an identity
// (provider, subject, email?) and this module maps it to a Control Scout user.
// A shared Control Point account later is just one more provider.
import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { all, get, run } from "../db.js";
import { env } from "../env.js";

export const SESSION_COOKIE = "cs_session";
const SESSION_DAYS = 30;

export interface User { id: number; email: string | null; displayName: string | null; createdAt: string }

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const token = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** Find or create the user behind a proven identity. */
export async function userForIdentity(provider: string, subject: string, email: string | null, displayName?: string | null): Promise<User> {
  const existing = await get<{ user_id: number }>("SELECT user_id FROM identities WHERE provider = ? AND subject = ?", [provider, subject]);
  let userId = existing?.user_id;
  if (!userId && email) {
    // Same verified email from another provider → same account.
    userId = (await get<{ id: number }>("SELECT id FROM users WHERE email = ?", [email]))?.id;
  }
  if (!userId) {
    const r = await get<{ id: number }>("INSERT INTO users (email, display_name, created_at) VALUES (?, ?, ?) RETURNING id", [email, displayName ?? null, new Date().toISOString()]);
    userId = r!.id;
  }
  await run("INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)", [provider, subject, userId]);
  return (await getUser(Number(userId)))!;
}

export async function getUser(id: number): Promise<User | null> {
  const u = await get<any>("SELECT id, email, display_name, created_at FROM users WHERE id = ?", [id]);
  return u ? { id: Number(u.id), email: u.email, displayName: u.display_name, createdAt: u.created_at } : null;
}

export async function startSession(res: Response, user: User, userAgent?: string): Promise<void> {
  const t = token();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await run("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)", [sha256(t), user.id, new Date().toISOString(), expires.toISOString(), (userAgent ?? "").slice(0, 200)]);
  res.cookie(SESSION_COOKIE, t, { httpOnly: true, sameSite: "lax", secure: env.production, path: "/", expires });
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export async function currentUser(req: Request): Promise<User | null> {
  const t = readCookie(req, SESSION_COOKIE);
  if (!t) return null;
  const s = await get<any>("SELECT user_id, expires_at FROM sessions WHERE id = ?", [sha256(t)]);
  if (!s || Date.parse(s.expires_at) < Date.now()) return null;
  const user = await getUser(Number(s.user_id));
  if (user) await run("UPDATE users SET last_seen = ? WHERE id = ?", [new Date().toISOString(), user.id]);
  return user;
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const t = readCookie(req, SESSION_COOKIE);
  if (t) await run("DELETE FROM sessions WHERE id = ?", [sha256(t)]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** Delete an account and everything personal attached to it. */
export async function deleteUser(id: number): Promise<void> {
  // The account row goes first: anything written for it from then on checks it exists (the notification inbox
  // does), and whatever was written before is deleted below.
  await run("DELETE FROM users WHERE id = ?", [id]);
  await run("DELETE FROM push_sent WHERE subscription_id IN (SELECT id FROM push_subscriptions WHERE user_id = ?)", [id]);
  for (const t of ["sessions", "identities", "user_state", "scout_entries", "inbox_items", "push_subscriptions"]) await run(`DELETE FROM ${t} WHERE user_id = ?`, [id]);
}

export async function sessionsFor(id: number) {
  return all<any>("SELECT created_at, expires_at, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC", [id]);
}

export { readCookie };
