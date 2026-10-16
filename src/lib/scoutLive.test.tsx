// @vitest-environment jsdom
// Live workspace entries on the device, with a fake EventSource: events merge
// newer-wins and move the pull cursor, the list re-renders, reconnects back off
// from the cursor, polling takes over when the stream keeps failing (or isn't
// there), and Personal / hidden tabs hold no stream. Plus the attribution line
// and its one shared clock.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { BACKOFF_MS, followWorkspace, HIDDEN_CLOSE_MS, POLL_MS, STREAM_RETRY_WHILE_POLLING_MS, useScoutLive, type LiveMode } from "./scoutLive";
import { localScoutEntries, saveScoutEntry, scoutCursor, useScouting, type ScoutEntry } from "./scouting";
import { attributionText, EntryAttribution } from "../components/EntryAttribution";
import { NOW_TICK_MS, nowClock } from "./useNow";
import { TEMPLATE_CHANGED, type TemplateChange } from "./scoutTemplates";

class FakeES {
  static all: FakeES[] = [];
  static get last() { return FakeES.all.at(-1)!; }
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string, readonly init?: EventSourceInit) { FakeES.all.push(this); }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  close() { this.closed = true; }
  emit(type: string, data: unknown, id = "") { for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data), lastEventId: id })); }
  fail() { this.onerror?.(); }
}
const ES = FakeES as unknown as typeof EventSource;

const base = { season: 2025, team: 18360, eventCode: "USNJQ1", matchLabel: "Q1", kind: "match" as const, data: { auto: 3 }, notes: "fast" };
const remote = (over: Partial<ScoutEntry> = {}): ScoutEntry => ({
  uuid: "aaaaaaaaaaaa", ...base, workspaceId: "41", updatedAt: 1000, deleted: false,
  authorAccountId: 7, authorDisplayName: "Priya", editorAccountId: 7, editorDisplayName: "Priya", ...over,
});

beforeEach(() => { localStorage.clear(); FakeES.all = []; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function follow(deps: Parameters<typeof followWorkspace>[2] = {}) {
  const modes: LiveMode[] = [];
  const pull = vi.fn(async () => undefined);
  const stop = followWorkspace("41", (m) => modes.push(m), { EventSource: ES, pull, random: () => 0, ...deps });
  return { modes, pull, stop };
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(60); });

describe("followWorkspace", () => {
  it("opens the stream from the device's cursor, merges events newer-wins, moves the cursor and refreshes the list", async () => {
    localStorage.setItem("cs-scout-ws-cursor:41", "4");
    const { result } = renderHook(() => useScouting({}, false, "41"));
    const { modes, stop } = follow();
    expect(FakeES.last.url).toBe("/api/scout/stream?workspaceId=41&since=4");
    expect(modes).toEqual(["connecting"]);
    FakeES.last.emit("ready", { cursor: 4 });
    expect(modes).toEqual(["connecting", "live"]);
    FakeES.last.emit("upsert", remote(), "5");
    FakeES.last.emit("upsert", remote({ uuid: "bbbbbbbbbbbb", updatedAt: 1001 }), "6");
    await flush();
    expect(result.current.entries.map((e) => e.uuid)).toEqual(["bbbbbbbbbbbb", "aaaaaaaaaaaa"]); // re-rendered, no refresh
    expect(result.current.entries[1]).toMatchObject({ authorDisplayName: "Priya", workspaceId: "41" });
    expect(scoutCursor("41")).toBe(6);
    // A tombstone takes it off the list.
    FakeES.last.emit("delete", remote({ deleted: true, data: {}, notes: "", updatedAt: 2000 }), "7");
    await flush();
    expect(result.current.entries.map((e) => e.uuid)).toEqual(["bbbbbbbbbbbb"]);
    expect(localScoutEntries("41").find((e) => e.uuid === "aaaaaaaaaaaa")!.deleted).toBe(true);
    expect(scoutCursor("41")).toBe(7);
    stop();
    expect(FakeES.last.closed).toBe(true);
    expect(modes.at(-1)).toBe("off");
  });

  it("same last-write-wins as a pull: a newer edit queued on this device survives an older event (the cursor still moves)", async () => {
    const mine = saveScoutEntry({ uuid: "cccccccccccc", ...base, workspaceId: "41", notes: "mine, newer" });
    const { stop } = follow();
    FakeES.last.emit("upsert", remote({ uuid: mine.uuid, notes: "theirs, older", updatedAt: mine.updatedAt - 1 }), "3");
    FakeES.last.emit("upsert", remote({ uuid: mine.uuid, notes: "theirs, older", updatedAt: mine.updatedAt - 1 }), "3"); // a duplicate is harmless
    await flush();
    expect(localScoutEntries("41")[0].notes).toBe("mine, newer");
    expect(scoutCursor("41")).toBe(3);
    // Nothing leaks into Personal.
    expect(localScoutEntries()).toEqual([]);
    stop();
  });

  it("reconnects with backoff, from the cursor it has reached", async () => {
    const { modes, stop } = follow();
    FakeES.last.emit("ready", { cursor: 0 });
    FakeES.last.emit("upsert", remote(), "9");
    FakeES.last.fail();
    expect(FakeES.all[0].closed).toBe(true);
    expect(scoutCursor("41")).toBe(9); // what arrived before the drop is kept
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1); });
    expect(FakeES.all).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(FakeES.all).toHaveLength(2);
    expect(FakeES.last.url).toBe("/api/scout/stream?workspaceId=41&since=9");
    FakeES.last.fail();
    await act(async () => { await vi.advanceTimersByTimeAsync(BACKOFF_MS[1]); });
    expect(FakeES.all).toHaveLength(3);
    FakeES.last.emit("ready", { cursor: 9 });
    expect(modes.at(-1)).toBe("live");
    stop();
  });

  it("errors beyond the backoff: polls every 15 s, retries the stream every 2 min, and stops polling once it's back", async () => {
    const { modes, pull, stop } = follow();
    for (const wait of BACKOFF_MS) { FakeES.last.fail(); await act(async () => { await vi.advanceTimersByTimeAsync(wait); }); }
    expect(FakeES.all).toHaveLength(BACKOFF_MS.length + 1);
    expect(pull).not.toHaveBeenCalled();
    FakeES.last.fail(); // one more: give up on streaming for now
    expect(modes.at(-1)).toBe("polling");
    expect(pull).toHaveBeenCalledTimes(1);
    expect(pull).toHaveBeenCalledWith("41");
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 2); });
    expect(pull).toHaveBeenCalledTimes(3);
    const opened = FakeES.all.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_RETRY_WHILE_POLLING_MS - POLL_MS * 2); });
    expect(FakeES.all).toHaveLength(opened + 1);
    expect(modes.at(-1)).toBe("polling"); // still polling until the stream is actually back
    FakeES.last.emit("ready", { cursor: 0 });
    expect(modes.at(-1)).toBe("live");
    const polls = pull.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    expect(pull).toHaveBeenCalledTimes(polls);
    stop();
  });

  it("no EventSource at all: polls from the start", async () => {
    const { modes, pull, stop } = follow({ EventSource: undefined });
    expect(modes).toEqual(["polling"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(pull).toHaveBeenCalledTimes(2);
    stop();
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 2); });
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it("polling and the pull is refused (403: no longer a member): revoked for good; other failures keep polling", async () => {
    let status = 500;
    const pull = vi.fn(async () => { throw Object.assign(new Error("no"), { status }); });
    const { modes, stop } = follow({ EventSource: undefined, pull });
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(modes.at(-1)).toBe("polling");
    status = 403;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS); });
    expect(modes.at(-1)).toBe("revoked");
    const calls = pull.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS * 3); });
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(pull).toHaveBeenCalledTimes(calls);
    stop();
  });

  it("resync: pulls, then streams from the new cursor; membership_revoked: stops for good", async () => {
    const pull = vi.fn(async () => { localStorage.setItem("cs-scout-ws-cursor:41", "5000"); });
    const { modes, stop } = follow({ pull });
    FakeES.last.emit("resync", { cursor: 4999 });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(pull).toHaveBeenCalledTimes(1);
    expect(FakeES.last.url).toBe("/api/scout/stream?workspaceId=41&since=5000");
    FakeES.last.emit("membership_revoked", {});
    expect(FakeES.last.closed).toBe(true);
    expect(modes.at(-1)).toBe("revoked");
    const opened = FakeES.all.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(STREAM_RETRY_WHILE_POLLING_MS * 2); });
    act(() => { window.dispatchEvent(new Event("online")); }); // back online: still nothing (the member has no access)
    expect(FakeES.all).toHaveLength(opened);
    expect(modes.at(-1)).toBe("revoked");
    expect(FakeES.all).toHaveLength(opened);
    stop();
  });
});

describe("useScouting pushes a save right away", () => {
  it("a save in the shown space is pushed within a moment (not at the next 30 s tick); other spaces wait", async () => {
    const posts: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (init?.method === "POST") posts.push(body);
      const answer = init?.method === "POST" ? { results: body.entries.map((x: ScoutEntry) => ({ uuid: x.uuid, ok: true })) } : { entries: [], cursor: 0, more: false };
      return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    renderHook(() => useScouting({}, true, "41"));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(posts).toHaveLength(0); // nothing queued at mount
    act(() => { saveScoutEntry({ uuid: "dddddddddddd", ...base, workspaceId: "42" }); });
    act(() => { saveScoutEntry({ uuid: "eeeeeeeeeeee", ...base, workspaceId: "41" }); });
    act(() => { saveScoutEntry({ uuid: "ffffffffffff", ...base, workspaceId: "41" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(posts).toHaveLength(1); // one push for the burst, this space only
    expect(posts[0].workspaceId).toBe("41");
    expect(posts[0].entries.map((e: ScoutEntry) => e.uuid).sort()).toEqual(["eeeeeeeeeeee", "ffffffffffff"]);
  });
});

describe("useScoutLive", () => {
  it("Personal and signed out hold no stream; a workspace does, and lets go on space change and sign-out", () => {
    vi.stubGlobal("EventSource", ES);
    const { result, rerender } = renderHook(({ space, signedIn }) => useScoutLive(space, signedIn), { initialProps: { space: null as string | null, signedIn: true } });
    expect(FakeES.all).toHaveLength(0);
    expect(result.current).toBe("off");
    rerender({ space: "41", signedIn: true });
    expect(FakeES.all).toHaveLength(1);
    expect(result.current).toBe("connecting");
    rerender({ space: "42", signedIn: true });
    expect(FakeES.all[0].closed).toBe(true);
    expect(FakeES.last.url).toContain("workspaceId=42");
    rerender({ space: "42", signedIn: false });
    expect(FakeES.last.closed).toBe(true);
    expect(result.current).toBe("off");
  });

  it("a tab hidden for a minute closes the stream; visible again reopens it", async () => {
    vi.stubGlobal("EventSource", ES);
    let state: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    renderHook(() => useScoutLive("41", true));
    expect(FakeES.all).toHaveLength(1);
    state = "hidden"; act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(HIDDEN_CLOSE_MS - 1); });
    expect(FakeES.last.closed).toBe(false); // a quick look at another tab keeps it
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(FakeES.last.closed).toBe(true);
    state = "visible"; act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(FakeES.all).toHaveLength(2);
    expect(FakeES.last.closed).toBe(false);
  });
});

describe("attribution", () => {
  const now = 10_000_000;
  it("author and relative time; the editor when it's someone else; nothing for Personal", () => {
    expect(attributionText(remote({ updatedAt: now - 2 * 60_000 }), now)).toBe("Priya · 2m ago");
    expect(attributionText(remote({ updatedAt: now - 5_000, editorAccountId: 9, editorDisplayName: "Marcus" }), now)).toBe("Priya · edited by Marcus · just now");
    expect(attributionText(remote({ updatedAt: now - 3 * 3600_000 }), now)).toBe("Priya · 3h ago");
    expect(attributionText(remote({ authorAccountId: 0, authorDisplayName: "", editorAccountId: 0, editorDisplayName: "", updatedAt: now }), now)).toBe("You · just now"); // not synced yet
    expect(attributionText({ ...remote(), workspaceId: null }, now)).toBeNull();
    // An updatedAt outside Date's range (the server accepts any finite number) renders instead of crashing the list.
    render(<EntryAttribution e={remote({ updatedAt: 1e20 })} />);
    render(<EntryAttribution e={remote({ uuid: "zzzzzzzzzzzz", updatedAt: -1e20 })} />);
    expect(screen.getAllByText("time unknown")).toHaveLength(2);
  });

  it("a saved edit keeps the author and waits for the server to name the editor", () => {
    localStorage.setItem("cs-scout-ws:41:aaaaaaaaaaaa", JSON.stringify(remote({ editorAccountId: 9, editorDisplayName: "Marcus" })));
    const saved = saveScoutEntry({ uuid: "aaaaaaaaaaaa", ...base, workspaceId: "41", notes: "edited here" });
    expect(saved).toMatchObject({ authorAccountId: 7, authorDisplayName: "Priya", editorAccountId: 0, editorDisplayName: "" });
  });

  it("ticks: every row re-renders on one shared timer, which stops when nothing shows a time", async () => {
    vi.setSystemTime(now);
    const rows = [remote({ updatedAt: now - 30_000 }), remote({ uuid: "bbbbbbbbbbbb", updatedAt: now - 50_000 })];
    const view = render(<>{rows.map((e) => <EntryAttribution key={e.uuid} e={e} />)}</>);
    expect(screen.getAllByText("just now")).toHaveLength(2);
    expect(nowClock()).toEqual({ listeners: 2, running: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(NOW_TICK_MS); });
    expect(screen.getAllByText("1m ago")).toHaveLength(2); // both rows moved on, from one tick
    view.unmount();
    expect(nowClock()).toEqual({ listeners: 0, running: false });
  });
});

describe("template changes on the stream", () => {
  it("`event: template` tells open forms to refetch (season and version passed on), and never moves the cursor", () => {
    localStorage.setItem("cs-scout-ws-cursor:41", "4");
    const heard: TemplateChange[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<TemplateChange>).detail);
    window.addEventListener(TEMPLATE_CHANGED, on);
    const { stop } = follow();
    try {
      FakeES.last.emit("ready", { cursor: 4 });
      FakeES.last.emit("template", { season: 2025, version: 3, settingsVersion: 5 });
      expect(heard).toEqual([{ space: "41", season: 2025, version: 3 }]);
      expect(scoutCursor("41")).toBe(4);
    } finally { stop(); window.removeEventListener(TEMPLATE_CHANGED, on); }
  });
});
