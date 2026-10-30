// Preview: the Alliance view (?view=alliance) linked with a partner (the default), an admin with no link yet
// (?state=invite), or the pick list's View partner's toggle (?state=picklist). Sample answers are primed into the
// page cache (dev-only route); the Scout page reads the real ones from server/scout/alliances.ts.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { prime } from "../../lib/api";
import { allianceConsensusPath, alliancePicklistPath, alliancesPath, allianceSharedPath } from "../../lib/alliances";
import { AllianceView, PicklistWithPartner } from "../../components/scout/Alliance";
import type { Alliance, AllianceShared, AllianceEntry } from "../../shared/alliances";
import type { TeamConsensus } from "../../shared/consensus";

const WS = "preview-ws", S = 2025, EV = "USNJQ1";
const now = Date.now();
const linked: Alliance = {
  id: 1, season: S, eventCode: EV, eventName: "NJ Qualifier 1", endsOn: "2026-11-08", status: "active", endedReason: null,
  you: { workspaceId: WS, name: "Riverside Robotics", keepsCopies: true }, partner: { workspaceId: "p", name: "Pyro Pandas", keepsCopies: true },
  invitedByYou: true, createdAt: now - 86_400_000, acceptedAt: now - 80_000_000, endedAt: null, inviteExpiresAt: null, copiesKept: false,
};
const teams = [[7393, "Gearbox Gurus", 4, 3], [18360, "Pyro", 3, 4], [21010, "Iron Owls", 5, 0], [9999, "Bolt Brigade", 0, 3], [12345, "Circuit Breakers", 2, 2], [16404, "Mecha Mantis", 0, 0], [22222, "Gear Grinders", 1, 0]] as const;
const scouts = ["Priya", "Marcus", "Ana"], partners = ["Ben", "Rae"];
let n = 0;
const entries: AllianceEntry[] = teams.flatMap(([team, , you, partner]) => [
  ...Array.from({ length: you }, (_, i) => ({ side: "you" as const, team, i })),
  ...Array.from({ length: partner }, (_, i) => ({ side: "partner" as const, team, i })),
]).map(({ side, team, i }) => {
  n++;
  return {
    uuid: `pv${n}`, side, workspaceId: side === "you" ? WS : "p", team, kind: "match" as const, matchLabel: `Q${(n * 3) % 40 + 1}`,
    notes: side === "partner" && i === 0 ? ["Fast intake, struggled to park.", "Strong auto, two samples every time.", "Defended well in Q12.", ""][n % 4] : "",
    data: {}, updatedAt: now - n * 600_000, authorAccountId: side === "you" ? n % 3 : 10 + (n % 2),
    authorDisplayName: side === "you" ? scouts[n % 3] : partners[n % 2],
  };
});
const shared: AllianceShared = {
  alliance: linked, entries,
  assignments: [
    { id: 1, workspaceId: WS, season: S, eventCode: EV, team: 7393, assigneeAccountId: 1, assigneeName: "Priya", createdByAccountId: 9, createdByName: "Coach", createdAt: now, status: "done", doneAt: now, doneByAccountId: 1, doneByName: "Priya", version: 1, progress: 4, side: "you" },
    { id: 2, workspaceId: WS, season: S, eventCode: EV, team: 21010, assigneeAccountId: 2, assigneeName: "Marcus", createdByAccountId: 9, createdByName: "Coach", createdAt: now, status: "open", doneAt: null, doneByAccountId: null, doneByName: null, version: 1, progress: 2, side: "you" },
  ],
  matchAssignments: [
    { id: 3, workspaceId: "p", season: S, eventCode: EV, watching: { kind: "alliance", side: "red" }, fromMatch: "Q1", toMatch: "Q30", assigneeAccountId: 10, assigneeName: "Ben", createdByAccountId: 11, createdByName: "Rae", createdAt: now, updatedAt: now, version: 1, side: "partner" },
  ],
  coverage: {
    you: { workspaceId: WS, name: "Riverside Robotics", entries: 15, matchEntries: 15, pitEntries: 0, teams: 5, matches: 13, scouts: 3 },
    partner: { workspaceId: "p", name: "Pyro Pandas", entries: 12, matchEntries: 12, pitEntries: 0, teams: 4, matches: 11, scouts: 2 },
    teams: teams.map(([team, name, you, partner]) => ({ team, name, you, partner })).sort((a, b) => b.you + b.partner - (a.you + a.partner)),
  },
};
const consensus = (team: number, e: number, r1: number, r2: number, strengths: string[]): TeamConsensus => ({
  team, entries: e, matchEntries: e, pitEntries: 0, scouts: 3, lastUpdated: now - 1_200_000,
  ratings: [{ kind: "match", id: "auto", label: "Auto", avg: r1, n: e, max: 5 }, { kind: "match", id: "driver", label: "Driving", avg: r2, n: e, max: 5 }] as TeamConsensus["ratings"],
  counters: [], strengths: strengths.map((label) => ({ label, count: Math.max(1, e - 2) })), weaknesses: [], tags: [],
});

function prepare(state: string) {
  const scouted = shared.coverage.teams.filter((t) => t.you + t.partner > 0).slice(0, 12).map((t) => t.team);
  if (state === "invite") { prime(alliancesPath(WS, S), { alliances: [], canManage: true }); return; }
  prime(alliancesPath(WS, S), { alliances: [linked], canManage: true });
  prime(allianceSharedPath(WS, 1), shared);
  prime(allianceConsensusPath(WS, 1, scouted), { allianceId: 1, season: S, eventCode: EV, teams: scouted.map((t, i) => consensus(t, 7 - i, 4.5 - i * 0.4, 3.8 - i * 0.2, i < 2 ? ["Auto", "Driving"] : i < 4 ? ["Auto"] : [])) });
  prime(alliancePicklistPath(WS, 1), { allianceId: 1, partnerName: "Pyro Pandas", list: { workspaceId: "p", season: S, version: 4, picks: [
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
