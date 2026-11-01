// Sharing a pit entry in the scouting commons (docs/scouting-commons.md): the switch on an open workspace pit entry,
// and the "In the commons" badge on its card. Shown only while the workspace has opted in; the server checks the
// rest (the event open, the author or an admin) and its refusal is said in plain words under the switch.
import { useId, useState } from "react";
import { Globe2 } from "lucide-react";
import { Badge } from "../ui/basic";
import { Switch } from "../ui/controls";
import { isShared, setShare, useWorkspaceCommons } from "../../lib/commons";
import { optimistic } from "../../lib/optimistic";
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
 * The switch moves at once and goes back, saying why, if the server refuses (the event closed, not the author's).
 */
export function CommonsShare({ e, readOnly, unsaved, className }: { e: ScoutEntry; readOnly?: boolean; unsaved?: boolean; className?: string }) {
  const c = useWorkspaceCommons(e.kind === "pit" ? e.workspaceId : null);
  // The switch's position until the server's answer is in the workspace's copy (null: as that copy says).
  const [guess, setGuess] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const toggle = (publish: boolean) => {
    setErr(null);
    void optimistic({
      key: `commons-share:${e.workspaceId}:${e.uuid}`,
      apply: () => { setGuess(publish); return () => setGuess(null); },
      send: () => setShare(e.workspaceId!, e.uuid, publish),
      reconcile: () => setGuess(null), // setShare put the server's copy in the shared cache
      what: publish ? "shared in the scouting commons" : "unshared from the scouting commons",
      report: (m) => setErr(m),
    });
  };
  if (e.kind !== "pit" || !e.workspaceId || !c?.optedIn) return null;
  const on = guess ?? isShared(c, e.uuid);
  const removed = c.shares.find((s) => s.uuid === e.uuid && s.status === "removed");
  if (removed || c.suspended) {
    return (
      <div role="status" className={`rounded-xl border border-danger/40 bg-danger/[0.06] p-4 text-sm ${className ?? ""}`}>
        <p className="flex items-center gap-1.5 font-medium"><Globe2 className="size-4 text-danger" aria-hidden />{removed ? "Taken down from the scouting commons" : "Your workspace is suspended from the scouting commons"}</p>
        <p className="mt-0.5 text-muted-foreground">
          {removed ? <>Control Scout took this entry down{removed.removedReason ? ` (${removed.removedReason})` : ""}, so it can't be shared again. It stays in your workspace as it is.</>
            : <>Nothing your workspace shared is shown{c.suspended!.reason ? ` (${c.suspended!.reason})` : ""}. Your own scouting is untouched. Contact Control Scout if you think that's a mistake.</>}
        </p>
        {/* Suspended, or taken down, the workspace can still withdraw the entry, so lifting the suspension or a restore
            won't bring back what it unshared. */}
        {(removed ? removed.sharedIfRestored : on) && (
          <div className="mt-3 flex items-center justify-between gap-4">
            <label htmlFor={id} className="text-sm">{removed ? "Share it again if it's restored" : "Shared: unshare it"}</label>
            <Switch id={id} checked disabled={guess !== null || readOnly} onCheckedChange={(v) => { if (!v) toggle(false); }} />
          </div>
        )}
        {removed && removed.sharedIfRestored === false && <p className="mt-2 text-muted-foreground">Unshared: it stays out of the commons even if it's restored.</p>}
        {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
      </div>
    );
  }
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
        <Switch id={id} checked={on} disabled={readOnly || (!on && unsaved)} onCheckedChange={toggle} />
      </div>
      {unsaved && <p className="mt-2 text-sm text-warning">{on ? "Readers see the saved version: your changes show there once they're saved and synced." : "Save your changes first: the saved version is what gets shared."}</p>}
      {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
}
