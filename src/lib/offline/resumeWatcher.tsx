// Picks up the downloads a dropped connection paused (resumeMarks.ts) as soon as the connection check finds
// internet again (lib/connection.ts), without waiting for the person to tap Resume: only the ones they started
// themselves, never one they deleted, and only on a connection their network setting allows (Wi-Fi only keeps
// it off mobile data; a switch to Wi-Fi picks it up then). The downloader asks only for the missing bytes.
import { useEffect, useRef } from "react";
import { usePersonal } from "../personal";
import { useFlag } from "../flags";
import type { ConnectionInfo } from "../packPolicy";
import { connection, onInternetChange, onInternetConfirmed } from "../connection";
import { toast } from "../../components/ui/sonner";
import { seasonLabel } from "../../shared/format";
import { resumeMarks } from "./resumeMarks";
import { resumeAllowed, updatePrefs } from "./updatePolicy";

type Connection = EventTarget & ConnectionInfo;
const conn = () => (typeof navigator === "undefined" ? undefined : (navigator as Navigator & { connection?: Connection }).connection);

const labelOf = (key: string) => key === "lite:lite" ? "Predictions for every team" : `${seasonLabel(Number(key.split(":")[1]))} season`;

export function DownloadResumer(): null {
  const { state, user, providers, syncReady } = usePersonal();
  const { network } = updatePrefs(state.settings);
  // Whose network setting this is is known (as for automatic updates): a Wi-Fi only choice made on another device
  // has arrived before anything picks up on mobile data.
  const settled = providers !== null && (!user || syncReady);
  const packsOn = useFlag("offlinePacks");
  const live = useRef({ network, settled, packsOn });
  live.current = { network, settled, packsOn };
  const kickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    // Asked before loading anything, and again before each download: the phone may have moved off Wi-Fi meanwhile.
    const allowed = () => !stopped && live.current.packsOn && resumeAllowed(live.current.network, conn());
    const kick = () => {
      if (!live.current.settled || connection().internet !== "yes" || !allowed() || !resumeMarks().length) return;
      void import("./resume").then(async (r) => {
        for (const t of await r.resumePaused(allowed)) {
          if (t.saved) toast.success(`${labelOf(t.key)} saved on this device`, { description: "The download picked up where it stopped once the connection was back." });
        }
      }).catch(() => { /* the person's own Resume still works */ });
    };
    kickRef.current = kick;
    const offChange = onInternetChange((now) => { if (now === "yes") kick(); });
    const offConfirmed = onInternetConfirmed(kick);
    // Moving onto Wi-Fi (Wi-Fi only) lets a held one go.
    const c = conn();
    c?.addEventListener?.("change", kick);
    kick();
    return () => { stopped = true; kickRef.current = () => {}; offChange(); offConfirmed(); c?.removeEventListener?.("change", kick); };
  }, []);

  // The setting arriving (a signed-in account's), or offline packs switched back on.
  useEffect(() => { kickRef.current(); }, [settled, packsOn, network]);
  return null;
}
