// @vitest-environment jsdom
// The Alliance view: linked, every team's coverage shows (a team with nothing shows zeros, never hidden); the other
// teams' entries read without edit controls; a member gets no invite, leave or end controls; the creator's admin can
// remove a team and invite more, another team's admin can only leave; the pick list's "View <team>'s" toggle appears
// only while linked and shows that team's list read-only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { forget } from "../../lib/api";
import { AllianceView, PicklistWithPartner } from "./Alliance";
import type { Alliance, AllianceMember, AllianceShared, AlliancesResponse } from "../../shared/alliances";

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const member = (workspaceId: string, name: string, creator = false): AllianceMember => ({ workspaceId, name, keepsCopies: true, creator, joinedAt: 1 });
const linked: Alliance = {
  id: 7, season: 2025, eventCode: "USALQ1", eventName: "Alabama Qualifier", endsOn: "2025-11-08", status: "active", endedReason: null,
  you: member("w1", "Gearheads", true), members: [member("w1", "Gearheads", true), member("w2", "Pyro")],
  createdAt: 1, endedAt: null, inviteExpiresAt: null, copiesKept: false,
};
const side = (workspaceId: string, name: string, entries: number) => ({ workspaceId, name, entries, matchEntries: entries, pitEntries: 0, teams: entries ? 1 : 0, matches: entries, scouts: entries ? 1 : 0 });
const shared: AllianceShared = {
  alliance: linked,
  entries: [{ uuid: "e1", workspaceId: "w2", team: 101, kind: "match", matchLabel: "Q3", notes: "Fast intake", answers: [{ label: "Auto samples", text: "3" }], updatedAt: Date.now(), authorAccountId: 5, authorDisplayName: "Ben" }],
  assignments: [], matchAssignments: [],
  coverage: { members: [side("w1", "Gearheads", 0), side("w2", "Pyro", 1)], teams: [{ team: 101, name: "Alpha", total: 1, byMember: { w2: 1 } }, { team: 102, name: "Beta", total: 0, byMember: {} }] },
};

let routes: Record<string, unknown> = {};
beforeEach(() => {
  forget(["/api/scout/workspaces/w1/alliances?season=2025", "/api/scout/workspaces/w1/alliances/7/shared", "/api/scout/workspaces/w1/alliances/7/picklist?workspace=w2", "/api/scout/workspaces/w1/alliances/7/consensus?teams=101"]);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = routes[url];
    return new Response(JSON.stringify(body ?? { error: "nope" }), { status: body ? 200 : 404, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const list = (alliances: Alliance[], canManage: boolean): AlliancesResponse => ({ alliances, canManage });

describe("AllianceView", () => {
  it("linked: both sides' coverage, including the one with nothing, and the partner's entries read-only", async () => {
    routes = {
      "/api/scout/workspaces/w1/alliances?season=2025": list([linked], false),
      "/api/scout/workspaces/w1/alliances/7/shared": shared,
      "/api/scout/workspaces/w1/alliances/7/consensus?teams=101": { allianceId: 7, season: 2025, eventCode: "USALQ1", teams: [] },
    };
    render(<MemoryRouter><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode="USALQ1" isAdmin={false} readOnly={false} /></MemoryRouter>);
    const cov = await screen.findByTestId("alliance-coverage");
    expect(within(cov).getByText("Gearheads hasn't added any entries at this event yet.")).toBeTruthy();
    expect(within(cov).getByText("Not scouted yet")).toBeTruthy(); // team 102
    expect(screen.getByText("Fast intake")).toBeTruthy();
    // Tapping the partner's entry shows its answers under its own questions.
    fireEvent.click(screen.getByText("Fast intake"));
    expect(within(screen.getByTestId("partner-answers")).getByText("Auto samples")).toBeTruthy();
    // A member: no leave, end, remove or invite.
    for (const name of [/leave/i, /^end$/i, /remove/i, /invite/i]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("three teams: one coverage card each; the creator's admin can remove a team and invite more", async () => {
    const three: Alliance = { ...linked, members: [...linked.members, member("w3", "Quokkas")] };
    routes = {
      "/api/scout/workspaces/w1/alliances?season=2025": list([three], true),
      "/api/scout/workspaces/w1/alliances/7/shared": { ...shared, alliance: three, coverage: { ...shared.coverage, members: [...shared.coverage.members, side("w3", "Quokkas", 2)] } },
      "/api/scout/workspaces/w1/alliances/7/consensus?teams=101": { allianceId: 7, season: 2025, eventCode: "USALQ1", teams: [] },
    };
    render(<MemoryRouter><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode="USALQ1" isAdmin readOnly={false} /></MemoryRouter>);
    const cov = await screen.findByTestId("alliance-coverage");
    for (const name of ["Gearheads", "Pyro", "Quokkas"]) expect(within(cov).getByText(name)).toBeTruthy();
    expect(screen.getByText("3 teams linked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Pyro" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Quokkas" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove Gearheads" })).toBeNull();
    expect(screen.getByRole("button", { name: /invite a team/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Quokkas" }));
    expect(screen.getByText(/Remove Quokkas\?/)).toBeTruthy();
  });

  it("another team's admin can leave, but not remove, invite or end", async () => {
    const theirs: Alliance = { ...linked, you: member("w1", "Gearheads"), members: [member("w2", "Pyro", true), member("w1", "Gearheads")] };
    routes = {
      "/api/scout/workspaces/w1/alliances?season=2025": list([theirs], true),
      "/api/scout/workspaces/w1/alliances/7/shared": { ...shared, alliance: theirs },
      "/api/scout/workspaces/w1/alliances/7/consensus?teams=101": { allianceId: 7, season: 2025, eventCode: "USALQ1", teams: [] },
    };
    render(<MemoryRouter><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode="USALQ1" isAdmin readOnly={false} /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: /leave/i })).toBeTruthy();
    for (const name of [/^end$/i, /remove/i, /invite/i]) expect(screen.queryByRole("button", { name })).toBeNull();
  });

  it("an invite link fills in the join form", async () => {
    routes = { "/api/scout/workspaces/w1/alliances?season=2025": list([], true) };
    render(<MemoryRouter initialEntries={["/scout?view=alliance&join=ABCDEFGHJK"]}><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode={null} isAdmin readOnly={false} /></MemoryRouter>);
    expect(((await screen.findByLabelText("Invite code")) as HTMLInputElement).value).toBe("ABCDE-FGHJK");
    expect((screen.getByRole("button", { name: /join the alliance/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("an admin with no link gets the invite and accept forms", async () => {
    routes = { "/api/scout/workspaces/w1/alliances?season=2025": list([], true) };
    render(<MemoryRouter><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode={null} isAdmin readOnly={false} /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: /create invite code/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "I have a code" }));
    expect(screen.getByLabelText("Invite code")).toBeTruthy();
    expect((screen.getByRole("button", { name: /join the alliance/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AllianceView: the invite code", () => {
  it("stays on screen after the invite exists (the list refreshes to pending and the forms hide)", async () => {
    const pending: Alliance = { ...linked, status: "pending", members: [linked.you], inviteExpiresAt: Date.now() + 86_400_000 };
    let invited = false;
    routes = {};
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") { invited = true; return new Response(JSON.stringify({ alliance: pending, code: "ABCDEFGHJK" }), { status: 201, headers: { "Content-Type": "application/json" } }); }
      if (url === "/api/scout/workspaces/w1/alliances?season=2025") return new Response(JSON.stringify(list(invited ? [pending] : [], true)), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "nope" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }));
    render(<MemoryRouter><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode="USALQ1" isAdmin readOnly={false} /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /create invite code/i }));
    expect(await screen.findByText("ABCDE-FGHJK")).toBeTruthy();
    await screen.findByText(/Waiting for a team to join/); // the refreshed list: pending, forms gone
    expect(screen.queryByRole("button", { name: /create invite code/i })).toBeNull();
    expect(screen.getByText("ABCDE-FGHJK")).toBeTruthy();
  });
});

describe("polling: a refusal clears what was shown", () => {
  it("the partner switching off mid-view replaces the shared view with the refusal", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      routes = {
        "/api/scout/workspaces/w1/alliances?season=2025": list([linked], false),
        "/api/scout/workspaces/w1/alliances/7/shared": shared,
        "/api/scout/workspaces/w1/alliances/7/consensus?teams=101": { allianceId: 7, season: 2025, eventCode: "USALQ1", teams: [] },
      };
      render(<MemoryRouter><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode="USALQ1" isAdmin={false} readOnly={false} /></MemoryRouter>);
      expect(await screen.findByText("Fast intake")).toBeTruthy();
      vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/shared")
        ? new Response(JSON.stringify({ error: "feature_disabled", feature: "scoutingAlliances", message: "Scouting alliances are switched off for now." }), { status: 403, headers: { "Content-Type": "application/json" } })
        : new Response(JSON.stringify(routes[url] ?? { error: "nope" }), { status: routes[url] ? 200 : 404, headers: { "Content-Type": "application/json" } })));
      await vi.advanceTimersByTimeAsync(31_000);
      await waitFor(() => expect(screen.queryByText("Fast intake")).toBeNull());
    } finally { vi.useRealTimers(); }
  });
});

describe("PicklistWithPartner", () => {
  it("only while linked: a toggle to the partner's list, read-only", async () => {
    routes = {
      "/api/scout/workspaces/w1/alliances?season=2025": list([linked], false),
      "/api/scout/workspaces/w1/alliances/7/picklist?workspace=w2": { allianceId: 7, workspaceId: "w2", name: "Pyro", teamsKnown: true, list: { workspaceId: "w2", season: 2025, version: 1, picks: [
        { team: 101, rank: 1, addedBy: { accountId: 5, name: "Ben" }, addedAt: 1, note: "first pick", noteBy: null, noteUpdatedAt: null },
      ] } },
    };
    render(<MemoryRouter><PicklistWithPartner workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode="USALQ1"><p>our list</p></PicklistWithPartner></MemoryRouter>);
    expect(screen.getByText("our list")).toBeTruthy();
    fireEvent.click(await screen.findByRole("radio", { name: /View Pyro's/ }));
    const theirs = await screen.findByTestId("partner-picklist");
    expect(within(theirs).getByText("first pick")).toBeTruthy();
    expect(within(theirs).queryByRole("button")).toBeNull();
    expect(screen.queryByText("our list")).toBeNull();
  });

  it("switched off by the owner: asks nothing and shows just the workspace's own list", async () => {
    routes = { "/api/scout/workspaces/w1/alliances?season=2025": list([linked], false) };
    render(<MemoryRouter><PicklistWithPartner enabled={false} workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode="USALQ1"><p>our list</p></PicklistWithPartner></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 20));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("our list")).toBeTruthy();
  });

  it("without a link, just the workspace's own list", async () => {
    routes = { "/api/scout/workspaces/w1/alliances?season=2025": list([], false) };
    render(<MemoryRouter><PicklistWithPartner workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode={null}><p>our list</p></PicklistWithPartner></MemoryRouter>);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByText("our list")).toBeTruthy();
  });
});
