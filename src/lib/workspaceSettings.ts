// A workspace's settings on the device (Task 6, Tier 2; server/scout/settings.ts, docs/settings.md).
//
// - Read by every member, written by admins only (the server checks the role).
// - Cached on the device by settings version (localStorage cs-scout-wss:<workspace>), so a form opens
//   with the last defaults seen, offline too. Refetched on open (a 304 when unchanged: the ETag), when
//   the live stream says they changed (`event: settings`), and when a template notice carries a newer
//   settings version than the one cached (scoutLive.ts).
// - The cache is a copy of the server's, never sent back: only an admin's explicit save goes up.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { ENTRY_POLICY, NO_DEFAULTS, readDefaults, type DroppedSetting, type WorkspaceDefaults, type WorkspaceSettings } from "../shared/workspaceSettings";

/** Window event: a workspace's settings changed (detail: { space, settingsVersion? }). Open forms and Settings refetch. */
export const SETTINGS_CHANGED = "cs-workspace-settings";
export interface SettingsChange { space: string; settingsVersion?: number }
export const announceSettingsChange = (c: SettingsChange) => window.dispatchEvent(new CustomEvent<SettingsChange>(SETTINGS_CHANGED, { detail: c }));

const CACHE = (ws: string) => `cs-scout-wss:${ws}`;

function isSettings(v: unknown): v is WorkspaceSettings {
  return !!v && typeof v === "object" && Number.isSafeInteger((v as WorkspaceSettings).settingsVersion) && typeof (v as WorkspaceSettings).workspaceId === "string";
}
/** A cached or received copy, re-read field by field (a stale or hand-edited copy can't break a form). */
function normalize(v: WorkspaceSettings): WorkspaceSettings {
  return {
    workspaceId: v.workspaceId, settingsVersion: v.settingsVersion, defaults: readDefaults(v.defaults), entryPolicy: { ...ENTRY_POLICY },
    updatedAt: typeof v.updatedAt === "string" ? v.updatedAt : null, updatedBy: typeof v.updatedBy === "string" ? v.updatedBy : null,
  };
}

/** The settings last seen on this device for a workspace (null: never fetched here). */
export function cachedWorkspaceSettings(ws: string): WorkspaceSettings | null {
  try {
    const raw = localStorage.getItem(CACHE(ws));
    const v = raw ? JSON.parse(raw) as unknown : null;
    return isSettings(v) && v.workspaceId === ws ? normalize(v) : null;
  } catch { return null; }
}

/** Keep a copy on the device unless the one there is newer. */
export function rememberWorkspaceSettings(s: WorkspaceSettings) {
  const cur = cachedWorkspaceSettings(s.workspaceId);
  if (cur && cur.settingsVersion > s.settingsVersion) return;
  try { localStorage.setItem(CACHE(s.workspaceId), JSON.stringify(normalize(s))); } catch { /* storage full: fetched again next time */ }
}

const inflight = new Map<string, Promise<WorkspaceSettings>>();
/** GET the workspace's settings, deduped, kept on the device. */
export function fetchWorkspaceSettings(ws: string): Promise<WorkspaceSettings> {
  let p = inflight.get(ws);
  if (!p) {
    p = apiFetch<{ settings: WorkspaceSettings }>(`/api/scout/workspaces/${encodeURIComponent(ws)}/settings`).then((r) => {
      const s = normalize(r.settings);
      rememberWorkspaceSettings(s);
      return s;
    });
    inflight.set(ws, p);
    void p.catch(() => undefined).finally(() => inflight.delete(ws));
  }
  return p;
}

export type SettingsStatus = "none" | "loading" | "ready" | "offline";

/**
 * A workspace's settings: from the device at once, then from the server. Null space (Personal): none,
 * and the defaults are the app's own. `refresh` refetches.
 */
export function useWorkspaceSettings(space: string | null): { settings: WorkspaceSettings | null; defaults: WorkspaceDefaults; status: SettingsStatus; refresh: () => void } {
  const [state, setState] = useState(() => initial(space));
  const cur = state.key === (space ?? "") ? state : initial(space);
  const refresh = useCallback(() => {
    if (space == null) return;
    fetchWorkspaceSettings(space)
      .then((s) => setState((x) => (x.key === space ? { key: space, settings: s, status: "ready" } : x)))
      .catch(() => setState((x) => (x.key === space ? { ...x, status: "offline" } : x)));
  }, [space]);
  useEffect(() => {
    setState(initial(space));
    if (space == null) return;
    refresh();
    const changed = (ev: Event) => {
      const c = (ev as CustomEvent<SettingsChange>).detail;
      if (c?.space !== space) return;
      // A notice no newer than the copy on the device needs no request (a save here already stored it;
      // a template save carries the version too): show that copy.
      const have = cachedWorkspaceSettings(space);
      if (c.settingsVersion != null && have && have.settingsVersion >= c.settingsVersion) setState({ key: space, settings: have, status: "ready" });
      else refresh();
    };
    window.addEventListener(SETTINGS_CHANGED, changed);
    return () => window.removeEventListener(SETTINGS_CHANGED, changed);
  }, [space, refresh]);
  return { settings: cur.settings, defaults: cur.settings?.defaults ?? NO_DEFAULTS, status: cur.status, refresh };
}

function initial(space: string | null): { key: string; settings: WorkspaceSettings | null; status: SettingsStatus } {
  if (space == null) return { key: "", settings: null, status: "none" };
  return { key: space, settings: cachedWorkspaceSettings(space), status: "loading" };
}

/** Save an admin's change (PUT). Throws ApiError (409: another admin saved first; its body has theirs). */
export async function saveWorkspaceSettings(ws: string, body: { defaults: Partial<WorkspaceDefaults>; baseVersion: number }) {
  const r = await apiFetch<{ changed: boolean; settings: WorkspaceSettings; dropped: DroppedSetting[] }>(
    `/api/scout/workspaces/${encodeURIComponent(ws)}/settings`, { method: "PUT", json: body });
  const s = normalize(r.settings);
  rememberWorkspaceSettings(s);
  announceSettingsChange({ space: ws, settingsVersion: s.settingsVersion });
  return { ...r, settings: s };
}

/**
 * Where a new entry in a space starts. Personal: the page's season, no event (unchanged). A workspace:
 * its default event when it belongs to the season on screen (or the default has no season).
 */
export function newEntryEventCode(space: string | null, defaults: WorkspaceDefaults, season: number): string {
  if (space == null || !defaults.eventCode) return "";
  return defaults.season == null || defaults.season === season ? defaults.eventCode : "";
}
