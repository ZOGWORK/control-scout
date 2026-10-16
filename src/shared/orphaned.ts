// Orphaned workspaces (Task 19; docs/shared-accounts.md, "Orphaned workspaces"): a Control Point workspace
// whose scout space is left behind. Shared by the server and the app.
//
// - "deleted": the workspace is gone from Control Point (its members route answers 404 not_found). Everyone
//   who was in Scout's membership cache for it at that moment (its former members) keeps reading the space.
// - "no_admin": the workspace is still there but has no admin left. Its members keep their access, read-only.
//
// Either way the space is read-only: entries, comments, assignments and photos stay viewable, and every
// write is refused with READ_ONLY_STATUS / READ_ONLY_CODE (never 403, which means "you were removed").
// If the workspace comes back (re-created or an admin added in Control Point), it is writable again.

export type OrphanReason = "deleted" | "no_admin";
/** When the space went read-only (ISO) and why. */
export interface OrphanState { at: string; reason: OrphanReason }

export const isOrphanReason = (v: unknown): v is OrphanReason => v === "deleted" || v === "no_admin";

/** The status a write to a read-only (orphaned) workspace gets: 423 Locked. */
export const READ_ONLY_STATUS = 423;
/** The `code` in that answer's body. */
export const READ_ONLY_CODE = "workspace_read_only";
export const READ_ONLY_ERROR = "This workspace is read-only: it no longer exists in Control Point (or has no admin left). Its entries are preserved and can still be read and exported.";

/** The banner on a read-only space. */
export function orphanBanner(reason: OrphanReason): string {
  return reason === "deleted"
    ? "This workspace no longer exists in Control Point — this space is read-only. Your entries are preserved."
    : "This workspace has no admin left in Control Point — this space is read-only. Your entries are preserved.";
}

/** An orphaned workspace as the owner portal lists it (GET /api/owner/orphaned-workspaces). */
export interface OrphanedWorkspace {
  workspaceId: string;
  name: string;
  orphanedAt: string;
  reason: OrphanReason;
  /** Live (not deleted) shared entries. */
  entries: number;
  /** Who can still read it: the former members ("deleted") or the members Scout knows ("no_admin"). */
  members: { accountId: number; name: string; role: "admin" | "member" }[];
}
