// Settings → Workspace → Members (Task 9): who's in the workspace, from Control Point (the source of
// truth), and for its admins a Remove button. Removing goes through Control Point, which checks the
// admin again and keeps the last admin; it only ever ends workspace access: the person's Control Scout
// account, personal data and entries stay, and their workspace entries keep their name.
import { useState } from "react";
import { Loader2, RefreshCw, UserMinus } from "lucide-react";
import { ApiError } from "../../lib/api";
import { usePersonal } from "../../lib/personal";
import { workspaceLabel, type WorkspaceSpace } from "../../lib/scoutSpace";
import { removeWorkspaceMember, useWorkspaceMembers } from "../../lib/workspaceMembers";
import type { WorkspaceMemberOut } from "../../shared/workspaceMembers";
import { Button } from "../ui/button";
import { Badge } from "../ui/basic";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { Row } from "./rows";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export function WorkspaceMembers({ workspace }: { workspace: WorkspaceSpace }) {
  const { data, status, error, reload, drop } = useWorkspaceMembers(workspace.id);
  const { refreshUser } = usePersonal();
  // The person and the workspace they're being removed from, fixed when the dialog opens.
  const [confirm, setConfirm] = useState<(WorkspaceMemberOut & { workspaceId: string }) | null>(null);
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const label = workspaceLabel(workspace);
  const isAdmin = workspace.role === "admin";

  const description = !data ? "Everyone in this workspace, with their role."
    : data.source === "control-point" ? `Everyone in ${label}, as Control Point lists them.`
      : "Members who use Control Scout. Control Point couldn't list everyone just now.";

  const open = (m: WorkspaceMemberOut) => { setProblem(null); setConfirm({ ...m, workspaceId: workspace.id }); };
  const remove = async () => {
    if (!confirm?.accountId) return;
    setRemoving(true); setProblem(null);
    try {
      const r = await removeWorkspaceMember(confirm.workspaceId, confirm.accountId);
      setConfirm(null);
      drop(confirm.accountId); // gone from the list now, whatever the reload below brings
      if (r.self) {
        toast.success(`You left ${label}`);
        await refreshUser(); // the workspace leaves the account: Settings and the scout space follow
      } else {
        toast.success(`Removed ${confirm.name} from ${label}`);
        reload();
      }
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn't remove them. Try again.");
      if (e instanceof ApiError && [404, 501, 502].includes(e.status)) reload(); // the list catches up
    } finally { setRemoving(false); }
  };

  return (
    <>
      <Row label={data ? `Members (${data.members.length})` : "Members"} description={description} stack>
        {status === "loading" && !data ? (
          <div className="skeleton h-24 rounded-lg" aria-label="Loading members" />
        ) : !data ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{error ?? "Couldn't load the members."}</p>
            <Button variant="outline" size="sm" onClick={reload}><RefreshCw /> Try again</Button>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label={`Members of ${label}`}>
              {data.members.map((m, i) => (
                <li key={m.accountId ?? `cp-${i}`} className="flex min-h-14 items-center gap-3 px-3 py-2">
                  <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium text-muted-foreground">{initials(m.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{m.name}{m.you && <span className="font-normal text-muted-foreground"> (you)</span>}</p>
                    {m.accountId == null && <p className="truncate text-xs text-muted-foreground">Not on Control Scout yet{isAdmin ? ", manage them in Control Point" : ""}</p>}
                  </div>
                  <Badge variant={m.role === "admin" ? "success" : "secondary"}>{m.role === "admin" ? "Admin" : "Member"}</Badge>
                  {isAdmin && m.accountId != null && (
                    <Button variant="outline" size="sm" className="shrink-0" disabled={!data.canRemove}
                      title={data.removeUnavailable ?? undefined}
                      aria-label={m.you ? `Leave ${label}` : `Remove ${m.name}`} onClick={() => open(m)}>
                      <UserMinus /> <span className="hidden sm:inline">{m.you ? "Leave" : "Remove"}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {isAdmin && data.removeUnavailable && <p className="mt-2 text-sm text-muted-foreground" role="note">{data.removeUnavailable}</p>}
            {error && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground" role="status">Couldn't refresh the list: {error}</p>
                <Button variant="outline" size="sm" onClick={reload}><RefreshCw /> Try again</Button>
              </div>
            )}
          </>
        )}
      </Row>

      <Dialog open={!!confirm} onOpenChange={(v) => { if (!v && !removing) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.you ? `Leave ${label}?` : `Remove ${confirm?.name ?? "this member"} from ${label}?`}</DialogTitle>
            <DialogDescription>
              {confirm?.you
                ? "You lose access to its shared scout space, here and in Control Point. Your Control Scout account, personal data and entries stay, and entries you wrote for the workspace keep your name."
                : "They lose access to its shared scout space, here and in Control Point. Their Control Scout account, personal data and entries stay, and entries they wrote for the workspace keep their name."}
            </DialogDescription>
          </DialogHeader>
          {problem && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{problem}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={removing}>Cancel</Button>
            <Button variant="destructive" onClick={() => void remove()} disabled={removing}>
              {removing ? <Loader2 className="animate-spin" /> : <UserMinus />} {confirm?.you ? "Leave workspace" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
