// Settings → Workspace → Scouting commons (docs/scouting-commons.md): the workspace's opt-in, off by default. Admins
// switch it; members read it. Turning it off withdraws everything the workspace shared.
import { useState } from "react";
import { Globe2 } from "lucide-react";
import { Switch } from "../ui/controls";
import { toast } from "../ui/sonner";
import { setOptIn, useWorkspaceCommons } from "../../lib/commons";
import { workspaceLabel, type WorkspaceSpace } from "../../lib/scoutSpace";
import type { ApiError } from "../../lib/api";
import { Group, Row } from "./rows";

export function WorkspaceCommons({ workspace, isAdmin }: { workspace: WorkspaceSpace; isAdmin: boolean }) {
  const c = useWorkspaceCommons(workspace.id);
  const [busy, setBusy] = useState(false);
  if (!c) return null;
  const shared = c.shares.filter((s) => s.status === "published").length;
  const change = async (v: boolean) => {
    setBusy(true);
    try {
      await setOptIn(workspace.id, v);
      toast.success(v ? "Joined the scouting commons. Share pit entries one by one from each entry." : "Left the scouting commons. Everything shared was withdrawn.");
    } catch (e) { toast.error((e as ApiError).message); } finally { setBusy(false); }
  };
  return (
    <Group title="Scouting commons" description={<>Share chosen pit entries with every signed-in Scout user at events where the commons is open, credited to {workspaceLabel(workspace)}. Match scouting always stays here.</>}>
      <Row label={<span className="inline-flex items-center gap-1.5"><Globe2 className="size-4 text-info" aria-hidden />Join the commons</span>} htmlFor="ws-commons"
        description={c.optedIn
          ? `On${c.updatedBy ? ` (by ${c.updatedBy})` : ""}. Members share each pit entry themselves; ${shared === 1 ? "1 entry is" : `${shared} entries are`} shared now. Turning it off withdraws them all.`
          : isAdmin ? "Off: nothing is shared. Turning it on shares nothing by itself; each pit entry is shared from the entry." : "Off: nothing is shared. Only workspace admins can change this."}>
        <Switch id="ws-commons" checked={c.optedIn} disabled={!isAdmin || busy} onCheckedChange={(v) => { void change(v); }} />
      </Row>
    </Group>
  );
}
