// Scout consensus on the team page and in Compare (v1.6 Task 1; the server side: server/scout/consensus.ts,
// the rules: src/shared/consensus.ts).
//
// - Only for a signed-in account with workspace scouting on: the workspaces asked about are the account's own
//   (/api/auth/me's list, workspacesOf), never anything from the URL, so the app never asks for another
//   workspace's consensus. Signed out, no workspaces, or the switch off: nothing shows and nothing is fetched.
// - Which workspace: the one remembered on this device for the Scout page (cs-scout-space, this account's), if
//   it's still one of the account's, else the account's first. A small switcher picks another (and remembers
//   it, so the Scout page opens on the same space).
// - Fresh enough: the server's answer may be up to ~60 s old for changes nothing announced; this page asks
//   again every minute while visible, and soon after any scouting change on this device (a save, a pull, a
//   live entry from another member). The latest answer always wins: a refusal or failure hides the block.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, qs, type ApiError } from "./api";
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

// The last answer per request, for this account only (dropped when another signs in), so going back to a page
// shows it at once while it's asked again. A refusal or failure drops it: an old summary is never shown as current.
const memo = new Map<string, unknown>();
let memoFor: number | null = null;
/** Tests: forget every answer. */
export function clearConsensusMemo() { memo.clear(); memoFor = null; }

export interface WorkspaceAnswerState<T> { data: T | undefined; error: ApiError | undefined; loading: boolean }
export type ConsensusState = WorkspaceAnswerState<ConsensusResponse>;

/**
 * The answer for `path`, asked now and on every refresh(). Unlike the shared page cache, the latest
 * outcome always wins: a refresh that's refused (403, paused) or fails hides the data it had.
 */
function useWorkspaceRequest<T>(path: string | null, account: number | null): { state: WorkspaceAnswerState<T>; refresh: () => void } {
  if (memoFor !== account) { memo.clear(); memoFor = account; }
  const [st, setSt] = useState<{ path: string | null; account: number | null; data?: T; error?: ApiError }>({ path: null, account: null });
  const seq = useRef(0);
  const refresh = useCallback(() => {
    if (!path) return;
    const my = ++seq.current;
    apiFetch<T>(path).then(
      (data) => { if (my !== seq.current) return; if (memoFor === account) memo.set(path, data); setSt({ path, account, data }); },
      (error: ApiError) => { if (my !== seq.current) return; memo.delete(path); setSt({ path, account, error }); },
    );
  }, [path, account]);
  useEffect(() => { refresh(); return () => { seq.current++; }; }, [refresh]);
  const mine = st.path === path && st.account === account;
  const data = mine ? st.data : path ? (memo.get(path) as T | undefined) : undefined;
  const error = mine ? st.error : undefined;
  return { state: { data, error, loading: !!path && !data && !error }, refresh };
}

export interface WorkspaceAnswer<T> {
  /** The account's workspaces (the switcher shows when there's more than one). */
  workspaces: WorkspaceSpace[];
  workspace: WorkspaceSpace;
  select(id: string): void;
  state: WorkspaceAnswerState<T>;
}
export type Consensus = WorkspaceAnswer<ConsensusResponse>;

/**
 * A members-only answer from the account's chosen workspace (`pathFor` builds the request for a workspace id;
 * null: nothing to ask), kept fresh as above. Null when there's no workspace to ask (signed out, none, or the
 * switch off).
 */
export function useWorkspaceAnswer<T>(pathFor: (workspaceId: string) => string | null): WorkspaceAnswer<T> | null {
  const { user } = usePersonal();
  const enabled = useFlag("workspaceScouting");
  const userId = user?.id ?? null;
  const { list } = useMemo(() => workspacesOf(user), [user]);
  const [chosen, setChosen] = useState<{ id: string; account: number | null } | null>(null);
  const remembered = useMemo(() => (chosen && chosen.account === userId ? { id: chosen.id, account: userId ?? undefined } : readRememberedSpace()), [chosen, userId]);
  const workspace = enabled && user ? pickWorkspace(list, remembered, userId) : null;
  const path = workspace ? pathFor(workspace.id) : null;
  const { state, refresh } = useWorkspaceRequest<T>(path, userId);

  // Ask again every minute while the page is visible, on coming back to it, and soon after a scouting change on this device.
  useEffect(() => {
    if (!path) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const again = () => { if (document.visibilityState === "visible") refresh(); };
    const soon = () => { clearTimeout(t); t = setTimeout(again, AFTER_CHANGE_MS); };
    const every = setInterval(again, CONSENSUS_REFRESH_MS);
    document.addEventListener("visibilitychange", again);
    window.addEventListener(SCOUT_CHANGED, soon);
    return () => { clearTimeout(t); clearInterval(every); document.removeEventListener("visibilitychange", again); window.removeEventListener(SCOUT_CHANGED, soon); };
  }, [path, refresh]);

  const select = useCallback((id: string) => {
    const w = list.find((x) => x.id === id);
    if (!w) return;
    rememberSpace(w.id, w.name, userId);
    setChosen({ id: w.id, account: userId });
  }, [list, userId]);

  if (!workspace || !path) return null;
  return { workspaces: list, workspace, select, state };
}

/** The consensus of the account's chosen workspace on these teams, or null when there's none to show. */
export function useConsensus(teams: number[], season: number | null): Consensus | null {
  return useWorkspaceAnswer<ConsensusResponse>((id) => (season && teams.length ? consensusPath(id, season, teams) : null));
}

/** The Scout page, on this workspace, with a new entry for the team open. */
export const scoutTeamHref = (workspaceId: string, team: number, season: number) =>
  `/scout${qs({ space: workspaceId, team, season, new: 1 })}`;
