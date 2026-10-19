// The comment thread under an open workspace entry (Task 15): oldest first,
// each with its author and relative time ("Priya · 2m ago · edited"), live
// for everyone viewing the entry. You edit and delete your own comments; a
// workspace admin can delete anyone's. Plain text only: bodies render as text
// (React escapes them), with their line breaks; nothing is turned into a link.
// A deleted comment disappears from the thread.
//
// Touch: every control is at least 44 px tall on small screens, the composer
// scrolls itself above the on-screen keyboard when focused, and Ctrl/⌘+Enter posts.
//
// A post the server may have taken without its answer arriving (audit PRIVATE-F05) keeps its text and its
// operation id: the thread is checked for it, and Retry sends the same attempt, so it never posts twice.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, MessageSquare, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/basic";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { agoShort } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { usePersonal } from "../../lib/personal";
import { newCommentOpId, useEntryComments } from "../../lib/scoutComments";
import { commentArrived, discardComment, loadCommentAttempts, sendComment, useCommentAttempt, type CommentPlace } from "../../lib/commentAttempts";
import { SAVED_SHOW_MS, type SaveState } from "../../lib/pendingWork";
import { SaveStatus } from "../SaveStatus";
import type { ScoutEntry } from "../../lib/scouting";
import { COMMENT_MAX, commentLength, type EntryComment } from "../../shared/comments";

/** Show the characters-left counter once a comment gets this close to the limit. */
const COUNTER_FROM = COMMENT_MAX - 200;
/** Something to send, within the limit (counted like the server: characters after trimming, not UTF-16 units). */
const sendable = (text: string) => { const n = commentLength(text); return n > 0 && n <= COMMENT_MAX; };
const touch = "max-sm:h-11 max-sm:min-w-11";

/** Keep a focused field above the on-screen keyboard (it opens after focus, and shrinks the visual viewport). */
const keepVisible = (el: HTMLElement) => {
  setTimeout(() => { if (el.isConnected && document.activeElement === el) el.scrollIntoView?.({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, 300);
};

export function EntryComments({ entry, className }: { entry: ScoutEntry; className?: string }) {
  const space = entry.workspaceId;
  const synced = space != null && !!entry.authorAccountId; // on the server: comments attach to its copy
  const thread = useEntryComments(synced ? space : null, synced ? entry.uuid : null);
  const { user } = usePersonal();
  const cp = user?.controlPoint;
  const ws = cp?.workspaces?.find((w) => w.id === space);
  // A read-only space (Task 19: deleted in Control Point, or no admin left): the thread reads, nothing changes.
  const readOnly = !!ws?.orphaned;
  const me = { accountId: cp?.accountId, admin: ws?.role === "admin" };
  const headingId = useId();
  // Where a new comment belongs (kept until the workspace confirms it): this account, workspace and entry.
  const account = me.accountId;
  const place = useMemo<CommentPlace | null>(() => (account == null || space == null || !synced ? null : {
    account, space, uuid: entry.uuid, season: entry.season, team: entry.team,
    what: `Comment on ${entry.team} · ${entry.kind === "pit" ? "Pit" : `Match ${entry.matchLabel ?? ""}`.trim()}`,
  }), [account, space, synced, entry.uuid, entry.season, entry.team, entry.kind, entry.matchLabel]);
  // Attempts kept from before a reload are checked against their threads (once per page).
  useEffect(() => { loadCommentAttempts(account); }, [account]);
  if (space == null) return null; // Personal entries have no comments
  const n = thread.comments.length;
  return (
    <section aria-labelledby={headingId} className={cn("rounded-2xl border border-border bg-card p-5 sm:p-6", className)}>
      <h2 id={headingId} className="flex items-center gap-2 font-medium">
        <MessageSquare className="size-4 text-muted-foreground" aria-hidden />
        <span>Comments{n > 0 && <span className="text-muted-foreground"> ({n})</span>}</span>
      </h2>
      {!synced ? (
        <p className="mt-2 text-sm text-muted-foreground">Save and sync this entry, then the workspace can comment on it.</p>
      ) : (
        <>
          {thread.loading && !n && (
            <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Loading comments</p>
          )}
          {thread.error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {thread.error} <button type="button" onClick={thread.reload} className={cn("underline underline-offset-2", touch)}>Try again</button>
            </p>
          )}
          {!thread.loading && !thread.error && !n && (
            <p className="mt-2 text-sm text-muted-foreground">{thread.closed ? "No comments." : "No comments yet. Ask a question or add context for the team."}</p>
          )}
          {n > 0 && (
            <ol className="mt-4 space-y-4" aria-label="Comments, oldest first">
              {thread.comments.map((c) => (
                <CommentRow key={c.id} c={c} mine={!readOnly && me.accountId != null && c.authorAccountId === me.accountId} admin={!readOnly && me.admin} thread={thread} />
              ))}
            </ol>
          )}
          {readOnly
            ? <p className="mt-4 text-sm text-muted-foreground">This workspace is read-only: its comments can be read, not added to.</p>
            : thread.closed
            ? <p className="mt-4 text-sm text-muted-foreground">This entry was deleted, so it can't take new comments.</p>
            : <Composer key={place ? `${place.account}:${place.uuid}` : "none"} post={thread.post} comments={thread.comments} place={place} />}
        </>
      )}
    </section>
  );
}

type Thread = ReturnType<typeof useEntryComments>;

function CommentRow({ c, mine, admin, thread }: { c: EntryComment; mine: boolean; admin: boolean; thread: Thread }) {
  const now = useNow();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const at = new Date(c.createdAt);
  const save = async () => {
    setBusy(true); setError(null);
    try { await thread.edit(c.id, draft); setEditing(false); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await thread.remove(c.id); toast("Comment deleted"); }
    catch (e) { toast.error((e as Error).message); setBusy(false); setConfirming(false); }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (sendable(draft) && !busy) void save(); }
    if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(c.body); setError(null); }
  };
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent/20 text-xs font-medium text-foreground">
        {(c.authorName.trim()[0] ?? "?").toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground" title={Number.isFinite(at.getTime()) ? at.toLocaleString() : undefined}>
          <span className="font-medium text-foreground">{c.authorName || "Member"}</span>
          {" · "}<time dateTime={Number.isFinite(at.getTime()) ? at.toISOString() : undefined}>{agoShort(c.createdAt, now)}</time>
          {c.editedAt != null && <> · <span title={new Date(c.editedAt).toLocaleString()}>edited</span></>}
        </p>
        {editing ? (
          <div className="mt-1.5">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onFocus={(e) => keepVisible(e.currentTarget)} readOnly={busy}
              aria-label="Edit your comment" aria-invalid={!!error} aria-describedby={error ? errId : undefined} autoFocus rows={3} className="scroll-mb-24 text-base sm:text-sm" />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" className={touch} onClick={save} disabled={busy || !sendable(draft)}>{busy ? <Loader2 className="animate-spin" /> : null}Save</Button>
              <Button type="button" size="sm" variant="ghost" className={touch} onClick={() => { setEditing(false); setDraft(c.body); setError(null); }} disabled={busy}>Cancel</Button>
              <CharsLeft length={commentLength(draft)} />
            </div>
            {error && <p id={errId} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
          </div>
        ) : (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">{c.body}</p>
        )}
        {!editing && (mine || admin) && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {confirming ? (
              <>
                <span className="text-xs text-muted-foreground">{mine ? "Delete your comment?" : `Delete ${c.authorName || "this member"}'s comment?`}</span>
                <Button type="button" size="sm" variant="ghost" className={cn("text-danger", touch)} onClick={remove} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}Delete</Button>
                <Button type="button" size="sm" variant="ghost" className={touch} onClick={() => setConfirming(false)} disabled={busy}>Keep</Button>
              </>
            ) : (
              <>
                {mine && <Button type="button" size="sm" variant="ghost" className={cn("text-muted-foreground", touch)} onClick={() => { setDraft(c.body); setEditing(true); }} aria-label="Edit your comment"><Pencil />Edit</Button>}
                <Button type="button" size="sm" variant="ghost" className={cn("text-muted-foreground", touch)} onClick={() => setConfirming(true)}
                  aria-label={mine ? "Delete your comment" : `Delete ${c.authorName || "this member"}'s comment`}><Trash2 className="size-4" />Delete</Button>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function CharsLeft({ length }: { length: number }) {
  if (length < COUNTER_FROM) return null;
  const left = COMMENT_MAX - length;
  return <span className={cn("ml-auto text-xs tabular-nums", left < 0 ? "text-danger" : "text-muted-foreground")} aria-live="polite">{left < 0 ? `${(-left).toLocaleString()} over the ${COMMENT_MAX.toLocaleString()}-character limit` : `${left.toLocaleString()} characters left`}</span>;
}

/**
 * The new-comment box, with where its comment stands (E4): Draft while typed, Saving while it's on its way, a
 * moment of Saved, and Needs attention when it didn't go or its outcome is unknown. The attempt is kept
 * (commentAttempts.ts) until the workspace confirms it, so closing the entry, or a reload, doesn't lose it: it
 * comes back here, and the recoverable-changes view lists it meanwhile.
 */
function Composer({ post, comments, place }: { post: (body: string, opId: string) => Promise<void>; comments: EntryComment[]; place: CommentPlace | null }) {
  const attempt = useCommentAttempt(place?.account, place?.space ?? null, place?.uuid ?? null);
  // A kept attempt (one that didn't go, or isn't confirmed) comes back into the field.
  const [draft, setDraft] = useState(() => attempt?.body ?? "");
  const [justSaved, setJustSaved] = useState(false);
  // One attempt per entry at a time: while it's on its way (or being checked), nothing else is sent, even if the text changes.
  const busy = attempt?.state === "saving";
  /** The attempt the text in the field belongs to: the same text sent again is the same attempt (same id). */
  const local = useRef<{ opId: string; text: string } | null>(attempt ? { opId: attempt.opId, text: attempt.body } : null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const errId = useId();
  const fieldId = useId();
  const saved = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saved.current) clearTimeout(saved.current); }, []);
  /** The attempt went through: clear what was sent (words typed since stay) and start a new attempt next time. */
  const done = (sent: string) => {
    local.current = null;
    setDraft((d) => (d === sent ? "" : d));
    setJustSaved(true);
    if (saved.current) clearTimeout(saved.current);
    saved.current = setTimeout(() => setJustSaved(false), SAVED_SHOW_MS);
  };
  // An unconfirmed post that shows up in the thread after all (the stream, or a refetch): it was posted.
  useEffect(() => {
    const a = local.current;
    if (!a || busy || !comments.some((c) => c.opId === a.opId)) return;
    if (place) commentArrived(place.account, place.space, place.uuid, a.opId);
    done(a.text);
  }, [comments, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Confirmed or let go elsewhere (the recoverable view's Retry or Discard): the field follows.
  const had = useRef(attempt);
  useEffect(() => {
    const before = had.current;
    had.current = attempt;
    // Kept from before a reload, read after this field mounted: its text and id come back (never over typing).
    if (!before && attempt && !local.current) {
      local.current = { opId: attempt.opId, text: attempt.body };
      setDraft((d) => (d.trim() ? d : attempt.body));
      return;
    }
    if (!before || attempt?.opId === before.opId) return;
    if (local.current?.opId !== before.opId) return;
    // Another tab replaced it with a newer attempt: that one comes into the field (unless something new was typed here).
    if (attempt) { local.current = { opId: attempt.opId, text: attempt.body }; setDraft((d) => (d === before.body || !d.trim() ? attempt.body : d)); return; }
    local.current = null;
    setDraft((d) => (d === before.body ? "" : d));
  }, [attempt]);
  const send = async () => {
    if (!sendable(draft) || busy) return;
    const sent = draft;
    if (local.current?.text !== sent) local.current = { opId: newCommentOpId(), text: sent };
    const { opId } = local.current;
    setJustSaved(false);
    // Cleared only if it still holds what was sent: words typed while it was sending stay.
    let ok: boolean;
    if (place) ok = await sendComment(place, sent, opId, post);
    else ok = await post(sent, opId).then(() => true, () => false);
    if (ok) { done(sent); ref.current?.focus(); }
  };
  const discard = () => {
    if (place) discardComment(place.account, place.space, place.uuid);
    local.current = null;
    setDraft("");
    ref.current?.focus();
  };
  // The message belongs to the text it was about: once that's edited, it's a new comment.
  const problem = attempt?.state === "attention" && draft === attempt.body ? attempt : null;
  const state: SaveState | null = problem ? "attention" : busy ? "saving" : justSaved && !draft.trim() ? "saved" : draft.trim() ? "draft" : null;
  return (
    <div className="mt-5 border-t border-border pt-4">
      <label htmlFor={fieldId} className="sr-only">Add a comment</label>
      <Textarea id={fieldId} ref={ref} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
        placeholder="Add a comment for the workspace" enterKeyHint="enter" aria-invalid={!!problem} aria-describedby={problem ? errId : undefined}
        onFocus={(e) => keepVisible(e.currentTarget)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        className="scroll-mb-24 min-h-11 text-base sm:text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={send} disabled={busy || !sendable(draft)}>{busy ? <Loader2 className="animate-spin" /> : <Send />}Comment</Button>
        <SaveStatus state={state} what="Your comment" text={state === "saved" ? "Posted" : state === "saving" ? "Posting…" : undefined} />
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl+Enter to send · everyone in the workspace sees it</span>
        <CharsLeft length={commentLength(draft)} />
      </div>
      {problem && (
        <p id={errId} role="alert" className="mt-1 text-xs text-danger">
          {problem.message}
          {" "}<button type="button" onClick={send} disabled={busy || !sendable(draft)} className={cn("font-medium underline underline-offset-2", touch)}>Retry</button>
          {" "}<button type="button" onClick={discard} className={cn("font-medium underline underline-offset-2", touch)}>Discard</button>
        </p>
      )}
    </div>
  );
}
