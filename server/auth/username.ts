// Setting an account's username and actual name (src/shared/username.ts, docs/contributors.md). The username is
// unique ignoring case (users_username, migration 81), changes at most once in 30 days, and every change of either
// is written to the owner audit log with the account as its actor, so the owner console shows a contributor's
// name history beside their verification.
import { all, get, run } from "../db.js";
import { recordAudit } from "../portal/audit.js";
import { NAME_MAX, USERNAME_CHANGE_DAYS, USERNAME_PROBLEM_TEXT, usernameKey, usernameProblem, usernameSuggestions } from "../../src/shared/username.js";
import type { User } from "./session.js";

/** How the audit log names an account acting for itself. */
export const accountActor = (u: Pick<User, "id" | "email">) => u.email ?? `account ${u.id}`;

export type UsernameCheck = { ok: true } | { ok: false; reason: "format" | "reserved" | "taken" | "tooSoon"; error: string; suggestions: string[]; retryAfter?: string };

/** Is this username taken by another account? */
async function takenBy(u: string, self: number | null): Promise<boolean> {
  const r = await get<{ id: number }>("SELECT id FROM users WHERE lower(username) = ? AND id IS NOT ?", [usernameKey(u), self]);
  return !!r;
}

/** The free suggestions for a taken (or reserved) username: candidates read once, in one query. */
async function suggestionsFor(raw: string, self: number | null, team: number | null): Promise<string[]> {
  const candidates = usernameSuggestions(raw, team, () => false, 8);
  if (!candidates.length) return [];
  const used = new Set((await all<{ k: string }>(`SELECT lower(username) k FROM users WHERE lower(username) IN (${candidates.map(() => "?").join(", ")}) AND id IS NOT ?`,
    [...candidates.map(usernameKey), self])).map((r) => r.k));
  return candidates.filter((c) => !used.has(usernameKey(c))).slice(0, 3);
}

/** When this account may change its username next (ISO), or null when it may now. */
export function nextUsernameChange(u: Pick<User, "username" | "usernameChangedAt">, now = Date.now()): string | null {
  if (!u.username || !u.usernameChangedAt) return null;
  const next = Date.parse(u.usernameChangedAt) + USERNAME_CHANGE_DAYS * 864e5;
  return Number.isFinite(next) && next > now ? new Date(next).toISOString() : null;
}

/** Can `user` take `raw` now? `team`: a number to suggest with (their team), when it's taken. */
export async function checkUsername(user: User, raw: string, team: number | null = null, now = Date.now()): Promise<UsernameCheck> {
  const u = raw.trim();
  const problem = usernameProblem(u);
  if (problem === "format") return { ok: false, reason: "format", error: USERNAME_PROBLEM_TEXT.format, suggestions: [] };
  if (problem === "reserved") return { ok: false, reason: "reserved", error: USERNAME_PROBLEM_TEXT.reserved, suggestions: await suggestionsFor(u, user.id, team) };
  // The same name again (any case) is no change: it never counts against the 30 days.
  if (user.username && usernameKey(user.username) === usernameKey(u) && user.username === u) return { ok: true };
  const soon = user.username && usernameKey(user.username) !== usernameKey(u) ? nextUsernameChange(user, now) : null;
  if (soon) return { ok: false, reason: "tooSoon", error: USERNAME_PROBLEM_TEXT.tooSoon, suggestions: [], retryAfter: soon };
  if (await takenBy(u, user.id)) return { ok: false, reason: "taken", error: USERNAME_PROBLEM_TEXT.taken, suggestions: await suggestionsFor(u, user.id, team) };
  return { ok: true };
}

/** Set `user`'s username. The unique index settles two accounts racing for one name: the loser is told it's taken. */
export async function setUsername(user: User, raw: string, team: number | null = null, now = Date.now()): Promise<UsernameCheck & { username?: string }> {
  const u = raw.trim();
  const check = await checkUsername(user, u, team, now);
  if (!check.ok) return check;
  if (user.username === u) return { ok: true, username: u };
  // A change of letter case only is the same username: it keeps its date (and its 30 days).
  const caseOnly = !!user.username && usernameKey(user.username) === usernameKey(u);
  try {
    await run(`UPDATE users SET username = ?${caseOnly ? "" : ", username_changed_at = ?"} WHERE id = ?`, caseOnly ? [u, user.id] : [u, new Date(now).toISOString(), user.id]);
  } catch (e) {
    if (/UNIQUE/i.test(String((e as Error)?.message))) return { ok: false, reason: "taken", error: USERNAME_PROBLEM_TEXT.taken, suggestions: await suggestionsFor(u, user.id, team) };
    throw e;
  }
  await recordAudit(accountActor(user), "account.username", { userId: user.id }, null, { from: user.username ?? null, to: u });
  return { ok: true, username: u };
}

/** Set `user`'s actual name (display name). Returns the stored name; logs the change when it is one. */
export async function setDisplayName(user: User, raw: string): Promise<string | null> {
  const name = raw.trim().slice(0, NAME_MAX) || null;
  const was = (await get<{ display_name: string | null }>("SELECT display_name FROM users WHERE id = ?", [user.id]))?.display_name ?? null;
  await run("UPDATE users SET display_name = ? WHERE id = ?", [name, user.id]);
  if (was !== name) await recordAudit(accountActor(user), "account.name", { userId: user.id }, null, { from: was, to: name });
  return name;
}

/** An account's name changes, oldest first, from the audit log (the owner console's contributor row). */
export async function nameHistory(userId: number, limit = 20): Promise<{ at: string; field: "name" | "username"; from: string | null; to: string | null }[]> {
  const rows = await all<any>(
    `SELECT at, action, old_value, new_value FROM owner_audit WHERE action IN ('account.name', 'account.username') AND json_extract(details, '$.userId') = ? ORDER BY id DESC LIMIT ?`, [userId, limit]);
  const val = (s: string | null) => { try { const v = s == null ? null : JSON.parse(s); return typeof v === "string" ? v : null; } catch { return null; } };
  return rows.reverse().map((r) => ({ at: String(r.at), field: r.action === "account.username" ? "username" : "name", from: val(r.old_value), to: val(r.new_value) }));
}
