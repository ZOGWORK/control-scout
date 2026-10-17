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
import { ago, seasonLabel } from "../lib/format";
import { Badge } from "./ui/basic";
import { cn } from "./cn";

export function OfflineNote({ data, className }: { data: unknown; className?: string }) {
  const src = offlineSource(data);
  if (!src) return null;
  return (
    <p role="status" className={cn("mb-4 flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
      <WifiOff className="mt-px size-3.5 shrink-0 text-info" />
      <span>
        Offline: from your saved {seasonLabel(src.season)} data (saved {ago(new Date(src.savedAt).toISOString())}
        {src.dataAsOf ? `, results as of ${new Date(src.dataAsOf).toLocaleDateString()}` : ""}). It refreshes when you're back online.{" "}
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
          <Badge variant="info" className="gap-1.5 py-1">
            <WifiOff aria-hidden="true" />
            Offline<span className="max-sm:sr-only">, showing saved data</span>
          </Badge>
        </Link>
      )}
    </span>
  );
}
