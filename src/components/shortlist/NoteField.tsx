// A private one-line note on a shortlisted team. Saves as you type (after a
// short pause), on blur and on Enter; Escape puts the saved note back.
// If this device can't store it (storage full or blocked), the field says so
// inline and keeps the text, and the next blur or Enter (or its Retry, when
// `retry` is set) tries again. Leaving the page mid-pause (a reload, a closed
// tab) hands the text to `onSave` first, so a caller that keeps it can.
import { useEffect, useId, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import { MAX_NOTE } from "../../shared/personal";
import { cn } from "../cn";
import { FieldError } from "../ui/basic";

/**
 * `value` is the note as the app holds it (in memory); `stored` is what this device has actually
 * stored for it. They differ only when a write was refused (storage full or blocked), and then the
 * field shows the error and retries. Both come from the store, so the error survives remounts and
 * sign-ins, and clears exactly when the note is stored. When `stored` is unknown (storage can't be
 * read), the last write's result (`onSave` returning false) shows the error instead, and Escape
 * writes nothing: it can't tell what to restore.
 */
export function NoteField({ team, value, stored, onSave, className, label, placeholder = "Add a pick note…", maxLength = MAX_NOTE, failedText, retry = false, retryOnLeave = true, onBegin, onDraft, discard }: {
  team: number; value: string; stored?: string; onSave: (text: string) => boolean | void; className?: string;
  /** What a screen reader hears for the field (default: "Private note on team <n>"). */
  label?: string;
  placeholder?: string;
  maxLength?: number;
  /** What the field says when the note isn't stored (default: this device's storage is full or blocked). */
  failedText?: string;
  /** Offer a Retry button beside that message (it sends the text again, as Enter does). */
  retry?: boolean;
  /** Leaving the field (blur) retries an unsaved note too (default). False: only Enter, Retry or a new edit sends it. */
  retryOnLeave?: boolean;
  /** An edit begins (the first keystroke since the last save, or since focus): the note it is written over is the one shown now. */
  onBegin?: () => void;
  /** True while typed text waits out the save pause (a draft not sent yet); false once it's handed to onSave or dropped. */
  onDraft?: (draft: boolean) => void;
  /** Beside Retry: drop the unsaved text (its label and action), e.g. "Keep theirs". */
  discard?: { label: string; onClick: () => void };
}) {
  const [draft, setDraft] = useState(value);
  /** The last write was refused (what shows the error while `stored` is unknown). */
  const [refused, setRefused] = useState(false);
  const failed = stored !== undefined ? value.trim() !== stored.trim() : refused;
  const errorId = useId();
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The text last handed to `onSave` (or loaded): typing pauses don't send it twice. */
  const sent = useRef(value);
  /** Escape: leave without saving the edit. */
  const skip = useRef(false);
  /** Typed in since the last save (or since focus): only then does leaving the field write. */
  const edited = useRef(false);
  // Another tab, device or member changed it: show that, unless this field holds an edit not yet saved.
  // (A field focused but untouched follows the change, and leaving it writes nothing: it never puts back
  // the text it showed before.)
  useEffect(() => {
    sent.current = value;
    if (!focused.current || (!edited.current && value.trim() !== latest.current.draft.trim())) setDraft(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const drafting = useRef(false);
  const setDrafting = (on: boolean) => { if (drafting.current !== on) { drafting.current = on; latest.current.onDraft?.(on); } };
  const flush = (text: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setDrafting(false);
    // Not touched since the last save: nothing to write, unless that save wasn't stored (a retry).
    if (!edited.current && !failed) return;
    // Unchanged, but not stored: send it again (a retry).
    if (text.trim() === sent.current.trim() && !failed) { edited.current = false; return; }
    edited.current = false;
    sent.current = text;
    const ok = onSave(text) !== false;
    if (stored === undefined) setRefused(!ok);
  };
  /** Escape: back to the stored note, in the store's memory too when that holds a refused edit. */
  const revert = () => {
    edited.current = false;
    setDrafting(false);
    if (stored === undefined) { setDraft(value); return; }
    setDraft(stored);
    if (failed) { sent.current = stored; onSave(stored); }
  };
  // Leaving the page mid-pause still saves what was typed.
  const latest = useRef({ draft, onSave, onDraft });
  latest.current = { draft, onSave, onDraft };
  useEffect(() => {
    const leave = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      if (latest.current.draft.trim() !== sent.current.trim()) { sent.current = latest.current.draft; edited.current = false; latest.current.onSave(latest.current.draft); }
    };
    // A reload or a closed tab runs no unmount: the page going away saves the pause's text too.
    window.addEventListener("pagehide", leave);
    return () => { window.removeEventListener("pagehide", leave); leave(); };
  }, []);
  return (
    <div className={cn("min-w-0", className)}>
    <label className={cn("group/note flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors focus-within:bg-muted/60 hover:bg-muted/40", failed && "ring-1 ring-destructive/60")}>
      <PencilLine className={cn("size-3.5 shrink-0", draft.trim() ? "text-accent" : "text-text-muted/70 group-hover/note:text-text-muted")} aria-hidden />
      <span className="sr-only">{label ?? `Private note on team ${team}`}</span>
      <input
        type="text" value={draft} maxLength={maxLength} placeholder={placeholder} enterKeyHint="done" data-note={team}
        aria-invalid={failed ? true : undefined} aria-describedby={failed ? errorId : undefined}
        className="min-w-0 flex-1 bg-transparent text-text-base outline-none placeholder:text-text-muted/70"
        onFocus={() => { focused.current = true; edited.current = false; }}
        onBlur={(e) => {
          focused.current = false;
          if (skip.current) { skip.current = false; return; }
          // Leaving for this field's Discard (Keep theirs): the member is letting the text go, so nothing is sent.
          if ((e.relatedTarget as HTMLElement | null)?.dataset?.noteDiscard === String(team)) { if (timer.current) clearTimeout(timer.current); timer.current = null; return; }
          if (!retryOnLeave && !edited.current) return;
          flush(e.currentTarget.value);
        }}
        onChange={(e) => {
          const text = e.currentTarget.value;
          if (!edited.current) onBegin?.();
          edited.current = true;
          setDrafting(true);
          setDraft(text);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => flush(text), 700);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); flush(e.currentTarget.value); e.currentTarget.blur(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (timer.current) clearTimeout(timer.current); timer.current = null; skip.current = true; revert(); e.currentTarget.blur(); }
        }}
      />
    </label>
    <FieldError id={errorId} className="mt-0.5 px-1.5">{failed ? <>
      {failedText ?? "Not saved: this device's storage is full or blocked. Your text is still here; free up space and press Enter to retry."}
      {retry && <> <button type="button" className="font-medium underline underline-offset-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center" onClick={() => flush(draft)}>Retry</button></>}
      {discard && <> <button type="button" data-note-discard={team} className="font-medium underline underline-offset-2 max-sm:inline-flex max-sm:min-h-11 max-sm:items-center"
        // A mouse press doesn't take focus from the field first (so its blur can't send the text being let go).
        onMouseDown={(e) => { if (focused.current) { e.preventDefault(); skip.current = true; } }}
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = null;
          edited.current = false; setDrafting(false); discard.onClick();
          if (skip.current && focused.current) document.querySelector<HTMLInputElement>(`input[data-note="${team}"]`)?.blur();
        }}>{discard.label}</button></>}
    </> : null}</FieldError>
    </div>
  );
}
