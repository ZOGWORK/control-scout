// @vitest-environment jsdom
// The Alliance view: linked, both sides' coverage shows (a side with nothing shows zeros, never hidden); the
// partner's entries read without edit controls; a member gets no invite or unlink controls; the pick list's
// "View partner's" toggle appears only while linked and shows the partner's list read-only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { forget } from "../../lib/api";
import { AllianceView, PicklistWithPartner } from "./Alliance";
import type { Alliance, AllianceShared, AlliancesResponse } from "../../shared/alliances";

window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const linked: Alliance = {
  id: 7, season: 2025, eventCode: "USALQ1", eventName: "Alabama Qualifier", endsOn: "2025-11-08", status: "active", endedReason: null,
  you: { workspaceId: "w1", name: "Gearheads", keepsCopies: true }, partner: { workspaceId: "w2", name: "Pyro", keepsCopies: true },
  invitedByYou: true, createdAt: 1, acceptedAt: 2, endedAt: null, inviteExpiresAt: null, copiesKept: false,
};
const side = (workspaceId: string, name: string, entries: number) => ({ workspaceId, name, entries, matchEntries: entries, pitEntries: 0, teams: entries ? 1 : 0, matches: entries, scouts: entries ? 1 : 0 });
const shared: AllianceShared = {
  alliance: linked,
  entries: [{ uuid: "e1", side: "partner", workspaceId: "w2", team: 101, kind: "match", matchLabel: "Q3", notes: "Fast intake", answers: [{ label: "Auto samples", text: "3" }], updatedAt: Date.now(), authorAccountId: 5, authorDisplayName: "Ben" }],
  assignments: [], matchAssignments: [],
  coverage: { you: side("w1", "Gearheads", 0), partner: side("w2", "Pyro", 1), teams: [{ team: 101, name: "Alpha", you: 0, partner: 1 }, { team: 102, name: "Beta", you: 0, partner: 0 }] },
};

let routes: Record<string, unknown> = {};
beforeEach(() => {
  forget(["/api/scout/workspaces/w1/alliances?season=2025", "/api/scout/workspaces/w1/alliances/7/shared", "/api/scout/workspaces/w1/alliances/7/picklist", "/api/scout/workspaces/w1/alliances/7/consensus?teams=101"]);
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
    // A member: no unlink, no invite.
    expect(screen.queryByRole("button", { name: /unlink/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /invite code/i })).toBeNull();
  });

  it("an admin with no link gets the invite and accept forms", async () => {
    routes = { "/api/scout/workspaces/w1/alliances?season=2025": list([], true) };
    render(<MemoryRouter><AllianceView workspaceId="w1" workspaceName="Gearheads" season={2025} eventCode={null} isAdmin readOnly={false} /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: /create invite code/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "I have a code" }));
    expect(screen.getByLabelText("Invite code")).toBeTruthy();
    expect((screen.getByRole("button", { name: /accept and link/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AllianceView: the invite code", () => {
  it("stays on screen after the invite exists (the list refreshes to pending and the forms hide)", async () => {
    const pending: Alliance = { ...linked, status: "pending", partner: null, inviteExpiresAt: Date.now() + 86_400_000 };
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
    await screen.findByText(/Invite sent for/); // the refreshed list: pending, forms gone
    expect(screen.queryByRole("button", { name: /create invite code/i })).toBeNull();
    expect(screen.getByText("ABCDE-FGHJK")).toBeTruthy();
  });
});

describe("PicklistWithPartner", () => {
  it("only while linked: a toggle to the partner's list, read-only", async () => {
    routes = {
      "/api/scout/workspaces/w1/alliances?season=2025": list([linked], false),
      "/api/scout/workspaces/w1/alliances/7/picklist": { allianceId: 7, partnerName: "Pyro", teamsKnown: true, list: { workspaceId: "w2", season: 2025, version: 1, picks: [
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
