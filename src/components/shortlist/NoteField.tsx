// A private one-line note on a shortlisted team. Saves as you type (after a
// short pause), on blur and on Enter; Escape puts the saved note back.
import { useEffect, useRef, useState } from "react";
import { PencilLine } from "lucide-react";
import { MAX_NOTE } from "../../shared/personal";
import { cn } from "../cn";

export function NoteField({ team, value, onSave, className }: { team: number; value: string; onSave: (text: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(value);
  /** Escape: leave without saving the edit. */
  const skip = useRef(false);
  // Another tab or device changed it: show that, unless this field is being edited.
  useEffect(() => { saved.current = value; if (!focused.current) setDraft(value); }, [value]);
  const flush = (text: string) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (text.trim() !== saved.current.trim()) { saved.current = text; onSave(text); }
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
    <label className={cn("group/note flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs transition-colors focus-within:bg-muted/60 hover:bg-muted/40", className)}>
      <PencilLine className={cn("size-3.5 shrink-0", draft.trim() ? "text-accent" : "text-text-muted/70 group-hover/note:text-text-muted")} aria-hidden />
      <span className="sr-only">Private note on team {team}</span>
      <input
        type="text" value={draft} maxLength={MAX_NOTE} placeholder="Add a pick note…" enterKeyHint="done" data-note={team}
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
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (timer.current) clearTimeout(timer.current); timer.current = null; skip.current = true; setDraft(saved.current); e.currentTarget.blur(); }
        }}
      />
    </label>
  );
}
