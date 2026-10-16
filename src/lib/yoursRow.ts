// The "My team" row under YOURS (sidebar, the phone's tab bar and its More menu).
//
// It's the workspace entry point (Sushil's wording, exactly):
// - exactly one Control Point workspace: "My team", opening that workspace's scout space;
// - more than one: "My teams", opening a picker of the workspaces;
// - none, signed out, workspace scouting switched off, or Control Point's answer unknown: today's row,
//   "My team", the followed-team dashboard (/my-team).
// It counts workspaces, never FTC team numbers. The followed-team dashboard stays at /my-team, linked
// from the team page and Settings for workspace users.
import { useLocation } from "react-router-dom";
import { useFlag } from "./flags";
import { usePersonal, type AccountUser } from "./personal";
import { PERSONAL_PARAM, scoutSpaceHref, workspacesOf, type WorkspaceSpace } from "./scoutSpace";

export const FOLLOWED_TEAM_PATH = "/my-team";

export type YoursRow =
  | { kind: "followed"; label: "My team"; to: string }
  | { kind: "workspace"; label: "My team"; to: string; workspace: WorkspaceSpace }
  | { kind: "picker"; label: "My teams"; workspaces: WorkspaceSpace[] };

/** What the row is for this account (pure). `enabled`: the workspaceScouting flag. */
export function yoursRow(user: AccountUser | null, enabled: boolean): YoursRow {
  const { list, known } = workspacesOf(user);
  if (!user || !enabled || !known || list.length === 0) return { kind: "followed", label: "My team", to: FOLLOWED_TEAM_PATH };
  if (list.length === 1) return { kind: "workspace", label: "My team", to: scoutSpaceHref(list[0].id), workspace: list[0] };
  return { kind: "picker", label: "My teams", workspaces: list };
}

/** Is the page on screen the row's? (A workspace's scout space, or the followed-team page.) */
export function yoursRowActive(row: YoursRow, pathname: string, search: string): boolean {
  if (row.kind === "followed") return /^\/my-team\/?$/i.test(pathname);
  if (!/^\/scout\/?$/i.test(pathname)) return false;
  const space = new URLSearchParams(search).get("space");
  if (!space || space === PERSONAL_PARAM) return false;
  return row.kind === "workspace" ? row.workspace.id === space : row.workspaces.some((w) => w.id === space);
}

/** The row for the signed-in account, and whether it's the page on screen. */
export function useYoursRow(): { row: YoursRow; active: boolean } {
  const { user } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const loc = useLocation();
  const row = yoursRow(user, enabled);
  return { row, active: yoursRowActive(row, loc.pathname, loc.search) };
}
