// @vitest-environment jsdom
// The demo account on a device (personal.tsx): entering puts the device's own data aside (never merged into the
// demo), leaving puts it back; and when the device is too full to put it aside, leaving never wipes it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PersonalProvider, usePersonal, type AccountUser } from "./personal";
import { resetFlags } from "./flags";
import { isDemoSession } from "./api";
import { DEFAULT_FLAGS } from "../shared/flags";

const DEMO: AccountUser = { id: 77, email: null, displayName: "Demo Scout", createdAt: "", demo: true, controlPointLinked: true,
  controlPoint: { accountId: 2_100_000_000, member: true, teams: [], url: "", workspaces: [{ id: "demo-sample-workspace", name: "Demo", role: "admin" }] } };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

let signedIn = true;
const sent: string[] = [];
function server() {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(String(url), "http://x").pathname;
    sent.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/auth/me") return json({ user: signedIn ? DEMO : null, providers: { email: true, google: false } });
    if (path === "/api/auth/logout") { signedIn = false; return json({ ok: true }); }
    if (path === "/api/me/state") return json({ state: { myTeam: { value: 19666, updatedAt: 1 }, bookmarks: { value: [19641, 16095], updatedAt: 1 } } });
    if (path === "/api/me/scout") return json({ entries: [] });
    return json({ error: "not in this test" }, 404);
  }));
}

let api: ReturnType<typeof usePersonal> | null = null;
function Probe() { api = usePersonal(); return null; }
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const mine = () => ({ myTeam: JSON.parse(localStorage.getItem("cs-personal:myTeam") ?? "null")?.value, bookmarks: JSON.parse(localStorage.getItem("cs-personal:bookmarks") ?? "null")?.value });

beforeEach(() => {
  localStorage.clear(); sent.length = 0; signedIn = true; api = null; resetFlags({ ...DEFAULT_FLAGS });
  // A signed-out visitor's own data on this device.
  localStorage.setItem("cs-personal:myTeam", JSON.stringify({ value: 18360, updatedAt: 5 }));
  localStorage.setItem("cs-personal:bookmarks", JSON.stringify({ value: [7244], updatedAt: 5 }));
  server();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the demo account on a device", () => {
  it("puts the visitor's data aside, never merges it, and puts it back on leaving", async () => {
    render(<MemoryRouter><PersonalProvider><Probe /></PersonalProvider></MemoryRouter>);
    await settle();
    expect(api!.user?.demo).toBe(true);
    expect(api!.state.myTeam).toBe(19666);
    expect(sent).not.toContain("POST /api/me/migrate"); // never absorbed into the shared demo
    expect(sent.some((s) => s.startsWith("PUT /api/me/state"))).toBe(false); // the demo keeps nothing
    await act(async () => { await api!.signOut(); });
    await settle();
    expect(mine()).toEqual({ myTeam: 18360, bookmarks: [7244] });
    expect(localStorage.getItem("cs-demo-return")).toBeNull();
    expect(localStorage.getItem("cs-personal-owner")).toBe("");
  });

  it("a demo session that expired: the next page load gives the device its own data back", async () => {
    render(<MemoryRouter><PersonalProvider><Probe /></PersonalProvider></MemoryRouter>);
    await settle();
    expect(api!.user?.demo).toBe(true);
    cleanup();
    signedIn = false; // the cookie is gone: /me answers no one
    render(<MemoryRouter><PersonalProvider><Probe /></PersonalProvider></MemoryRouter>);
    await settle();
    expect(api!.user).toBeNull();
    expect(mine()).toEqual({ myTeam: 18360, bookmarks: [7244] });
    expect(api!.state.myTeam).toBe(18360);
    expect(localStorage.getItem("cs-demo-return")).toBeNull();
    expect(isDemoSession()).toBe(false);
  });

  it("a device too full to put the data aside: leaving the demo wipes nothing", async () => {
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith("cs-stash")) throw new DOMException("full", "QuotaExceededError");
      return set.call(this, k, v);
    });
    render(<MemoryRouter><PersonalProvider><Probe /></PersonalProvider></MemoryRouter>);
    await settle();
    expect(localStorage.getItem("cs-demo-return")).toBeNull();
    await act(async () => { await api!.signOut(); });
    await settle();
    expect(mine()).toEqual({ myTeam: 18360, bookmarks: [7244] });
  });
});
