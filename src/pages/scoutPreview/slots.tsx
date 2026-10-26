// Preview: the Assignments view as a workspace admin sees it, with match scouting (who watches which slot or
// alliance for which quals) above the team assignments. ?sheet=1 opens the Assign match scouting sheet;
// ?member=1 shows it as a member (no actions). Sample names and ranges for the piece's own props. Dev only.
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/page";
import { AssignmentsView } from "../../components/scout/Assignments";
import { MatchAssignSheet } from "../../components/scout/MatchAssignments";
import type { AssignmentsState } from "../../lib/assignments";
import type { MatchAssignmentsState } from "../../lib/slotAssignments";
import type { AssignableMember, Assignment, MatchAssignment } from "../../shared/assignments";
import type { Watching } from "../../shared/scoutMatch";

const SEASON = 2025, EVENT = "USMICHQ", ME = 1;
const MEMBERS: AssignableMember[] = [
  { accountId: 1, name: "Coach Rivera", role: "admin" }, { accountId: 2, name: "Priya", role: "member" }, { accountId: 3, name: "Marcus", role: "member" },
  { accountId: 4, name: "Jo", role: "member" }, { accountId: 5, name: "Sam", role: "member" },
];
const nameOf = (id: number) => MEMBERS.find((m) => m.accountId === id)!.name;

const slots: [number, Watching, string | null, string | null][] = [
  [2, { kind: "slot", slot: "red1" }, "Q1", "Q30"], [4, { kind: "slot", slot: "red2" }, "Q1", "Q30"],
  [3, { kind: "alliance", side: "blue" }, "Q1", "Q30"], [5, { kind: "alliance", side: "red" }, "Q31", null],
  [2, { kind: "alliance", side: "blue" }, "Q31", null], [1, { kind: "all" }, null, null],
];
const MATCH: MatchAssignment[] = slots.map(([who, watching, fromMatch, toMatch], i) => ({
  id: i + 1, workspaceId: "preview", season: SEASON, eventCode: i === 5 ? "USMIDTQ" : EVENT, watching, fromMatch, toMatch,
  assigneeAccountId: who, assigneeName: nameOf(who), createdByAccountId: ME, createdByName: "Coach Rivera", createdAt: 0, updatedAt: 0, version: 1,
}));
const TEAMS: Assignment[] = [[2, 18360, 3], [3, 21010, 0], [4, 7236, 2]].map(([who, team, progress], i) => ({
  id: i + 1, workspaceId: "preview", season: SEASON, eventCode: EVENT, team, assigneeAccountId: who, assigneeName: nameOf(who),
  createdByAccountId: ME, createdByName: "Coach Rivera", createdAt: 0, status: i === 2 ? "done" : "open", doneAt: null, doneByAccountId: null,
  doneByName: i === 2 ? "Jo" : null, version: 1, progress,
}));

const noop = () => {};

export default function SlotsPreview() {
  const [sp] = useSearchParams();
  const member = sp.get("member") === "1";
  const teams = useMemo<AssignmentsState>(() => ({ list: TEAMS, loading: false, error: null, reload: noop, apply: noop }), []);
  const match = useMemo<MatchAssignmentsState>(() => ({ list: MATCH, loading: false, error: null, reload: noop, apply: noop }), []);
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Assignments" description="Gearheads · 2025" />
      <AssignmentsView space="preview" workspaceName="Gearheads" season={SEASON} defaultEvent={EVENT} state={teams} matchState={match}
        myAccountId={member ? 2 : ME} isAdmin={!member} localEntries={[]} onScout={noop} />
      {sp.get("sheet") === "1" && (
        <MatchAssignSheet open editing={null} onOpenChange={noop} space="preview" season={SEASON} defaultEvent={EVENT} state={match} myAccountId={ME} members={MEMBERS} />
      )}
    </div>
  );
}
