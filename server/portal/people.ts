// The owner console's Users and Workspaces: who has an account and what they keep here, and every Scout
// space with its members and entries. Read-only: the owner looks, nothing here changes an account. Each
// count comes from the database as it stands; tables a server doesn't have yet read as null, not zero.
import { all, get } from "../db.js";
import { CP_PROVIDER } from "../auth/controlPoint.js";
import { tablesPresent } from "./overview.js";
import type { OwnerUser, OwnerUserDetail, OwnerWorkspace } from "../../src/shared/owner.js";

const n = (x: unknown) => Number(x ?? 0);

/**
 * Who can read which Scout space, as (account_id, cp_workspace_id, role) rows: the membership cache, plus the
 * people who keep reading a workspace deleted in Control Point (workspace_former_members), whose cached rows go
 * as Control Point stops listing them. Built for the tables this database has; null without memberships.
 */
function membershipsSql(tables: Set<string>): string | null {
  if (!tables.has("workspace_members")) return null;
  const current = "SELECT account_id, cp_workspace_id, role, 0 former FROM workspace_members";
  if (!tables.has("workspace_former_members") || !tables.has("workspaces")) return current;
  return `${current} UNION ALL SELECT f.account_id, w.cp_workspace_id, f.role, 1 former FROM workspace_former_members f JOIN workspaces w ON w.id = f.workspace_id WHERE w.orphan_reason = 'deleted'`;
}

/** Accounts, most recently seen first; `q` matches email or display name. */
export async function listUsers(q: string | null, limit = 300): Promise<{ users: OwnerUser[]; total: number }> {
  const tables = await tablesPresent();
  const like = q ? `%${q.toLowerCase()}%` : null;
  const where = like ? "WHERE lower(COALESCE(u.email, '')) LIKE ? OR lower(COALESCE(u.display_name, '')) LIKE ?" : "";
  const args = like ? [like, like] : [];
  const ms = membershipsSql(tables);
  // Distinct spaces: someone both cached and kept as a former member of a deleted workspace counts once.
  const members = ms
    ? `(SELECT COUNT(DISTINCT m.cp_workspace_id) FROM (${ms}) m JOIN identities ci ON ci.provider = '${CP_PROVIDER}' AND CAST(ci.subject AS INTEGER) = m.account_id WHERE ci.user_id = u.id)`
    : "NULL";
  const rows = await all<any>(
    `SELECT u.id, u.email, u.display_name, u.created_at, u.last_seen,
       (SELECT group_concat(provider, ',') FROM identities i WHERE i.user_id = u.id) providers,
       (SELECT COUNT(*) FROM scout_entries s WHERE s.user_id = u.id AND s.deleted = 0) entries,
       ${members} workspaces
     FROM users u ${where}
     ORDER BY COALESCE(u.last_seen, u.created_at) DESC, u.id DESC LIMIT ?`, [...args, limit]);
  const total = n((await get<{ c: number }>(`SELECT COUNT(*) c FROM users u ${where}`, args))?.c);
  return {
    total,
    users: rows.map((r): OwnerUser => ({
      id: n(r.id), email: r.email ?? null, displayName: r.display_name ?? null, createdAt: r.created_at, lastSeen: r.last_seen ?? null,
      providers: r.providers ? [...new Set(String(r.providers).split(","))].sort() : [],
      personalEntries: n(r.entries), workspaces: r.workspaces == null ? null : n(r.workspaces),
    })),
  };
}

/** One account in full: sign-in methods, sessions, what's saved for it, and its workspaces. */
export async function userDetail(id: number, now = Date.now()): Promise<OwnerUserDetail | null> {
  const u = await get<any>("SELECT id, email, display_name, created_at, last_seen FROM users WHERE id = ?", [id]);
  if (!u) return null;
  const tables = await tablesPresent();
  const [ids, sessions, state, entries] = await Promise.all([
    all<any>("SELECT provider, subject FROM identities WHERE user_id = ? ORDER BY provider", [id]),
    all<any>("SELECT created_at, expires_at, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC", [id, new Date(now).toISOString()]),
    all<any>("SELECT key, updated_at FROM user_state WHERE user_id = ? ORDER BY key", [id]),
    get<any>("SELECT COUNT(*) c, MAX(updated_at) last FROM scout_entries WHERE user_id = ? AND deleted = 0", [id]),
  ]);
  const cp = ids.find((i) => i.provider === CP_PROVIDER);
  const account = cp ? Number(cp.subject) : null;
  const ms = membershipsSql(tables);
  const rows = account != null && ms
    ? await all<any>(
      `SELECT m.cp_workspace_id, COALESCE(NULLIF(w.name, ''), (SELECT wm.workspace_name FROM workspace_members wm WHERE wm.cp_workspace_id = m.cp_workspace_id LIMIT 1)) name,
         m.role, m.former, w.orphaned_at,
         ${tables.has("workspace_scout_entries") ? "(SELECT COUNT(*) FROM workspace_scout_entries e WHERE e.workspace_id = w.id AND e.author_account_id = m.account_id AND e.deleted = 0)" : "NULL"} authored
       FROM (${ms}) m LEFT JOIN workspaces w ON w.cp_workspace_id = m.cp_workspace_id
       WHERE m.account_id = ? ORDER BY m.former, name`, [account])
    : [];
  // One row per space: the current membership wins over a former one (its role is the live one).
  const seen = new Set<string>();
  const workspaces = rows.filter((w) => !seen.has(String(w.cp_workspace_id)) && !!seen.add(String(w.cp_workspace_id)))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  return {
    id: n(u.id), email: u.email ?? null, displayName: u.display_name ?? null, createdAt: u.created_at, lastSeen: u.last_seen ?? null,
    signIns: ids.map((i) => i.provider),
    controlPointAccount: account,
    sessions: sessions.map((s) => ({ createdAt: s.created_at, expiresAt: s.expires_at, device: (s.user_agent ?? "").slice(0, 160) || null })),
    saved: state.map((s) => ({ key: s.key, updatedAt: n(s.updated_at) })),
    personalEntries: { count: n(entries?.c), lastUpdated: entries?.last == null ? null : n(entries.last) },
    workspaces: workspaces.map((w) => ({ id: String(w.cp_workspace_id), name: w.name ?? "", role: w.role, orphaned: !!w.orphaned_at, authoredEntries: w.authored == null ? null : n(w.authored) })),
  };
}

/** Every Scout space (a Control Point workspace that has used Scout): members, entries, last activity. Null before workspaces exist here. */
export async function listWorkspaces(): Promise<OwnerWorkspace[] | null> {
  const tables = await tablesPresent();
  if (!tables.has("workspaces")) return null;
  const hasEntries = tables.has("workspace_scout_entries"), ms = membershipsSql(tables);
  const rows = await all<any>(
    `SELECT w.id, w.cp_workspace_id, w.name, w.created_at, w.orphaned_at, w.orphan_reason,
       ${ms ? `(SELECT COUNT(DISTINCT m.account_id) FROM (${ms}) m WHERE m.cp_workspace_id = w.cp_workspace_id)` : "NULL"} members,
       ${hasEntries ? "(SELECT COUNT(*) FROM workspace_scout_entries e WHERE e.workspace_id = w.id AND e.deleted = 0)" : "NULL"} entries,
       ${hasEntries ? "(SELECT MAX(updated_at) FROM workspace_scout_entries e WHERE e.workspace_id = w.id)" : "NULL"} last_entry
     FROM workspaces w ORDER BY COALESCE(last_entry, 0) DESC, w.id DESC`);
  return rows.map((r): OwnerWorkspace => ({
    id: String(r.cp_workspace_id), name: r.name ?? "", createdAt: r.created_at,
    members: r.members == null ? null : n(r.members), entries: r.entries == null ? null : n(r.entries),
    lastEntryAt: r.last_entry == null ? null : n(r.last_entry),
    orphaned: r.orphaned_at ? { at: r.orphaned_at, reason: r.orphan_reason ?? null } : null,
  }));
}
