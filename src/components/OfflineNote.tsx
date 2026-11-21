// Offline data in use, said where it's seen.
// OfflineNote, "Offline: from your saved 2025–26 data", above a page answered
// from a season saved on this device (lib/offline) instead of the server.
// The top bar's one offline indicator ("Offline · updated 8:09 PM") is ConnectionPill in ConnectionStatus.tsx.
// "Offline" only when the connection check found no internet. Saved data on screen while it hasn't is a slow
// connection: the server's answer is still on its way and replaces it (lib/api.ts awaitLate), and the note says so.

/** How a saved-data note starts and ends: offline (the check found no internet), or only slow. */
export function useSavedWords(): { offline: boolean; lead: string; tail: string } {
  const offline = shownOffline(useConnection());
  return offline
    ? { offline, lead: "Offline", tail: "It refreshes when you're back online." }
    : { offline, lead: "Slow connection, showing saved data", tail: "The live data replaces it as soon as it arrives." };
}
import { SignalLow, WifiOff } from "lucide-react";
import { shownOffline, useConnection } from "../lib/connection";
import { Link } from "react-router-dom";
import { offlineSource } from "../lib/offline/saved";
import { ago, dayDate, dayTime, seasonLabel } from "../lib/format";
import { SnapshotBanner } from "./offline/Snapshot";
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
  const words = useSavedWords();
  const Icon = words.offline ? WifiOff : SignalLow;
  const src = offlineSource(data);
  if (!src) return null;
  if (what && !src.bundle) {
    const when = at ?? src.dataAsOf;
    return (
      <p role="status" className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
        <Icon className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
        <span>
          {words.lead}: {what}{when ? ` as of ${dayTime(when)}` : ""}, from your saved {seasonLabel(src.season)} data (saved {ago(new Date(src.savedAt).toISOString())}).
          {" "}{words.tail}{" "}
          <Link to="/download" className="underline">Saved seasons</Link>
        </span>
      </p>
    );
  }
  if (src.bundle) {
    // From an event-day bundle: its time and age, always (docs/event-bundle.md).
    return (
      <SnapshotBanner at={src.dataAsOf ?? src.bundle.builtAt} className={className}>
        {words.offline ? "No signal, so this is your event-day bundle; live data takes over as soon as it loads." : "Slow connection, so this is your event-day bundle while the live data loads; it takes over as soon as it arrives."} <Link to="/download" className="underline">Bundles</Link>
      </SnapshotBanner>
    );
  }
  if (src.kept && !src.savedAt) {
    // Nothing loaded for it on this device (a team added with no signal): who it is, no stats yet.
    return (
      <p role="status" data-offline-kept className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
        <Icon className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
        <span>{words.offline ? "Offline: stats for these teams need a connection. They load when you're back online." : "Slow connection: stats for these teams are still loading."}</span>
      </p>
    );
  }
  if (src.kept) {
    // The last answer this device loaded (lib/offline/kept.ts): when, and that it refreshes.
    return (
      <p role="status" data-offline-kept className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
        <Icon className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
        <span>{words.lead}: last loaded on this device at {keptClock(src.savedAt)} ({ago(new Date(src.savedAt).toISOString())}). {words.tail}</span>
      </p>
    );
  }
  return (
    <p role="status" className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
      <Icon className="mt-px size-3.5 shrink-0 text-info" aria-hidden />
      <span>
        {words.lead}: from your saved {seasonLabel(src.season)} data (saved {ago(new Date(src.savedAt).toISOString())}
        {src.dataAsOf ? `, results as of ${dayDate(src.dataAsOf)}` : ""}). {words.tail}{" "}
        <Link to="/download" className="underline">Saved seasons</Link>
      </span>
    </p>
  );
}
