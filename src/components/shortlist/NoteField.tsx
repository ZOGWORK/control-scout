// A private one-line note on a shortlisted team. Saves as you type (after a
// short pause), on blur and on Enter; Escape puts the saved note back.
// If this device can't store it (storage full or blocked), the field says so
// inline and keeps the text, and the next edit, blur or Enter tries again.
import { useEffect, useId, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import { MAX_NOTE } from "../../shared/personal";
import { cn } from "../cn";
import { FieldError } from "../ui/basic";

/**
 * Team → note text this device couldn't store. Kept outside the field so a remount (List/Grid switch,
 * leaving and coming back) still shows the error and still retries: the store's memory holds the text,
 * so a fresh field would otherwise take it as saved. Lives as long as the page (and that memory) does.
 */
const unstoredNotes = new Map<number, string>();

export function NoteField({ team, value, onSave, className }: { team: number; value: string; onSave: (text: string) => boolean | void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [failed, setFailed] = useState(() => unstoredNotes.has(team));
  const errorId = useId();
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(value);
  /** Escape: leave without saving the edit. */
  const skip = useRef(false);
  /** The text this device couldn't store (or null). The store still holds it in memory and echoes it back as
   *  `value` (trimmed); that echo must not count as saved, or the next Enter or blur would skip the retry. */
  const unstored = (): string | null => unstoredNotes.get(team) ?? null;
  const markUnstored = (text: string | null) => {
    if (text === null) unstoredNotes.delete(team); else unstoredNotes.set(team, text);
    setFailed(text !== null);
  };
  // Another tab or device changed it: show that, unless this field is being edited.
  useEffect(() => {
    const u = unstored();
    if (u !== null && value.trim() === u.trim()) return;
    markUnstored(null);
    saved.current = value;
    if (!focused.current) setDraft(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const flush = (text: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const unchanged = text.trim() === saved.current.trim();
    // Back to the stored text with a failed edit still in the store's memory: write it anyway, to replace that edit.
    if (unchanged && unstored() === null) return;
    // Not stored: keep `saved` as it was and the error up, so the next flush tries again. That holds for
    // the unchanged text too: notes share one record, so another note's save may have stored the failed edit.
    if (onSave(text) === false) { markUnstored(text); return; }
    markUnstored(null);
    saved.current = text;
  };
  /** Escape: back to the stored note, in the store too (its memory may still hold text that failed to store). */
  const revert = () => {
    setDraft(saved.current);
    if (unstored() === null) return;
    // Write the stored note back over the failed edit; if that's refused too, the error stays up.
    const back = saved.current;
    unstoredNotes.set(team, back);
    markUnstored(onSave(back) === false ? back : null);
  };
  // Leaving the page mid-pause still saves what was typed.
  const latest = useRef({ draft, onSave });
  latest.current = { draft, onSave };
  useEffect(() => () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    if (latest.current.draft.trim() !== saved.current.trim()) latest.current.onSave(latest.current.draft);
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
