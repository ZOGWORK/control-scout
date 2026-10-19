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
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, MessageSquare, Pencil, Send, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/basic";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { agoShort } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { usePersonal } from "../../lib/personal";
import { CommentWriteError, newCommentOpId, useEntryComments } from "../../lib/scoutComments";
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
            : <Composer post={thread.post} comments={thread.comments} />}
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

function Composer({ post, comments }: { post: (body: string, opId: string) => Promise<void>; comments: EntryComment[] }) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; uncertain: boolean } | null>(null);
  /** The attempt the text in the field belongs to: the same text sent again is the same attempt (same id). */
  const attempt = useRef<{ opId: string; text: string } | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const errId = useId();
  const fieldId = useId();
  /** The attempt went through: clear what was sent (words typed since stay) and start a new attempt next time. */
  const done = (sent: string) => { attempt.current = null; setDraft((d) => (d === sent ? "" : d)); setError(null); };
  // An unconfirmed post that shows up in the thread after all (the stream, or a refetch): it was posted.
  useEffect(() => {
    const a = attempt.current;
    if (a && !busy && comments.some((c) => c.opId === a.opId)) done(a.text);
  }, [comments, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (!sendable(draft) || busy) return;
    const sent = draft;
    if (attempt.current?.text !== sent) attempt.current = { opId: newCommentOpId(), text: sent };
    const { opId } = attempt.current;
    setBusy(true); setError(null);
    // Cleared only if it still holds what was sent: words typed while it was sending stay.
    try { await post(sent, opId); done(sent); ref.current?.focus(); }
    // The draft (and its attempt) stays, to try again.
    catch (e) { setError({ text: (e as Error).message, uncertain: e instanceof CommentWriteError && e.uncertain }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-5 border-t border-border pt-4">
      <label htmlFor={fieldId} className="sr-only">Add a comment</label>
      <Textarea id={fieldId} ref={ref} value={draft} onChange={(e) => { setDraft(e.target.value); setError(null); }} rows={2}
        placeholder="Add a comment for the workspace" enterKeyHint="enter" aria-invalid={!!error} aria-describedby={error ? errId : undefined}
        onFocus={(e) => keepVisible(e.currentTarget)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
        className="scroll-mb-24 min-h-11 text-base sm:text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={send} disabled={busy || !sendable(draft)}>{busy ? <Loader2 className="animate-spin" /> : <Send />}Comment</Button>
        <span className="hidden text-xs text-muted-foreground sm:inline">Ctrl+Enter to send · everyone in the workspace sees it</span>
        <CharsLeft length={commentLength(draft)} />
      </div>
      {error && (
        <p id={errId} role="alert" className="mt-1 text-xs text-danger">
          {error.text}
          {error.uncertain && <> <button type="button" onClick={send} disabled={busy || !sendable(draft)} className={cn("font-medium underline underline-offset-2", touch)}>Retry</button></>}
        </p>
      )}
    </div>
  );
}
