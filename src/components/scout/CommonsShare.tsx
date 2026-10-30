// Sharing a pit entry in the scouting commons (docs/scouting-commons.md): the switch on an open workspace pit entry,
// and the "In the commons" badge on its card. Shown only while the workspace has opted in; the server checks the
// rest (the event open, the author or an admin) and its refusal is said in plain words under the switch.
import { useId, useState } from "react";
import { Globe2 } from "lucide-react";
import { Badge } from "../ui/basic";
import { Switch } from "../ui/controls";
import { isShared, setShare, useWorkspaceCommons } from "../../lib/commons";
import type { ApiError } from "../../lib/api";
import type { ScoutEntry } from "../../lib/scouting";

/** On an entry's card: shared right now. */
export function CommonsBadge({ e }: { e: ScoutEntry }) {
  const c = useWorkspaceCommons(e.kind === "pit" ? e.workspaceId : null);
  if (!isShared(c, e.uuid)) return null;
  return <Badge variant="info" className="mt-1.5"><Globe2 /> In the scouting commons</Badge>;
}

/**
 * In the open entry: share or unshare it. `readOnly`: shown, not changeable. `unsaved`: the form has changes not saved
 * yet; what's shared is the saved, synced version, so sharing waits for Save (unsharing never waits).
 */
export function CommonsShare({ e, readOnly, unsaved, className }: { e: ScoutEntry; readOnly?: boolean; unsaved?: boolean; className?: string }) {
  const c = useWorkspaceCommons(e.kind === "pit" ? e.workspaceId : null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  if (e.kind !== "pit" || !e.workspaceId || !c?.optedIn) return null;
  const on = isShared(c, e.uuid);
  const toggle = async (publish: boolean) => {
    setBusy(true); setErr(null);
    try { await setShare(e.workspaceId!, e.uuid, publish); } catch (x) { setErr((x as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <div className={`rounded-xl border p-4 ${on ? "border-info/40 bg-info/[0.06]" : "border-border"} ${className ?? ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium"><Globe2 className="size-4 text-info" aria-hidden />Share in the scouting commons</label>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {on ? <>Every signed-in Scout user at {e.eventCode ?? "this event"} can read this pit entry and its photos, credited to your workspace. Your edits show there too.</>
              : <>Lets every signed-in Scout user at {e.eventCode ?? "the event"} read this pit entry and its photos, credited to your workspace (never to you by name). Match scouting is never shared.</>}
          </p>
        </div>
        <Switch id={id} checked={on} disabled={busy || readOnly || (!on && unsaved)} onCheckedChange={(v) => { void toggle(v); }} />
      </div>
      {unsaved && <p className="mt-2 text-sm text-warning">{on ? "Readers see the saved version: your changes show there once they're saved and synced." : "Save your changes first: the saved version is what gets shared."}</p>}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
