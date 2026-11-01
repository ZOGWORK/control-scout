// Preview: the Alliance view (?view=alliance) linked with two other teams (the default), an admin with no alliance yet
// (?state=invite), or the pick list's View <team>'s toggle (?state=picklist). Sample answers are primed into the page
// cache (dev-only route); the Scout page reads the real ones from server/scout/alliances.ts.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { prime } from "../../lib/api";
import { allianceConsensusPath, alliancePicklistPath, alliancesPath, allianceSharedPath } from "../../lib/alliances";
import { AllianceView, PicklistWithPartner } from "../../components/scout/Alliance";
import type { Alliance, AllianceShared, AllianceEntry, AllianceMember } from "../../shared/alliances";
import type { TeamConsensus } from "../../shared/consensus";

const WS = "preview-ws", S = 2025, EV = "USNJQ1";
const now = Date.now();
const member = (workspaceId: string, name: string, creator = false, keepsCopies = true): AllianceMember => ({ workspaceId, name, keepsCopies, creator, joinedAt: now - 86_400_000 });
const members = [member(WS, "Riverside Robotics", true), member("p", "Pyro Pandas"), member("q", "Quantum Quokkas")];
const linked: Alliance = {
  id: 1, season: S, eventCode: EV, eventName: "NJ Qualifier 1", endsOn: "2026-11-08", status: "active", endedReason: null,
  you: members[0], members, createdAt: now - 86_400_000, endedAt: null, inviteExpiresAt: now + 5 * 86_400_000, copiesKept: false,
};
// Team, name, then entries by each member in order.
const teams = [[7393, "Gearbox Gurus", 4, 3, 1], [18360, "Pyro", 3, 4, 0], [21010, "Iron Owls", 5, 0, 2], [9999, "Bolt Brigade", 0, 3, 2], [12345, "Circuit Breakers", 2, 2, 0], [16404, "Mecha Mantis", 0, 0, 0], [22222, "Gear Grinders", 1, 0, 1]] as const;
const scouts: Record<string, string[]> = { [WS]: ["Priya", "Marcus", "Ana"], p: ["Ben", "Rae"], q: ["Jo", "Sam"] };
let n = 0;
const entries: AllianceEntry[] = teams.flatMap(([team, , ...counts]) => counts.flatMap((c, k) => Array.from({ length: c }, (_, i) => ({ ws: members[k].workspaceId, team, i }))))
  .map(({ ws, team, i }) => {
    n++;
    const theirs = ws !== WS;
    return {
      uuid: `pv${n}`, workspaceId: ws, team, kind: "match" as const, matchLabel: `Q${(n * 3) % 40 + 1}`,
      notes: theirs && i === 0 ? ["Fast intake, struggled to park.", "Strong auto, two samples every time.", "Defended well in Q12.", ""][n % 4] : "",
      answers: theirs ? [{ label: "Auto samples", text: String(n % 4) }, { label: "Parked", text: n % 3 ? "Yes" : "No" }, { label: "Driving", text: `${3 + (n % 3)} / 5` }] : [],
      updatedAt: now - n * 600_000, authorAccountId: n % 7, authorDisplayName: scouts[ws][n % scouts[ws].length],
    };
  });
const coverageSide = (k: number) => {
  const ws = members[k].workspaceId;
  const mine = entries.filter((e) => e.workspaceId === ws);
  return { workspaceId: ws, name: members[k].name, entries: mine.length, matchEntries: mine.length, pitEntries: 0, teams: new Set(mine.map((e) => e.team)).size, matches: new Set(mine.map((e) => e.matchLabel)).size, scouts: scouts[ws].length };
};
const shared: AllianceShared = {
  alliance: linked, entries,
  assignments: [
    { id: 1, workspaceId: WS, season: S, eventCode: EV, team: 7393, assigneeAccountId: 1, assigneeName: "Priya", createdByAccountId: 9, createdByName: "Coach", createdAt: now, status: "done", doneAt: now, doneByAccountId: 1, doneByName: "Priya", version: 1, progress: 4 },
    { id: 2, workspaceId: WS, season: S, eventCode: EV, team: 21010, assigneeAccountId: 2, assigneeName: "Marcus", createdByAccountId: 9, createdByName: "Coach", createdAt: now, status: "open", doneAt: null, doneByAccountId: null, doneByName: null, version: 1, progress: 2 },
  ],
  matchAssignments: [
    { id: 3, workspaceId: "p", season: S, eventCode: EV, watching: { kind: "alliance", side: "red" }, fromMatch: "Q1", toMatch: "Q30", assigneeAccountId: 10, assigneeName: "Ben", createdByAccountId: 11, createdByName: "Rae", createdAt: now, updatedAt: now, version: 1 },
  ],
  coverage: {
    members: members.map((_, k) => coverageSide(k)),
    teams: teams.map(([team, name, ...counts]) => ({
      team, name, total: counts.reduce<number>((a, b) => a + b, 0),
      byMember: Object.fromEntries(counts.map((c, k) => [members[k].workspaceId, c] as const).filter(([, c]) => c > 0)),
    })).sort((a, b) => b.total - a.total),
  },
};
const consensus = (team: number, e: number, r1: number, r2: number, strengths: string[]): TeamConsensus => ({
  team, entries: e, matchEntries: e, pitEntries: 0, scouts: 3, lastUpdated: now - 1_200_000,
  ratings: [{ kind: "match", id: "auto", label: "Auto", avg: r1, n: e, max: 5 }, { kind: "match", id: "driver", label: "Driving", avg: r2, n: e, max: 5 }] as TeamConsensus["ratings"],
  counters: [], strengths: strengths.map((label) => ({ label, count: Math.max(1, e - 2) })), weaknesses: [], tags: [],
});

function prepare(state: string) {
  const scouted = shared.coverage.teams.filter((t) => t.total > 0).slice(0, 12).map((t) => t.team);
  if (state === "invite") { prime(alliancesPath(WS, S), { alliances: [], canManage: true }); return; }
  prime(alliancesPath(WS, S), { alliances: [linked], canManage: true });
  prime(allianceSharedPath(WS, 1), shared);
  prime(allianceConsensusPath(WS, 1, scouted), { allianceId: 1, season: S, eventCode: EV, teams: scouted.map((t, i) => consensus(t, 7 - i, 4.5 - i * 0.4, 3.8 - i * 0.2, i < 2 ? ["Auto", "Driving"] : i < 4 ? ["Auto"] : [])) });
  prime(alliancePicklistPath(WS, 1, "p"), { allianceId: 1, workspaceId: "p", name: "Pyro Pandas", teamsKnown: true, list: { workspaceId: "p", season: S, version: 4, picks: [
    { team: 21010, rank: 1, addedBy: { accountId: 10, name: "Ben" }, addedAt: now, note: "Best auto at the event", noteBy: null, noteUpdatedAt: null },
    { team: 7393, rank: 2, addedBy: { accountId: 11, name: "Rae" }, addedAt: now, note: "", noteBy: null, noteUpdatedAt: null },
    { team: 12345, rank: 3, addedBy: { accountId: 10, name: "Ben" }, addedAt: now, note: "Consistent, quiet driver", noteBy: null, noteUpdatedAt: null },
  ] } });
}

export default function AlliancePreview() {
  const [sp] = useSearchParams();
  const state = sp.get("state") ?? "linked";
  useState(() => prepare(state)); // primed once, before the first render reads the cache
  if (state === "picklist") {
    return (
      <PicklistWithPartner workspaceId={WS} workspaceName="Riverside Robotics" season={S} eventCode={EV}>
        <p className="text-sm text-muted-foreground">Riverside Robotics' own pick list goes here.</p>
      </PicklistWithPartner>
    );
  }
  return <div className="max-w-3xl"><AllianceView workspaceId={WS} workspaceName="Riverside Robotics" season={S} eventCode={EV} isAdmin readOnly={false} /></div>;
}
