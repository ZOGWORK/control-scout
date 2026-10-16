// @vitest-environment jsdom
// The activity feed on the device: merging pages and live items (a coalesced edit replaces the items it
// stands for), the words each item shows, grouping by day, the stream's `event: activity` reaching the feed,
// and the feed hook: first page, live merge, "Load older".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { activityEntry, describeActivity, groupByDay, mergeActivity, SCOUT_ACTIVITY, useWorkspaceActivity, type ActivityItem } from "./scoutActivity";
import { followWorkspace, type LiveMode } from "./scoutLive";

const item = (over: Partial<ActivityItem> = {}): ActivityItem => ({
  id: 1, workspaceId: "41", at: Date.UTC(2026, 9, 15, 15), actor: { accountId: 7, name: "Priya" }, type: "entry.added", subject: "entry:u1",
  details: { uuid: "u1", season: 2025, team: 18360, kind: "match", matchLabel: "Q12", eventCode: "USNJQ1" }, ...over,
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("mergeActivity", () => {
  it("newest first by id, deduped", () => {
    const out = mergeActivity([item({ id: 2 }), item({ id: 1 })], [item({ id: 3 }), item({ id: 2, actor: { accountId: 7, name: "P2" } })]);
    expect(out.map((i) => i.id)).toEqual([3, 2, 1]);
    expect(out[1].actor.name).toBe("P2");
  });

  it("a coalesced edit replaces the same person's earlier edit items of that entry, and nothing else", () => {
    const cur = [
      item({ id: 5, type: "entry.edited", actor: { accountId: 8, name: "Coach" } }), // someone else: kept
      item({ id: 4, type: "entry.edited" }),
      item({ id: 3, type: "entry.edited", subject: "entry:u2" }), // another entry: kept
      item({ id: 1 }),
    ];
    const out = mergeActivity(cur, [item({ id: 6, type: "entry.edited", details: { firstId: 4, edits: 2 } })]);
    expect(out.map((i) => i.id)).toEqual([6, 5, 3, 1]);
  });
});

describe("describeActivity", () => {
  it("says what happened", () => {
    expect(describeActivity(item())).toEqual({ verb: "added", subject: "team 18360 · match Q12 · USNJQ1" });
    expect(describeActivity(item({ type: "entry.edited", details: { team: 1, kind: "pit", changed: ["notes", "auto", "drive"], edits: 3 } })))
      .toEqual({ verb: "edited", subject: "team 1 · pit", note: "changed notes, 2 answers · 3 edits" });
    expect(describeActivity(item({ type: "template.changed", subject: "template:2025", details: { season: 2025, version: 4, kinds: ["pit"] } })))
      .toEqual({ verb: "changed the", subject: "2025 pit fields", note: "version 4" });
    expect(describeActivity(item({ type: "settings.changed", subject: "settings", details: { settingsVersion: 3, changed: ["eventCode"], defaults: { season: 2025, eventCode: "USNYQ1" } } })))
      .toEqual({ verb: "changed the", subject: "defaults for new entries", note: "season 2025, event USNYQ1" });
    expect(describeActivity(item({ type: "settings.changed", subject: "settings", details: { defaults: { season: null, eventCode: null } } })).note)
      .toBe("current season, no event");
    expect(describeActivity(item({ type: "member.left", actor: { accountId: null, name: "Control Point" }, details: { name: "Sam" } })))
      .toEqual({ verb: "removed", subject: "Sam from the workspace" });
    // Task 9: removed by an admin in Scout's settings, or leaving by themselves.
    expect(describeActivity(item({ type: "member.left", actor: { accountId: 7, name: "Ada" }, details: { name: "Sam", origin: "control-scout" } })))
      .toEqual({ verb: "removed", subject: "Sam from the workspace", note: "in Control Scout" });
    expect(describeActivity(item({ type: "member.left", actor: { accountId: 7, name: "Ada" }, details: { name: "Ada", origin: "control-scout", self: true } })))
      .toEqual({ verb: "left", subject: "the workspace" });
    expect(describeActivity(item({ type: "picklist.changed", details: {} }))).toEqual({ verb: "picklist changed", subject: "" });
  });

  it("entry items open their entry, except a deletion; other items open nothing", () => {
    expect(activityEntry(item())).toBe("u1");
    expect(activityEntry(item({ type: "entry.deleted" }))).toBeNull();
    expect(activityEntry(item({ type: "template.changed", subject: "template:2025" }))).toBeNull();
  });
});

describe("groupByDay", () => {
  it("Today, Yesterday, then dates", () => {
    const now = new Date(2026, 9, 15, 18).getTime();
    const g = groupByDay([item({ id: 3, at: now - 3600_000 }), item({ id: 2, at: now - 864e5 }), item({ id: 1, at: now - 5 * 864e5 })], now);
    expect(g.map((x) => x.label.startsWith("Today") || x.label.startsWith("Yesterday") ? x.label : "date")).toEqual(["Today", "Yesterday", "date"]);
    expect(g.map((x) => x.items.length)).toEqual([1, 1, 1]);
  });
});

class FakeES {
  static last: FakeES;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeES.last = this; }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  close() {}
  emit(type: string, data: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: JSON.stringify(data) })); }
}

describe("live", () => {
  beforeEach(() => { localStorage.clear(); });

  it("the stream's `event: activity` is announced to the feed (this workspace's only, malformed ones dropped)", () => {
    const heard: ActivityItem[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<ActivityItem>).detail);
    window.addEventListener(SCOUT_ACTIVITY, on);
    const stop = followWorkspace("41", () => {}, { EventSource: FakeES as unknown as typeof EventSource, pull: async () => undefined });
    FakeES.last.emit("activity", item({ id: 9 }));
    FakeES.last.emit("activity", item({ id: 10, workspaceId: "42" }));
    FakeES.last.emit("activity", { id: "x" });
    stop();
    window.removeEventListener(SCOUT_ACTIVITY, on);
    expect(heard.map((i) => i.id)).toEqual([9]);
  });

  it("useWorkspaceActivity: loads the newest page, merges live items, loads older pages", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const before = new URL(url, "http://x").searchParams.get("before");
      const body = before ? { items: [item({ id: 1 })], more: false } : { items: [item({ id: 3 }), item({ id: 2 })], more: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useWorkspaceActivity("41", "live"));
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([3, 2]));
    expect(result.current.more).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/scout/workspaces/41/activity?limit=50");
    act(() => { window.dispatchEvent(new CustomEvent(SCOUT_ACTIVITY, { detail: item({ id: 4, type: "member.joined" }) })); });
    expect(result.current.items.map((i) => i.id)).toEqual([4, 3, 2]);
    act(() => { result.current.loadOlder(); });
    await waitFor(() => expect(result.current.items.map((i) => i.id)).toEqual([4, 3, 2, 1]));
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/scout/workspaces/41/activity?limit=50&before=2");
    expect(result.current.more).toBe(false);
  });

  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  const ids = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, k) => item({ id: from - k, subject: `entry:u${from - k}` }));

  it("a reconnect that missed more than a page starts again from the newest page, even when a live item came first", async () => {
    let page = { items: ids(100, 51), more: true };
    vi.stubGlobal("fetch", vi.fn(async () => json(page)));
    const { result, rerender } = renderHook(({ live }) => useWorkspaceActivity("41", live), { initialProps: { live: "connecting" as LiveMode } });
    await waitFor(() => expect(result.current.items).toHaveLength(50));
    // Items 101–160 were missed; 161 streams in before the refetch answers.
    act(() => { window.dispatchEvent(new CustomEvent(SCOUT_ACTIVITY, { detail: item({ id: 161, subject: "entry:u161" }) })); });
    page = { items: ids(161, 112), more: true };
    rerender({ live: "live" });
    await waitFor(() => expect(result.current.items[0].id).toBe(161));
    await waitFor(() => expect(result.current.items.at(-1)!.id).toBe(112)); // no 100…51 below a hole
    expect(result.current.items).toHaveLength(50);
    expect(result.current.more).toBe(true);
  });

  it("starting again keeps an item that streamed in while that page was on its way", async () => {
    let answer: (r: Response) => void = () => {};
    let first = true;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (first) { first = false; return json({ items: ids(100, 51), more: true }); }
      return new Promise<Response>((r) => { answer = r; });
    }));
    const { result, rerender } = renderHook(({ live }) => useWorkspaceActivity("41", live), { initialProps: { live: "connecting" as LiveMode } });
    await waitFor(() => expect(result.current.items).toHaveLength(50));
    rerender({ live: "live" }); // the refetch: read 160…111 on the server
    act(() => { window.dispatchEvent(new CustomEvent(SCOUT_ACTIVITY, { detail: item({ id: 161, subject: "entry:u161" }) })); });
    await act(async () => { answer(json({ items: ids(160, 111), more: true })); });
    await waitFor(() => expect(result.current.items.at(-1)!.id).toBe(111));
    expect(result.current.items[0].id).toBe(161);
    expect(result.current.items).toHaveLength(51);
  });

  it("closing the feed while older items load leaves nothing stuck when it opens again", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (u.includes("before=") ? new Promise<Response>((r) => { release = r; }) : json({ items: [item({ id: 3 }), item({ id: 2 })], more: true }))));
    const { result, rerender } = renderHook(({ space }) => useWorkspaceActivity(space, "live"), { initialProps: { space: "41" as string | null } });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => { result.current.loadOlder(); });
    expect(result.current.loadingOlder).toBe(true);
    rerender({ space: null });
    rerender({ space: "41" });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.loadingOlder).toBe(false);
    await act(async () => { release(json({ items: [item({ id: 1 })], more: false })); });
    expect(result.current.items.map((i) => i.id)).toEqual([3, 2]); // the old request's answer changes nothing
    expect(result.current.more).toBe(true);
  });
});
