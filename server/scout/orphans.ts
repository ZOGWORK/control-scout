// Orphaned workspaces (Task 19; docs/shared-accounts.md, "Orphaned workspaces"): the state Scout keeps for
// a scout space whose Control Point workspace was deleted or has no admin left. Detection runs in the
// membership refresh (controlPoint.ts storeMemberships); this module holds the rows and what they mean.
//
// - workspaces.orphaned_at / orphan_reason: set while the space is read-only, cleared when it comes back.
// - workspace_former_members: for a "deleted" workspace, everyone in Scout's membership cache for it when
//   Scout saw it go (with their role). They keep reading (entries, comments, assignments, photos, export)
//   although Control Point no longer lists them. A "no_admin" workspace has none: it still exists, so its
//   members are whoever Control Point says, as ever, only read-only.
//
// Every change is recorded in the owner audit (workspace.orphaned / workspace.restored) and published to
// the workspace's open streams (`event: workspace`), which stay open.
import { all, db, get } from "../db.js";
import { publishWorkspaceState } from "./bus.js";
import { recordAudit } from "../portal/audit.js";
import { isOrphanReason, type OrphanedWorkspace, type OrphanReason, type OrphanState } from "../../src/shared/orphaned.js";

const CP_PROVIDER = "control-point"; // controlPoint.ts's, repeated: that module imports this one

const stateOf = (r: { orphaned_at?: unknown; orphan_reason?: unknown } | undefined): OrphanState | null =>
  r && typeof r.orphaned_at === "string" && isOrphanReason(r.orphan_reason) ? { at: r.orphaned_at, reason: r.orphan_reason } : null;

/** Is the workspace's scout space read-only right now, and why? Null: it's fine (or has no scout space). */
export async function orphanState(workspaceId: string): Promise<OrphanState | null> {
  return stateOf(await get("SELECT orphaned_at, orphan_reason FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]));
}

/** The scout spaces among these workspaces (a mirror row), each with its orphan state. */
export async function mirroredStates(workspaceIds: string[]): Promise<Map<string, OrphanState | null>> {
  if (!workspaceIds.length) return new Map();
  const rows = await all<{ cp_workspace_id: string; orphaned_at: string | null; orphan_reason: string | null }>(
    `SELECT cp_workspace_id, orphaned_at, orphan_reason FROM workspaces WHERE cp_workspace_id IN (${workspaceIds.map(() => "?").join(", ")})`, workspaceIds);
  return new Map(rows.map((r) => [String(r.cp_workspace_id), stateOf(r)]));
}

/** A former member's standing in a workspace deleted in Control Point (null: not one, or not deleted). */
export async function formerMember(accountId: number, workspaceId: string): Promise<{ workspaceName: string; role: "admin" | "member" } | null> {
  const r = await get<{ name: string; role: string }>(
    `SELECT ws.name, f.role FROM workspace_former_members f JOIN workspaces ws ON ws.id = f.workspace_id
      WHERE f.account_id = ? AND ws.cp_workspace_id = ? AND ws.orphan_reason = 'deleted'`, [accountId, workspaceId]);
  return r ? { workspaceName: String(r.name ?? ""), role: r.role === "admin" ? "admin" : "member" } : null;
}

/** The deleted workspaces this account still reads (for /api/auth/me: Control Point no longer lists them). */
export async function formerWorkspaces(accountId: number): Promise<{ id: string; name: string; role: "admin" | "member"; orphaned: OrphanState }[]> {
  const rows = await all<{ cp_workspace_id: string; name: string; role: string; orphaned_at: string; orphan_reason: string }>(
    `SELECT ws.cp_workspace_id, ws.name, f.role, ws.orphaned_at, ws.orphan_reason FROM workspace_former_members f
       JOIN workspaces ws ON ws.id = f.workspace_id WHERE f.account_id = ? AND ws.orphan_reason = 'deleted' ORDER BY ws.id LIMIT 100`, [accountId]);
  return rows.flatMap((r) => {
    const orphaned = stateOf(r);
    return orphaned ? [{ id: String(r.cp_workspace_id), name: String(r.name ?? ""), role: r.role === "admin" ? "admin" as const : "member" as const, orphaned }] : [];
  });
}

/** A deleted workspace's former members, named as cachedWorkspaceMembers names them (Settings → Workspace → Members). */
export async function formerMembersOf(workspaceId: string): Promise<{ accountId: number; name: string; role: "admin" | "member" }[]> {
  const rows = await all<{ account_id: number; role: string; display_name: string | null; email: string | null }>(
    `SELECT f.account_id, f.role, u.display_name, u.email FROM workspace_former_members f JOIN workspaces ws ON ws.id = f.workspace_id
       LEFT JOIN users u ON u.id = (SELECT i.user_id FROM identities i WHERE i.provider = ? AND i.subject = CAST(f.account_id AS TEXT) ORDER BY i.user_id LIMIT 1)
      WHERE ws.cp_workspace_id = ? ORDER BY f.account_id LIMIT 1000`, [CP_PROVIDER, workspaceId]);
  return rows.map((r) => ({
    accountId: Number(r.account_id),
    name: (r.display_name?.trim() || r.email?.split("@")[0] || "A member").slice(0, 60),
    role: r.role === "admin" ? "admin" as const : "member" as const,
  }));
}

/** Accounts Scout knows in the workspace: its cached members and former members (whose /me changes with it). */
async function accountsOf(workspaceId: string): Promise<number[]> {
  const rows = await all<{ account_id: number }>(
    `SELECT account_id FROM workspace_members WHERE cp_workspace_id = ?
     UNION SELECT f.account_id FROM workspace_former_members f JOIN workspaces ws ON ws.id = f.workspace_id WHERE ws.cp_workspace_id = ?`, [workspaceId, workspaceId]);
  return rows.map((r) => Number(r.account_id));
}

/**
 * Mark the workspace's scout space read-only (a no-op without a mirror row, or when it is already marked for
 * this reason). "deleted" snapshots the former members from the membership cache, so call it before the
 * refresh that saw the deletion drops its own row. A "no_admin" space that turns out deleted switches reason
 * (and takes the snapshot); one deleted that turns out to exist with no admin drops the snapshot. The time it
 * first went read-only is kept. Returns the accounts it concerns when it changed anything, else null.
 */
export async function markOrphaned(workspaceId: string, reason: OrphanReason, now = Date.now()): Promise<number[] | null> {
  const iso = new Date(now).toISOString();
  const res = await db().batch([
    {
      sql: `UPDATE workspaces SET orphaned_at = COALESCE(orphaned_at, ?), orphan_reason = ?, orphan_check_at = NULL, updated_at = ?
             WHERE cp_workspace_id = ? AND (orphan_reason IS NULL OR orphan_reason <> ?) RETURNING name, orphaned_at`,
      args: [iso, reason, iso, workspaceId, reason],
    },
    reason === "deleted"
      ? {
        sql: `INSERT OR IGNORE INTO workspace_former_members (workspace_id, account_id, role)
              SELECT ws.id, wm.account_id, wm.role FROM workspace_members wm JOIN workspaces ws ON ws.cp_workspace_id = wm.cp_workspace_id
               WHERE wm.cp_workspace_id = ? AND ws.orphan_reason = 'deleted'`,
        args: [workspaceId],
      }
      : { sql: "DELETE FROM workspace_former_members WHERE workspace_id = (SELECT id FROM workspaces WHERE cp_workspace_id = ?)", args: [workspaceId] },
    // Departures Control Point couldn't explain earlier (controlPoint.ts storeMemberships): former members too.
    ...(reason === "deleted" ? [
      {
        sql: `INSERT OR IGNORE INTO workspace_former_members (workspace_id, account_id, role)
              SELECT ws.id, p.account_id, p.role FROM workspace_pending_departures p JOIN workspaces ws ON ws.cp_workspace_id = p.cp_workspace_id
               WHERE p.cp_workspace_id = ? AND ws.orphan_reason = 'deleted'`,
        args: [workspaceId],
      },
      { sql: "DELETE FROM workspace_pending_departures WHERE cp_workspace_id = ?", args: [workspaceId] },
    ] : []),
  ], "write");
  const row = res[0].rows[0] as unknown as { name: string; orphaned_at: string } | undefined;
  if (!row) return null;
  const state: OrphanState = { at: String(row.orphaned_at), reason };
  publishWorkspaceState(workspaceId, state);
  const accounts = await accountsOf(workspaceId).catch(() => []);
  try {
    await recordAudit("Control Point", "workspace.orphaned", { workspaceId, workspaceName: String(row.name ?? ""), reason, formerMembers: reason === "deleted" ? accounts.length : 0 });
  } catch (e) { console.warn(`[orphans] audit failed: ${(e as Error)?.name ?? "error"}`); }
  return accounts;
}

/**
 * The workspace is back in Control Point (listed again, with an admin): writable again. Clears the mark and
 * the former members (Control Point's membership counts again). Returns the accounts it concerns when it
 * changed anything (taken before the former members go), else null.
 */
export async function restoreWorkspace(workspaceId: string): Promise<number[] | null> {
  const accounts = await accountsOf(workspaceId).catch(() => [] as number[]);
  const iso = new Date().toISOString();
  const res = await db().batch([
    { sql: "SELECT orphan_reason FROM workspaces WHERE cp_workspace_id = ?", args: [workspaceId] }, // what it was (RETURNING gives the new values)
    { sql: "UPDATE workspaces SET orphaned_at = NULL, orphan_reason = NULL, orphan_check_at = NULL, updated_at = ? WHERE cp_workspace_id = ? AND orphaned_at IS NOT NULL RETURNING name", args: [iso, workspaceId] },
    { sql: "DELETE FROM workspace_former_members WHERE workspace_id = (SELECT id FROM workspaces WHERE cp_workspace_id = ?)", args: [workspaceId] },
  ], "write");
  const row = res[1].rows[0] as unknown as { name: string } | undefined;
  if (!row) return null;
  const was = String((res[0].rows[0] as unknown as { orphan_reason: string | null } | undefined)?.orphan_reason ?? "");
  publishWorkspaceState(workspaceId, null);
  try { await recordAudit("Control Point", "workspace.restored", { workspaceId, workspaceName: String(row.name ?? ""), was }); }
  catch (e) { console.warn(`[orphans] audit failed: ${(e as Error)?.name ?? "error"}`); }
  return accounts;
}

/** How many scout spaces are read-only right now (the owner portal's Overview). */
export async function orphanedCount(): Promise<number> {
  return Number((await get<{ n: number }>("SELECT COUNT(*) n FROM workspaces WHERE orphaned_at IS NOT NULL"))?.n ?? 0);
}

/** Every read-only scout space, newest first, with its entry count and who can still read it (the owner portal). */
export async function listOrphaned(): Promise<OrphanedWorkspace[]> {
  const rows = await all<{ id: number; cp_workspace_id: string; name: string; orphaned_at: string; orphan_reason: string; entries: number }>(
    `SELECT ws.id, ws.cp_workspace_id, ws.name, ws.orphaned_at, ws.orphan_reason,
            (SELECT COUNT(*) FROM workspace_scout_entries e WHERE e.workspace_id = ws.id AND e.deleted = 0) entries
       FROM workspaces ws WHERE ws.orphaned_at IS NOT NULL ORDER BY ws.orphaned_at DESC, ws.id DESC LIMIT 200`);
  if (!rows.length) return [];
  // Named as cachedWorkspaceMembers does: the Scout profile's name, else the email before the @.
  const people = await all<{ workspace_id: number; account_id: number; role: string; display_name: string | null; email: string | null }>(
    `SELECT m.workspace_id, m.account_id, m.role, u.display_name, u.email FROM (
        SELECT f.workspace_id, f.account_id, f.role FROM workspace_former_members f JOIN workspaces ws ON ws.id = f.workspace_id WHERE ws.orphan_reason = 'deleted'
        UNION ALL
        SELECT ws.id, wm.account_id, wm.role FROM workspace_members wm JOIN workspaces ws ON ws.cp_workspace_id = wm.cp_workspace_id WHERE ws.orphan_reason = 'no_admin'
      ) m
      LEFT JOIN users u ON u.id = (SELECT i.user_id FROM identities i WHERE i.provider = ? AND i.subject = CAST(m.account_id AS TEXT) ORDER BY i.user_id LIMIT 1)
      ORDER BY m.role, m.account_id`, [CP_PROVIDER]);
  return rows.flatMap((r) => {
    const st = stateOf(r);
    if (!st) return [];
    const members = people.filter((p) => Number(p.workspace_id) === Number(r.id)).map((p) => ({
      accountId: Number(p.account_id),
      name: (p.display_name?.trim() || p.email?.split("@")[0] || "A member").slice(0, 60),
      role: p.role === "admin" ? "admin" as const : "member" as const,
    }));
    return [{ workspaceId: String(r.cp_workspace_id), name: String(r.name ?? ""), orphanedAt: st.at, reason: st.reason, entries: Number(r.entries ?? 0), members }];
  });
}
