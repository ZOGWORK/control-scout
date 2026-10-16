// Pre-match scouting report (v1.6 Task 2), the workspace half: for the teams in one match, the workspace's
// scout consensus (consensus.ts, cached), which of them are on its shared pick list this season, and which
// are assigned to the asker at the event. One request for the whole lineup.
//
// GET /api/scout/workspaces/:workspaceId/match-report?season=YYYY&event=CODE&teams=1,2,3,4
//   Members only, checked exactly as reading the workspace's entries (workspaceAccess: 401 signed out,
//   403 not a member or not linked, 503 while workspace scouting is paused). Never cached beyond the asker
//   (private, no-store). consensusFor reads this workspace only, after that check.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { isWorkspaceId } from "../auth/controlPoint.js";
import { currentUser } from "../auth/session.js";
import { normalEventCode } from "../../src/shared/assignments.js";
import type { MatchReportWorkspace } from "../../src/shared/matchReport.js";
import { accessError, workspaceAccess, workspacePaused } from "./entries.js";
import { consensusFor, parseTeams } from "./consensus.js";
import { readPickList } from "./picklist.js";
import { listAssignments } from "./assignments.js";

const isSeason = (n: number) => Number.isSafeInteger(n) && n >= 2000 && n <= 2100;

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((b) => { if (!res.headersSent && b !== undefined) res.json(b); }).catch(next);
};

export function matchReportRouter(): Router {
  const r = express.Router();
  r.get("/workspaces/:workspaceId/match-report", h(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const user = await currentUser(req);
    if (!user) { res.status(401).json({ error: "Sign in first." }); return; }
    if (await workspacePaused(res)) return;
    const workspaceId = req.params.workspaceId;
    if (!isWorkspaceId(workspaceId)) { res.status(400).json({ error: "workspaceId required" }); return; }
    const season = Number(req.query.season);
    if (!isSeason(season)) { res.status(400).json({ error: "season required" }); return; }
    const event = normalEventCode(req.query.event);
    if (!event) { res.status(400).json({ error: "event must be an event code" }); return; }
    const teams = parseTeams(req.query.teams);
    // A match has 4 teams (a few more with surrogates or a playoff backup): 8 is plenty.
    if (!teams || teams.length > 8) { res.status(400).json({ error: "teams: 1 to 8 team numbers, comma separated" }); return; }
    const access = await workspaceAccess(user, workspaceId);
    if (!access.ok) { res.status(access.status).json(accessError(access)); return; }
    const me = access.membership.accountId;
    const [consensus, picks, assigned] = await Promise.all([
      consensusFor(workspaceId, season, teams),
      readPickList(workspaceId, season),
      listAssignments(workspaceId, { season, eventCode: event, assigneeAccountId: me, teams }),
    ]);
    const want = new Set(teams);
    const body: MatchReportWorkspace = {
      workspaceId, season, teams: consensus,
      picklist: picks.picks.map((p) => p.team).filter((t) => want.has(t)),
      assignedToMe: [...new Set(assigned.map((a) => a.team))],
    };
    return body;
  }));
  return r;
}
