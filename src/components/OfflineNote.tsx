// "Offline: from your saved 2025–26 data" — shown above a page answered from
// a season saved on this device (lib/offline) instead of the server.
import { WifiOff } from "lucide-react";
import { Link } from "react-router-dom";
import { offlineSource } from "../lib/offline/saved";
import { ago, seasonLabel } from "../lib/format";
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
