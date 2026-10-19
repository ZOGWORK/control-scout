// Comments on workspace entries, on the device (server/scout/comments.ts, src/shared/comments.ts).
//
// Comments live on the server only (no offline queue: a comment is a conversation, and one sent
// hours late reads wrong). The thread of an open entry and the counts on the cards update live:
// scoutLive.ts re-announces each `event: comment` from the workspace's stream as SCOUT_COMMENT, and
// SCOUT_COMMENTS_RESYNC whenever the stream (re)connects or a poll runs, since comment events carry
// no id and a device that was away refetches what it shows instead.
//
// Posting (audit PRIVATE-F05): each attempt carries an operation id (newCommentOpId), kept across its
// retries, so the server answers a retry with the comment the first try made instead of a second one.
// When a post's outcome is unknown (the connection dropped after it was sent, or a proxy timed out),
// the device doesn't say "offline": it checks the thread for a comment with that id, and only when it
// isn't there says so and offers a retry of the same attempt.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { isCommentEvent, isEntryComment, type CommentEvent, type EntryComment } from "../shared/comments";

/** A new comment post's operation id (one per attempt; the same on its retries). */
export function newCommentOpId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A write that didn't go through. `uncertain`: it may have reached the server (no answer came back), so a
 * retry must be the same attempt (the same operation id), and the message says it couldn't be confirmed.
 */
export class CommentWriteError extends Error {
  constructor(message: string, readonly uncertain = false) { super(message); }
}

export const COMMENT_UNCONFIRMED = "Couldn't confirm your comment was posted: the connection dropped before the server answered. Retry checks again and never posts it twice.";
export const COMMENT_NOT_ARRIVED = "Your comment didn't reach the workspace. Retry to send it (it won't post twice).";

/** Window event: a comment changed in a workspace (detail: CommentEvent). */
export const SCOUT_COMMENT = "cs-scout-comment";
/** Window event: what's shown may be stale (detail: { space }); threads and counts refetch. */
export const SCOUT_COMMENTS_RESYNC = "cs-scout-comments-resync";

export const announceComment = (e: CommentEvent) => { window.dispatchEvent(new CustomEvent(SCOUT_COMMENT, { detail: e })); };
export const announceCommentsResync = (space: string) => { window.dispatchEvent(new CustomEvent(SCOUT_COMMENTS_RESYNC, { detail: { space } })); };

const enc = encodeURIComponent;
const threadUrl = (space: string, uuid: string) => `/api/scout/workspaces/${enc(space)}/entries/${enc(uuid)}/comments`;

/** Apply one change to a thread (oldest first, by id). Which changes are new enough is decided before (see Seen). */
export function applyCommentEvent(thread: EntryComment[], e: CommentEvent): EntryComment[] {
  if (e.action === "deleted") return thread.filter((c) => c.id !== e.commentId);
  if (!e.comment) return thread;
  const at = thread.findIndex((c) => c.id === e.commentId);
  if (at < 0) return [...thread, e.comment].sort((a, b) => a.id - b.id);
  const next = thread.slice();
  next[at] = e.comment;
  return next;
}

/**
 * The newest change applied per key (a comment, or an entry's count), so an older one that arrives
 * later (a slow reply racing the stream, or a stream event racing a reply) is ignored, and a deleted
 * comment never comes back. A rev of 0 (nothing changed) applies only to something not seen yet.
 */
export class Seen<K> {
  private revs = new Map<K, number>();
  readonly gone = new Set<K>();
  accept(key: K, rev: number, deleted = false): boolean {
    if (this.gone.has(key)) return false;
    const last = this.revs.get(key);
    if (last !== undefined && (rev === 0 || last >= rev)) return false;
    this.revs.set(key, rev);
    if (deleted) this.gone.add(key);
    return true;
  }
}

function onResync(space: string, fn: () => void): () => void {
  const h = (ev: Event) => { if ((ev as CustomEvent<{ space?: string }>).detail?.space === space) fn(); };
  window.addEventListener(SCOUT_COMMENTS_RESYNC, h);
  return () => window.removeEventListener(SCOUT_COMMENTS_RESYNC, h);
}
function onComment(space: string, fn: (e: CommentEvent) => void): () => void {
  const h = (ev: Event) => { const e = (ev as CustomEvent<unknown>).detail; if (isCommentEvent(e) && e.workspaceId === space) fn(e); };
  window.addEventListener(SCOUT_COMMENT, h);
  return () => window.removeEventListener(SCOUT_COMMENT, h);
}

/**
 * Loads that can overlap with live changes: each load notes where the log of accepted changes stood when
 * it started, and its answer gets every change accepted since replayed over it. Only the latest load's
 * answer is used (an older one that comes back later is dropped).
 */
function loader() {
  let gen = 0;
  let log: CommentEvent[] = [];
  return {
    record(e: CommentEvent) { log.push(e); },
    start() { const g = ++gen; const mark = log.length; return { g, since: () => (g === gen ? log.slice(mark) : null) }; },
    finished(g: number) { if (g === gen) log = []; },
    cancel() { gen++; log = []; },
    current: (g: number) => g === gen,
  };
}

/** How many comments each entry of a workspace has (uuid → count; missing: none). Personal (null): none. */
export function useCommentCounts(space: string | null): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setCounts({});
    if (!space) return;
    const loads = loader();
    const seen = new Seen<string>();
    const set = (c: Record<string, number>, e: CommentEvent) => ({ ...c, [e.entryUuid]: e.count });
    const fetchCounts = () => {
      const { g, since } = loads.start();
      apiFetch<{ counts: Record<string, unknown> }>(`/api/scout/workspaces/${enc(space)}/comment-counts`)
        .then((r) => {
          const later = since();
          if (!later) return;
          let out: Record<string, number> = {};
          for (const [k, v] of Object.entries(r?.counts ?? {})) if (Number.isSafeInteger(v) && (v as number) > 0) out[k] = v as number;
          for (const e of later) out = set(out, e); // changes heard while it was on its way are newer than it
          setCounts(out);
        })
        .catch(() => { /* offline or refused: the cards keep what they show */ })
        .finally(() => loads.finished(g));
    };
    fetchCounts();
    const offResync = onResync(space, fetchCounts);
    const offComment = onComment(space, (e) => {
      if (e.rev === 0 || !seen.accept(e.entryUuid, e.rev)) return;
      loads.record(e);
      setCounts((c) => set(c, e));
    });
    return () => { loads.cancel(); offResync(); offComment(); };
  }, [space]);
  return counts;
}

export interface ThreadState {
  comments: EntryComment[];
  loading: boolean;
  /** The last load failed (the thread shown may be out of date). */
  error: string | null;
  /** The entry was deleted: no new comments. */
  closed: boolean;
  /** `opId`: this attempt's operation id (newCommentOpId), the same when retrying it. */
  post: (body: string, opId: string) => Promise<void>;
  edit: (id: number, body: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  reload: () => void;
}

/** What to say about a failed request. Offline only when the device knows it is; a dropped connection otherwise. */
const message = (e: unknown, fallback: string) => (e instanceof ApiError
  ? (e.offline ? (typeof navigator !== "undefined" && navigator.onLine === false ? "You're offline. Comments need a connection." : "Couldn't reach the server. Check your connection and try again.") : e.message)
  : fallback);
/**
 * No answer, or a server error (a proxy's 5xx when the connection to the server dropped, e.g. 502 or 520-524,
 * or a failure after the write): the request may have been carried out. 503 is a definite answer (paused).
 */
const unanswered = (e: unknown) => e instanceof ApiError && (e.status === 0 || (e.status >= 500 && e.status !== 503));

/** The thread of one workspace entry, live. Null space or uuid: nothing (Personal entries have no comments). */
export function useEntryComments(space: string | null, uuid: string | null): ThreadState {
  const [comments, setComments] = useState<EntryComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  // Per thread shown (space + entry): which changes were applied, and the loads in flight.
  const live = useRef({ seen: new Seen<number>(), loads: loader() });

  const load = useCallback(() => {
    if (!space || !uuid) return;
    const { seen, loads } = live.current;
    const { g, since } = loads.start();
    setLoading(true);
    apiFetch<{ comments: unknown[]; entryDeleted: boolean }>(threadUrl(space, uuid))
      .then((r) => {
        const later = since();
        if (!later) return;
        let list = (r?.comments ?? []).filter(isEntryComment).filter((c) => !seen.gone.has(c.id));
        for (const e of later) list = applyCommentEvent(list, e);
        setComments(list);
        setClosed(!!r?.entryDeleted);
        setError(null);
      })
      .catch((e) => { if (loads.current(g)) setError(message(e, "Couldn't load the comments.")); })
      .finally(() => { if (loads.current(g)) setLoading(false); loads.finished(g); });
  }, [space, uuid]);

  useEffect(() => {
    live.current.loads.cancel();
    live.current = { seen: new Seen<number>(), loads: loader() };
    setComments([]); setError(null); setClosed(false); setLoading(false);
    if (!space || !uuid) return;
    const { seen, loads } = live.current;
    load();
    const offResync = onResync(space, load);
    const offComment = onComment(space, (e) => {
      if (e.entryUuid !== uuid || !seen.accept(e.commentId, e.rev, e.action === "deleted")) return;
      loads.record(e);
      setComments((t) => applyCommentEvent(t, e));
    });
    return () => { loads.cancel(); offResync(); offComment(); };
  }, [space, uuid, load]);

  const write = useCallback(async (path: string, init: RequestInit & { json?: unknown }, fallback: string) => {
    if (!space || !uuid) return;
    try {
      const e = await apiFetch<unknown>(threadUrl(space, uuid) + path, init);
      // Our own change: applied here through the same check as the stream's (whichever comes first wins),
      // and heard by the card counts even when the stream is off.
      if (isCommentEvent(e)) announceComment(e);
    } catch (err) {
      // The comment or its entry was deleted meanwhile: show the thread as it is now (and close it if the entry went).
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) load();
      throw new CommentWriteError(message(err, fallback));
    }
  }, [space, uuid, load]);

  /**
   * Post one attempt. Its answer lost (the device was online when it went): look for its comment in the
   * thread. There: posted after all (applied like the stream's copy). Not there, or the thread can't be read:
   * an uncertain failure, to retry with the same opId.
   */
  const post = useCallback(async (body: string, opId: string) => {
    if (!space || !uuid) return;
    const offlineBefore = typeof navigator !== "undefined" && navigator.onLine === false;
    try {
      const e = await apiFetch<unknown>(threadUrl(space, uuid), { method: "POST", json: { body, opId } });
      if (isCommentEvent(e)) announceComment(e);
      return;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) load();
      // Never sent (known offline), or the server answered (refused): as it says.
      if (offlineBefore || !unanswered(err)) throw new CommentWriteError(message(err, "Couldn't post your comment. Try again."));
    }
    // Sent, but no answer: did it make the comment? The thread says (by the attempt's id).
    let thread: { comments?: unknown[] } | null = null;
    try { thread = await apiFetch<{ comments?: unknown[] }>(threadUrl(space, uuid)); } catch { /* still can't tell */ }
    if (!thread) throw new CommentWriteError(COMMENT_UNCONFIRMED, true);
    const made = (thread.comments ?? []).filter(isEntryComment).find((c) => c.opId === opId);
    if (!made) throw new CommentWriteError(COMMENT_NOT_ARRIVED, true);
    // Posted after all: applied like the stream's copy would be (rev 0: only if it isn't shown already).
    announceComment({ action: "created", workspaceId: space, entryUuid: uuid, commentId: made.id, count: thread.comments?.length ?? 0, rev: 0, comment: made });
  }, [space, uuid, load]);

  return {
    comments, loading, error, closed, reload: load, post,
    edit: (id, body) => write(`/${id}`, { method: "PATCH", json: { body } }, "Couldn't save your edit. Try again."),
    remove: (id) => write(`/${id}`, { method: "DELETE" }, "Couldn't delete the comment. Try again."),
  };
}
