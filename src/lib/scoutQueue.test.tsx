// @vitest-environment jsdom
// Offline entries in every space go up when the connection returns: pushes to one space never
// overlap, the background sync covers Personal and the account's workspaces (not one it left, and
// none while workspace scouting is off), and the pending counts follow saves and syncs.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { pendingScoutCounts, saveScoutEntry, syncQueuedScouting, syncScouting, usePendingScoutCounts, type ScoutEntry } from "./scouting";
import { resetFlags } from "./flags";
import { DEFAULT_FLAGS } from "../shared/flags";
import type { AccountUser } from "./personal";

const h = vi.hoisted(() => ({ personal: { user: null as AccountUser | null, syncReady: false } }));
vi.mock("./personal", () => ({ usePersonal: () => h.personal }));
const { ScoutQueueSync } = await import("./scoutSpace");

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

beforeEach(() => { localStorage.clear(); h.personal = { user: null, syncReady: false }; resetFlags({ ...DEFAULT_FLAGS }); });
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

  it("signed out: nothing is sent", async () => {
    const s = server();
    saveScoutEntry({ uuid: "pppppppppppp", ...base });
    render(<ScoutQueueSync />);
    act(() => { window.dispatchEvent(new Event("online")); });
    await new Promise((r) => setTimeout(r, 20));
    expect(s.calls).toEqual([]);
  });
});
