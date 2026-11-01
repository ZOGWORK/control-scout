// Preview (dev only): Pick list & planning as a workspace member sees it, the shared pick list with the rail beside
// it (your assignments, latest activity, the scouting alliance). The pick list's GET is answered with a sample list
// on this page only (dev-only route); the Scout page reads the real one from server/scout/picklist.ts.
import { useState } from "react";
import { SharedPicklist } from "../../components/scout/SharedPicklist";
import { PlanningRail } from "../../components/scout/planning/PlanningRail";
import type { Assignment } from "../../shared/assignments";
import type { ActivityItem, ActivityState } from "../../lib/scoutActivity";
import type { Pick } from "../../shared/picklist";

const WS = "preview-ws", S = 2025, EV = "USMSVIQ1";
const now = Date.now();
const coach = { accountId: 9, name: "Coach" }, priya = { accountId: 1, name: "Priya" };
const pick = (team: number, rank: number, note = "", by = coach): Pick => ({ team, rank, addedBy: by, addedAt: now - rank * 3_600_000, note, noteBy: note ? by : null, noteUpdatedAt: note ? now - rank * 600_000 : null });
const PICKS = [pick(16489, 1, "Best auto here, 2 samples every match", priya), pick(18370, 2, "Reliable climb"), pick(11279, 3), pick(23994, 4, "Fast cycles, weak defense", priya), pick(12272, 5), pick(8690, 6, "Check their arm after Q12")];
const asg = (id: number, team: number): Assignment => ({ id, workspaceId: WS, season: S, eventCode: EV, team, assigneeAccountId: 1, assigneeName: "Priya", createdByAccountId: 9, createdByName: "Coach", createdAt: now, status: "open", doneAt: null, doneByAccountId: null, doneByName: null, version: 1 }) as Assignment;
const item = (id: number, type: string, actor: string, subject: string, ago: number) => ({ id, type, actor: { accountId: id, name: actor }, subject, details: {}, at: now - ago }) as unknown as ActivityItem;
const activity: ActivityState = {
  items: [item(1, "picklist.moved", "Priya", "team:16489", 120_000), item(2, "entry.added", "Marcus", "entry:x", 600_000), item(3, "picklist.noted", "Coach", "team:8690", 1_800_000), item(4, "assignment.created", "Coach", "team:20217", 3_600_000)],
  loading: false, error: null, more: false, loadingOlder: false, loadOlder: () => {}, reload: () => {},
} as unknown as ActivityState;

/** Answers the pick list's GET with the sample list; everything else goes through. */
function stubPicklist() {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (u.includes(`/api/scout/workspaces/${WS}/picklist`) && (!init?.method || init.method === "GET")) {
      return Promise.resolve(new Response(JSON.stringify({ list: { workspaceId: WS, season: S, version: 7, picks: PICKS } }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return real(input, init);
  };
}

export default function PlanningPreview() {
  useState(stubPicklist); // before the first render's fetch
  return (
    <div className="grid gap-6">
      <div className="min-w-0">
        <SharedPicklist workspaceId={WS} workspaceName="Riverside Robotics" season={S} live="off" me={priya} shortlist={[]} />
      </div>
      <PlanningRail mine={[asg(1, 20217), asg(2, 19846), asg(3, 23659)]} onScout={() => {}} readOnly={false} activity={activity} onOpenEntry={() => {}} alliancesOn onView={() => {}} />
    </div>
  );
}
