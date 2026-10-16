// "Know your match" on the device (v1.6 Task 2; the rules: src/shared/matchReport.ts).
//
// Two requests, whatever the lineup: the public report (/api/events/:season/:code/matches/:key/report: OPR,
// ranks, trend, data flags) and, only for a signed-in workspace member, the workspace half
// (/api/scout/workspaces/:id/match-report: consensus, pick list, assignments), asked of the same workspace
// the team page's consensus uses (the one remembered for the Scout page if it's still the account's, else
// the first), and kept fresh the same way. Your own flags (your team, tracked, shortlist) never leave the device.
import { useMemo } from "react";
import { qs } from "./api";
import { useWorkspaceAnswer, type WorkspaceAnswer } from "./consensus";
import { usePersonal } from "./personal";
import { watchFlags, type MatchReportWorkspace, type WatchFlag } from "../shared/matchReport";

export const matchReportPath = (season: number | string, code: string, key: string) =>
  `/api/events/${season}/${encodeURIComponent(code)}/matches/${key}/report`;

export const matchReportWorkspacePath = (workspaceId: string, season: number, event: string, teams: number[]) =>
  `/api/scout/workspaces/${encodeURIComponent(workspaceId)}/match-report${qs({ season, event, teams: teams.join(",") })}`;

/** The workspace half for these teams, or null when there's no workspace to ask (OPR-only mode). */
export function useMatchReportWorkspace(season: number | null, event: string | null, teams: number[]): WorkspaceAnswer<MatchReportWorkspace> | null {
  return useWorkspaceAnswer<MatchReportWorkspace>((id) => (season && event && teams.length ? matchReportWorkspacePath(id, season, event, teams) : null));
}

/** Your flags for each team (shared rules), from the personal store and the workspace's answer (when there is one). */
export function useWatchFlags(teams: number[], ws: MatchReportWorkspace | undefined): Map<number, WatchFlag[]> {
  const { state } = usePersonal();
  return useMemo(() => {
    const input = {
      myTeam: state.myTeam, tracked: state.tracked.teams, shortlist: state.bookmarks,
      picklist: ws?.picklist ?? [], assigned: ws?.assignedToMe ?? [],
    };
    return new Map(teams.map((t) => [t, watchFlags(t, input)]));
  }, [teams, ws, state.myTeam, state.tracked.teams, state.bookmarks]);
}
