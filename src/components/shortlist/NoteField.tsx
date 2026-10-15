// A private one-line note on a shortlisted team. Saves as you type (after a
// short pause), on blur and on Enter; Escape puts the saved note back.
// If this device can't store it (storage full or blocked), the field says so
// inline and keeps the text, and the next blur or Enter tries again.
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
export function NoteField({ team, value, stored, onSave, className }: { team: number; value: string; stored?: string; onSave: (text: string) => boolean | void; className?: string }) {
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
  // Another tab or device changed it: show that, unless this field is being edited.
  useEffect(() => { sent.current = value; if (!focused.current) setDraft(value); }, [value]);
  const flush = (text: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    // Unchanged, but not stored: send it again (a retry).
    if (text.trim() === sent.current.trim() && !failed) return;
    sent.current = text;
    const ok = onSave(text) !== false;
    if (stored === undefined) setRefused(!ok);
  };
  /** Escape: back to the stored note, in the store's memory too when that holds a refused edit. */
  const revert = () => {
    if (stored === undefined) { setDraft(value); return; }
    setDraft(stored);
    if (failed) { sent.current = stored; onSave(stored); }
  };
  // Leaving the page mid-pause still saves what was typed.
  const latest = useRef({ draft, onSave });
  latest.current = { draft, onSave };
  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    if (latest.current.draft.trim() !== sent.current.trim()) latest.current.onSave(latest.current.draft);
  }, []);
  return (
    <div className={cn("min-w-0", className)}>
    <label className={cn("group/note flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors focus-within:bg-muted/60 hover:bg-muted/40", failed && "ring-1 ring-destructive/60")}>
      <PencilLine className={cn("size-3.5 shrink-0", draft.trim() ? "text-accent" : "text-text-muted/70 group-hover/note:text-text-muted")} aria-hidden />
      <span className="sr-only">Private note on team {team}</span>
      <input
        type="text" value={draft} maxLength={MAX_NOTE} placeholder="Add a pick note…" enterKeyHint="done" data-note={team}
        aria-invalid={failed ? true : undefined} aria-describedby={failed ? errorId : undefined}
        className="min-w-0 flex-1 bg-transparent text-text-base outline-none placeholder:text-text-muted/70"
        onFocus={() => { focused.current = true; }}
        onBlur={(e) => { focused.current = false; if (skip.current) { skip.current = false; return; } flush(e.currentTarget.value); }}
        onChange={(e) => {
          const text = e.currentTarget.value;
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
    <FieldError id={errorId} className="mt-0.5 px-1.5">{failed ? "Not saved: this device's storage is full or blocked. Your text is still here; free up space and press Enter to retry." : null}</FieldError>
    </div>
  );
}
