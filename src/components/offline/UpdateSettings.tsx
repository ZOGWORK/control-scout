// The two offline-update settings (personal, so they sync for signed-in accounts): "When updates are out" and
// "Download updates on". Shown on the Download page and in Settings › Offline data; lib/offline/updatePolicy.ts
// says what they do.
import { useSyncExternalStore } from "react";
import { usePersonal } from "../../lib/personal";
import type { ConnectionInfo } from "../../lib/packPolicy";
import { netKind, updatePrefs, type UpdateMode, type UpdateNetwork } from "../../lib/offline/updatePolicy";
import { ToggleGroup, ToggleGroupItem } from "../ui/controls";

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

export function UpdateModeToggle({ value, onChange }: { value: UpdateMode; onChange: (v: UpdateMode) => void }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => { if (v) onChange(v as UpdateMode); }} aria-label="When updates are out">
      <ToggleGroupItem value="ask">Ask me</ToggleGroupItem>
      <ToggleGroupItem value="auto">Download automatically</ToggleGroupItem>
    </ToggleGroup>
  );
}

export function UpdateNetworkToggle({ value, onChange }: { value: UpdateNetwork; onChange: (v: UpdateNetwork) => void }) {
  return (
    <ToggleGroup type="single" value={value} onValueChange={(v) => { if (v) onChange(v as UpdateNetwork); }} aria-label="Download updates on">
      <ToggleGroupItem value="wifi">Wi-Fi only</ToggleGroupItem>
      <ToggleGroupItem value="any">Wi-Fi and mobile data</ToggleGroupItem>
    </ToggleGroup>
  );
}

/** What this browser says about the connection, for the network setting's description. */
export function connectionNote(c: ConnectionInfo | null): string {
  const kind = netKind(c);
  if (kind === "wifi") return "This device is on Wi-Fi now.";
  if (kind === "cellular") return "This device is on mobile data now.";
  return "This browser doesn't tell sites whether it's on Wi-Fi or mobile data, so with Wi-Fi only you're asked before a season downloads. Offline predictions (a small pack) still save themselves.";
}
