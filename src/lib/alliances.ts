// Scouting alliances on the Scout page (docs/alliances.md; the server: server/scout/alliances.ts). Every request
// names the reader's own workspace; the server checks membership there and that the link is active.
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiFetch, markStale, prime, qs, useApi, type ApiState } from "./api";
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

/** The active link to show: the one at `eventCode` if there is one, else the first active one. */
export function activeAlliance(list: Alliance[] | undefined, eventCode?: string | null): Alliance | null {
  const active = (list ?? []).filter((a) => a.status === "active");
  return active.find((a) => eventCode && a.eventCode === eventCode.toUpperCase()) ?? active[0] ?? null;
}

/** A refusal (not a lost connection): the answer on screen is no longer the reader's to see. */
const isRefusal = (e: unknown) => e instanceof ApiError && !e.offline && [401, 403, 404, 410].includes(e.status);

/**
 * An answer that's asked again every ALLIANCE_REFRESH_MS while it's on screen. A refresh the server refuses (the
 * link ended, the partner's scouting or alliances were switched off, access lost) clears what's shown and shows the
 * refusal instead: the page cache alone would keep the earlier answer on screen as if it were current. A lost
 * connection keeps it (it's still the latest known).
 */
export function usePolled<T>(path: string | null): ApiState<T> {
  const st = useApi<T>(path);
  const [refused, setRefused] = useState<{ path: string; error: ApiError } | null>(null);
  const ask = useCallback(async () => {
    if (!path) return;
    try { prime(path, await apiFetch<T>(path)); setRefused(null); }
    catch (e) { if (isRefusal(e)) setRefused({ path, error: e as ApiError }); }
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") void ask(); }, ALLIANCE_REFRESH_MS);
    return () => clearInterval(t);
  }, [path, ask]);
  if (refused && refused.path === path) return { data: undefined, error: refused.error, loading: false, reload: ask };
  return { ...st, reload: async () => { await ask(); await st.reload(); } };
}

/**
 * This workspace's links this season (null: none to ask, e.g. Personal). Asked again while on screen: the other
 * workspace accepting, unlinking or the event ending changes it without anything reaching this device.
 */
export function useAlliances(ws: string | null, season: number): ApiState<AlliancesResponse> {
  return usePolled<AlliancesResponse>(ws ? alliancesPath(ws, season) : null);
}

export const useAllianceShared = (ws: string | null, id: number | null) => usePolled<AllianceShared>(ws && id ? allianceSharedPath(ws, id) : null);
export const useAllianceConsensus = (ws: string | null, id: number | null, teams: number[]) =>
  usePolled<AllianceConsensusResponse>(ws && id && teams.length ? allianceConsensusPath(ws, id, teams) : null);
export const useAlliancePicklist = (ws: string | null, id: number | null) => usePolled<AlliancePicklistResponse>(ws && id ? alliancePicklistPath(ws, id) : null);

/** After a change: what's on screen asks again, keeping what it shows meanwhile (never back to loading). */
const changed = (ws: string) => markStale(base(ws));

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
