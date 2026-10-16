// A workspace's members (Task 9; docs/shared-accounts.md, "Workspace members"). Control Point's
// `members` table is the source of truth: Scout lists it and, for an admin, asks Control Point to
// remove someone. Scout never forks membership.
//
//   GET  /api/scout/workspaces/:workspaceId/members           any member
//        200 WorkspaceMembersResponse (src/shared/workspaceMembers.ts). Everyone, from Control Point;
//        when Control Point can't list them (unreachable, or an older deploy) the members Scout knows
//        (source "scout"). An older Control Point also means no removing (removeUnavailable).
//   POST /api/scout/workspaces/:workspaceId/members/remove    admins only, JSON {accountId}
//        Scout checks the admin (requireWorkspaceAdmin: a member is 403 without asking Control Point),
//        then Control Point checks again and removes them with its own removal path.
//        200 {ok, self}; 400 bad accountId; 403 not an admin (Control Point's answer included);
//        404 not in the workspace; 409 the last admin; 501 an older Control Point; 502 unreachable.
//        On success Scout drops its cached membership at once, logs member.left (actor: the admin)
//        in the workspace's feed, ends the person's open streams there and records the removal in
//        the owner audit. Their account, personal data and every entry stay; authorship is kept.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import {
  cachedWorkspaceMembers, dropMembership, isWorkspaceId, listWorkspaceMembers, refreshAccount, removeWorkspaceMember,
  type Membership, type WorkspaceMember,
} from "../auth/controlPoint.js";
import { currentUser, type User } from "../auth/session.js";
import { LAST_ADMIN, LAST_ADMIN_SELF, REMOVE_UNSUPPORTED, type WorkspaceMembersResponse } from "../../src/shared/workspaceMembers.js";
import { requireWorkspaceAdmin, workspaceAccess, workspacePaused, writerName } from "./entries.js";

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};
const jsonOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!req.is("application/json")) { res.status(415).json({ error: "Send JSON" }); return; }
  next();
};

const byRoleThenName = (a: WorkspaceMember, b: WorkspaceMember) =>
  (a.role === b.role ? 0 : a.role === "admin" ? -1 : 1) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The list for one viewer: Control Point's when it answers, else Scout's own cache. */
export async function membersFor(m: Membership): Promise<WorkspaceMembersResponse> {
  let listed: WorkspaceMember[] | "unsupported" | null = null;
  try { listed = await listWorkspaceMembers(m.workspaceId); } catch { listed = null; }
  const fromCp = Array.isArray(listed);
  const members = (fromCp ? listed as WorkspaceMember[] : await cachedWorkspaceMembers(m.workspaceId))
    .slice().sort(byRoleThenName)
    .map((x) => ({ ...x, you: x.accountId === m.accountId }));
  const removeUnavailable = listed === "unsupported" && m.role === "admin" ? REMOVE_UNSUPPORTED : null;
  return { members, source: fromCp ? "control-point" : "scout", canRemove: m.role === "admin" && !removeUnavailable, removeUnavailable };
}

export function membersRouter(): Router {
  const r = express.Router();

  r.get("/workspaces/:workspaceId/members", h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    if (await workspacePaused(res)) return;
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    return membersFor(access.membership);
  }));

  r.post("/workspaces/:workspaceId/members/remove", jsonOnly, requireWorkspaceAdmin(), h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = res.locals.user as User;
    const m = res.locals.membership as Membership;
    const accountId = (req.body ?? {}).accountId;
    if (!Number.isSafeInteger(accountId) || accountId < 1) { res.status(400).json({ error: "accountId must be a member's account id" }); return; }
    const self = accountId === m.accountId;
    // Their name and role as Control Point lists them, for the feed and the audit (best effort).
    let target: WorkspaceMember | undefined;
    try {
      const listed = await listWorkspaceMembers(m.workspaceId);
      if (listed === "unsupported") { res.status(501).json({ error: REMOVE_UNSUPPORTED, code: "unsupported" }); return; }
      target = listed?.find((x) => x.accountId === accountId);
    } catch { /* the remove call below says whether Control Point is there */ }
    let result;
    try { result = await removeWorkspaceMember(m.workspaceId, accountId, m.accountId); }
    catch { res.status(502).json({ error: "Couldn't reach Control Point, so nobody was removed. Try again in a moment." }); return; }
    if (!result.ok) {
      switch (result.reason) {
        case "unsupported": res.status(501).json({ error: REMOVE_UNSUPPORTED, code: "unsupported" }); return;
        case "not_admin":
          void refreshAccount(m.accountId); // Scout's cached role was out of date: catch up with Control Point
          res.status(403).json({ error: "Control Point says you're not an admin of this workspace any more.", code: "not_admin" }); return;
        case "not_member":
          void refreshAccount(accountId); // already gone: let the cache (and the feed) catch up
          res.status(404).json({ error: "They're not in this workspace any more.", code: "not_member" }); return;
        case "last_admin": res.status(409).json({ error: self ? LAST_ADMIN_SELF : LAST_ADMIN, code: "last_admin" }); return;
        default: res.status(400).json({ error: "Control Point couldn't read that request.", code: "invalid_input" }); return;
      }
    }
    await dropMembership(m.workspaceId, m.workspaceName, { accountId, name: target?.name, role: target?.role },
      { accountId: m.accountId, name: writerName(user) }, user.email ?? `account ${m.accountId}`);
    return { ok: true, self };
  }));

  return r;
}
