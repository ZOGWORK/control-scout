// @vitest-environment jsdom
// Task 12, opened offline: the account /api/auth/me last answered (cs-account-cache, Tier 3) stands
// in while /me can't answer, so the Scout page opens the workspace it would have and new entries go
// to that workspace (not to Personal); once /me answers, the usual sign-in sync runs and the queue
// goes up. Only the device's own account, only when offline, and gone after a sign-out.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ACCOUNT_CACHE_KEY, PersonalProvider, usePersonal, type AccountUser } from "./personal";
import { pendingScoutCounts, saveScoutEntry } from "./scouting";
import { ScoutQueueSync, useScoutSpaces } from "./scoutSpace";
import { resetFlags } from "./flags";
import { DEFAULT_FLAGS } from "../shared/flags";

const USER: AccountUser = {
  id: 1, email: "ada@scout.test", displayName: "Ada", createdAt: "", controlPointLinked: true,
  controlPoint: { accountId: 9001, member: true, teams: [], url: "", workspaces: [{ id: "41", name: "Gearheads", role: "member" }] },
};
const base = { season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: {}, notes: "" };

type Sent = { path: string; method: string; body: string };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
/** No network at all. */
const offline = () => vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
/** Back online: /me answers `user`; personal state and scout pushes are accepted. */
function online(user: AccountUser | null) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : "";
    const path = new URL(String(url), "http://x").pathname;
    sent.push({ path, method: init?.method ?? "GET", body });
    if (path === "/api/auth/me") return json({ user, providers: { email: true, google: false } });
    if (path === "/api/me/state") return json({ state: {} });
    if (path === "/api/me/migrate") return json({ state: JSON.parse(body).state });
    if (path === "/api/me/scout/sync") return json({ results: JSON.parse(body).entries.map((e: { uuid: string }) => ({ uuid: e.uuid, ok: true })) });
    if (path === "/api/me/scout") return json({ entries: [] });
    if (path === "/api/scout/sync") return json({ entries: [], cursor: 0, more: false });
    return json({ error: "not in this test" }, 404);
  }));
  return sent;
}

let seen: { user: AccountUser | null; offlineAccount: boolean; syncReady: boolean; space: string | null } | null = null;
function Probe() {
  const p = usePersonal();
  const spaces = useScoutSpaces();
  seen = { user: p.user, offlineAccount: p.offlineAccount, syncReady: p.syncReady, space: spaces.space };
  return null;
}
const mount = async () => {
  render(<MemoryRouter initialEntries={["/scout"]}><PersonalProvider><Probe /><ScoutQueueSync /></PersonalProvider></MemoryRouter>);
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

beforeEach(() => { localStorage.clear(); seen = null; resetFlags({ ...DEFAULT_FLAGS }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetFlags({ ...DEFAULT_FLAGS }); });

describe("opened offline", () => {
  it("the cached account stands in: its workspace opens, a new entry goes there, and syncs once /me answers", async () => {
    localStorage.setItem("cs-personal-owner", "1");
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(USER));
    offline();
    await mount();
    expect(seen).toMatchObject({ offlineAccount: true, syncReady: false, space: "41" });
    expect(seen!.user?.id).toBe(1);
    // The page saves to the space on screen: the workspace, not Personal.
    act(() => { saveScoutEntry({ uuid: "offline00001", ...base, workspaceId: seen!.space }); });
    expect(pendingScoutCounts()).toEqual({ personal: 0, workspaces: { 41: 1 } });
    // Back online: /me answers, the sign-in sync runs, and the queue goes up to the workspace.
    const sent = online(USER);
    await act(async () => { window.dispatchEvent(new Event("online")); await new Promise((r) => setTimeout(r, 50)); });
    await vi.waitFor(() => expect(pendingScoutCounts().workspaces).toEqual({}));
    const push = sent.find((s) => s.path === "/api/me/scout/sync" && JSON.parse(s.body).workspaceId === "41");
    expect(JSON.parse(push!.body).entries.map((e: { uuid: string }) => e.uuid)).toEqual(["offline00001"]);
    expect(seen).toMatchObject({ offlineAccount: false, syncReady: true, space: "41" });
  });

  it("back online but signed out (the session ended): the stand-in goes, and the queue stays on the device", async () => {
    localStorage.setItem("cs-personal-owner", "1");
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(USER));
    offline();
    await mount();
    act(() => { saveScoutEntry({ uuid: "offline00002", ...base, workspaceId: "41" }); });
    online(null);
    await act(async () => { window.dispatchEvent(new Event("online")); await new Promise((r) => setTimeout(r, 50)); });
    expect(seen).toMatchObject({ user: null, offlineAccount: false, space: null });
    expect(localStorage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
    expect(pendingScoutCounts().workspaces).toEqual({ 41: 1 }); // kept for the next sign-in
  });

  it("only this device's own account, and only when offline (a server error isn't)", async () => {
    localStorage.setItem("cs-personal-owner", "2"); // the device's data is another account's
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(USER));
    offline();
    await mount();
    expect(seen).toMatchObject({ user: null, offlineAccount: false, space: null });
    cleanup();
    localStorage.setItem("cs-personal-owner", "1");
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "boom" }, 500)));
    await mount();
    expect(seen).toMatchObject({ user: null, offlineAccount: false });
  });

  it("written on every answer with an account, removed on sign-out", async () => {
    online(USER);
    await mount();
    await vi.waitFor(() => expect(seen?.syncReady).toBe(true));
    expect(JSON.parse(localStorage.getItem(ACCOUNT_CACHE_KEY)!)).toMatchObject({ id: 1, controlPoint: { workspaces: [{ id: "41" }] } });
    let signOut!: () => Promise<void>;
    function Out() { signOut = usePersonal().signOut; return null; }
    cleanup();
    render(<MemoryRouter><PersonalProvider><Out /></PersonalProvider></MemoryRouter>);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); await signOut(); });
    expect(localStorage.getItem(ACCOUNT_CACHE_KEY)).toBeNull();
  });
});
