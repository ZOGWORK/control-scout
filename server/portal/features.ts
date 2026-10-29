// The owner console's Features tab (src/components/owner/FeaturesPanel.tsx): feature toggles and kill switches.
//
//   GET /api/owner/flags                                  every flag (group, scope, global value, who changed it last),
//                                                         the per-workspace overrides, and the workspaces that can take
//                                                         one (ids and names only: no members, no entries)
//   PUT /api/owner/flags/:name                            {enabled, confirm} the global switch. A feature toggle needs
//                                                         {confirm: true} (the console asks first); a kill switch doesn't.
//   PUT /api/owner/flags/:name/workspaces/:workspaceId    {enabled: true | false | null} one workspace's override of a
//                                                         workspace-scoped flag, applied at once (null: follow the global switch)
//
// Every change is in the audit log with its old and new value. Flipping never touches a feature's data: switching
// back on shows everything as it was. These routes (the whole console) are never behind a toggle.
import type { Request, Response, Router } from "express";
import { all, get } from "../db.js";
import { flagDetails, overrideDetails, setFlag, setWorkspaceOverride, workspaceOverride } from "../flags.js";
import { FLAG_META, isFlag, isWorkspaceFlag } from "../../src/shared/flags.js";
import type { OwnerFlags } from "../../src/shared/owner.js";
import { recordAudit } from "./audit.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Everything the Features tab shows. */
export async function ownerFlags(): Promise<OwnerFlags> {
  const [flags, overrides, workspaces] = await Promise.all([
    flagDetails(),
    overrideDetails(),
    all<{ id: string; name: string }>("SELECT cp_workspace_id id, name FROM workspaces ORDER BY name COLLATE NOCASE, cp_workspace_id"),
  ]);
  return {
    flags: flags.map((f) => ({ ...f, ...FLAG_META[f.name] })),
    overrides,
    workspaces: workspaces.map((w) => ({ id: String(w.id), name: String(w.name ?? "") })),
  };
}

/** Add the Features tab's routes to the owner router. `h` wraps a handler; `actor` names the signed-in owner. */
export function featureOwnerRoutes(r: Router, h: (fn: Handler) => (req: Request, res: Response, next: (e?: unknown) => void) => void, actor: (req: Request) => string) {
  r.get("/flags", h(async () => ownerFlags()));

  r.put("/flags/:name", h(async (req, res) => {
    const name = req.params.name;
    if (!isFlag(name)) { res.status(404).json({ error: "No such flag" }); return; }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") { res.status(400).json({ error: "Send {\"enabled\": true | false}" }); return; }
    // A feature toggle changes what everyone sees: the console confirms first, and so must the request.
    if (FLAG_META[name].group === "feature" && req.body?.confirm !== true) { res.status(400).json({ error: "Confirm with {\"enabled\": …, \"confirm\": true}" }); return; }
    const was = (await flagDetails()).find((f) => f.name === name)!.enabled;
    if (was !== enabled) {
      await setFlag(name, enabled, actor(req));
      await recordAudit(actor(req), "flag.set", { flag: name, enabled }, null, { from: was, to: enabled });
    }
    return ownerFlags();
  }));

  r.put("/flags/:name/workspaces/:workspaceId", h(async (req, res) => {
    const name = req.params.name;
    if (!isFlag(name)) { res.status(404).json({ error: "No such flag" }); return; }
    if (!isWorkspaceFlag(name)) { res.status(400).json({ error: "This switch is global only: it has no per-workspace setting" }); return; }
    const enabled = req.body?.enabled;
    if (enabled !== null && typeof enabled !== "boolean") { res.status(400).json({ error: "Send {\"enabled\": true | false | null} (null: follow the global switch)" }); return; }
    const workspaceId = String(req.params.workspaceId);
    // Only a workspace Scout knows (one that has scouted here); a made-up id never gets a row.
    const ws = await get<{ name: string }>("SELECT name FROM workspaces WHERE cp_workspace_id = ?", [workspaceId]);
    if (!ws) { res.status(404).json({ error: "No such workspace" }); return; }
    const was = await workspaceOverride(name, workspaceId);
    if (was !== enabled) {
      await setWorkspaceOverride(name, workspaceId, enabled, actor(req));
      await recordAudit(actor(req), "flag.workspace", { flag: name, workspaceId, workspace: ws.name ?? "", enabled }, null, { from: was, to: enabled });
    }
    return ownerFlags();
  }));
}
