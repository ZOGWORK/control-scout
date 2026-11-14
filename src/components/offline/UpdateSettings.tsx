// The two offline-update settings (personal, so they sync for signed-in accounts): automatic updates or not, and Wi-Fi
// only or mobile data too. Shown in one place, Settings › Network & offline (components/settings/NetworkSection.tsx);
// lib/offline/updatePolicy.ts says what they do.
import { useSyncExternalStore } from "react";
import { usePersonal } from "../../lib/personal";
import type { ConnectionInfo } from "../../lib/packPolicy";
import { updatePrefs, type UpdateMode, type UpdateNetwork } from "../../lib/offline/updatePolicy";

export function useUpdatePrefs() {
  const { state, update } = usePersonal();
  const prefs = updatePrefs(state.settings);
  return {
    ...prefs,
    setMode: (v: UpdateMode) => update("settings", (x) => ({ ...x, offlineUpdates: v })),
    setNetwork: (v: UpdateNetwork) => update("settings", (x) => ({ ...x, offlineNetwork: v })),
  };
}

type Connection = EventTarget & ConnectionInfo;
const conn = () => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: Connection }).connection);
// One string per state, so the snapshot only changes when the connection does.
let last = "";
let lastInfo: ConnectionInfo | null = null;
function snapshot(): ConnectionInfo | null {
  const c = conn();
  const s = c ? `${c.type ?? ""}|${c.saveData ? 1 : 0}|${c.effectiveType ?? ""}` : "";
  if (s !== last) { last = s; lastInfo = c ? { type: c.type, saveData: c.saveData, effectiveType: c.effectiveType } : null; }
  return lastInfo;
}
function subscribe(f: () => void) {
  const c = conn();
  c?.addEventListener?.("change", f);
  return () => c?.removeEventListener?.("change", f);
}
/** navigator.connection as it is now (null where the browser has none), updated when it changes. */
export function useConnection(): ConnectionInfo | null { return useSyncExternalStore(subscribe, snapshot, () => null); }
