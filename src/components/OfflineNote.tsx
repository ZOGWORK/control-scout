// Offline data in use, said where it's seen:
// - OfflineNote, "Offline: from your saved 2025–26 data", above a page answered
//   from a season saved on this device (lib/offline) instead of the server;
// - OfflineStatus, a small "Offline, showing saved data" badge in the header
//   while anything on screen comes from data saved on this device (a saved
//   season, or the lite pack's prediction). It goes as soon as the server
//   answers again (lib/api.ts decides; online, the packs never run).
import { WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { useOfflineMode } from "../lib/api";
import { offlineSource } from "../lib/offline/saved";
import { ago, dayDate, dayTime, seasonLabel } from "../lib/format";
import { SnapshotBanner } from "./offline/Snapshot";
import { Badge } from "./ui/basic";
import { cn } from "./cn";

/** When a kept answer was loaded: the time today, else the day and time. */
export function keptClock(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const today = d.toDateString() === now.toDateString();
  return d.toLocaleString(undefined, today ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** `what` ("Rankings"): a leaderboard's own words, with its data time `at` (else the saved data's): "Offline: Rankings
 *  as of Nov 13, 8:09 PM, from your saved 2026–27 data." */
export function OfflineNote({ data, className, what, at }: { data: unknown; className?: string; what?: string; at?: string | null }) {
  const src = offlineSource(data);
  if (!src) return null;
  if (what && !src.bundle) {
    const when = at ?? src.dataAsOf;
    return (
      <p role="status" className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
        <WifiOff className="mt-px size-3.5 shrink-0 text-info" />
        <span>
          Offline: {what}{when ? ` as of ${dayTime(when)}` : ""}, from your saved {seasonLabel(src.season)} data (saved {ago(new Date(src.savedAt).toISOString())}).
          It refreshes when you're back online.{" "}
          <Link to="/download" className="underline">Saved seasons</Link>
        </span>
      </p>
    );
  }
  if (src.bundle) {
    // From an event-day bundle: its time and age, always (docs/event-bundle.md).
    return (
      <SnapshotBanner at={src.dataAsOf ?? src.bundle.builtAt} className={className}>
        No signal, so this is your event-day bundle; live data takes over as soon as it loads. <Link to="/download" className="underline">Bundles</Link>
      </SnapshotBanner>
    );
  }
  if (src.kept && !src.savedAt) {
    // Nothing loaded for it on this device (a team added with no signal): who it is, no stats yet.
    return (
      <p role="status" data-offline-kept className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
        <WifiOff className="mt-px size-3.5 shrink-0 text-info" />
        <span>Offline: stats for these teams need a connection. They load when you're back online.</span>
      </p>
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

export function OfflineStatus() {
  const on = useOfflineMode();
  // Always in the tree, so screen readers hear it appear and go.
  return (
    <span role="status" className="shrink-0 empty:hidden">
      {on && (
        <Link to="/download" title="No signal: this is the data saved on this device. It switches back when the server answers." className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {/* Phones: the icon alone, so the top bar's right side stays clear of the centred logo (Shell). */}
          <Badge variant="info" className="gap-1.5 py-1 max-md:px-1.5">
            <WifiOff aria-hidden="true" />
            <span className="max-md:sr-only">Offline<span className="max-sm:sr-only">, showing saved data</span></span>
          </Badge>
        </Link>
      )}
    </span>
  );
}
