// Checks the published packs (/packs/latest.json) against the seasons saved on this device, in the
// background: soon after the app starts, when the tab comes back into focus, when the connection returns and
// every hour, never more than once every ten minutes. Only on a device with a saved season. What it does with
// a newer release follows the person's settings (updatePolicy.ts): ask (an inbox item and one pop-up per
// release) or download automatically, on Wi-Fi only or on any connection. Downloads go through saveSeason, so
// they're verified and a failed one never replaces the saved copy.
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { usePersonal } from "../personal";
import { useFlag } from "../flags";
import { fetchManifest, type PackManifest } from "../packs";
import type { ConnectionInfo } from "../packPolicy";
import { toast } from "../../components/ui/sonner";
import { useSavedSeasons } from "./saved";
import { decideUpdate, seasonList, shouldPopUp, updatePrefs, updateQuestion } from "./updatePolicy";
import { applyUpdate, laterRelease, markLater, markShown, setUpdate, shownRelease, updateNow, updateSnapshot } from "./updateStore";

const FIRST_CHECK_MS = 8_000;
const EVERY_MS = 60 * 60_000;
/** Focus and the hourly timer check at most this often. */
const MIN_GAP_MS = 10 * 60_000;
/** An automatic download that failed (no space, a dropped connection) waits this long before trying the same release again. */
const RETRY_MS = 60 * 60_000;
/** The pop-up stays this long (it shows once per release; the inbox item and the Download page keep it after). */
const POPUP_MS = 60_000;

type Connection = EventTarget & ConnectionInfo;
const connection = () => (navigator as Navigator & { connection?: Connection }).connection;

export function SeasonUpdateWatcher(): null {
  const { state } = usePersonal();
  const { mode, network } = updatePrefs(state.settings);
  const packsOn = useFlag("offlinePacks");
  const any = useSavedSeasons().length > 0;
  const { pathname } = useLocation();
  const live = useRef({ mode, network, pathname });
  live.current = { mode, network, pathname };
  const decideRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!packsOn || !any) { setUpdate(null, "none"); return; }
    let manifest: PackManifest | null = null, lastCheck = 0, stopped = false;
    const tried = new Map<string, number>();

    const decide = () => {
      if (stopped || !manifest) return;
      setUpdate(manifest, "none"); // the updates in this manifest against what's saved now
      const { key } = updateSnapshot();
      const { mode, network, pathname } = live.current;
      const conn = connection();
      const action = decideUpdate({ mode, network, connection: conn, online: navigator.onLine !== false, key, dismissed: laterRelease() });
      setUpdate(manifest, action);
      const snap = updateSnapshot();
      if (!key) return;
      if (action === "download") {
        if (Date.now() - (tried.get(key) ?? 0) < RETRY_MS) return;
        tried.set(key, Date.now());
        void applyUpdate(snap).then((r) => {
          if (r?.saved.length && !r.failed.length) toast.success(`Offline data for ${seasonList(snap.rows)} updated automatically`);
        }, () => { /* quiet: the next check tries again */ });
      } else if (shouldPopUp(action, key, shownRelease(), laterRelease())) {
        markShown(key);
        if (pathname === "/download") return; // the page itself shows the update
        toast(`${updateQuestion(snap.updates)} Update now?`, {
          id: "season-update", duration: POPUP_MS,
          description: "It downloads now and replaces the saved copy once it's verified.",
          action: { label: "Update now", onClick: () => void updateNow(updateSnapshot()) },
          cancel: { label: "Later", onClick: () => markLater(key) },
        });
      }
    };
    decideRef.current = decide;

    const check = async (force = false) => {
      if (stopped || navigator.onLine === false) return;
      if (!force && Date.now() - lastCheck < MIN_GAP_MS) return decide();
      lastCheck = Date.now();
      try { manifest = await fetchManifest(); } catch { return; } // offline, paused, none published: next time
      decide();
    };

    const first = window.setTimeout(() => void check(true), FIRST_CHECK_MS);
    const hourly = window.setInterval(() => void check(), EVERY_MS);
    const onFocus = () => { if (document.visibilityState !== "hidden") void check(); };
    const onOnline = () => void check(true);
    const conn = connection();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    conn?.addEventListener?.("change", decide); // onto Wi-Fi: a waiting update may go now
    return () => {
      stopped = true;
      decideRef.current = () => {};
      clearTimeout(first);
      clearInterval(hourly);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
      conn?.removeEventListener?.("change", decide);
    };
  }, [packsOn, any]);

  // A setting changed (here or synced from another device): decide again with what the last check found.
  useEffect(() => { decideRef.current(); }, [mode, network]);
  return null;
}
