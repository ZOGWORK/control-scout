// Where saving stands, as the entry forms' sticky Save bar says it: every Save keeps the entry on this device first
// (offline-first, src/pages/ScoutPage.tsx), then it syncs when it can. The words follow the page's real sync
// state and pending count, never a "Synced" that hasn't happened: Saved on this device (no account), Saving…,
// Queued offline · 3 to sync, Sync failed · 3 to sync with Retry, or Saved once nothing waits.
import { Check, CloudOff, HardDrive, Loader2, RotateCw, TriangleAlert } from "lucide-react";
import { cn } from "../../cn";

/** The page's sync state: useScouting's status ("local": no account), with this space's pending count. */
export interface SaveSync {
  status: "local" | "idle" | "syncing" | "offline" | "error";
  pending: number;
  onRetry?: () => void;
}

export type SaveStateKind = "unsaved" | "device" | "saving" | "queued" | "failed" | "saved";

/** What the bar says. `savedHere`: this form has saved at least once (else it says how saving works). */
export function saveState(s: SaveSync, savedHere: boolean): { kind: SaveStateKind; text: string } {
  const toSync = `${s.pending} to sync`;
  if (s.status === "local") return savedHere ? { kind: "device", text: "Saved on this device" } : { kind: "unsaved", text: "Saves on this device, no signal needed" };
  if (s.status === "error") return { kind: "failed", text: s.pending ? `Sync failed · ${toSync}` : "Sync failed" };
  if (s.status === "offline") return s.pending ? { kind: "queued", text: `Queued offline · ${toSync}` } : savedHere ? { kind: "device", text: "Saved on this device · offline" } : { kind: "unsaved", text: "Offline: saves on this device" };
  if (s.status === "syncing" || s.pending) return { kind: "saving", text: s.pending ? `Saving… ${toSync}` : "Saving…" };
  return savedHere ? { kind: "saved", text: "Saved" } : { kind: "unsaved", text: "Saved on this device first, then synced" };
}

const ICON = { unsaved: HardDrive, device: HardDrive, saving: Loader2, queued: CloudOff, failed: TriangleAlert, saved: Check } as const;
const TONE: Record<SaveStateKind, string> = {
  unsaved: "text-muted-foreground", device: "text-foreground", saving: "text-muted-foreground",
  queued: "text-warning-text", failed: "text-danger-text", saved: "text-success-text",
};

export function SaveState({ sync, savedHere, className }: { sync: SaveSync; savedHere: boolean; className?: string }) {
  const s = saveState(sync, savedHere);
  const Icon = ICON[s.kind];
  return (
    <p role="status" data-state={s.kind} className={cn("flex min-w-0 items-center gap-1.5 text-xs", TONE[s.kind], className)}>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", s.kind === "saving" && "motion-safe:animate-spin")} />
      <span className="min-w-0 truncate">{s.text}</span>
      {s.kind === "failed" && sync.onRetry && (
        <button type="button" onClick={sync.onRetry} className="ml-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-semibold text-foreground underline-offset-2 hover:underline">
          <RotateCw aria-hidden className="size-3" />Retry
        </button>
      )}
    </p>
  );
}
