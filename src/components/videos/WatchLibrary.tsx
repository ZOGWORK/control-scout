// The watch page's own part of the library (pages/WatchPage.tsx): Save and Watch later under the video, and Notes
// where comments would be. A note is written at the moment the video is at (the player's clock, lib/ytBridge.ts),
// or about the whole video; a note's moment plays the video from there. An account's notes are shared with its
// Control Point team (each teammate's under their name, theirs alone to edit); with no team, or signed out (the
// device keeps its own), only the person sees them.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bookmark, BookmarkCheck, Clock, Check, Pencil, Trash2 } from "lucide-react";
import { addNote, deleteNote, editNote, itemState, setInList, useLibraryVersion } from "../../lib/videoLibrary";
import { NOTE_MAX, noteTime, type LibraryItemState, type LibraryList, type VideoNote } from "../../shared/videoLibrary";
import type { FeedItem } from "../../shared/videosFeed";
import { Button } from "../ui/button";
import { cn } from "../cn";

const PRESS = "transition-[color,background-color,border-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

/** This video's place in the library, read again whenever the library changes. Kept with the video it's for, so the
 *  next video never shows the last one's notes or lists while its own are read. */
export function useItemState(item: FeedItem | null, signedIn: boolean, ready: boolean) {
  const v = useLibraryVersion();
  const [s, set] = useState<{ key: string; state: LibraryItemState } | null>(null);
  const key = item?.key;
  useEffect(() => {
    if (!key || !ready) return;
    let live = true;
    void itemState(signedIn, key).then((x) => { if (live) set({ key, state: x }); }).catch(() => {});
    return () => { live = false; };
  }, [key, signedIn, ready, v]);
  return s && key && s.key === key ? s.state : null;
}

/** Save and Watch later: each a toggle, answered at once and set right if the server says no. */
export function WatchActions({ item, signedIn, state }: { item: FeedItem | null; signedIn: boolean; state: LibraryItemState | null }) {
  const [on, setOn] = useState<Partial<Record<LibraryList, boolean>>>({});
  useEffect(() => { setOn({}); }, [item?.key, state]);
  const has = (l: LibraryList) => on[l] ?? !!state?.lists.includes(l);
  const toggle = (l: LibraryList) => {
    if (!item) return;
    const next = !has(l);
    setOn((o) => ({ ...o, [l]: next }));
    void setInList(signedIn, l, item, next).catch(() => setOn((o) => ({ ...o, [l]: !next })));
  };
  const pill = (active: boolean) => cn("inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium disabled:opacity-50", PRESS,
    active ? "border-transparent bg-text-base text-background" : "border-ink/[0.12] bg-ink/[0.04] text-text-base hover:bg-ink/[0.08]");
  return (
    <div className="flex flex-wrap items-center gap-2" data-watch-actions>
      <button type="button" className={pill(has("saved"))} aria-pressed={has("saved")} disabled={!item} onClick={() => toggle("saved")} data-watch-save>
        {has("saved") ? <BookmarkCheck className="size-4" aria-hidden /> : <Bookmark className="size-4" aria-hidden />}{has("saved") ? "Saved" : "Save"}
      </button>
      <button type="button" className={pill(has("later"))} aria-pressed={has("later")} disabled={!item} onClick={() => toggle("later")} data-watch-later>
        {has("later") ? <Check className="size-4" aria-hidden /> : <Clock className="size-4" aria-hidden />}Watch later
      </button>
    </div>
  );
}

/** Notes: write one at the video's moment (or about the whole video), and read, edit or delete your own. */
export function WatchNotes({ item, signedIn, state, now, seek }: { item: FeedItem | null; signedIn: boolean; state: LibraryItemState | null; now: number | null; seek: (t: number) => void }) {
  const [body, setBody] = useState("");
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extra, setExtra] = useState<VideoNote[]>([]);
  useEffect(() => { setExtra([]); }, [state]);
  const notes = [...(state?.notes ?? []), ...extra.filter((x) => !state?.notes.some((n) => n.id === x.id))];
  const at = whole || now == null ? null : now;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = body.trim();
    if (!item || !text || busy) return;
    setBusy(true); setError(null);
    try {
      const n = await addNote(signedIn, item, at, text);
      setExtra((x) => [...x, n]);
      setBody("");
    } catch (err) { setError((err as Error).message || "Couldn't keep that note. Try again."); }
    finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="watch-notes" className="mt-8" data-watch-notes>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 id="watch-notes" className="text-base font-semibold text-text-base">Notes</h2>
        {notes.length > 0 && <span className="text-sm tabular-nums text-text-faint">{notes.length}</span>}
        <span className="ml-auto min-w-0 truncate text-xs text-text-faint" data-notes-audience>{state?.teams.length ? `Shared with ${state.teams.join(", ")}` : "Only you see these"}</span>
      </div>
      <form onSubmit={submit} className="rounded-2xl border border-line bg-card p-3 focus-within:border-ink/25">
        <label htmlFor="watch-note-body" className="sr-only">Add a note</label>
        <textarea id="watch-note-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={NOTE_MAX} rows={2} disabled={!item}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e); }}
          placeholder={at != null ? `Note at ${noteTime(at)}…` : "Note about this video…"}
          className="block w-full resize-y bg-transparent text-sm leading-6 text-text-base outline-none placeholder:text-text-faint" data-note-input />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setWhole((w) => !w)} aria-pressed={!whole && now != null} disabled={now == null}
            className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium tabular-nums disabled:opacity-60", PRESS,
              at != null ? "bg-accent/15 text-accent-text hover:bg-accent/25" : "bg-ink/[0.06] text-text-muted hover:bg-ink/[0.1]")}
            title={at != null ? "This note is about this moment. Tap to make it about the whole video." : "About the whole video. Tap to note the moment instead."} data-note-moment>
            <Clock className="size-3.5" aria-hidden />{at != null ? noteTime(at) : "Whole video"}
          </button>
          {error && <p className="text-xs text-text-muted" role="alert">{error}</p>}
          <Button type="submit" size="sm" className="ml-auto" disabled={!item || !body.trim() || busy}>Add note</Button>
        </div>
      </form>
      {notes.length > 0 && (
        <ul className="mt-4 space-y-1" data-note-list>
          {notes.map((n) => <NoteRow key={n.id} note={n} signedIn={signedIn} seek={seek} onGone={() => setExtra((x) => x.filter((y) => y.id !== n.id))} />)}
        </ul>
      )}
      {!signedIn && notes.length > 0 && <p className="mt-3 text-xs text-text-faint">Kept on this device. Sign in to keep your notes on your account and share them with your team.</p>}
    </section>
  );
}

function NoteRow({ note, signedIn, seek, onGone }: { note: VideoNote; signedIn: boolean; seek: (t: number) => void; onGone: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [leaving, setLeaving] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => { if (editing) box.current?.focus(); }, [editing]);
  const [failed, setFailed] = useState(false);
  const save = async () => {
    const t = text.trim();
    if (!t) return;
    if (t !== note.body) {
      try { await editNote(signedIn, note.id, t); } catch { setFailed(true); return; }
    }
    setFailed(false);
    setEditing(false);
  };
  const remove = () => {
    setLeaving(true);
    window.setTimeout(() => { void deleteNote(signedIn, note.id).then(onGone).catch(() => setLeaving(false)); }, 150);
  };
  const theirs = note.author && !note.author.mine;
  const icon = "inline-flex size-8 items-center justify-center rounded-lg text-text-faint transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-ink/[0.06] hover:text-text-base active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100";
  return (
    <li className={cn("group/note flex gap-3 rounded-xl px-2 py-2 transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-ink/[0.03] motion-reduce:transition-none", leaving && "scale-[0.98] opacity-0")} data-note={note.id}>
      {note.t != null
        ? <button type="button" onClick={() => seek(note.t!)} className={cn("h-6 shrink-0 rounded-md bg-accent/15 px-1.5 text-xs font-semibold tabular-nums text-accent-text hover:bg-accent/25", PRESS)} aria-label={`Play from ${noteTime(note.t)}`}>{noteTime(note.t)}</button>
        : <span className="h-6 shrink-0 rounded-md bg-ink/[0.06] px-1.5 text-xs font-medium leading-6 text-text-faint">Video</span>}
      <div className="min-w-0 flex-1">
        {editing ? (
          <div>
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} maxLength={NOTE_MAX} rows={2}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save(); if (e.key === "Escape") { setText(note.body); setEditing(false); } }}
              className="block w-full resize-y rounded-lg border border-line bg-card px-2 py-1 text-sm leading-6 text-text-base outline-none focus:border-ink/25" aria-label="Edit note" />
            <div className="mt-1.5 flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={!text.trim()}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setText(note.body); setFailed(false); setEditing(false); }}>Cancel</Button>
              {failed && <p className="self-center text-xs text-text-muted" role="alert">Couldn't save that change. Try again.</p>}
            </div>
          </div>
        ) : <>
          {theirs && <p className="text-xs font-medium text-text-muted" data-note-author>{note.author!.name}{note.author!.team ? <span className="font-normal text-text-faint"> · {note.author!.team}</span> : null}</p>}
          <p className="whitespace-pre-line break-words text-sm leading-6 text-text-base">{note.body}</p>
        </>}
      </div>
      {!editing && !theirs && (
        <div className="flex shrink-0 items-start gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:duration-150 sm:group-hover/note:opacity-100 sm:group-focus-within/note:opacity-100">
          <button type="button" className={icon} onClick={() => setEditing(true)} aria-label="Edit note"><Pencil className="size-3.5" aria-hidden /></button>
          <button type="button" className={icon} onClick={remove} aria-label="Delete note"><Trash2 className="size-3.5" aria-hidden /></button>
        </div>
      )}
    </li>
  );
}
