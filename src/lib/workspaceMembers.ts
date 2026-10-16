// A workspace's members in Settings → Workspace (Task 9; server/scout/members.ts). Control Point is
// the source of truth: this lists what it says and asks it (through Scout's server) to remove someone.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { WorkspaceMembersResponse } from "../shared/workspaceMembers";

const url = (ws: string) => `/api/scout/workspaces/${encodeURIComponent(ws)}/members`;

export type MembersStatus = "loading" | "ready" | "error";

interface State { ws: string; data: WorkspaceMembersResponse | null; status: MembersStatus; error: string | null }

/**
 * The members of a workspace, fetched when it's shown. `reload` asks again; a reload that fails keeps
 * the list on screen with `error` set (the view shows both). `drop` takes someone off the list at once
 * (after a removal succeeded), so a failed reload can't leave them showing.
 */
export function useWorkspaceMembers(ws: string): { data: WorkspaceMembersResponse | null; status: MembersStatus; error: string | null; reload: () => void; drop: (accountId: number) => void } {
  const [state, setState] = useState<State>({ ws, data: null, status: "loading", error: null });
  const gen = useRef(0);
  const load = useCallback(() => {
    const g = ++gen.current;
    setState((s) => (s.ws === ws ? { ...s, status: s.data ? "ready" : "loading" } : { ws, data: null, status: "loading", error: null }));
    apiFetch<WorkspaceMembersResponse>(url(ws))
      .then((data) => { if (gen.current === g) setState({ ws, data, status: "ready", error: null }); })
      .catch((e) => { if (gen.current === g) setState((s) => ({ ...s, ws, status: s.data ? "ready" : "error", error: e instanceof ApiError ? e.message : "Couldn't load the members." })); });
  }, [ws]);
  useEffect(() => { load(); }, [load]);
  const drop = useCallback((accountId: number) => {
    setState((s) => (s.ws === ws && s.data ? { ...s, data: { ...s.data, members: s.data.members.filter((m) => m.accountId !== accountId) } } : s));
  }, [ws]);
  const cur = state.ws === ws ? state : { ws, data: null, status: "loading" as const, error: null };
  return { data: cur.data, status: cur.status, error: cur.error, reload: load, drop };
}

/** Ask Control Point (through Scout) to remove a member. Throws ApiError with the server's explanation. */
export async function removeWorkspaceMember(ws: string, accountId: number): Promise<{ ok: true; self: boolean }> {
  return apiFetch<{ ok: true; self: boolean }>(`${url(ws)}/remove`, { method: "POST", json: { accountId } });
}
