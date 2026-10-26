// A team search field for adding teams (Compare, Shortlist): type a number or a name, pick from the matches,
// or press Enter on a number. A combobox (ARIA 1.2): arrow keys move through the matches, Escape closes them.
// While it searches, finds nothing or can't reach search, the list says so (and a screen reader hears it).
import { useEffect, useId, useRef, useState, type Ref } from "react";
import { Check, Loader2, Plus, Search } from "lucide-react";
import { apiFetch } from "../lib/api";
import type { SearchHit } from "../shared/api";
import { cn } from "./cn";
import { m } from "./motion";

interface Option { team: number; name: string; place: string }

/** The team matches for a query (search's own ranking, teams only). */
async function searchTeams(q: string): Promise<Option[]> {
  const r = await apiFetch<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}&limit=12`);
  return r.hits.filter((h) => h.kind === "team" && /^\d+$/.test(h.ref))
    .map((h) => ({ team: Number(h.ref), name: h.title.replace(/^\d+\s*/, ""), place: h.subtitle }));
}

export function TeamPicker({ onPick, exclude = [], marked = [], markedLabel = "Added", disabled, busy, error, onEdit, label = "Add a team", placeholder = "Add a team: number or name", autoFocus, inputRef, className }: {
  /** A team was chosen (from the list, or a number typed and Enter pressed). */
  onPick: (team: number) => void;
  /** Teams already chosen: left out of the list. */
  exclude?: number[];
  /** Teams already chosen that stay in the list, marked with `markedLabel` (picking one is the caller's to answer). */
  marked?: number[];
  markedLabel?: string;
  disabled?: boolean;
  /** Checking the last pick. */
  busy?: boolean;
  /** The last pick's error (e.g. "not a team we know"). */
  error?: string | null;
  /** The text changed (clears the error). */
  onEdit?: () => void;
  label?: string;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [options, setOptions] = useState<{ q: string; list: Option[]; failed?: boolean }>({ q: "", list: [] });
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const errId = useId();
  const q = text.trim();
  const asked = useRef("");

  useEffect(() => {
    asked.current = q; // an answer for any other query (an older one, or one since cleared) is dropped
    if (!q) { setOptions({ q: "", list: [] }); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      searchTeams(q).then((o) => { if (asked.current === q) { setOptions({ q, list: o }); setActive(0); } })
        .catch(() => { if (asked.current === q) setOptions({ q, list: [], failed: true }); })
        .finally(() => { if (asked.current === q) setLoading(false); });
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  // A typed number is always offered first, even before (or without) a match from search.
  const typed = /^\d{1,6}$/.test(q) ? Number(q) : null;
  // Only the answer to what's in the box now: never an earlier query's teams, which Enter could otherwise pick.
  const shown = options.q === q ? options.list.filter((o) => !exclude.includes(o.team)) : [];
  const list: Option[] = typed != null && !shown.some((o) => o.team === typed) && !exclude.includes(typed)
    ? [{ team: typed, name: "", place: "" }, ...shown] : shown;
  const failed = options.q === q && !!options.failed;
  const expanded = open && !!q;
  const isMarked = (team: number) => marked.includes(team);
  // What the list holds, said when it changes (the options themselves are read as they're reached).
  // Counted from search's own matches: a typed number's option is offered before search has answered.
  const status = !expanded ? "" : loading ? "Searching…"
    : failed ? "Search isn't reachable right now. Type a team number and press Enter."
    : shown.length ? `${shown.length} ${shown.length === 1 ? "team" : "teams"} found.` : `No team matches “${q}”.`;

  const pick = (team: number) => {
    onPick(team);
    setText(""); setOptions({ q: "", list: [] }); setOpen(false); setActive(0);
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      <div className={cn("flex h-12 items-center gap-2 rounded-xl border bg-card px-3 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
        error ? "border-destructive" : "border-border", disabled && "opacity-60")}>
        {busy || (loading && !!q) ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden /> : <Search className="size-4 shrink-0 text-accent" aria-hidden />}
        <input ref={inputRef} value={text} disabled={disabled} autoFocus={autoFocus} placeholder={placeholder} aria-label={label}
          role="combobox" aria-expanded={expanded} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={expanded && list[active] ? `${listId}-${list[active].team}` : undefined}
          aria-invalid={error ? true : undefined} aria-describedby={error ? errId : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          onChange={(e) => { setText(e.target.value.slice(0, 60)); setActive(0); setOpen(true); onEdit?.(); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(list.length - 1, 0))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Escape") setOpen(false);
            else if (e.key === "Enter") {
              e.preventDefault();
              const o = list[active] ?? (typed != null ? { team: typed } : undefined);
              if (o) pick(o.team);
            }
          }} />
        <kbd className="hidden shrink-0 rounded border border-border px-1.5 font-mono text-[11px] text-muted-foreground sm:inline">Enter</kbd>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{status}</p>
      {error && <p id={errId} role="alert" className="mt-1 text-xs font-medium text-destructive">{error}</p>}
      {expanded && (
        <m.ul id={listId} role="listbox" aria-label="Matching teams"
          initial={{ opacity: 0, y: -4, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-lg">
          {list.map((o, i) => (
            <li key={o.team} id={`${listId}-${o.team}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(o.team); }} onMouseEnter={() => setActive(i)}
              className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-sm", i === active && "bg-accent/10")}>
              <span className={cn("w-16 shrink-0 font-mono font-semibold tabular-nums", isMarked(o.team) && "text-muted-foreground")}>{o.team}</span>
              <span className={cn("min-w-0 flex-1", isMarked(o.team) && "text-muted-foreground")}>
                <span className="block truncate">{o.name || (loading ? "Looking it up…" : "Add this number")}</span>
                {o.place && <span className="block truncate text-xs text-muted-foreground">{o.place}</span>}
              </span>
              {isMarked(o.team)
                ? <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-success"><Check className="size-3.5" aria-hidden />{markedLabel}</span>
                : <Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
            </li>
          ))}
          {(!list.length || failed) && (
            <li role="presentation" className={cn("flex items-center gap-2 px-3 py-2.5 text-sm", failed ? "text-destructive" : "text-muted-foreground")}>
              {loading && !list.length && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />}
              {status}
            </li>
          )}
        </m.ul>
      )}
    </div>
  );
}
