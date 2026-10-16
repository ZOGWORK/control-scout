// Scout consensus on the team page and in Compare (v1.6 Task 1; the server side: server/scout/consensus.ts,
// the rules: src/shared/consensus.ts).
//
// - Only for a signed-in account with workspace scouting on: the workspaces asked about are the account's own
//   (/api/auth/me's list, workspacesOf), never anything from the URL, so the app never asks for another
//   workspace's consensus. Signed out, no workspaces, or the switch off: nothing shows and nothing is fetched.
// - Which workspace: the one remembered on this device for the Scout page (cs-scout-space, this account's), if
//   it's still one of the account's, else the account's first. A small switcher picks another (and remembers
//   it, so the Scout page opens on the same space).
// - Fresh enough: the server's answer may be up to ~60 s old for changes nothing announced; this page's copy
//   refetches every minute while visible, and soon after any scouting change on this device (a save, a pull,
//   a live entry from another member).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invalidate, markStale, qs, useApi, type ApiState } from "./api";
import { useFlag } from "./flags";
import { usePersonal } from "./personal";
import { SCOUT_CHANGED } from "./scouting";
import { readRememberedSpace, rememberSpace, workspacesOf, type WorkspaceSpace } from "./scoutSpace";
import type { ConsensusResponse } from "../shared/consensus";

const PREFIX = "/api/scout/workspaces/";
export const CONSENSUS_REFRESH_MS = 60_000;
const AFTER_CHANGE_MS = 1_500;

/** The consensus request for a workspace (members only on the server). */
export const consensusPath = (workspaceId: string, season: number, teams: number[]) =>
  `${PREFIX}${encodeURIComponent(workspaceId)}/consensus${qs({ season, teams: teams.join(",") })}`;

/** Which of the account's workspaces to show: the remembered one if it's still theirs, else the first. */
export function pickWorkspace(list: WorkspaceSpace[], remembered: { id: string; account?: number } | null, account: number | null): WorkspaceSpace | null {
  const r = remembered && (remembered.account == null || remembered.account === account) ? remembered.id : null;
  return list.find((w) => w.id === r) ?? list[0] ?? null;
}

export interface Consensus {
  /** The account's workspaces (the switcher shows when there's more than one). */
  workspaces: WorkspaceSpace[];
  workspace: WorkspaceSpace;
  select(id: string): void;
  state: ApiState<ConsensusResponse>;
}

/** The consensus of the account's chosen workspace on these teams, or null when there's none to show. */
export function useConsensus(teams: number[], season: number | null): Consensus | null {
  const { user } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const userId = user?.id ?? null;
  const { list } = useMemo(() => workspacesOf(user), [user]);
  const [chosen, setChosen] = useState<{ id: string; account: number | null } | null>(null);
  const remembered = useMemo(() => (chosen && chosen.account === userId ? { id: chosen.id, account: userId ?? undefined } : readRememberedSpace()), [chosen, userId]);
  const workspace = enabled && user ? pickWorkspace(list, remembered, userId) : null;
  const key = teams.join(",");
  const path = workspace && season && teams.length ? consensusPath(workspace.id, season, teams) : null;
  const state = useApi<ConsensusResponse>(path);

  // Another account on this tab: drop whatever the last one had read (it may not be a member).
  const lastUser = useRef(userId);
  useEffect(() => {
    if (lastUser.current !== userId) invalidate(PREFIX);
    lastUser.current = userId;
  }, [userId]);

  // Refetch every minute while the page is visible, and soon after a scouting change on this device.
  useEffect(() => {
    if (!path) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const stale = () => { if (document.visibilityState === "visible") markStale(path); };
    const soon = () => { clearTimeout(t); t = setTimeout(stale, AFTER_CHANGE_MS); };
    const every = setInterval(stale, CONSENSUS_REFRESH_MS);
    document.addEventListener("visibilitychange", stale);
    window.addEventListener(SCOUT_CHANGED, soon);
    return () => { clearTimeout(t); clearInterval(every); document.removeEventListener("visibilitychange", stale); window.removeEventListener(SCOUT_CHANGED, soon); };
  }, [path, key]);

  const select = useCallback((id: string) => {
    const w = list.find((x) => x.id === id);
    if (!w) return;
    rememberSpace(w.id, w.name, userId);
    setChosen({ id: w.id, account: userId });
  }, [list, userId]);

  if (!workspace || !path) return null;
  return { workspaces: list, workspace, select, state };
}

/** The Scout page, on this workspace, with a new entry for the team open. */
export const scoutTeamHref = (workspaceId: string, team: number, season: number) =>
  `/scout${qs({ space: workspaceId, team, season, new: 1 })}`;
