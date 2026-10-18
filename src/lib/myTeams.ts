// "My teams": the FTC teams the signed-in account is on or manages, from what Control Point sends with
// /api/auth/me (docs/shared-accounts.md). Nothing here is guessed or stored: it's the account's
// Control Point workspaces, each with the FTC team number its Control Point team has on file.
//
// Control Point builds `controlPoint.teams` (name + FTC number) and `controlPoint.workspaces` (id, name, role)
// from the same rows, in the same order. Scout keeps at most 10 teams, and keeps a workspace deleted in
// Control Point in the workspace list only (read-only), so the two lists are paired in order and by name,
// never by position alone. A workspace with no paired number is listed as "no team number".
import type { AccountUser } from "./personal";
import { workspacesOf, type WorkspaceSpace } from "./scoutSpace";

/** One FTC team: its number and the account's workspaces for it (usually one). */
export interface MyTeam { teamNumber: number; workspaces: WorkspaceSpace[] }

export interface MyTeams {
  /** FTC teams, admin ones first, then in Control Point's order. */
  teams: MyTeam[];
  /** Workspaces with no FTC team number in Control Point. */
  unnumbered: WorkspaceSpace[];
  /** False when this device can't tell (signed out, Control Point unreachable, an older server). */
  known: boolean;
}

const sameName = (a: unknown, b: string) => typeof a === "string" && a.trim() === b.trim();
const ftcNumber = (n: unknown) => (typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 999_999 ? n : null);

/** The account's FTC teams (pure). */
export function myTeamsOf(user: AccountUser | null): MyTeams {
  const { list, known } = workspacesOf(user);
  const raw = user?.controlPoint?.teams;
  const teams = Array.isArray(raw) ? raw.filter((t) => !!t && typeof t === "object") : [];
  const byNumber = new Map<number, WorkspaceSpace[]>();
  const unnumbered: WorkspaceSpace[] = [];
  let next = 0;
  for (const w of list) {
    // Gone from Control Point: not a team the account is on any more (its read-only space stays under Scout).
    if (w.orphaned?.reason === "deleted") continue;
    const k = teams.findIndex((t, i) => i >= next && sameName(t.name, w.name));
    const n = k >= 0 ? ftcNumber(teams[k].teamNumber) : null;
    if (k >= 0) next = k + 1;
    if (n == null) { unnumbered.push(w); continue; }
    byNumber.set(n, [...(byNumber.get(n) ?? []), w]);
  }
  const out = [...byNumber].map(([teamNumber, workspaces]) => ({ teamNumber, workspaces }));
  const admin = (t: MyTeam) => (t.workspaces.some((w) => w.role === "admin") ? 0 : 1);
  return { teams: out.map((t, i) => ({ t, i })).sort((a, b) => admin(a.t) - admin(b.t) || a.i - b.i).map((x) => x.t), unnumbered, known };
}
