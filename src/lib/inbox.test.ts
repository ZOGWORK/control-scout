// @vitest-environment jsdom
// The inbox's live count on the device: the stream's count when it's up; when it keeps failing (or live
// updates are switched off, 503), the count is polled instead and the stream retried later.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followInbox, INBOX_BACKOFF_MS, INBOX_POLL_MS, INBOX_STREAM_RETRY_MS, type InboxMode } from "./inbox";
import type { InboxItem } from "../shared/inbox";

class FakeES {
  static all: FakeES[] = [];
  listeners = new Map<string, (e: MessageEvent) => void>();
  onerror: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeES.all.push(this); }
  addEventListener(t: string, fn: (e: MessageEvent) => void) { this.listeners.set(t, fn); }
  close() { this.closed = true; }
  emit(t: string, data: unknown) { this.listeners.get(t)?.({ data: JSON.stringify(data) } as MessageEvent); }
}

beforeEach(() => { vi.useFakeTimers(); FakeES.all = []; });
afterEach(() => { vi.useRealTimers(); });

describe("followInbox", () => {
  it("live: the stream's counts", () => {
    const counts: number[] = [], modes: InboxMode[] = [];
    const stop = followInbox((n) => counts.push(n.unread), (m) => modes.push(m), { EventSource: FakeES as unknown as typeof EventSource, count: async () => null });
    expect(FakeES.all[0].url).toBe("/api/inbox/stream");
    FakeES.all[0].emit("inbox", { unread: 3, latest: 9 });
    FakeES.all[0].emit("inbox", { unread: 1, latest: 9 });
    expect(counts).toEqual([3, 1]);
    expect(modes).toEqual(["connecting", "live"]);
    stop();
    expect(FakeES.all[0].closed).toBe(true);
    expect(modes.at(-1)).toBe("off");
  });

  it("a stream that keeps failing: polls the count every 45 s, retries the stream every 2 minutes", async () => {
    const count = vi.fn(async () => ({ unread: 4, latest: null }));
    const modes: InboxMode[] = [];
    const seen: number[] = [];
    const stop = followInbox((n) => seen.push(n.unread), (m) => modes.push(m), { EventSource: FakeES as unknown as typeof EventSource, count, random: () => 0 });
    for (let i = 0; i <= INBOX_BACKOFF_MS.length; i++) {
      FakeES.all.at(-1)!.onerror!();
      await vi.advanceTimersByTimeAsync(INBOX_BACKOFF_MS[i] ?? 0);
    }
    expect(modes.at(-1)).toBe("polling");
    const before = count.mock.calls.length;
    await vi.advanceTimersByTimeAsync(INBOX_POLL_MS);
    expect(count.mock.calls.length).toBe(before + 1);
    expect(seen.at(-1)).toBe(4);
    const streams = FakeES.all.length;
    await vi.advanceTimersByTimeAsync(INBOX_STREAM_RETRY_MS);
    expect(FakeES.all.length).toBe(streams + 1);
    FakeES.all.at(-1)!.emit("inbox", { unread: 2, latest: null });
    expect(modes.at(-1)).toBe("live");
    stop();
  });

  it("no EventSource: polls", async () => {
    const count = vi.fn(async () => ({ unread: 1, latest: null }));
    const modes: InboxMode[] = [];
    const stop = followInbox(() => {}, (m) => modes.push(m), { EventSource: undefined, count });
    expect(modes).toEqual(["polling"]);
    await vi.advanceTimersByTimeAsync(INBOX_POLL_MS);
    expect(count).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("useInbox: replies in order", () => {
  const item = (id: number, read = false) => ({ id, at: 1, workspaceId: "1", workspaceName: "", category: "edits", type: "entry.edited", actorName: "", title: `t${id}`, body: "", link: "/", read }) as InboxItem;
  type Pending = { path: string; resolve: (v: unknown) => void; json?: unknown };
  const pending: Pending[] = [];
  beforeEach(() => { pending.length = 0; vi.useRealTimers(); vi.stubGlobal("EventSource", undefined); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("an older snapshot that lands last is ignored; a read sent meanwhile isn't undone by an earlier refresh", async () => {
    vi.doMock("./api", async (orig) => ({
      ...(await orig<typeof import("./api")>()),
      apiFetch: (path: string) => new Promise((resolve) => { pending.push({ path, resolve }); }),
    }));
    vi.resetModules();
    const { useInbox } = await import("./inbox");
    const { renderHook, act } = await import("@testing-library/react");
    const { result } = renderHook(() => useInbox(1));
    const page = (items: InboxItem[]) => ({ items, more: false, unread: items.filter((i) => !i.read).length });
    const lists = () => pending.filter((p) => p.path.startsWith("/api/inbox?"));
    await act(async () => { result.current.load(); });
    await act(async () => { lists()[0].resolve(page([item(2), item(1)])); });
    expect(result.current.items.map((i) => i.id)).toEqual([2, 1]);

    // Two refreshes overlap; the first answers last with an older snapshot.
    await act(async () => { result.current.load(); result.current.load(); });
    await act(async () => { lists()[2].resolve(page([item(3), item(2), item(1)])); });
    await act(async () => { lists()[1].resolve(page([item(1)])); });
    expect(result.current.items.map((i) => i.id)).toEqual([3, 2, 1]);
    expect(result.current.unread).toBe(3);

    // A refresh is out; then item 3 is read here. The refresh's (older) reply doesn't undo it.
    await act(async () => { result.current.load(); });
    await act(async () => { result.current.markRead([3]); });
    expect(result.current.unread).toBe(2);
    await act(async () => { lists()[3].resolve(page([item(3), item(2), item(1)])); });
    expect(result.current.items[0].read).toBe(true);
    expect(result.current.unread).toBe(2);
    // Once the server has the change, the list is fetched again and that reply is used.
    await act(async () => { pending.find((p) => p.path === "/api/inbox/read")!.resolve({ unread: 2 }); });
    await act(async () => { lists().at(-1)!.resolve(page([item(3, true), item(2), item(1)])); });
    expect(result.current.items.map((i) => i.read)).toEqual([true, false, false]);

    // "Load older" while a refresh is out doesn't cancel the refresh; the older page (asked for before the
    // refresh answered) is dropped instead.
    await act(async () => { result.current.load(); });
    await act(async () => { result.current.loadOlder(); });
    const older = pending.filter((p) => p.path.includes("before="));
    await act(async () => { lists().filter((p) => !p.path.includes("before=")).at(-1)!.resolve(page([item(4), item(3, true), item(2), item(1)])); });
    expect(result.current.items.map((i) => i.id)).toEqual([4, 3, 2, 1]);
    expect(older).toHaveLength(1);
    await act(async () => { older[0].resolve({ items: [item(0)], more: false, unread: 0 }); });
    expect(result.current.items.map((i) => i.id)).toEqual([4, 3, 2, 1]);
    // Asked for on the current list, an older page is appended.
    await act(async () => { result.current.loadOlder(); });
    await act(async () => { pending.filter((p) => p.path.includes("before=")).at(-1)!.resolve({ items: [item(0)], more: false, unread: 0 }); });
    expect(result.current.items.map((i) => i.id)).toEqual([4, 3, 2, 1, 0]);
    vi.doUnmock("./api");
  });

  // Follow-up state: the Follow up view's paging, write order, and loading while the filter changes.
  async function harness() {
    vi.doMock("./api", async (orig) => ({
      ...(await orig<typeof import("./api")>()),
      apiFetch: (path: string, init?: { json?: unknown }) => new Promise((resolve) => { pending.push({ path, resolve, json: init?.json }); }),
    }));
    vi.resetModules();
    const { useInbox } = await import("./inbox");
    const { renderHook, act } = await import("@testing-library/react");
    const { result } = renderHook(() => useInbox(1));
    return { result, act };
  }
  const flagged = (id: number, followUp = true) => ({ ...item(id, true), followUp });
  const fpage = (items: InboxItem[], more = false) => ({ items, more, unread: 0, followUp: items.filter((i) => i.followUp).length });

  it("Follow up view: an unflagged row kept on screen never becomes the Load older cursor", async () => {
    const { result, act } = await harness();
    await act(async () => { result.current.setFilter("followUp"); });
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(90), flagged(61)], true)); });
    await act(async () => { result.current.loadOlder(); });
    expect(pending.at(-1)!.path).toContain("filter=followUp");
    expect(pending.at(-1)!.path).toContain("before=61");
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(60), flagged(31)], true)); });
    expect(result.current.items.map((i) => i.id)).toEqual([90, 61, 60, 31]);
    // Unflag 31 (the oldest loaded): it stays on screen; the refresh brings the newest page back.
    await act(async () => { result.current.setFollowUp([31], false); });
    await act(async () => { pending.find((p) => p.path === "/api/inbox/follow-up")!.resolve({ unread: 0, followUp: 3 }); });
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(90), flagged(61)], true)); });
    expect(result.current.items.map((i) => [i.id, i.followUp])).toEqual([[90, true], [61, true], [31, false]]);
    // Load older carries on after 61 (the server's oldest), not after the kept 31, so 60 isn't skipped.
    await act(async () => { result.current.loadOlder(); });
    expect(pending.at(-1)!.path).toContain("before=61");
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(60)])); });
    expect(result.current.items.map((i) => i.id)).toEqual([90, 61, 60, 31]);
    vi.doUnmock("./api");
  });

  it("writes reach the server one at a time, in order: flag then unflag ends unflagged", async () => {
    const { result, act } = await harness();
    await act(async () => { result.current.load(); });
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(5, false)])); });
    await act(async () => { result.current.setFollowUp([5], true); });
    await act(async () => { result.current.setFollowUp([5], false); });
    const writes = () => pending.filter((p) => p.path === "/api/inbox/follow-up");
    // The unflag waits for the flag.
    expect(writes().map((w) => w.json)).toEqual([{ ids: [5], on: true }]);
    await act(async () => { writes()[0].resolve({ unread: 0, followUp: 1 }); });
    expect(writes().map((w) => w.json)).toEqual([{ ids: [5], on: true }, { ids: [5], on: false }]);
    // No refresh between them (its snapshot would show the flag again); one after the last.
    expect(pending.filter((p) => p.path.startsWith("/api/inbox?"))).toHaveLength(1);
    expect(result.current.items[0].followUp).toBe(false);
    await act(async () => { writes()[1].resolve({ unread: 0, followUp: 0 }); });
    expect(pending.filter((p) => p.path.startsWith("/api/inbox?"))).toHaveLength(2);
    vi.doUnmock("./api");
  });

  it("switching filters while a list is loading stays loading (never a false empty view)", async () => {
    const { result, act } = await harness();
    await act(async () => { result.current.load(); });
    expect(result.current.loading).toBe(true);
    await act(async () => { result.current.setFilter("followUp"); });
    // The first (All) reply lands after the switch: dropped, and the Follow up list is still loading.
    await act(async () => { pending[0].resolve(fpage([flagged(9, false)])); });
    expect(result.current.loading).toBe(true);
    expect(result.current.loaded).toBe(false);
    expect(result.current.items).toEqual([]);
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(8)])); });
    expect(result.current.loading).toBe(false);
    expect(result.current.items.map((i) => i.id)).toEqual([8]);
    vi.doUnmock("./api");
  });
});
