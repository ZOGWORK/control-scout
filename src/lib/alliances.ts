// Scouting alliances on the Scout page (docs/alliances.md; the server: server/scout/alliances.ts). Every request
// names the reader's own workspace; the server checks membership there and that the link is active.
import { useEffect } from "react";
import { apiFetch, invalidate, qs, useApi, type ApiState } from "./api";
import type {
  Alliance, AllianceConsensusResponse, AllianceInviteResponse, AlliancePicklistResponse, AllianceShared, AlliancesResponse,
} from "../shared/alliances";

const base = (ws: string) => `/api/scout/workspaces/${encodeURIComponent(ws)}/alliances`;
export const alliancesPath = (ws: string, season: number) => `${base(ws)}${qs({ season })}`;
export const allianceSharedPath = (ws: string, id: number) => `${base(ws)}/${id}/shared`;
export const allianceConsensusPath = (ws: string, id: number, teams: number[]) => `${base(ws)}/${id}/consensus${qs({ teams: teams.join(",") })}`;
export const alliancePicklistPath = (ws: string, id: number) => `${base(ws)}/${id}/picklist`;

/** How often an open alliance view asks again: the partner's scouting doesn't reach this workspace's stream. */
export const ALLIANCE_REFRESH_MS = 30_000;

/** This workspace's links this season (null: none to ask, e.g. Personal). */
export function useAlliances(ws: string | null, season: number): ApiState<AlliancesResponse> {
  return useApi<AlliancesResponse>(ws ? alliancesPath(ws, season) : null);
}

/** The active link to show: the one at `eventCode` if there is one, else the first active one. */
export function activeAlliance(list: Alliance[] | undefined, eventCode?: string | null): Alliance | null {
  const active = (list ?? []).filter((a) => a.status === "active");
  return active.find((a) => eventCode && a.eventCode === eventCode.toUpperCase()) ?? active[0] ?? null;
}

/** An answer that's asked again every ALLIANCE_REFRESH_MS while it's on screen. */
export function usePolled<T>(path: string | null): ApiState<T> {
  const st = useApi<T>(path);
  const { reload } = st;
  useEffect(() => {
    if (!path) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void reload(); }, ALLIANCE_REFRESH_MS);
    return () => clearInterval(t);
  }, [path, reload]);
  return st;
}

export const useAllianceShared = (ws: string | null, id: number | null) => usePolled<AllianceShared>(ws && id ? allianceSharedPath(ws, id) : null);
export const useAllianceConsensus = (ws: string | null, id: number | null, teams: number[]) =>
  usePolled<AllianceConsensusResponse>(ws && id && teams.length ? allianceConsensusPath(ws, id, teams) : null);
export const useAlliancePicklist = (ws: string | null, id: number | null) => usePolled<AlliancePicklistResponse>(ws && id ? alliancePicklistPath(ws, id) : null);

const changed = (ws: string) => invalidate(base(ws));

export async function inviteAlliance(ws: string, season: number, eventCode: string, keepCopies: boolean): Promise<AllianceInviteResponse> {
  const r = await apiFetch<AllianceInviteResponse>(base(ws), { method: "POST", json: { season, eventCode, keepCopies } });
  changed(ws);
  return r;
}
export async function acceptAlliance(ws: string, code: string, keepCopies: boolean): Promise<{ alliance: Alliance }> {
  const r = await apiFetch<{ alliance: Alliance }>(`${base(ws)}/accept`, { method: "POST", json: { code, keepCopies } });
  changed(ws);
  return r;
}
export async function endAlliance(ws: string, id: number): Promise<{ alliance: Alliance }> {
  const r = await apiFetch<{ alliance: Alliance }>(`${base(ws)}/${id}/end`, { method: "POST", json: {} });
  changed(ws);
  return r;
}
