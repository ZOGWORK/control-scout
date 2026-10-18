// Pick an event by typing its name (or city, or code): one season's events from /api/events?q=, as a
// combobox. The chosen event shows by name, with a way to change it; the value handed back is its code.
import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays, MapPin, Search, X } from "lucide-react";
import { apiFetch, qs } from "../../lib/api";
import { dateRange, place } from "../../lib/format";
import { normalEventCode } from "../../shared/assignments";
import type { EventListItem } from "../../shared/api";
import { Input } from "../ui/basic";
import { cn } from "../cn";

/** How long typing settles before asking (ms), and how many events to offer. */
export const EVENT_SEARCH_DEBOUNCE = 200;
const LIMIT = 8;

export function EventPicker({ id, season, code, onChange }: { id: string; season: number; code: string; onChange: (code: string) => void }) {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<EventListItem[] | null>(null);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  // The chosen event's name and place (looked up when the code came from elsewhere, e.g. the workspace's default).
  const [chosen, setChosen] = useState<EventListItem | null>(null);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const picked = normalEventCode(code);

  useEffect(() => {
    if (!picked) { setChosen(null); return; }
    if (chosen?.code === picked) return;
    let live = true;
    apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, q: picked, all: 1, limit: 20 })}`)
      .then((r) => { if (live) setChosen(r.events.find((e) => e.code === picked) ?? null); }, () => { if (live) setChosen(null); });
    return () => { live = false; };
  }, [picked, season]); // eslint-disable-line react-hooks/exhaustive-deps -- only when the code or season changes

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setHits(null); return; }
    let live = true;
    const t = setTimeout(() => {
      apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, q, all: 1, limit: 60 })}`).then((r) => {
        if (!live) return;
        // Names that start with what's typed first, then the rest; nearest dates first within each.
        const lower = q.toLowerCase();
        const starts = (e: EventListItem) => (e.name.toLowerCase().startsWith(lower) || e.code.toLowerCase() === lower ? 0 : 1);
        setHits([...r.events].sort((a, b) => starts(a) - starts(b) || (a.start ?? "").localeCompare(b.start ?? "")).slice(0, LIMIT));
        setActive(0);
      }, () => { if (live) setHits([]); });
    }, EVENT_SEARCH_DEBOUNCE);
    return () => { live = false; clearTimeout(t); };
  }, [text, season]);

  const pick = (e: EventListItem) => { setChosen(e); onChange(e.code); setText(""); setOpen(false); };

  if (picked) {
    return (
      <div className="mt-2 flex min-h-11 items-center gap-3 rounded-xl border border-accent/40 bg-accent/[0.06] px-3 py-2">
        <CalendarDays className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{chosen?.name ?? picked}</span>
          <span className="block truncate text-xs text-muted-foreground">
            <span className="font-mono">{picked}</span>{chosen ? ` · ${dateRange(chosen.start, chosen.end)}${place(chosen.city, chosen.state) ? ` · ${place(chosen.city, chosen.state)}` : ""}` : ""}
          </span>
        </span>
        <button type="button" onClick={() => { onChange(""); setChosen(null); requestAnimationFrame(() => input.current?.focus()); }} aria-label="Change event"
          className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-text-base/[0.06] hover:text-foreground"><X className="size-4" /></button>
      </div>
    );
  }

  const options = hits ?? [];
  return (
    <div className="relative mt-2">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input ref={input} id={id} value={text} placeholder="Event name, city or code" autoComplete="off"
        role="combobox" aria-expanded={open && options.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => { setText(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(options.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            // Codes are searched too, so a typed code shows up as an option to pick.
            if (options[active]) pick(options[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="h-11 pl-9" />
      {open && hits && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-xl">
          {!options.length ? <p className="px-3 py-3 text-sm text-muted-foreground">No {season} event matches “{text.trim()}”.</p> : (
            <ul id={listId} role="listbox" aria-label="Events" className="max-h-72 overflow-y-auto py-1">
              {options.map((e, k) => (
                <li key={e.code} id={`${listId}-${k}`} role="option" aria-selected={k === active}
                  onMouseDown={(ev) => { ev.preventDefault(); pick(e); }} onMouseEnter={() => setActive(k)}
                  className={cn("cursor-pointer px-3 py-2", k === active && "bg-accent/10")}>
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono">{e.code}</span>
                    <span>{dateRange(e.start, e.end)}</span>
                    {place(e.city, e.state) && <span className="inline-flex items-center gap-0.5"><MapPin className="size-3" aria-hidden />{place(e.city, e.state)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
