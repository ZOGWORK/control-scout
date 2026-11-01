// The Shortlist's own way in: type a team number or name, pick a suggestion (or press Enter / Add team on an exact
// number) and the team joins the end of the list. Suggestions come from the site's team search (useSearchHits, the
// header box's hook, limited to teams); a team already listed says so and is never added twice.
import { useEffect, useId, useRef, useState } from "react";
import { smoothBehavior } from "../../lib/pageScroll";
import { Check, Loader2, Plus, Search, Users } from "lucide-react";
import type { SearchHit } from "../../shared/api";
import { useSearchHits, HitText } from "../search/SearchBox";
import { Button } from "../ui/button";
import { cn } from "../cn";
import { MAX_BOOKMARKS } from "../../shared/personal";

const SUGGESTIONS = 8;

/** The team a query names outright: a plain team number (never 0), or null. */
export const exactNumber = (q: string): number | null => (/^\d{1,6}$/.test(q.trim()) && Number(q.trim()) > 0 ? Number(q.trim()) : null);

export function AddTeamBox({ listed, onAdd, className, autoFocus }: {
  /** Teams already on the list. */
  listed: readonly number[];
  /** Add one team (its search hit when there is one, for its name). */
  onAdd: (team: number, hit: SearchHit | null) => void;
  className?: string;
  /** Focus the field on mount (the toolbar's box taking over from the empty page's after the first pick). */
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // A message under the field: "already on your list", "no team 99999".
  const [note, setNote] = useState<string | null>(null);
  // Enter pressed on a number while its search was still on its way: answered when the results land.
  const [waiting, setWaiting] = useState<number | null>(null);
  const { hits: all, busy, error, stale, saved } = useSearchHits(q, ["team"], SUGGESTIONS, null, false);
  const hits = stale ? [] : all;
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const noteId = useId();
  const query = q.trim();
  const has = (t: number) => listed.includes(t);

  useEffect(() => { setActive(-1); setNote(null); setWaiting(null); }, [q]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest", behavior: smoothBehavior() }); }, [active, open, listId]);

  // Nothing added: the list closes so the reason under the field shows.
  const refuse = (why: string) => { setNote(why); setOpen(false); };
  const add = (team: number, hit: SearchHit | null) => {
    if (has(team)) { refuse(`${hit?.title ?? `Team ${team}`} is already on your shortlist.`); return; }
    if (listed.length >= MAX_BOOKMARKS) { refuse(`Your shortlist is full (${MAX_BOOKMARKS} teams). Remove one to add another.`); return; }
    onAdd(team, hit);
    setQ(""); setOpen(false);
    input.current?.focus();
  };
  // Enter / Add team: the highlighted row; else the exact number typed; else the top suggestion.
  const submit = () => {
    if (!query) { input.current?.focus(); return; }
    if (active >= 0 && hits[active]) { add(Number(hits[active].ref), hits[active]); return; }
    const n = exactNumber(query);
    if (n != null) {
      const hit = hits.find((h) => Number(h.ref) === n) ?? null;
      if (hit || has(n)) add(n, hit);
      // Search can't answer (server down) or answered from saved data that may not know the team: the number is taken as typed.
      else if (error || (!busy && saved)) add(n, null);
      else if (busy) setWaiting(n);
      else refuse(`No team ${n} found.`);
      return;
    }
    if (hits[0]) add(Number(hits[0].ref), hits[0]);
    else if (!busy) refuse(`No team matches “${query}”.`);
  };
  useEffect(() => {
    if (waiting == null || busy) return;
    setWaiting(null);
    const hit = hits.find((h) => Number(h.ref) === waiting) ?? null;
    if (hit || error || saved) add(waiting, hit);
    else refuse(`No team ${waiting} found.`);
  }, [waiting, busy, hits, error, saved]); // eslint-disable-line react-hooks/exhaustive-deps

  const showList = open && !!query;
  return (
    <div ref={box} className={cn("relative flex items-center gap-2", className)} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}>
      <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-foreground transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)] max-sm:h-10">
        {busy || waiting != null ? <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" /> : <Search className="size-4 shrink-0 text-accent" />}
        <input
          ref={input} value={q} autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onClick={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { if (showList) setOpen(false); else setQ(""); return; }
            if (e.key === "Enter") { e.preventDefault(); submit(); return; }
            if (!hits.length) return;
            if (e.key === "ArrowDown") { e.preventDefault(); if (!showList) { setOpen(true); return; } setActive((i) => (i + 1) % hits.length); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i <= 0 ? hits.length - 1 : i - 1)); }
          }}
          placeholder="Team number or name" aria-label="Add a team to your shortlist"
          role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 && active < hits.length ? `${listId}-${active}` : undefined}
          aria-describedby={note ? noteId : undefined}
          inputMode="search" enterKeyHint="done"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      <Button variant="secondary" size="sm" className="shrink-0 max-sm:h-10" onClick={submit}><Plus /> Add team</Button>
      {/* What Enter / Add team did when it added nothing; read out too. */}
      <p id={noteId} role="status" className={cn("absolute left-0 top-full mt-1 text-xs text-warning", !note || showList ? "sr-only" : "")}>{note}</p>
      {showList && (
        <div id={listId} role="listbox" aria-label="Teams to add"
          className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-[min(22rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] sm:left-auto sm:w-96">
          {error ? <p className="px-3 py-2.5 text-sm text-muted-foreground">Search isn’t answering. Type a team number and press Add team.</p>
            : !hits.length ? <p className="px-3 py-2.5 text-sm text-muted-foreground">{busy ? "Searching…" : `No team matches “${query}”.`}</p>
            : hits.map((h, i) => {
              const team = Number(h.ref), added = has(team);
              return (
                <div
                  key={h.ref} id={`${listId}-${i}`} role="option" aria-selected={i === active} aria-disabled={added || undefined}
                  // Focus stays in the field, so the list doesn't close before the click lands (an iPhone sends mousedown too).
                  onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => add(team, h)} onPointerMove={() => setActive(i)}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm", i === active ? "bg-accent/[0.12] text-foreground" : "text-foreground/90", added && "cursor-default text-muted-foreground")}
                >
                  <Users className="size-4 shrink-0 text-muted-foreground" />
                  <HitText h={h} />
                  {added
                    ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-success"><Check className="size-3.5" /> Added</span>
                    : <span className="inline-flex shrink-0 items-center gap-1 text-xs text-accent-text"><Plus className="size-3.5" /> Add</span>}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
