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

  it("Follow up view: toggled rows come back from the server (keep=), over the whole loaded range, with their real state", async () => {
    const { result, act } = await harness();
    await act(async () => { result.current.setFilter("followUp"); });
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(90), flagged(61)], true)); });
    await act(async () => { result.current.loadOlder(); });
    expect(pending.at(-1)!.path).toContain("filter=followUp");
    expect(pending.at(-1)!.path).toContain("before=61");
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(60), flagged(31)], true)); });
    expect(result.current.items.map((i) => i.id)).toEqual([90, 61, 60, 31]);
    // Unflag 31 (the oldest loaded): shown unflagged at once.
    await act(async () => { result.current.setFollowUp([31], false); });
    expect(result.current.items.map((i) => [i.id, i.followUp])).toEqual([[90, true], [61, true], [60, true], [31, false]]);
    await act(async () => { pending.find((p) => p.path === "/api/inbox/follow-up")!.resolve({ unread: 0, followUp: 3 }); });
    // The refresh asks for everything shown (not just a page) and for 31 by id.
    const refresh = pending.at(-1)!;
    expect(refresh.path).toMatch(/limit=30&filter=followUp&keep=31$/);
    // Flagged again on another device meanwhile: the server's copy is what shows.
    await act(async () => { refresh.resolve(fpage([flagged(90), flagged(61), flagged(60), flagged(31, true)], true)); });
    expect(result.current.items.map((i) => [i.id, i.followUp])).toEqual([[90, true], [61, true], [60, true], [31, true]]);
    // Re-flagged here (after unflagging) it stays kept, so a later refresh can't drop it either.
    await act(async () => { result.current.setFollowUp([31], false); });
    await act(async () => { pending.filter((p) => p.path === "/api/inbox/follow-up").at(-1)!.resolve({}); });
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(90), flagged(61), flagged(60), flagged(31, false)])); });
    await act(async () => { result.current.setFollowUp([31], true); });
    await act(async () => { pending.filter((p) => p.path === "/api/inbox/follow-up").at(-1)!.resolve({}); });
    expect(pending.at(-1)!.path).toContain("keep=31");
    vi.doUnmock("./api");
  });

  it("Follow up view with more than 100 rows shown: the refresh covers them all, in pages", async () => {
    const { result, act } = await harness();
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, k) => flagged(from - k));
    await act(async () => { result.current.setFilter("followUp"); });
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(200, 30), true)); });
    for (const from of [170, 140, 110]) {
      await act(async () => { result.current.loadOlder(); });
      await act(async () => { pending.at(-1)!.resolve(fpage(ids(from, 30), true)); });
    }
    expect(result.current.items).toHaveLength(120);
    await act(async () => { result.current.setFollowUp([81], false); });
    await act(async () => { pending.find((p) => p.path === "/api/inbox/follow-up")!.resolve({}); });
    expect(pending.at(-1)!.path).toBe("/api/inbox?limit=100&filter=followUp&keep=81");
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(200, 100), true)); });
    expect(pending.at(-1)!.path).toBe("/api/inbox?limit=30&filter=followUp&keep=81&before=101");
    await act(async () => { pending.at(-1)!.resolve(fpage([...ids(100, 19), flagged(81, false)], true)); });
    expect(result.current.items).toHaveLength(120);
    expect(result.current.items.at(-1)).toMatchObject({ id: 81, followUp: false });
    vi.doUnmock("./api");
  });

  it("Load older during a Follow up refresh: the refresh keeps its target, and the older rows stay", async () => {
    const { result, act } = await harness();
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, k) => flagged(from - k));
    await act(async () => { result.current.setFilter("followUp"); });
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(200, 30), true)); });
    for (const from of [170, 140, 110]) {
      await act(async () => { result.current.loadOlder(); });
      await act(async () => { pending.at(-1)!.resolve(fpage(ids(from, 30), true)); });
    }
    await act(async () => { result.current.setFollowUp([150], false); });
    await act(async () => { pending.find((p) => p.path === "/api/inbox/follow-up")!.resolve({}); });
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(200, 100), true)); });
    const second = pending.at(-1)!;
    expect(second.path).toBe("/api/inbox?limit=30&filter=followUp&keep=150&before=101");
    // Load older lands while the refresh's second page is out.
    await act(async () => { result.current.loadOlder(); });
    expect(pending.at(-1)!.path).toContain("before=81");
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(80, 30), false)); });
    expect(result.current.items).toHaveLength(150);
    const before = pending.length;
    await act(async () => { second.resolve(fpage(ids(100, 20), true)); });
    // No third request (the refresh went down to the oldest row shown when it started), and nothing lost.
    expect(pending.length).toBe(before);
    expect(result.current.items).toHaveLength(150);
    expect(result.current.items.at(-1)!.id).toBe(51);
    expect(result.current.more).toBe(false);
    vi.doUnmock("./api");
  });

  it("a Follow up refresh covers down to the oldest row shown and takes the server's more (new flags elsewhere)", async () => {
    const { result, act } = await harness();
    const ids = (from: number, n: number) => Array.from({ length: n }, (_, k) => flagged(from - k));
    await act(async () => { result.current.setFilter("followUp"); });
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(100, 30), false)); }); // 100..71, nothing more
    expect(result.current.more).toBe(false);
    // 101 and 50 are flagged on another device; the stream refreshes this view.
    await act(async () => { result.current.load(); });
    expect(pending.at(-1)!.path).toBe("/api/inbox?limit=30&filter=followUp");
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(101, 30), true)); }); // 101..72
    // Not down to 71 yet: one more page.
    expect(pending.at(-1)!.path).toBe("/api/inbox?limit=30&filter=followUp&before=72");
    await act(async () => { pending.at(-1)!.resolve(fpage(ids(71, 1), true)); });
    expect(result.current.items.map((i) => i.id)).toEqual(ids(101, 31).map((i) => i.id));
    // 50 is still on the server: Load older is offered.
    expect(result.current.more).toBe(true);
    vi.doUnmock("./api");
  });

  it("more than 200 rows toggled in the Follow up view: every one is asked for, in batches of 200", async () => {
    const { result, act } = await harness();
    const rows = Array.from({ length: 210 }, (_, k) => flagged(1000 - k));
    await act(async () => { result.current.setFilter("followUp"); });
    await act(async () => { pending.at(-1)!.resolve(fpage(rows)); });
    await act(async () => { result.current.setFollowUp(rows.map((i) => i.id), false); });
    await act(async () => { pending.find((p) => p.path === "/api/inbox/follow-up")!.resolve({}); });
    const keepOf = (path: string) => (/keep=([0-9,]+)/.exec(path)?.[1] ?? "").split(",").filter(Boolean).map(Number);
    const first = pending.at(-1)!;
    expect(keepOf(first.path)).toHaveLength(200);
    await act(async () => { first.resolve(fpage(rows.filter((i) => keepOf(first.path).includes(i.id)).map((i) => ({ ...i, followUp: false })))); });
    const second = pending.at(-1)!;
    expect(keepOf(second.path)).toHaveLength(10);
    expect(new Set([...keepOf(first.path), ...keepOf(second.path)]).size).toBe(210);
    await act(async () => { second.resolve(fpage(rows.filter((i) => keepOf(second.path).includes(i.id)).map((i) => ({ ...i, followUp: false })))); });
    expect(result.current.items).toHaveLength(210);
    expect(result.current.items.every((i) => !i.followUp)).toBe(true);
    vi.doUnmock("./api");
  });

  it("batched Follow up refresh: more comes from the pass that reached the oldest row", async () => {
    const { result, act } = await harness();
    const rows = Array.from({ length: 210 }, (_, k) => flagged(1000 - k)); // 1000..791
    await act(async () => { result.current.setFilter("followUp"); });
    await act(async () => { pending.at(-1)!.resolve(fpage(rows)); });
    await act(async () => { result.current.setFollowUp(rows.map((i) => i.id), false); });
    await act(async () => { pending.find((p) => p.path === "/api/inbox/follow-up")!.resolve({}); });
    const keepOf = (path: string) => (/keep=([0-9,]+)/.exec(path)?.[1] ?? "").split(",").filter(Boolean).map(Number);
    const tail = Array.from({ length: 10 }, (_, k) => flagged(790 - k)); // flagged rows below everything kept
    // First pass stops at its last kept row with more (790..781 lie below); the second reaches the very bottom.
    const first = pending.at(-1)!;
    await act(async () => { first.resolve(fpage(rows.filter((i) => keepOf(first.path).includes(i.id)).map((i) => ({ ...i, followUp: false })), true)); });
    // Its next page passes the oldest row shown (791) and stops there, with more.
    expect(pending.at(-1)!.path).toContain("before=801");
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(790)], true)); });
    const second = pending.at(-1)!;
    expect(keepOf(second.path)).toHaveLength(10);
    await act(async () => { second.resolve(fpage([...rows.filter((i) => keepOf(second.path).includes(i.id)).map((i) => ({ ...i, followUp: false })), ...tail], false)); });
    expect(result.current.items.at(-1)!.id).toBe(781);
    expect(result.current.more).toBe(false);
    vi.doUnmock("./api");
  });

  it("switching to Follow up starts from one page, not the All view's loaded range", async () => {
    const { result, act } = await harness();
    await act(async () => { result.current.load(); });
    await act(async () => { pending.at(-1)!.resolve(fpage(Array.from({ length: 30 }, (_, k) => flagged(500 - k, false)), true)); });
    for (const from of [470, 440, 410]) {
      await act(async () => { result.current.loadOlder(); });
      await act(async () => { pending.at(-1)!.resolve(fpage(Array.from({ length: 30 }, (_, k) => flagged(from - k, false)), true)); });
    }
    expect(result.current.items).toHaveLength(120);
    await act(async () => { result.current.setFilter("followUp"); });
    expect(pending.at(-1)!.path).toBe("/api/inbox?limit=30&filter=followUp");
    const n = pending.length;
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(450)], true)); });
    expect(pending.length).toBe(n); // one page: no walk down to the All view's oldest row
    expect(result.current.items.map((i) => i.id)).toEqual([450]);
    vi.doUnmock("./api");
  });

  it("a live refresh waits while a write is queued (it would bring back the old state)", async () => {
    const { result, act } = await harness();
    await act(async () => { result.current.load(); });
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(5, false)])); });
    await act(async () => { result.current.markUnread([5]); });
    // e.g. the stream's event, or the panel opening, while the write is out: no request yet.
    const lists = () => pending.filter((p) => p.path.startsWith("/api/inbox?"));
    await act(async () => { result.current.load(); });
    expect(lists()).toHaveLength(1);
    expect(result.current.items[0].read).toBe(false);
    await act(async () => { pending.find((p) => p.path === "/api/inbox/unread")!.resolve({ unread: 1 }); });
    expect(lists()).toHaveLength(2);
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

  it("a write still queued when the account changes is never sent (not with the next account's cookie)", async () => {
    vi.doMock("./api", async (orig) => ({
      ...(await orig<typeof import("./api")>()),
      apiFetch: (path: string, init?: { json?: unknown }) => new Promise((resolve) => { pending.push({ path, resolve, json: init?.json }); }),
    }));
    vi.resetModules();
    const { useInbox } = await import("./inbox");
    const { renderHook, act } = await import("@testing-library/react");
    const { result, rerender } = renderHook(({ id }) => useInbox(id), { initialProps: { id: 1 as number | null } });
    await act(async () => { result.current.load(); });
    await act(async () => { pending.at(-1)!.resolve(fpage([flagged(5, false), item(4)])); });
    await act(async () => { result.current.setFollowUp([5], true); });
    await act(async () => { result.current.markAllRead(); });
    const posts = () => pending.filter((p) => p.path === "/api/inbox/follow-up" || p.path === "/api/inbox/read");
    expect(posts()).toHaveLength(1);
    // Signed out, someone else signs in; then the slow first write finishes.
    rerender({ id: null });
    rerender({ id: 2 });
    await act(async () => { posts()[0].resolve({ unread: 1, followUp: 1 }); });
    expect(posts()).toHaveLength(1);
    expect(pending.filter((p) => p.path.startsWith("/api/inbox?"))).toHaveLength(1);
    vi.doUnmock("./api");
  });
});

// A write the server refuses (V4-PRIVATE-002): the row goes back to what the server confirmed, the failure is
// reported (never silent), Retry sends the same change once, and an older failure never undoes a newer change.
describe("useInbox: failed writes", () => {
  const item = (id: number, over: Partial<InboxItem> = {}) => ({ id, at: 1, workspaceId: "1", workspaceName: "", category: "edits", type: "entry.edited", actorName: "", title: `t${id}`, body: "", link: "/", read: true, followUp: false, ...over }) as InboxItem;
  type Pending = { path: string; resolve: (v: unknown) => void; reject: (e: unknown) => void; json?: unknown };
  const pending: Pending[] = [];
  beforeEach(() => { pending.length = 0; vi.useRealTimers(); vi.stubGlobal("EventSource", undefined); });
  afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("./api"); });

  async function harness(rows: InboxItem[]) {
    vi.doMock("./api", async (orig) => ({
      ...(await orig<typeof import("./api")>()),
      apiFetch: (path: string, init?: { json?: unknown }) => new Promise((resolve, reject) => { pending.push({ path, resolve, reject, json: init?.json }); }),
    }));
    vi.resetModules();
    const { useInbox } = await import("./inbox");
    const { ApiError } = await import("./api");
    const { renderHook, act } = await import("@testing-library/react");
    const hook = renderHook(({ id }) => useInbox(id), { initialProps: { id: 1 as number | null } });
    const page = (items: InboxItem[]) => ({ items, more: false, unread: items.filter((i) => !i.read).length, followUp: items.filter((i) => i.followUp).length });
    await act(async () => { hook.result.current.load(); });
    await act(async () => { pending.at(-1)!.resolve(page(rows)); });
    const posts = (path: string) => pending.filter((p) => p.path === path);
    const unavailable = () => new ApiError(503, "Service unavailable");
    return { ...hook, act, page, posts, unavailable };
  }
  const state = (r: { current: { items: InboxItem[] } }) => r.current.items.map((i) => [i.id, i.read, i.followUp]);

  it("flag refused (503): back to unflagged, reported; Retry sends the same change once and clears it", async () => {
    const { result, act, page, posts, unavailable } = await harness([item(2), item(1)]);
    await act(async () => { result.current.setFollowUp([2], true); });
    expect(result.current.followUp).toBe(1);
    await act(async () => { posts("/api/inbox/follow-up")[0].reject(unavailable()); });
    expect(state(result)).toEqual([[2, true, false], [1, true, false]]);
    expect(result.current.followUp).toBe(0);
    expect(result.current.failures).toEqual([{ id: 2, field: "followUp", on: true }]);
    // The confirmed state is fetched again; it doesn't clear the warning (the change still isn't saved).
    await act(async () => { pending.at(-1)!.resolve(page([item(2), item(1)])); });
    expect(result.current.failures).toHaveLength(1);
    await act(async () => { result.current.retry(result.current.failures[0]); });
    expect(posts("/api/inbox/follow-up")).toHaveLength(2);
    expect(posts("/api/inbox/follow-up")[1].json).toEqual({ ids: [2], on: true });
    expect(result.current.failures).toEqual([]);
    await act(async () => { posts("/api/inbox/follow-up")[1].resolve({ unread: 0, followUp: 1 }); });
    await act(async () => { pending.at(-1)!.resolve(page([item(2, { followUp: true }), item(1)])); });
    expect(state(result)).toEqual([[2, true, true], [1, true, false]]);
    expect(result.current.failures).toEqual([]);
    expect(posts("/api/inbox/follow-up")).toHaveLength(2);
  });

  it("unflag refused: the flag comes back, reported as not removed; other rows untouched", async () => {
    const { result, act, posts, unavailable } = await harness([item(2, { followUp: true }), item(1, { read: false })]);
    await act(async () => { result.current.setFollowUp([2], false); });
    await act(async () => { posts("/api/inbox/follow-up")[0].reject(unavailable()); });
    expect(state(result)).toEqual([[2, true, true], [1, false, false]]);
    expect(result.current.failures).toEqual([{ id: 2, field: "followUp", on: false }]);
    expect(result.current.unread).toBe(1);
  });

  it("an older write failing after a newer change was made leaves the newer change standing", async () => {
    const { result, act, posts, unavailable } = await harness([item(2)]);
    // Flag, then unflag quickly: the first is refused, the second goes through. Ends unflagged, nothing reported.
    await act(async () => { result.current.setFollowUp([2], true); });
    await act(async () => { result.current.setFollowUp([2], false); });
    await act(async () => { posts("/api/inbox/follow-up")[0].reject(unavailable()); });
    expect(state(result)).toEqual([[2, true, false]]);
    expect(result.current.failures).toEqual([]);
    await act(async () => { posts("/api/inbox/follow-up")[1].resolve({}); });
    expect(result.current.failures).toEqual([]);
    await act(async () => { pending.at(-1)!.resolve({ items: [item(2)], more: false, unread: 0, followUp: 0 }); });

    // Flag (saved), then unflag (refused): back to flagged, the state the server confirmed last.
    await act(async () => { result.current.setFollowUp([2], true); });
    await act(async () => { result.current.setFollowUp([2], false); });
    await act(async () => { posts("/api/inbox/follow-up")[2].resolve({}); });
    expect(state(result)).toEqual([[2, true, false]]);
    await act(async () => { posts("/api/inbox/follow-up")[3].reject(unavailable()); });
    expect(state(result)).toEqual([[2, true, true]]);
    expect(result.current.failures).toEqual([{ id: 2, field: "followUp", on: false }]);
  });

  it("mark unread and mark read refused: the read state and the badge go back, and it's reported", async () => {
    const { result, act, posts, unavailable } = await harness([item(2), item(1, { read: false })]);
    await act(async () => { result.current.markUnread([2]); });
    expect(result.current.unread).toBe(2);
    await act(async () => { posts("/api/inbox/unread")[0].reject(unavailable()); });
    expect(state(result)).toEqual([[2, true, false], [1, false, false]]);
    expect(result.current.unread).toBe(1);
    expect(result.current.failures).toEqual([{ id: 2, field: "read", on: false }]);
    await act(async () => { result.current.markRead([1]); });
    await act(async () => { posts("/api/inbox/read")[0].reject(unavailable()); });
    expect(state(result)).toEqual([[2, true, false], [1, false, false]]);
    expect(result.current.unread).toBe(1);
    expect(result.current.failures).toEqual([{ id: 2, field: "read", on: false }, { id: 1, field: "read", on: true }]);
  });

  it("mark all read refused: every row is unread again and the failure is reported once, with a retry of the same range", async () => {
    const { result, act, posts, unavailable } = await harness([item(3, { read: false }), item(2, { read: false, followUp: true })]);
    await act(async () => { result.current.markAllRead(); });
    expect(result.current.unread).toBe(0);
    await act(async () => { posts("/api/inbox/read")[0].reject(unavailable()); });
    expect(state(result)).toEqual([[3, false, false], [2, false, true]]);
    expect(result.current.unread).toBe(2);
    expect(result.current.allReadFailed).toEqual({ upTo: 3 });
    expect(result.current.failures).toEqual([]);
    await act(async () => { result.current.retryAllRead(); });
    expect(posts("/api/inbox/read")[1].json).toEqual({ all: true, upTo: 3 });
    expect(result.current.allReadFailed).toBeNull();
  });

  it("a write refused after the account changed reports nothing to the next account and is never retried there", async () => {
    const { result, rerender, act, posts, unavailable } = await harness([item(2)]);
    await act(async () => { result.current.setFollowUp([2], true); });
    rerender({ id: null });
    rerender({ id: 2 });
    await act(async () => { posts("/api/inbox/follow-up")[0].reject(unavailable()); });
    expect(result.current.failures).toEqual([]);
    expect(result.current.items).toEqual([]);
    expect(posts("/api/inbox/follow-up")).toHaveLength(1);
  });
});
