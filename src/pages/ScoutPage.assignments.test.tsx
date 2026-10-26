// @vitest-environment jsdom
// Scouting assignments on the Scout page (Task 10): "Assigned to …" badges on entry cards, My assignments
// with live progress and Done, live changes from the stream, and the admin's Assign sheet (multi-select,
// with a duplicate warning that doesn't block).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import { saveScoutEntry } from "../lib/scouting";
import { announceAssignments } from "../lib/assignments";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import type { Assignment } from "../shared/assignments";
import { TooltipProvider } from "../components/ui/overlay";
import { asEntries } from "./scoutTestUrl";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: false, state: { videoLinks: {} } },
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: () => "off" }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));

const { default: ScoutPage } = await import("./ScoutPage");

const WS = "903", ME = 9001, SAM = 9002, EV = "USTST1";
const userAs = (role: "admin" | "member"): AccountUser => ({
  id: 1, email: "p@scout.test", displayName: "Priya", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: ME, member: true, teams: [], url: "", workspaces: [{ id: WS, name: "Gearheads", role }] },
});
const asg = (id: number, team: number, assignee: number, over: Partial<Assignment> = {}): Assignment => ({
  id, workspaceId: WS, season: 2025, eventCode: EV, team, assigneeAccountId: assignee, assigneeName: assignee === ME ? "Priya" : "Sam",
  createdByAccountId: 1, createdByName: "Coach", createdAt: Date.now() - 60_000, status: "open", doneAt: null, doneByAccountId: null, doneByName: null, version: 1, progress: 0, ...over,
});
let list: Assignment[];
/** Match scouting assignments ("Red 2, Q1 on"), and the event's schedule for the Match and Matches tabs. */
let matchList: unknown[];
const sched = { event: { name: "Test Qualifier" }, matches: [1, 2].map((n) => ({ season: 2025, code: EV, key: `qual:0:${n}`, level: "qual", series: 0, number: n, label: `Q${n}`, time: null, startsAt: null, played: false,
  red: { teams: [{ number: 1234, surrogate: false, dq: false, onField: true }, { number: 5678, surrogate: false, dq: false, onField: true }], score: null },
  blue: { teams: [{ number: 2222, surrogate: false, dq: false, onField: true }, { number: 3333, surrogate: false, dq: false, onField: true }], score: null }, video: null, prediction: null })) };
const masg = (id: number, assignee: number, watching: unknown) => ({ id, workspaceId: WS, season: 2025, eventCode: EV, watching, fromMatch: null, toMatch: null,
  assigneeAccountId: assignee, assigneeName: assignee === ME ? "Priya" : "Sam", createdByAccountId: 1, createdByName: "Coach", createdAt: 1, updatedAt: 1, version: 1 });
const calls: { method: string; path: string; body: any }[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  calls.length = 0;
  list = [asg(1, 1234, ME), asg(2, 5678, ME), asg(3, 2222, SAM)];
  matchList = [];
  h.personal = { user: userAs("member"), providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {} } };
  resetFlags({ ...DEFAULT_FLAGS });
  localStorage.setItem(`cs-scout-tpl:${WS}:2025`, JSON.stringify({ workspaceId: WS, season: 2025, version: 0, settingsVersion: 0, match: null, pit: null, updatedAt: null, updatedBy: null }));
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://x");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, path: u.pathname + u.search, body });
    const ok = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status });
    const p = `/api/scout/workspaces/${WS}/assignments`;
    if (u.pathname === `${p}/matches` && method === "GET") return ok({ matchAssignments: matchList });
    if (u.pathname === `/api/events/2025/${EV}`) return ok(sched);
    if (u.pathname === p && method === "GET") return ok({ assignments: list });
    if (u.pathname === "/api/events") return ok({ events: [{ season: 2025, code: EV, name: "Test Qualifier", start: "2025-11-01", end: "2025-11-01", city: "Edison", state: "NJ", country: "USA" }] });
    if (u.pathname === `${p}/options`) return ok({ members: [{ accountId: ME, name: "Priya", role: "admin" }, { accountId: SAM, name: "Sam", role: "member" }], teams: [{ team: 1234, name: "Alpha" }, { team: 2222, name: "Beta" }, { team: 5678, name: "Gamma" }] });
    if (u.pathname.startsWith(`${p}/`) && method === "PATCH") {
      const id = Number(u.pathname.split("/").pop());
      const a = { ...list.find((x) => x.id === id)!, status: body.status, doneByName: "Priya", doneByAccountId: ME, doneAt: Date.now() };
      return ok({ assignment: a, changed: true });
    }
    if (u.pathname === p && method === "POST") {
      const created = body.teams.flatMap((t: number) => body.assigneeAccountIds.map((m: number, i: number) => asg(100 + t + i, t, m)));
      return ok({ created, existing: [], duplicates: [{ team: 2222, assignees: [{ accountId: SAM, name: "Sam" }, { accountId: ME, name: "Priya" }] }] }, 201);
    }
    return ok({ error: "offline in tests" }, 500);
  }));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

const show = (url: string) => render(<TooltipProvider><MemoryRouter initialEntries={[asEntries(url)]}><ScoutPage /></MemoryRouter></TooltipProvider>);
const myCards = () => within(screen.getByRole("list", { name: "My assignments" })).getAllByRole("listitem");

describe("assignments on the Scout page", () => {
  it("entry cards carry an \"Assigned to\" badge for the team at that event", async () => {
    saveScoutEntry({ uuid: "assigned0001", season: 2025, team: 2222, eventCode: EV, matchLabel: "Q1", kind: "match", data: {}, notes: "", workspaceId: WS });
    saveScoutEntry({ uuid: "assigned0002", season: 2025, team: 1234, eventCode: EV, matchLabel: "Q2", kind: "match", data: {}, notes: "", workspaceId: WS });
    saveScoutEntry({ uuid: "assigned0003", season: 2025, team: 1234, eventCode: "OTHER", matchLabel: "Q3", kind: "match", data: {}, notes: "", workspaceId: WS });
    show(`/scout?space=${WS}&season=2025`);
    await waitFor(() => expect(screen.getByText("Assigned to Sam")).toBeTruthy());
    expect(screen.getAllByText("Assigned to you")).toHaveLength(1); // not on the entry at another event
    // Data's Assignments row counts my open assignments.
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Assignments/ }).textContent).toContain("2"));
  });

  it("My assignments: my teams with progress (this device's unsynced entries count), Done, and live changes", async () => {
    saveScoutEntry({ uuid: "progress0001", season: 2025, team: 1234, eventCode: EV, matchLabel: "Q1", kind: "match", data: {}, notes: "", workspaceId: WS });
    show(`/scout?space=${WS}&season=2025&view=assignments`);
    await waitFor(() => expect(myCards()).toHaveLength(2));
    expect(myCards()[0].textContent).toMatch(/1234.*1entry by you/);
    expect(myCards()[1].textContent).toMatch(/5678.*0entries by you/);
    expect(screen.queryByRole("button", { name: /^Assign$/ })).toBeNull(); // members don't assign
    fireEvent.click(within(myCards()[0]).getByRole("button", { name: /Done/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH" && c.path.endsWith("/assignments/1") && c.body.status === "done")).toBe(true));
    await waitFor(() => expect(myCards().at(-1)!.textContent).toMatch(/1234.*Done/));
    expect(within(myCards().at(-1)!).queryByRole("button", { name: /Reopen/ })).toBeNull(); // only admins reopen
    // Live: an admin assigns another team; it shows up without a refresh.
    act(() => announceAssignments(WS, { action: "created", assignments: [asg(7, 9999, ME)] }));
    await waitFor(() => expect(myCards().map((c) => c.textContent).join()).toContain("9999"));
    act(() => announceAssignments(WS, { action: "deleted", assignments: [asg(7, 9999, ME)] }));
    await waitFor(() => expect(myCards().map((c) => c.textContent).join()).not.toContain("9999"));
  });

  it("progress counts every entry this season, whatever team the entry list is filtered to", async () => {
    saveScoutEntry({ uuid: "progress0002", season: 2025, team: 1234, eventCode: EV, matchLabel: "Q1", kind: "match", data: {}, notes: "", workspaceId: WS });
    show(`/scout?space=${WS}&season=2025&team=5678&view=assignments`);
    await waitFor(() => expect(myCards()).toHaveLength(2));
    expect(myCards()[0].textContent).toMatch(/1234.*1entry by you/);
  });

  it("Scout on a card opens a new entry for that team at the assignment's event", async () => {
    show(`/scout?space=${WS}&season=2025&view=assignments`);
    await waitFor(() => expect(myCards()).toHaveLength(2));
    fireEvent.click(within(myCards()[1]).getByRole("button", { name: /Scout/ }));
    await waitFor(() => expect((screen.getByLabelText("Event code") as HTMLInputElement).value).toBe(EV));
    expect((screen.getByLabelText(/^Team/) as HTMLInputElement).value).toBe("5678");
    // A draft for the same team with another event typed in: Scout again starts afresh at the assignment's event.
    fireEvent.change(screen.getByLabelText("Event code"), { target: { value: "ELSEWHERE" } });
    fireEvent.click(screen.getByRole("button", { name: "Data" }));
    fireEvent.click(screen.getByRole("button", { name: /Assignments/ }));
    await waitFor(() => expect(myCards()).toHaveLength(2));
    fireEvent.click(within(myCards()[1]).getByRole("button", { name: /Scout/ }));
    await waitFor(() => expect((screen.getByLabelText("Event code") as HTMLInputElement).value).toBe(EV));
  });

  it("Scout on an assignment opens a match entry, even after a pit entry was started and cancelled", async () => {
    show(`/scout?space=${WS}&season=2025&tab=data`);
    fireEvent.click(await screen.findByRole("button", { name: /Pit scouting/ }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Pit" }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: /Assignments/ }));
    await waitFor(() => expect(myCards()).toHaveLength(2));
    fireEvent.click(within(myCards()[1]).getByRole("button", { name: /Scout/ }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Match" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("match scouting: your assignment prefills the session setup", async () => {
    matchList = [masg(11, ME, { kind: "slot", slot: "red2" })];
    show(`/scout?space=${WS}&season=2025&tab=match`);
    await waitFor(() => expect(screen.getByRole("radio", { name: /Red 2/ }).getAttribute("aria-checked")).toBe("true"));
  });

  it("match scouting: setup choices made in one workspace don't carry into another", async () => {
    h.personal.user = { ...userAs("member"), controlPoint: { ...userAs("member").controlPoint!, workspaces: [{ id: WS, name: "Gearheads", role: "member" }, { id: "904", name: "Bolt Bots", role: "member" }] } };
    matchList = [masg(11, ME, { kind: "slot", slot: "red2" })];
    show(`/scout?space=${WS}&season=2025&tab=match`);
    await waitFor(() => expect(screen.getByRole("radio", { name: /Red 2/ }).getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(screen.getByRole("radio", { name: /^All 4 teams/ }));
    fireEvent.click(screen.getByRole("button", { name: /Bolt Bots/ }));
    await waitFor(() => expect(screen.getByRole("radio", { name: /^One alliance/ }).getAttribute("aria-checked")).toBe("true")); // the default, not the other workspace's pick
  });

  it("match scouting: Matches says who has the other teams", async () => {
    matchList = [masg(11, ME, { kind: "alliance", side: "red" }), masg(12, SAM, { kind: "alliance", side: "blue" })];
    localStorage.setItem(`cs-scout-session:${WS}`, JSON.stringify({ season: 2025, eventCode: EV, watching: { kind: "alliance", side: "red" }, setAt: 1 }));
    show(`/scout?space=${WS}&season=2025&tab=matches`);
    expect((await screen.findAllByText(/Sam/)).length).toBeGreaterThan(0);
  });

  it("the assignment's event only holds in its space: switching space while the form is open falls back to that space's defaults", async () => {
    const u = userAs("member");
    u.controlPoint!.workspaces = [...u.controlPoint!.workspaces!, { id: "904", name: "Bolt Bots", role: "member" }];
    h.personal.user = u;
    localStorage.setItem("cs-scout-tpl:904:2025", JSON.stringify({ workspaceId: "904", season: 2025, version: 0, settingsVersion: 0, match: null, pit: null, updatedAt: null, updatedBy: null }));
    show(`/scout?space=${WS}&season=2025&view=assignments`);
    await waitFor(() => expect(myCards()).toHaveLength(2));
    fireEvent.click(within(myCards()[1]).getByRole("button", { name: /Scout/ }));
    await waitFor(() => expect((screen.getByLabelText("Event code") as HTMLInputElement).value).toBe(EV));
    fireEvent.click(within(screen.getByRole("group", { name: "Scout space" })).getByRole("button", { name: /Bolt Bots/ }));
    await waitFor(() => expect((screen.getByLabelText("Event code") as HTMLInputElement).value).toBe(""));
  });

  it("an entry change asks the server for progress again (so a deleted entry stops counting)", async () => {
    saveScoutEntry({ uuid: "refresh00001", season: 2025, team: 1234, eventCode: EV, matchLabel: "Q1", kind: "match", data: {}, notes: "", workspaceId: WS });
    show(`/scout?space=${WS}&season=2025`);
    await waitFor(() => expect(screen.getAllByText(/Assigned to/).length).toBeGreaterThan(0));
    const gets = () => calls.filter((c) => c.method === "GET" && c.path.includes("/assignments?")).length;
    const before = gets();
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));
    await waitFor(() => expect(gets()).toBeGreaterThan(before), { timeout: 5000 });
  });

  it("admin: the Assign sheet picks members and several teams, warns about a team someone holds, and still assigns", async () => {
    h.personal.user = userAs("admin");
    show(`/scout?space=${WS}&season=2025&view=assignments`);
    fireEvent.click(await screen.findByRole("button", { name: /^Assign$/ }));
    const sheet = await screen.findByRole("dialog");
    // The event is picked by name, from that season's events.
    fireEvent.change(within(sheet).getByRole("combobox"), { target: { value: "test qual" } });
    fireEvent.mouseDown(await within(sheet).findByRole("option", { name: /Test Qualifier/ }));
    expect(within(sheet).getByText("Test Qualifier")).toBeTruthy();
    await waitFor(() => expect(within(sheet).getByRole("list", { name: "Teams at this event" })).toBeTruthy());
    // Team rows carry who already holds them.
    expect(within(sheet).getByText("Assigned to Sam")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: /Priya/ }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Team 2222" }));
    fireEvent.click(within(sheet).getByRole("checkbox", { name: "Team 1234" }));
    expect(within(sheet).getByRole("status").textContent).toMatch(/2222: Sam, you/);
    fireEvent.click(within(sheet).getByRole("button", { name: "Assign 2 teams to 1 member" }));
    await waitFor(() => expect(calls.find((c) => c.method === "POST")?.body).toEqual({ season: 2025, eventCode: EV, teams: [1234, 2222], assigneeAccountIds: [ME] }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
