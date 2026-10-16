// Settings → Workspace → Members (Task 9; server/scout/members.ts). Shared by the server and the app.

/** One person in a workspace. `accountId` null: they've never used Control Scout (Control Point's list only). */
export interface WorkspaceMemberOut { accountId: number | null; name: string; role: "admin" | "member"; you: boolean }

export interface WorkspaceMembersResponse {
  members: WorkspaceMemberOut[];
  /**
   * Where the list came from: "control-point" (everyone in the workspace), or "scout" (Control Point
   * couldn't list them: only the members Scout knows, those who use Control Scout).
   */
  source: "control-point" | "scout";
  /** Whether the viewer may remove members here (an admin, and Control Point supports it). */
  canRemove: boolean;
  /** Why an admin can't remove members here right now (an older Control Point), else null. */
  removeUnavailable: string | null;
}

/** An older Control Point, without the members routes. */
export const REMOVE_UNSUPPORTED = "Removing members needs the latest Control Point.";
export const LAST_ADMIN = "That's the workspace's last admin. Make someone else an admin in Control Point first.";
export const LAST_ADMIN_SELF = "You're the workspace's last admin. Make someone else an admin in Control Point before you leave.";
