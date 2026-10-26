// @vitest-environment jsdom
// The Scout page's spaces: the switcher (Personal | each workspace), which space opens, that the
// list and new entries follow the active space with nothing leaking across, pending counts per
// space, the revoked → Personal switch, and Personal only when signed out or the flag is off.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { AccountUser } from "../lib/personal";
import type { LiveMode } from "../lib/scoutLive";
import { localScoutEntries, saveScoutEntry } from "../lib/scouting";
import { resetFlags } from "../lib/flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import { SPACE_STORAGE_KEY } from "../lib/scoutSpace";
import { TooltipProvider } from "../components/ui/overlay";
import { asEntries } from "./scoutTestUrl";

const h = vi.hoisted(() => ({
  personal: { user: null as AccountUser | null, providers: { email: true, google: false } as object | null, syncReady: false, state: { videoLinks: {} } },
  live: "off" as LiveMode,
  generations: [] as number[],
  lookup: async (_n: number): Promise<string | null> => "Test Team",
}));
vi.mock("../lib/personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../lib/scoutLive", () => ({ useScoutLive: (space: string | null, _signedIn: boolean, generation = 0) => { h.generations.push(generation); return space == null ? "off" : h.live; } }));
vi.mock("../components/MatchVideo", () => ({ Recordings: () => null }));
vi.mock("../components/TeamInput", async (orig) => ({ ...(await orig<typeof import("../components/TeamInput")>()), lookupTeamName: (n: number) => h.lookup(n) }));

const { default: ScoutPage } = await import("./ScoutPage");

const gear = { id: "901", name: "Gearheads", role: "admin" as const };
const bolt = { id: "902", name: "Bolt Bots", role: "member" as const };
const signedIn = (workspaces: { id: string; name: string; role: "admin" | "member" }[] | undefined = [gear, bolt]): AccountUser => ({
  id: 1, email: "a@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9001, member: true, teams: [], url: "", ...(workspaces ? { workspaces } : {}) },
});

let where = "";
function Where() { const l = useLocation(); where = l.pathname + l.search; return null; }
const page = (url: string) => <TooltipProvider><MemoryRouter initialEntries={[asEntries(url)]}><ScoutPage /><Where /></MemoryRouter></TooltipProvider>;
const show = (url = "/scout?season=2025") => render(page(url));
const param = () => new URLSearchParams(where.split("?")[1]).get("space");
const switcher = () => screen.queryByRole("group", { name: "Scout space" });
const listed = () => screen.queryAllByRole("listitem").map((li) => li.textContent ?? "");

const base = { season: 2025, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: {}, notes: "" };
function seed() {
  saveScoutEntry({ uuid: "personal0001", ...base, team: 1111 });
  saveScoutEntry({ uuid: "gearheads001", ...base, team: 2222, workspaceId: "901" });
  saveScoutEntry({ uuid: "boltbots0001", ...base, team: 3333, workspaceId: "902" });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  h.personal = { user: null, providers: { email: true, google: false }, syncReady: false, state: { videoLinks: {} } };
  h.live = "off";
  h.lookup = async () => "Test Team";
  resetFlags({ ...DEFAULT_FLAGS });
  seed();
  // This device has seen both workspaces' (never customised) templates, so new-entry forms open at once.
  for (const w of ["901", "902"]) localStorage.setItem(`cs-scout-tpl:${w}:2025`, JSON.stringify({ workspaceId: w, season: 2025, version: 0, settingsVersion: 0, match: null, pit: null, updatedAt: null, updatedBy: null }));
});
afterEach(() => { cleanup(); resetFlags({ ...DEFAULT_FLAGS }); vi.unstubAllGlobals(); });

describe("Scout spaces", () => {
  it("signed out: Personal only, no switcher, the URL left alone", () => {
    show("/scout?season=2025&space=901");
    expect(switcher()).toBeNull();
    expect(listed().join()).toContain("1111");
    expect(listed().join()).not.toMatch(/2222|3333/);
    expect(param()).toBe("901");
    expect(localStorage.getItem(SPACE_STORAGE_KEY)).toBeNull();
  });

  it("signed in with workspaces: the first opens, written to the URL and remembered on this device", async () => {
    h.personal.user = signedIn();
    show();
    const group = switcher()!;
    // (seed() queued one entry in each space: the spaces not on screen show it.)
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Personal1 pending", "Gearheadsadmin", "Bolt Bots1 pending"]);
    expect(within(group).getByRole("button", { pressed: true }).textContent).toContain("Gearheads");
    expect(listed().join()).toContain("2222");
    expect(listed().join()).not.toMatch(/1111|3333/);
    await waitFor(() => expect(param()).toBe("901"));
    expect(JSON.parse(localStorage.getItem(SPACE_STORAGE_KEY)!)).toEqual({ id: "901", name: "Gearheads", account: 1 });
  });

  it("the switcher changes the space and its list, with nothing leaking across", async () => {
    h.personal.user = signedIn();
    show();
    fireEvent.click(screen.getByRole("button", { name: /^Bolt Bots/ }));
    await waitFor(() => expect(param()).toBe("902"));
    expect(listed().join()).toContain("3333");
    expect(listed().join()).not.toMatch(/1111|2222/);
    fireEvent.click(screen.getByRole("button", { name: /^Personal/ }));
    await waitFor(() => expect(param()).toBe("personal"));
    expect(listed().join()).toContain("1111");
    expect(listed().join()).not.toMatch(/2222|3333/);
    expect(JSON.parse(localStorage.getItem(SPACE_STORAGE_KEY)!)).toEqual({ id: "personal", account: 1 });
  });

  it("the URL wins over the remembered space", () => {
    localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify({ id: "901", name: "Gearheads" }));
    h.personal.user = signedIn();
    show("/scout?season=2025&space=902");
    expect(screen.getByRole("button", { pressed: true }).textContent).toBe("Bolt Bots");
    expect(param()).toBe("902");
  });

  it("a remembered workspace the account left: the default opens, with a notice naming it", async () => {
    localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify({ id: "777", name: "Old Team" }));
    h.personal.user = signedIn();
    show();
    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("Gearheads");
    expect((await screen.findByRole("status")).textContent).toContain("You no longer have access to Old Team");
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SPACE_STORAGE_KEY)!).id).toBe("901"));
  });

  it("a new entry is saved to the active space", async () => {
    h.personal.user = signedIn();
    show("/scout?season=2025&space=902");
    fireEvent.click(screen.getByRole("button", { name: /New entry/ }));
    expect(screen.getByText(/Saves to/).textContent).toContain("Bolt Bots");
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "4444" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries("902").some((e) => e.team === 4444)).toBe(true));
    expect(localScoutEntries("902").find((e) => e.team === 4444)!.workspaceId).toBe("902");
    expect(localScoutEntries(null).some((e) => e.team === 4444)).toBe(false);
    expect(localScoutEntries("901").some((e) => e.team === 4444)).toBe(false);
  });

  it("pending counts per space: a badge on the other spaces, the header for the active one", async () => {
    h.personal.user = signedIn();
    h.personal.syncReady = false;
    show();
    // seed() queued one entry in each space; the active one (Gearheads) shows no badge of its own.
    const group = switcher()!;
    expect(within(group).getByRole("button", { name: /Personal/ }).textContent).toBe("Personal1 pending");
    expect(within(group).getByRole("button", { name: /Bolt Bots/ }).textContent).toBe("Bolt Bots1 pending");
    expect(within(group).getByRole("button", { name: /Gearheads/ }).textContent).toBe("Gearheadsadmin");
    act(() => { saveScoutEntry({ uuid: "boltbots0002", ...base, team: 5555, workspaceId: "902" }); });
    expect(within(group).getByRole("button", { name: /Bolt Bots/ }).textContent).toBe("Bolt Bots2 pending");
  });

  it("the live stream says access ended: back to Personal, with a notice", async () => {
    h.personal.user = signedIn();
    const r = show();
    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("Gearheads");
    h.live = "revoked";
    r.rerender(page("/scout?season=2025"));
    await waitFor(() => expect(param()).toBe("personal"));
    expect(screen.getByRole("status").textContent).toContain("You were removed from Gearheads.");
    expect(screen.queryByRole("button", { name: /Gearheads/ })).toBeNull();
    expect(listed().join()).toContain("1111");
  });

  it("the workspace on screen leaves the account's list: back to Personal, with a notice", async () => {
    h.personal.user = signedIn();
    const r = show();
    h.personal = { ...h.personal, user: signedIn([bolt]) };
    r.rerender(page("/scout?season=2025"));
    await waitFor(() => expect(param()).toBe("personal"));
    expect(screen.getByRole("status").textContent).toContain("You were removed from Gearheads.");
  });

  it("switching spaces while Save checks the team: nothing goes to the old space; the next Save goes to the new one", async () => {
    let answer!: (v: string) => void;
    h.lookup = () => new Promise((r) => { answer = r; });
    h.personal.user = signedIn();
    show("/scout?season=2025&space=901");
    fireEvent.click(screen.getByRole("button", { name: /New entry/ }));
    fireEvent.change(screen.getByLabelText("Team"), { target: { value: "4444" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bolt Bots/ }));
    await waitFor(() => expect(param()).toBe("902"));
    await act(async () => { answer("Test Team"); });
    expect(localScoutEntries("901").some((e) => e.team === 4444)).toBe(false);
    expect(localScoutEntries("902").some((e) => e.team === 4444)).toBe(false);
    h.lookup = async () => "Test Team";
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(localScoutEntries("902").some((e) => e.team === 4444)).toBe(true));
    expect(localScoutEntries("901").some((e) => e.team === 4444)).toBe(false);
  });

  it("another account signing in on the same page: no notice, and the first account's revoked workspaces don't carry over", async () => {
    h.personal.user = signedIn();
    h.live = "revoked";
    const r = show();
    await waitFor(() => expect(param()).toBe("personal"));
    h.live = "off";
    h.personal = { ...h.personal, user: { ...signedIn([gear]), id: 2 } };
    r.rerender(page("/scout?season=2025"));
    expect(screen.getByRole("button", { name: /^Gearheads/ })).toBeTruthy();
    cleanup();
    // And the other way: a page showing A's workspace, then B (without it) signs in: no "no longer have access".
    localStorage.removeItem(SPACE_STORAGE_KEY);
    h.personal = { ...h.personal, user: signedIn([gear]) };
    const r2 = show();
    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("Gearheads");
    h.personal = { ...h.personal, user: { ...signedIn([bolt]), id: 3 } };
    r2.rerender(page("/scout?season=2025&space=901"));
    await waitFor(() => expect(screen.getByRole("button", { pressed: true }).textContent).toContain("Bolt Bots"));
    expect(screen.queryByText(/no longer have access/)).toBeNull();
  });

  it("workspace scouting switched off: Personal only", () => {
    resetFlags({ ...DEFAULT_FLAGS, workspaceScouting: false });
    h.personal.user = signedIn();
    show("/scout?season=2025&space=901");
    expect(switcher()).toBeNull();
    expect(listed().join()).toContain("1111");
    expect(listed().join()).not.toMatch(/2222|3333/);
  });

  it("before sign-in answers, a remembered workspace isn't replaced by a flash of Personal", () => {
    localStorage.setItem(SPACE_STORAGE_KEY, JSON.stringify({ id: "901", name: "Gearheads" }));
    h.personal.providers = null;
    show();
    expect(listed().join()).not.toContain("1111");
    expect(screen.getByRole("status", { name: /Loading scout space/ })).toBeTruthy();
  });

  it("a push or pull for the space on screen refused (403): back to Personal, with a notice", async () => {
    h.personal.user = signedIn();
    show();
    expect(screen.getByRole("button", { pressed: true }).textContent).toContain("Gearheads");
    act(() => { window.dispatchEvent(new CustomEvent("cs-scout-denied", { detail: "901" })); });
    await waitFor(() => expect(param()).toBe("personal"));
    expect(screen.getByRole("status").textContent).toContain("You were removed from Gearheads.");
  });

  it("the manual refresh: pushes the queue, pulls from the cursor, re-reads the account and reconnects the stream, then says so", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      const answer = init?.method === "POST" ? { results: body.entries.map((e: { uuid: string }) => ({ uuid: e.uuid, ok: true })) } : { entries: [], cursor: 7, more: false };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const refreshUser = vi.fn(async () => { calls.push("refreshUser"); });
    h.personal = { ...h.personal, user: signedIn(), syncReady: true, refreshUser } as typeof h.personal;
    show();
    await waitFor(() => expect(calls.some((c) => c.startsWith("GET /api/scout/sync?workspaceId=901"))).toBe(true)); // the page's own first sync
    const gen = h.generations.at(-1)!;
    calls.length = 0;
    saveScoutEntry({ uuid: "gearheads002", ...base, team: 4444, workspaceId: "901" }); // queued, not pushed yet
    calls.length = 0;
    const resyncs: unknown[] = [];
    window.addEventListener("cs-scout-comments-resync", (e) => resyncs.push((e as CustomEvent).detail));
    fireEvent.click(screen.getByRole("button", { name: "Refresh this space" }));
    expect(await screen.findByText("Updated just now")).toBeTruthy();
    // (The page's first pull moved the cursor to 7: the refresh pulls from there.)
    const pushed = calls.indexOf("POST /api/me/scout/sync"), pulled = calls.indexOf("GET /api/scout/sync?workspaceId=901&since=7");
    expect(pushed).toBeGreaterThanOrEqual(0); // the queue first…
    expect(pulled).toBeGreaterThan(pushed); // …then the catch-up pull from the cursor…
    expect(calls).toContain("refreshUser"); // …the account (/api/auth/me)…
    expect(h.generations.at(-1)).toBe(gen + 1); // …and a fresh stream
    expect(resyncs).toContainEqual({ space: "901" }); // open comment threads refetch too
    // Another space has its own status: Gearheads' "Updated just now" isn't shown for Bolt Bots.
    fireEvent.click(within(switcher()!).getByRole("button", { name: /Bolt Bots/ }));
    await waitFor(() => expect(param()).toBe("902"));
    expect(screen.queryByText("Updated just now")).toBeNull();
    expect(localStorage.getItem("cs-scout-ws-cursor:901")).toBe("7");
  });

  it("the manual refresh says when it couldn't update", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    h.personal = { ...h.personal, user: signedIn(), syncReady: true, refreshUser: async () => undefined } as typeof h.personal;
    show();
    fireEvent.click(screen.getByRole("button", { name: "Refresh this space" }));
    expect(await screen.findByText("Couldn't update. Check your connection.")).toBeTruthy();
  });

  it("many workspaces: a dropdown instead of the segmented control", () => {
    h.personal.user = signedIn(Array.from({ length: 5 }, (_, i) => ({ id: `w${i}`, name: `Team ${i}`, role: "member" as const })));
    show();
    expect(switcher()).toBeNull();
    expect(screen.getByRole("combobox", { name: "Scout space" }).textContent).toContain("Team 0");
  });
});
