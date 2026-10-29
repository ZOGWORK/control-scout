// GET /api/scout/workspaces/:workspaceId/activity?before=<id>&limit=50: a
// workspace's activity feed (activityLog.ts), newest first, for its members.
// 401 signed out, 403 feature_disabled while workspace scouting is switched off for the workspace, 400 a bad id or
// cursor, 403 not a member. `before`: the id of the oldest item already shown
// (the next page holds older ones); `more`: whether there are any.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { workspaceAccess, workspacePaused } from "./entries.js";
import { listActivity, PAGE_LIMIT, PAGE_MAX } from "./activityLog.js";

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

const cursor = (raw: unknown): number | null | undefined => {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return typeof raw === "string" && Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

export function activityRouter(): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/activity", h(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    if (await workspacePaused(res, workspaceId)) return;
    const before = cursor(req.query.before);
    if (before === undefined) { res.status(400).json({ error: "before must be an activity id" }); return; }
    const limit = req.query.limit === undefined ? PAGE_LIMIT : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_MAX) { res.status(400).json({ error: `limit must be 1 to ${PAGE_MAX}` }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json({ error: access.error }); return; }
    return listActivity(workspaceId, before, limit);
  }));
  return r;
}
