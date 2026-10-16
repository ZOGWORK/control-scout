// @vitest-environment jsdom
// Offline entries in every space go up when the connection returns: pushes to one space never
// overlap, the background sync covers Personal and the account's workspaces (not one it left, and
// none while workspace scouting is off), and the pending counts follow saves and syncs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { ACCOUNT_STALE, localScoutEntries, moveQueuedToPersonal, personalCopy, pendingScoutCounts, saveScoutEntry, syncQueuedScouting, syncScouting, usePendingScoutCounts, type ScoutEntry } from "./scouting";
import { resetFlags } from "./flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import type { AccountUser } from "./personal";

const h = vi.hoisted(() => ({ personal: { user: null as AccountUser | null, syncReady: false } as { user: AccountUser | null; syncReady: boolean; refreshUser?: () => Promise<void> }, toasts: [] as string[] }));
vi.mock("./personal", () => ({ usePersonal: () => h.personal }));
vi.mock("../components/ui/sonner", () => ({ toast: Object.assign((m: string) => { h.toasts.push(m); }, { warning: (m: string) => { h.toasts.push(m); } }) }));
const { ScoutQueueSync } = await import("./scoutSpace");

/** A server that refuses pushes to `refused` (403, as for a member removed in Control Point) and accepts the rest. */
function refusing(refused: string) {
  const calls: { workspaceId: string | null; uuids: string[] }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ workspaceId: body.workspaceId ?? null, uuids: (body.entries ?? []).map((e: ScoutEntry) => e.uuid) });
    if (body.workspaceId === refused) return new Response(JSON.stringify({ error: "You're not a member of this workspace in Control Point." }), { status: 403, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ results: body.entries.map((e: ScoutEntry) => ({ uuid: e.uuid, ok: true })) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return { calls };
}

const base = { season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: {}, notes: "" };
const user = (ids: string[]): AccountUser => ({ id: 1, email: null, displayName: null, createdAt: "",
  controlPoint: { accountId: 9001, member: true, teams: [], url: "", workspaces: ids.map((id) => ({ id, name: `W${id}`, role: "member" as const })) } });

/** A server that accepts every push; `gate` holds answers until released. */
function server() {
  const calls: { workspaceId: string | null; uuids: string[] }[] = [];
  let release: (() => void) | null = null;
  const state = { hold: false };
  vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ workspaceId: body.workspaceId ?? null, uuids: body.entries.map((e: ScoutEntry) => e.uuid) });
    if (state.hold) await new Promise<void>((r) => { release = r; });
    return new Response(JSON.stringify({ results: body.entries.map((e: ScoutEntry) => ({ uuid: e.uuid, ok: true })) }), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  return { calls, state, release: () => release?.() };
}

beforeEach(() => { localStorage.clear(); h.toasts = []; h.personal = { user: null, syncReady: false }; resetFlags({ ...DEFAULT_FLAGS }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); resetFlags({ ...DEFAULT_FLAGS }); });

describe("pushing queued entries", () => {
  it("two pushes to one space don't overlap: the second waits, then sends only what's left", async () => {
    const s = server();
    saveScoutEntry({ uuid: "aaaaaaaaaaaa", ...base, workspaceId: "41" });
    s.state.hold = true;
    const first = syncScouting("41");
    const second = syncScouting("41");
    await vi.waitFor(() => expect(s.calls).toHaveLength(1));
    s.state.hold = false;
    s.release();
    await first; await second;
    expect(s.calls).toHaveLength(1); // the queue was empty by the time the second ran
    expect(pendingScoutCounts().workspaces).toEqual({});
  });

  it("syncQueuedScouting pushes Personal and the given workspaces with entries waiting, not others", async () => {
    const s = server();
    saveScoutEntry({ uuid: "pppppppppppp", ...base });
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "41" });
    saveScoutEntry({ uuid: "wwwwwwwwwww2", ...base, workspaceId: "42" }); // a workspace the account left
    await syncQueuedScouting(["41", "43"]);
    expect(s.calls.map((c) => c.workspaceId).sort()).toEqual(["41", null].sort());
    expect(pendingScoutCounts()).toEqual({ personal: 0, workspaces: { 42: 1 } });
  });

  it("usePendingScoutCounts follows saves and syncs", async () => {
    server();
    const { result } = renderHook(() => usePendingScoutCounts());
    expect(result.current).toEqual({ personal: 0, workspaces: {} });
    act(() => { saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "41" }); });
    expect(result.current).toEqual({ personal: 0, workspaces: { 41: 1 } });
    await act(async () => { await syncScouting("41"); });
    expect(result.current).toEqual({ personal: 0, workspaces: {} });
  });
});

describe("ScoutQueueSync (the app-wide reconnect trigger)", () => {
  it("offline entries in a workspace not on screen go up when the connection returns", async () => {
    const s = server();
    h.personal = { user: user(["41"]), syncReady: true };
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); })); // offline
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "41" });
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(pendingScoutCounts().workspaces).toEqual({ 41: 1 })); // tried, still queued
    vi.unstubAllGlobals();
    const back = server();
    act(() => { window.dispatchEvent(new Event("online")); });
    await vi.waitFor(() => expect(pendingScoutCounts().workspaces).toEqual({}));
    expect(back.calls).toEqual([{ workspaceId: "41", uuids: ["wwwwwwwwwww1"] }]);
    expect(s.calls).toEqual([]);
  });

  it("retries every 30 s while entries wait", async () => {
    vi.useFakeTimers();
    h.personal = { user: user(["41"]), syncReady: true };
    render(<ScoutQueueSync />);
    const s = server();
    act(() => { saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "41" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(s.calls).toEqual([{ workspaceId: "41", uuids: ["wwwwwwwwwww1"] }]);
  });

  it("nothing for workspaces while workspace scouting is off (Personal still goes)", async () => {
    resetFlags({ ...DEFAULT_FLAGS, workspaceScouting: false });
    const s = server();
    h.personal = { user: user(["41"]), syncReady: true };
    saveScoutEntry({ uuid: "pppppppppppp", ...base });
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "41" });
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(pendingScoutCounts().personal).toBe(0));
    expect(s.calls.map((c) => c.workspaceId)).toEqual([null]);
    expect(pendingScoutCounts().workspaces).toEqual({ 41: 1 });
  });

  it("revoked while offline: a workspace's queue the server refuses (403) and the account no longer lists moves to Personal, nothing lost", async () => {
    // Saved in workspace 42 while offline; meanwhile the account was removed from it in Control Point.
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, team: 2222, notes: "slow lift", workspaceId: "42" });
    const gone = saveScoutEntry({ uuid: "wwwwwwwwwww2", ...base, team: 3333, workspaceId: "42" });
    saveScoutEntry({ ...gone, deleted: true, data: {}, notes: "" }); // a delete queued there too
    localStorage.setItem("cs-scout-space", JSON.stringify({ id: "42", name: "Robo Lions", account: 1 }));
    const s = refusing("42");
    h.personal = { user: user(["41"]), syncReady: true }; // Control Point's answer: 41 only
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(pendingScoutCounts().workspaces).toEqual({}));
    expect(s.calls.filter((c) => c.workspaceId === "42")).toHaveLength(1); // asked the server once more first
    // The new entry is in Personal now (a new personal entry, queued for the account); the delete was let go.
    const personal = localScoutEntries(null);
    expect(personal.map((e) => [e.team, e.notes, e.workspaceId])).toEqual([[2222, "slow lift", null]]);
    expect(personal[0].uuid).not.toBe("wwwwwwwwwww1");
    expect(localScoutEntries("42")).toEqual([]); // the queued delete was let go, its local tombstone with it
    expect(h.toasts).toEqual([expect.stringMatching(/^1 entry saved in Robo Lions couldn't sync: you're no longer a member there\. It's kept in Personal/)]);
    await vi.waitFor(() => expect(pendingScoutCounts().personal).toBe(0)); // and Personal syncs it to the account
  });

  it("another account signing in while the rescue's push is on its way: its queue is never moved", async () => {
    localStorage.setItem("cs-personal-owner", "1");
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "42" });
    let answer!: () => void;
    const gate = new Promise<void>((r) => { answer = r; });
    vi.stubGlobal("fetch", vi.fn(async () => { await gate; return new Response(JSON.stringify({ error: "not a member" }), { status: 403, headers: { "Content-Type": "application/json" } }); }));
    h.personal = { user: user(["41"]), syncReady: true };
    render(<ScoutQueueSync />);
    await new Promise((r) => setTimeout(r, 20));
    // Account 2 takes over the device (personal.tsx swaps the local data and the owner) before the 403 lands.
    localStorage.setItem("cs-personal-owner", "2");
    await act(async () => { answer(); await new Promise((r) => setTimeout(r, 30)); });
    expect(pendingScoutCounts().workspaces).toEqual({ 42: 1 });
    expect(localScoutEntries(null)).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("moving keeps the workspace's own answers readable: they go into the notes, built-in answers stay answers", () => {
    localStorage.setItem("cs-scout-tpl:42:2025", JSON.stringify({ workspaceId: "42", season: 2025, version: 3, settingsVersion: 3,
      match: [{ id: "custom_lift", label: "Lift height", type: "number", phase: "endgame" }, { id: "fouls", label: "Fouls drawn", type: "counter", phase: "overall" }], pit: null, updatedAt: null, updatedBy: null }));
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, notes: "quick", data: { custom_lift: 42, fouls: 2, custom_none: "" }, workspaceId: "42" });
    expect(moveQueuedToPersonal("42")).toBe(1);
    const [e] = localScoutEntries(null);
    expect(e.data).toEqual({ fouls: 2 });
    expect(e.notes).toBe("quick\n\nWorkspace answers:\nLift height: 42");
  });

  it("personalCopy names the workspace the answers came from, and says yes for a ticked toggle", () => {
    expect(personalCopy({ ramp: true, defense: true }, "", [{ id: "ramp", label: "Used the ramp" }], [{ id: "defense" }], "Robo Raptors"))
      .toEqual({ data: { defense: true }, notes: "Answers from Robo Raptors:\nUsed the ramp: yes" });
  });

  it("moving resets the workspace's pull cursor, so a later re-add pulls everything again", () => {
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "42" });
    localStorage.setItem("cs-scout-ws-cursor:42", "17");
    expect(moveQueuedToPersonal("42")).toBe(1);
    expect(localStorage.getItem("cs-scout-ws-cursor:42")).toBeNull();
  });

  it("a device too full to queue the Personal copy: nothing moves, and no half-made copy is left (a retry makes no duplicates)", () => {
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "42" });
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === "cs-scout-dirty") throw new DOMException("full", "QuotaExceededError");
      return real.call(this, k, v);
    });
    try {
      expect(moveQueuedToPersonal("42")).toBe(0);
      expect(moveQueuedToPersonal("42")).toBe(0);
    } finally { spy.mockRestore(); }
    expect(localScoutEntries(null)).toEqual([]);
    expect(pendingScoutCounts().workspaces).toEqual({ 42: 1 });
    expect(localScoutEntries("42").map((e) => e.uuid)).toEqual(["wwwwwwwwwww1"]);
    expect(moveQueuedToPersonal("42")).toBe(1); // room again: it moves, once
    expect(localScoutEntries(null)).toHaveLength(1);
  });

  it("a workspace the account no longer lists but the server still accepts: synced there, not moved", async () => {
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "42" });
    const s = server();
    h.personal = { user: user(["41"]), syncReady: true };
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(pendingScoutCounts().workspaces).toEqual({}));
    expect(s.calls).toEqual([{ workspaceId: "42", uuids: ["wwwwwwwwwww1"] }]);
    expect(localScoutEntries(null)).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("nothing moves while Control Point's answer is unknown, or for a failure other than 403", async () => {
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "42" });
    const unknown: AccountUser = { ...user([]), controlPoint: null };
    refusing("42");
    h.personal = { user: unknown, syncReady: true };
    const { unmount } = render(<ScoutQueueSync />);
    await new Promise((r) => setTimeout(r, 30));
    expect(pendingScoutCounts().workspaces).toEqual({ 42: 1 });
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "down" }), { status: 500, headers: { "Content-Type": "application/json" } })));
    h.personal = { user: user(["41"]), syncReady: true };
    render(<ScoutQueueSync />);
    await new Promise((r) => setTimeout(r, 30));
    expect(pendingScoutCounts().workspaces).toEqual({ 42: 1 });
    expect(localScoutEntries(null)).toEqual([]);
  });

  it("a refused push or pull (403) re-reads the account at once", async () => {
    const refreshUser = vi.fn(async () => undefined);
    h.personal = { user: user(["41"]), syncReady: true, refreshUser };
    refusing("41");
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "41" });
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(refreshUser).toHaveBeenCalled());
    expect(pendingScoutCounts().workspaces).toEqual({ 41: 1 }); // still listed: kept queued, not moved
  });

  // Task 19: a space that went read-only (deleted in Control Point, or no admin left).
  const readOnlyUser = (id: string): AccountUser => ({ ...user([]), controlPoint: { accountId: 9001, member: true, teams: [], url: "",
    workspaces: [{ id, name: `W${id}`, role: "member", orphaned: { at: "2026-10-16T00:00:00.000Z", reason: "deleted" } }] } });
  /** A server answering pushes to `ws` with 423 workspace_read_only. */
  function readOnlyServer(ws: string) {
    const calls: (string | null)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      calls.push(body.workspaceId ?? null);
      if (body.workspaceId === ws) return new Response(JSON.stringify({ error: "read-only", code: "workspace_read_only" }), { status: 423, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ results: body.entries.map((e: ScoutEntry) => ({ uuid: e.uuid, ok: true })) }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    return { calls };
  }

  it("read-only space: entries queued there are tried once (423), then kept in Personal with a notice, nothing lost", async () => {
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, team: 2222, notes: "offline note", workspaceId: "42" });
    const s = readOnlyServer("42");
    const refreshUser = vi.fn(async () => undefined);
    h.personal = { user: readOnlyUser("42"), syncReady: true, refreshUser };
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(pendingScoutCounts().workspaces).toEqual({}));
    expect(s.calls.filter((w) => w === "42")).toHaveLength(1);
    expect(localScoutEntries(null).map((e) => [e.team, e.notes, e.workspaceId])).toEqual([[2222, "offline note", null]]);
    expect(h.toasts).toEqual([expect.stringMatching(/^1 entry saved in W42 couldn't sync: the workspace is read-only now\. It's kept in Personal, so nothing was lost\./)]);
    expect(refreshUser).toHaveBeenCalled(); // the 423 re-reads the account (the banner)
    await vi.waitFor(() => expect(pendingScoutCounts().personal).toBe(0));
  });

  it("read-only space: a queued delete the server refused is let go, and the entry comes back from the server", async () => {
    const kept = { uuid: "wwwwwwwwwww1", ...base, team: 2222, notes: "server copy", workspaceId: "42", updatedAt: 1000, authorAccountId: 5, authorDisplayName: "Max" };
    localStorage.setItem("cs-scout-ws:42:wwwwwwwwwww1", JSON.stringify(kept));
    localStorage.setItem("cs-scout-ws-cursor:42", "9");
    saveScoutEntry({ ...kept, deleted: true, data: {}, notes: "" }); // deleted here while offline; the space went read-only
    const pulls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ error: "read-only", code: "workspace_read_only" }), { status: 423, headers: { "Content-Type": "application/json" } });
      pulls.push(path);
      return new Response(JSON.stringify({ entries: [kept], cursor: 9, more: false }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    h.personal = { user: readOnlyUser("42"), syncReady: true };
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(localScoutEntries("42").map((e) => [e.uuid, !!e.deleted, e.notes])).toEqual([["wwwwwwwwwww1", false, "server copy"]]));
    expect(pendingScoutCounts().workspaces).toEqual({});
    expect(pulls).toEqual(["/api/scout/sync?workspaceId=42&since=0"]); // from the start: the cursor was reset
    expect(localScoutEntries(null)).toEqual([]); // nothing to keep in Personal for a delete
  });

  it("read-only space that came back meanwhile: the push goes through there, nothing moves", async () => {
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "42" });
    const s = server();
    h.personal = { user: readOnlyUser("42"), syncReady: true };
    render(<ScoutQueueSync />);
    await vi.waitFor(() => expect(pendingScoutCounts().workspaces).toEqual({}));
    expect(s.calls).toEqual([{ workspaceId: "42", uuids: ["wwwwwwwwwww1"] }]);
    expect(localScoutEntries(null)).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  it("read-only space, but a failure other than 423 (offline, a server error): kept queued there", async () => {
    saveScoutEntry({ uuid: "wwwwwwwwwww1", ...base, workspaceId: "42" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "down" }), { status: 500, headers: { "Content-Type": "application/json" } })));
    h.personal = { user: readOnlyUser("42"), syncReady: true };
    render(<ScoutQueueSync />);
    await new Promise((r) => setTimeout(r, 30));
    expect(pendingScoutCounts().workspaces).toEqual({ 42: 1 });
    expect(localScoutEntries(null)).toEqual([]);
  });

  it("a live notice that the account's spaces changed re-reads the account at once", async () => {
    const refreshUser = vi.fn(async () => undefined);
    h.personal = { user: user(["41"]), syncReady: true, refreshUser };
    server();
    render(<ScoutQueueSync />);
    act(() => { window.dispatchEvent(new Event(ACCOUNT_STALE)); });
    expect(refreshUser).toHaveBeenCalledTimes(1);
  });

  it("signed out: nothing is sent", async () => {
    const s = server();
    saveScoutEntry({ uuid: "pppppppppppp", ...base });
    render(<ScoutQueueSync />);
    act(() => { window.dispatchEvent(new Event("online")); });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.calls).toEqual([]);
  });
});
