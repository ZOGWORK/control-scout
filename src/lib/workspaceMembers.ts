// A workspace's members in Settings → Workspace (Task 9; server/scout/members.ts). Control Point is
// the source of truth: this lists what it says and asks it (through Scout's server) to remove someone.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import type { WorkspaceMembersResponse } from "../shared/workspaceMembers";

const url = (ws: string) => `/api/scout/workspaces/${encodeURIComponent(ws)}/members`;

export type MembersStatus = "loading" | "ready" | "error";

/** The members of a workspace, fetched when it's shown; `reload` asks again (after a removal). */
export function useWorkspaceMembers(ws: string): { data: WorkspaceMembersResponse | null; status: MembersStatus; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ ws: string; data: WorkspaceMembersResponse | null; status: MembersStatus; error: string | null }>({ ws, data: null, status: "loading", error: null });
  const gen = useRef(0);
  const load = useCallback(() => {
    const g = ++gen.current;
    setState((s) => (s.ws === ws ? { ...s, status: s.data ? "ready" : "loading" } : { ws, data: null, status: "loading", error: null }));
    apiFetch<WorkspaceMembersResponse>(url(ws))
      .then((data) => { if (gen.current === g) setState({ ws, data, status: "ready", error: null }); })
      .catch((e) => { if (gen.current === g) setState((s) => ({ ...s, ws, status: s.data ? "ready" : "error", error: e instanceof ApiError ? e.message : "Couldn't load the members." })); });
  }, [ws]);
  useEffect(() => { load(); }, [load]);
  const cur = state.ws === ws ? state : { ws, data: null, status: "loading" as const, error: null };
  return { data: cur.data, status: cur.status, error: cur.error, reload: load };
}

/** Ask Control Point (through Scout) to remove a member. Throws ApiError with the server's explanation. */
export async function removeWorkspaceMember(ws: string, accountId: number): Promise<{ ok: true; self: boolean }> {
  return apiFetch<{ ok: true; self: boolean }>(`${url(ws)}/remove`, { method: "POST", json: { accountId } });
}
