// @vitest-environment jsdom
// The inbox's live count on the device: the stream's count when it's up; when it keeps failing (or live
// updates are switched off, 503), the count is polled instead and the stream retried later.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followInbox, INBOX_BACKOFF_MS, INBOX_POLL_MS, INBOX_STREAM_RETRY_MS, mergeInbox, type InboxMode } from "./inbox";
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

describe("mergeInbox", () => {
  const it_ = (id: number, read = false) => ({ id, read } as InboxItem);
  it("within the page's range the page wins; older loaded items stay; no more on the server: the page is all", () => {
    expect(mergeInbox([it_(5), it_(4), it_(2), it_(1)], [it_(6), it_(5, true), it_(3)], true).map((i) => [i.id, i.read])).toEqual([[6, false], [5, true], [3, false], [2, false], [1, false]]);
    expect(mergeInbox([it_(5), it_(4)], [it_(5)], false).map((i) => i.id)).toEqual([5]);
    expect(mergeInbox([it_(5)], [], false)).toEqual([]);
  });
});
