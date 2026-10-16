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
  type Pending = { path: string; resolve: (v: unknown) => void };
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
});
