// @vitest-environment jsdom
// "Your team's take" (v1.6 Task 1): a member sees their workspace's consensus on the team page and in Compare;
// a non-member (403), a signed-out visitor or an account with no workspaces sees nothing, and the app only ever
// asks about the account's own workspaces.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import type { TeamConsensus } from "../shared/consensus";

const h = vi.hoisted(() => ({ user: null as AccountUser | null }));
vi.mock("../lib/personal", () => ({ usePersonal: () => ({ user: h.user, providers: {}, state: { myTeam: null }, syncReady: false }) }));

const { TeamConsensusSection, CompareConsensus } = await import("./ScoutConsensus");
const { invalidate } = await import("../lib/api");
const { rememberSpace } = await import("../lib/scoutSpace");

const S = 2025;
const userIn = (workspaces: { id: string; name: string }[]): AccountUser => ({
  id: 7, email: "priya@scout.test", displayName: "Priya", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9, member: true, teams: [], url: "", workspaces: workspaces.map((w) => ({ ...w, role: "member" as const })) },
});
const empty = (team: number): TeamConsensus => ({ team, entries: 0, matchEntries: 0, pitEntries: 0, scouts: 0, lastUpdated: null, ratings: [], counters: [], strengths: [], weaknesses: [], tags: [] });
const scouted = (team: number): TeamConsensus => ({
  ...empty(team), entries: 3, matchEntries: 2, pitEntries: 1, scouts: 2, lastUpdated: Date.now() - 120_000,
  ratings: [{ kind: "match", id: "driver", label: "Driver skill", type: "rating", avg: 4.5, max: 5, n: 2 }],
  counters: [{ kind: "match", id: "artifacts", label: "Artifacts classified (TeleOp)", type: "counter", avg: 25, n: 2 }],
  strengths: [{ label: "Driver skill", count: 2 }], weaknesses: [{ label: "Consistency", count: 1 }], tags: [{ label: "Returned to base: Full", count: 2 }],
});

let asked: string[] = [];
let answer: (ws: string, teams: number[]) => Response;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  localStorage.clear();
  invalidate("/api/");
  asked = [];
  answer = (ws, teams) => json(200, { workspaceId: ws, season: S, teams: teams.map(scouted) });
  vi.stubGlobal("fetch", async (path: string) => {
    asked.push(path);
    const m = /^\/api\/scout\/workspaces\/([^/]+)\/consensus\?(.*)$/.exec(path);
    if (!m) throw new Error(`unexpected ${path}`);
    return answer(m[1], new URLSearchParams(m[2]).get("teams")!.split(",").map(Number));
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); h.user = null; });

const team = (n = 18360) => render(<MemoryRouter><TeamConsensusSection team={n} season={S} /></MemoryRouter>);

describe("TeamConsensusSection", () => {
  it("a member sees their workspace's consensus, labelled as theirs", async () => {
    h.user = userIn([{ id: "901", name: "Gearheads" }]);
    team();
    expect(await screen.findByText("Your team's take")).toBeTruthy();
    expect(screen.getByText(/Gearheads scouting: what its scouts agree on/)).toBeTruthy();
    expect(await screen.findByText("4.5")).toBeTruthy();
    expect(screen.getByText("Returned to base: Full")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Strengths" }).textContent).toContain("Driver skill");
    expect(screen.getByRole("list", { name: "Weaknesses" }).textContent).toContain("Consistency");
    expect(asked).toEqual([`/api/scout/workspaces/901/consensus?season=${S}&teams=18360`]);
  });

  it("a non-member (403) sees nothing at all", async () => {
    h.user = userIn([{ id: "902", name: "Old team" }]);
    answer = () => json(403, { error: "You're not a member of this workspace in Control Point." });
    const { container } = team();
    await waitFor(() => expect(asked).toHaveLength(1));
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("signed out, or in no workspace: nothing shown and nothing asked", async () => {
    const a = team();
    expect(a.container.textContent).toBe("");
    a.unmount();
    h.user = userIn([]);
    const b = team();
    expect(b.container.textContent).toBe("");
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toEqual([]);
  });

  it("no entries yet: a link to scout the team in that workspace", async () => {
    h.user = userIn([{ id: "901", name: "Gearheads" }]);
    answer = (ws, teams) => json(200, { workspaceId: ws, season: S, teams: teams.map(empty) });
    team();
    const link = await screen.findByRole("link", { name: /Scout this team/ });
    expect(link.getAttribute("href")).toBe(`/scout?space=901&team=18360&season=${S}&new=1`);
    expect(screen.getByText("No scouting on 18360 in Gearheads yet.")).toBeTruthy();
  });

  it("shows the remembered workspace when it's still the account's; a remembered one it left is never asked about", async () => {
    h.user = userIn([{ id: "901", name: "Gearheads" }, { id: "903", name: "Robo Owls" }]);
    rememberSpace("903", "Robo Owls", 7);
    const a = team();
    expect(await screen.findByText(/Robo Owls scouting: what its scouts agree on/)).toBeTruthy();
    a.unmount();
    rememberSpace("999", "Someone else's", 7);
    team(101);
    expect(await screen.findByText(/Gearheads scouting: what its scouts agree on/)).toBeTruthy();
    expect(asked.some((p) => p.includes("/999/"))).toBe(false);
  });
});

describe("CompareConsensus", () => {
  it("one batched request for every team, one card each", async () => {
    h.user = userIn([{ id: "901", name: "Gearheads" }]);
    answer = (ws, teams) => json(200, { workspaceId: ws, season: S, teams: teams.map((t) => (t === 102 ? empty(t) : scouted(t))) });
    render(<MemoryRouter><CompareConsensus teams={[101, 102, 103]} season={S} colors={["red", "green", "blue"]} /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId("consensus-card")).toHaveLength(3));
    expect(await screen.findByText("No scouting on 102 in Gearheads yet.")).toBeTruthy();
    expect(screen.getAllByText(/3 entries by 2 scouts/)).toHaveLength(2);
    expect(asked).toEqual([`/api/scout/workspaces/901/consensus?season=${S}&teams=101%2C102%2C103`]);
  });
});
