// The "My team" row under YOURS (sidebar, the phone's tab bar and its More menu).
//
// - one or more Control Point workspaces: "My team" (one) or "My teams" (more), opening /my-teams, the
//   FTC teams the account is on or manages with their stats (src/lib/myTeams.ts). Each workspace's
//   shared scout space is a link from there, and from Scout's own space tabs.
// - none, signed out, workspace scouting switched off, or Control Point's answer unknown: today's row,
//   "My team", the followed-team dashboard (/my-team).
// It counts workspaces, never FTC team numbers. The followed-team dashboard stays at /my-team, linked
// from My teams, the team page and Settings for workspace users.
import { useLocation } from "react-router-dom";
import { useFlag } from "./flags";
import { usePersonal, type AccountUser } from "./personal";
import { workspacesOf } from "./scoutSpace";

export const FOLLOWED_TEAM_PATH = "/my-team";
export const MY_TEAMS_PATH = "/my-teams";

export type YoursRow =
  | { kind: "followed"; label: "My team"; to: string }
  | { kind: "teams"; label: "My team" | "My teams"; to: string };

/** What the row is for this account (pure). `enabled`: the workspaceScouting flag. */
export function yoursRow(user: AccountUser | null, enabled: boolean): YoursRow {
  const { list, known } = workspacesOf(user);
  if (!user || !enabled || !known || list.length === 0) return { kind: "followed", label: "My team", to: FOLLOWED_TEAM_PATH };
  return { kind: "teams", label: list.length === 1 ? "My team" : "My teams", to: MY_TEAMS_PATH };
}

/** Is the page on screen the row's? */
export function yoursRowActive(row: YoursRow, pathname: string): boolean {
  return row.kind === "followed" ? /^\/my-team\/?$/i.test(pathname) : /^\/my-teams\/?$/i.test(pathname);
}

/** The row for the signed-in account, and whether it's the page on screen. */
export function useYoursRow(): { row: YoursRow; active: boolean } {
  const { user } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const loc = useLocation();
  const row = yoursRow(user, enabled);
  return { row, active: yoursRowActive(row, loc.pathname) };
}
