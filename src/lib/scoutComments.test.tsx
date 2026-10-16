// @vitest-environment jsdom
// Comments on the device: merging changes into a thread, the thread and the card counts following the
// live stream (`event: comment` re-announced by scoutLive.ts), and refetching on every (re)connect, since
// comment events carry no id to catch up from.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { announceComment, announceCommentsResync, applyCommentEvent, SCOUT_COMMENT, SCOUT_COMMENTS_RESYNC, useCommentCounts, useEntryComments } from "./scoutComments";
import { followWorkspace } from "./scoutLive";
import type { CommentEvent, EntryComment } from "../shared/comments";

const c = (id: number, over: Partial<EntryComment> = {}): EntryComment => ({
  id, workspaceId: "41", entryUuid: "aaaaaaaaaaaa", authorAccountId: 7, authorName: "Priya", body: `comment ${id}`, createdAt: 1000 + id, editedAt: null, ...over,
});
const ev = (action: CommentEvent["action"], comment: EntryComment, count: number): CommentEvent =>
  ({ action, workspaceId: comment.workspaceId, entryUuid: comment.entryUuid, commentId: comment.id, count, ...(action === "deleted" ? {} : { comment }) });

type Reply = { status?: number; body: unknown };
let routes: Record<string, () => Reply> = {};
const calls: { method: string; url: string; body?: unknown }[] = [];
beforeEach(() => {
  routes = {};
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const r = routes[`${method} ${url}`]?.() ?? { status: 404, body: { error: "Not found" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const THREAD = "/api/scout/workspaces/41/entries/aaaaaaaaaaaa/comments";
const COUNTS = "/api/scout/workspaces/41/comment-counts";

describe("applyCommentEvent", () => {
  it("adds in id order, replaces on edit (never with an older edit), removes on delete, ignores repeats", () => {
    let t = [c(1), c(3)];
    t = applyCommentEvent(t, ev("created", c(2), 3));
    expect(t.map((x) => x.id)).toEqual([1, 2, 3]);
    t = applyCommentEvent(t, ev("created", c(2), 3));
    expect(t).toHaveLength(3);
    t = applyCommentEvent(t, ev("edited", c(2, { body: "new", editedAt: 50 }), 3));
    t = applyCommentEvent(t, ev("edited", c(2, { body: "old", editedAt: 40 }), 3));
    expect(t[1].body).toBe("new");
    t = applyCommentEvent(t, ev("deleted", c(1), 2));
    expect(t.map((x) => x.id)).toEqual([2, 3]);
  });
});

describe("useEntryComments", () => {
  it("loads the thread, merges live changes for its entry only, and refetches on a resync", async () => {
    routes[`GET ${THREAD}`] = () => ({ body: { comments: [c(1)], entryDeleted: false } });
    const { result } = renderHook(() => useEntryComments("41", "aaaaaaaaaaaa"));
    await waitFor(() => expect(result.current.comments.map((x) => x.id)).toEqual([1]));
    act(() => { announceComment(ev("created", c(2), 2)); });
    act(() => { announceComment(ev("created", c(9, { entryUuid: "bbbbbbbbbbbb" }), 1)); }); // another entry
    act(() => { announceComment(ev("created", c(8, { workspaceId: "42" }), 1)); }); // another workspace
    expect(result.current.comments.map((x) => x.id)).toEqual([1, 2]);
    routes[`GET ${THREAD}`] = () => ({ body: { comments: [c(1), c(2), c(5)], entryDeleted: false } });
    act(() => { announceCommentsResync("41"); });
    await waitFor(() => expect(result.current.comments.map((x) => x.id)).toEqual([1, 2, 5]));
  });

  it("posts, edits and deletes; each reply updates the thread (and is announced for the card count)", async () => {
    routes[`GET ${THREAD}`] = () => ({ body: { comments: [], entryDeleted: false } });
    const heard: CommentEvent[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent<CommentEvent>).detail);
    window.addEventListener(SCOUT_COMMENT, on);
    const { result } = renderHook(() => useEntryComments("41", "aaaaaaaaaaaa"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    routes[`POST ${THREAD}`] = () => ({ status: 201, body: ev("created", c(4, { body: "hi" }), 1) });
    await act(() => result.current.post("hi"));
    expect(calls.at(-1)).toEqual({ method: "POST", url: THREAD, body: { body: "hi" } });
    expect(result.current.comments.map((x) => x.body)).toEqual(["hi"]);
    routes[`PATCH ${THREAD}/4`] = () => ({ body: ev("edited", c(4, { body: "hello", editedAt: 9 }), 1) });
    await act(() => result.current.edit(4, "hello"));
    expect(result.current.comments[0]).toMatchObject({ body: "hello", editedAt: 9 });
    routes[`DELETE ${THREAD}/4`] = () => ({ body: ev("deleted", c(4), 0) });
    await act(() => result.current.remove(4));
    expect(result.current.comments).toEqual([]);
    expect(heard.map((e) => [e.action, e.count])).toEqual([["created", 1], ["edited", 1], ["deleted", 0]]);
    window.removeEventListener(SCOUT_COMMENT, on);
  });

  it("a refused post says why and keeps the thread; a deleted entry closes it", async () => {
    routes[`GET ${THREAD}`] = () => ({ body: { comments: [c(1)], entryDeleted: false } });
    const { result } = renderHook(() => useEntryComments("41", "aaaaaaaaaaaa"));
    await waitFor(() => expect(result.current.comments).toHaveLength(1));
    routes[`POST ${THREAD}`] = () => ({ status: 429, body: { error: "You're commenting very quickly. Wait a moment and try again." } });
    await expect(result.current.post("x")).rejects.toThrow(/very quickly/);
    routes[`POST ${THREAD}`] = () => ({ status: 409, body: { error: "This entry was deleted, so it can't take new comments." } });
    routes[`GET ${THREAD}`] = () => ({ body: { comments: [c(1)], entryDeleted: true } });
    await expect(result.current.post("x")).rejects.toThrow(/deleted/);
    await waitFor(() => expect(result.current.closed).toBe(true));
    expect(result.current.comments).toHaveLength(1);
  });

  it("Personal (no space): nothing is fetched", () => {
    const { result } = renderHook(() => useEntryComments(null, "aaaaaaaaaaaa"));
    expect(result.current.comments).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("useCommentCounts", () => {
  it("loads the counts, follows live changes, and refetches on a resync", async () => {
    routes[`GET ${COUNTS}`] = () => ({ body: { counts: { aaaaaaaaaaaa: 2, bad: "x" } } });
    const { result } = renderHook(() => useCommentCounts("41"));
    await waitFor(() => expect(result.current).toEqual({ aaaaaaaaaaaa: 2 }));
    act(() => { announceComment(ev("created", c(3, { entryUuid: "bbbbbbbbbbbb" }), 1)); });
    act(() => { announceComment(ev("deleted", c(1), 1)); });
    expect(result.current).toEqual({ aaaaaaaaaaaa: 1, bbbbbbbbbbbb: 1 });
    routes[`GET ${COUNTS}`] = () => ({ body: { counts: { aaaaaaaaaaaa: 4 } } });
    act(() => { announceCommentsResync("41"); });
    await waitFor(() => expect(result.current).toEqual({ aaaaaaaaaaaa: 4 }));
  });
});

class FakeES {
  static all: FakeES[] = [];
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  constructor(readonly url: string) { FakeES.all.push(this); }
  addEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  close() { /* closed */ }
  emit(type: string, data: unknown) { for (const fn of this.listeners.get(type) ?? []) fn(new MessageEvent(type, { data: typeof data === "string" ? data : JSON.stringify(data) })); }
}

describe("the live stream (scoutLive.ts)", () => {
  it("re-announces each `event: comment` of its workspace, and asks for a resync on every (re)connect", () => {
    FakeES.all = [];
    const heard: unknown[] = [];
    const resyncs: unknown[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail);
    const re = (e: Event) => resyncs.push((e as CustomEvent).detail);
    window.addEventListener(SCOUT_COMMENT, on);
    window.addEventListener(SCOUT_COMMENTS_RESYNC, re);
    const stop = followWorkspace("41", () => undefined, { EventSource: FakeES as unknown as typeof EventSource, pull: async () => undefined, random: () => 0 });
    const es = FakeES.all[0];
    es.emit("ready", { cursor: 0 });
    expect(resyncs).toEqual([{ space: "41" }]);
    es.emit("comment", ev("created", c(1), 1));
    es.emit("comment", ev("created", c(2, { workspaceId: "99" }), 1)); // not this workspace
    es.emit("comment", "{not json");
    es.emit("comment", { action: "created" }); // not a comment event
    expect(heard).toEqual([ev("created", c(1), 1)]);
    stop();
    window.removeEventListener(SCOUT_COMMENT, on);
    window.removeEventListener(SCOUT_COMMENTS_RESYNC, re);
  });

  it("polling (no stream): each poll asks for a resync too", async () => {
    vi.useFakeTimers();
    const resyncs: unknown[] = [];
    const re = (e: Event) => resyncs.push((e as CustomEvent).detail);
    window.addEventListener(SCOUT_COMMENTS_RESYNC, re);
    const pull = vi.fn(async () => undefined);
    const stop = followWorkspace("41", () => undefined, { EventSource: undefined, pull, random: () => 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(pull).toHaveBeenCalledTimes(1);
    expect(resyncs).toEqual([{ space: "41" }]);
    stop();
    window.removeEventListener(SCOUT_COMMENTS_RESYNC, re);
  });
});
