// Offline data in use, said where it's seen.
// OfflineNote, "Offline: from your saved 2025–26 data", above a page answered
// from a season saved on this device (lib/offline) instead of the server.
// The top bar's one offline indicator ("Offline · updated 8:09 PM") is ConnectionPill in ConnectionStatus.tsx.
import { WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { offlineSource } from "../lib/offline/saved";
import { ago, dayDate, seasonLabel } from "../lib/format";
import { SnapshotBanner } from "./offline/Snapshot";
import { cn } from "./cn";

/** When a kept answer was loaded: the time today, else the day and time. */
export function keptClock(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const today = d.toDateString() === now.toDateString();
  return d.toLocaleString(undefined, today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function OfflineNote({ data, className }: { data: unknown; className?: string }) {
  const src = offlineSource(data);
  if (!src) return null;
  if (src.bundle) {
    // From an event-day bundle: its time and age, always (docs/event-bundle.md).
    return (
      <SnapshotBanner at={src.dataAsOf ?? src.bundle.builtAt} className={className}>
        No signal, so this is your event-day bundle; live data takes over as soon as it loads. <Link to="/download" className="underline">Bundles</Link>
      </SnapshotBanner>
    );
  }
  if (src.kept) {
    // The last answer this device loaded (lib/offline/kept.ts): when, and that it refreshes.
    return (
      <p role="status" data-offline-kept className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
        <WifiOff className="mt-px size-3.5 shrink-0 text-info" />
        <span>Offline: last loaded on this device at {keptClock(src.savedAt)} ({ago(new Date(src.savedAt).toISOString())}). It refreshes when you're back online.</span>
      </p>
    );
  }
  return (
    <p role="status" className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
      <WifiOff className="mt-px size-3.5 shrink-0 text-info" />
      <span>
        Offline: from your saved {seasonLabel(src.season)} data (saved {ago(new Date(src.savedAt).toISOString())}
        {src.dataAsOf ? `, results as of ${dayDate(src.dataAsOf)}` : ""}). It refreshes when you're back online.{" "}
        <Link to="/download" className="underline">Saved seasons</Link>
      </span>
    </p>
  );
}
