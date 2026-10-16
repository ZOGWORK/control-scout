// Comments on workspace entries, on the device (server/scout/comments.ts, src/shared/comments.ts).
//
// Comments live on the server only (no offline queue: a comment is a conversation, and one sent
// hours late reads wrong). The thread of an open entry and the counts on the cards update live:
// scoutLive.ts re-announces each `event: comment` from the workspace's stream as SCOUT_COMMENT, and
// SCOUT_COMMENTS_RESYNC whenever the stream (re)connects or a poll runs, since comment events carry
// no id and a device that was away refetches what it shows instead.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "./api";
import { isCommentEvent, isEntryComment, type CommentEvent, type EntryComment } from "../shared/comments";

/** Window event: a comment changed in a workspace (detail: CommentEvent). */
export const SCOUT_COMMENT = "cs-scout-comment";
/** Window event: what's shown may be stale (detail: { space }); threads and counts refetch. */
export const SCOUT_COMMENTS_RESYNC = "cs-scout-comments-resync";

export const announceComment = (e: CommentEvent) => { window.dispatchEvent(new CustomEvent(SCOUT_COMMENT, { detail: e })); };
export const announceCommentsResync = (space: string) => { window.dispatchEvent(new CustomEvent(SCOUT_COMMENTS_RESYNC, { detail: { space } })); };

const enc = encodeURIComponent;
const threadUrl = (space: string, uuid: string) => `/api/scout/workspaces/${enc(space)}/entries/${enc(uuid)}/comments`;

/** Apply one change to a thread (oldest first, by id). */
export function applyCommentEvent(thread: EntryComment[], e: CommentEvent): EntryComment[] {
  if (e.action === "deleted") return thread.filter((c) => c.id !== e.commentId);
  if (!e.comment) return thread;
  const at = thread.findIndex((c) => c.id === e.commentId);
  if (at < 0) return [...thread, e.comment].sort((a, b) => a.id - b.id);
  // An edit that arrives after a newer one (a reply racing the stream) never puts the older text back.
  if ((thread[at].editedAt ?? 0) > (e.comment.editedAt ?? 0)) return thread;
  const next = thread.slice();
  next[at] = e.comment;
  return next;
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

/** How many comments each entry of a workspace has (uuid → count; missing: none). Personal (null): none. */
export function useCommentCounts(space: string | null): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    setCounts({});
    if (!space) return;
    let gen = 0;
    const fetchCounts = () => {
      const g = ++gen;
      apiFetch<{ counts: Record<string, unknown> }>(`/api/scout/workspaces/${enc(space)}/comment-counts`)
        .then((r) => {
          if (g !== gen) return;
          const out: Record<string, number> = {};
          for (const [k, v] of Object.entries(r?.counts ?? {})) if (Number.isSafeInteger(v) && (v as number) > 0) out[k] = v as number;
          setCounts(out);
        })
        .catch(() => { /* offline or refused: the cards just show no count */ });
    };
    fetchCounts();
    const offResync = onResync(space, fetchCounts);
    const offComment = onComment(space, (e) => setCounts((c) => ({ ...c, [e.entryUuid]: e.count })));
    return () => { gen++; offResync(); offComment(); };
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
  post: (body: string) => Promise<void>;
  edit: (id: number, body: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  reload: () => void;
}

const message = (e: unknown, fallback: string) => (e instanceof ApiError ? (e.offline ? "You're offline. Comments need a connection." : e.message) : fallback);

/** The thread of one workspace entry, live. Null space or uuid: nothing (Personal entries have no comments). */
export function useEntryComments(space: string | null, uuid: string | null): ThreadState {
  const [comments, setComments] = useState<EntryComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const gen = useRef(0);
  // Changes heard (live or from our own writes) while a load is on its way are applied over its answer.
  const heard = useRef<CommentEvent[]>([]);

  const load = useCallback(() => {
    if (!space || !uuid) return;
    const g = gen.current;
    heard.current = [];
    setLoading(true);
    apiFetch<{ comments: unknown[]; entryDeleted: boolean }>(threadUrl(space, uuid))
      .then((r) => {
        if (gen.current !== g) return;
        let list = (r?.comments ?? []).filter(isEntryComment);
        for (const e of heard.current) list = applyCommentEvent(list, e);
        setComments(list);
        setClosed(!!r?.entryDeleted);
        setError(null);
      })
      .catch((e) => { if (gen.current === g) setError(message(e, "Couldn't load the comments.")); })
      .finally(() => { if (gen.current === g) setLoading(false); });
  }, [space, uuid]);

  useEffect(() => {
    gen.current++;
    setComments([]); setError(null); setClosed(false); setLoading(false);
    heard.current = [];
    if (!space || !uuid) return;
    load();
    const offResync = onResync(space, load);
    const offComment = onComment(space, (e) => {
      if (e.entryUuid !== uuid) return;
      heard.current.push(e);
      setComments((t) => applyCommentEvent(t, e));
    });
    return () => { gen.current++; offResync(); offComment(); };
  }, [space, uuid, load]);

  const apply = useCallback((e: CommentEvent) => {
    heard.current.push(e);
    setComments((t) => applyCommentEvent(t, e));
    // Our own change, for the count on the card even when the stream is off.
    announceComment(e);
  }, []);

  const write = useCallback(async (path: string, init: RequestInit & { json?: unknown }, fallback: string) => {
    if (!space || !uuid) return;
    try {
      const e = await apiFetch<unknown>(threadUrl(space, uuid) + path, init);
      if (isCommentEvent(e)) apply(e);
    } catch (err) {
      // The comment or its entry was deleted meanwhile: show the thread as it is now (and close it if the entry went).
      if (err instanceof ApiError && (err.status === 404 || err.status === 409)) load();
      throw new Error(message(err, fallback));
    }
  }, [space, uuid, apply, load]);

  return {
    comments, loading, error, closed, reload: load,
    post: (body) => write("", { method: "POST", json: { body } }, "Couldn't post your comment. Try again."),
    edit: (id, body) => write(`/${id}`, { method: "PATCH", json: { body } }, "Couldn't save your edit. Try again."),
    remove: (id) => write(`/${id}`, { method: "DELETE" }, "Couldn't delete the comment. Try again."),
  };
}
