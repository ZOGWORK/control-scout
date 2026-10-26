// Pick one event of a season by searching it: a full-width button showing the chosen event in full (name,
// dates, place, type) that opens a search over the season's events, as a popover on wider screens and a
// full-screen sheet on phones. One request per season (/api/events, the same one the Predict page makes, so
// it's cached), filtered here; a few suggestions before anything is typed, the team's events first when a
// team is chosen, but every event stays searchable.
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { CalendarDays, Check, ChevronDown, MapPin, RotateCw, Search, X } from "lucide-react";
import { qs, useApi } from "../../lib/api";
import { dateRange, place, seasonLabel } from "../../lib/format";
import { pickerResults } from "../../lib/labEvents";
import type { EventListItem } from "../../shared/api";
import { Input, Skeleton } from "../ui/basic";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger, Sheet, SheetContent, SheetTitle, SheetTrigger } from "../ui/overlay";
import { cn } from "../cn";

export interface EventSearchPickerProps {
  season: number;
  /** The chosen event's code. */
  value: string | null;
  onChange: (code: string | null) => void;
  /** The chosen team, if any: its events are suggested and listed first. */
  team?: number | null;
  /** Codes of that team's events this season (null: no team, or not known yet). */
  teamCodes?: Set<string> | null;
  /** Only events that advance teams (labEvents' ADVANCING). Default true. */
  advancingOnly?: boolean;
  /** The field's label. Default "Event". */
  label?: string;
  /** The trigger button's id (for an outside <label>, or tests). */
  id?: string;
}

/** Phones get the full-screen sheet; Tailwind's `sm` breakpoint. */
const SMALL = "(max-width: 639px)";
function useSmallScreen() {
  return useSyncExternalStore(
    (f) => {
      const m = typeof window !== "undefined" ? window.matchMedia?.(SMALL) : undefined;
      m?.addEventListener?.("change", f);
      return () => m?.removeEventListener?.("change", f);
    },
    () => (typeof window !== "undefined" && window.matchMedia?.(SMALL)?.matches) === true,
    () => false,
  );
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const where = (e: EventListItem) => place(e.city, e.state, e.country);

/** Date, place and type on one wrapping line. */
function Meta({ e, className }: { e: EventListItem; className?: string }) {
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1"><CalendarDays className="size-3 shrink-0" aria-hidden />{dateRange(e.start, e.end)}</span>
      {where(e) && <span className="inline-flex items-center gap-1"><MapPin className="size-3 shrink-0" aria-hidden />{where(e)}</span>}
      <span>{e.typeLabel}</span>
    </span>
  );
}

export function EventSearchPicker({ season, value, onChange, team = null, teamCodes = null, advancingOnly = true, label = "Event", id }: EventSearchPickerProps) {
  const uid = useId();
  const triggerId = id ?? `${uid}-trigger`;
  const labelId = `${uid}-label`, listId = `${uid}-list`, headId = `${uid}-head`, inputId = `${uid}-input`;
  const events = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season })}`);
  const all = events.data?.events;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const small = useSmallScreen();
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const leftOutside = useRef(false);

  const selected = value ? all?.find((e) => e.code === value) ?? null : null;
  const res = useMemo(() => (all ? pickerResults(all, { q, teamCodes, advancingOnly }) : null), [all, q, teamCodes, advancingOnly]);
  const options = res?.list ?? [];
  const optId = (k: number) => `${listId}-${k}`;

  // New rows (a search, the list or the team's events arriving) start from the first; an opened picker from an empty search.
  useEffect(() => setActive(0), [res]);
  useEffect(() => { if (open) setQ(""); }, [open]);
  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]); // eslint-disable-line react-hooks/exhaustive-deps -- optId is derived from a stable id

  const pick = (e: EventListItem) => { onChange(e.code); setOpen(false); };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    // Mid-composition (Chinese, Japanese input methods) Enter and the arrows belong to the input method.
    if (ev.nativeEvent.isComposing || ev.keyCode === 229) return;
    const last = options.length - 1;
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActive((a) => Math.min(last, a + 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (ev.key === "Home" && options.length) { ev.preventDefault(); setActive(0); }
    else if (ev.key === "End" && options.length) { ev.preventDefault(); setActive(Math.max(0, last)); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (options[active]) pick(options[active]); }
  };

  const searching = !!q.trim();
  const status = events.loading ? "Loading events"
    : !res ? ""
    : res.mode === "search"
      ? (res.total ? `${plural(res.total, "event")} found${res.total > options.length ? `, showing the first ${options.length}` : ""}` : "No events found")
      : (options.length ? plural(options.length, "suggested event") : "");
  // A team with no eligible events gets the nearest ones, and the heading says so (one line, no paragraph).
  const heading = res?.mode === "search" ? "Results"
    : team != null && res?.teamSuggestions ? `${team}'s events`
    : team != null && teamCodes ? `Nearest events · none for ${team} yet`
    : "Suggested";

  let body: ReactNode;
  if (events.loading) {
    body = (
      <div className="space-y-3 p-3" aria-hidden data-picker-loading>
        {[0, 1, 2, 3].map((k) => <div key={k} className="space-y-1.5"><Skeleton className="h-4 w-3/4 rounded-md" /><Skeleton className="h-3 w-1/2 rounded-md" /></div>)}
      </div>
    );
  } else if (!res) {
    body = (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-3 py-4 text-sm">
        <span className="text-muted-foreground">Couldn’t load {seasonLabel(season)} events just now.</span>
        <Button variant="secondary" size="sm" onClick={() => { void events.reload(); }}><RotateCw className="size-3.5" aria-hidden /> Try again</Button>
      </div>
    );
  } else if (!options.length) {
    const others = res.otherMatches;
    body = (
      <div className="flex flex-col items-start gap-2 px-3 py-4" data-picker-empty>
        <p className="text-sm font-medium text-foreground">
          {searching ? `No ${advancingOnly ? "qualifier, league tournament or championship" : "event"} matches “${q.trim()}”` : `No ${advancingOnly ? "advancing " : ""}events in ${seasonLabel(season)} yet`}
        </p>
        {others > 0 && <p className="text-sm text-muted-foreground">{plural(others, "other event")} match{others === 1 ? "es" : ""}, but {others === 1 ? "it doesn’t" : "those don’t"} advance teams (scrimmages, league meets).</p>}
        {searching && <Button variant="ghost" size="sm" onClick={() => { setQ(""); input.current?.focus(); }}>Clear search</Button>}
      </div>
    );
  } else {
    body = (
      <>
        <p id={headId} className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{heading}</p>
        <ul id={listId} role="listbox" aria-labelledby={headId} className="px-1.5 pb-1.5">
          {options.map((e, k) => {
            const current = e.code === value, ours = !!teamCodes?.has(e.code);
            return (
              <li key={e.code} id={optId(k)} role="option" aria-selected={k === active} data-current={current || undefined}
                onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(e)} onMouseMove={() => { if (k !== active) setActive(k); }}
                className={cn("flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2", k === active && "bg-accent/10")}>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium text-foreground">{e.name}</span>
                  <Meta e={e} className="mt-0.5" />
                </span>
                {ours && res.mode === "search" && team != null && (
                  <span className="mt-0.5 shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent-text">{team}’s event</span>
                )}
                {current && <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-label="Chosen" />}
              </li>
            );
          })}
        </ul>
        {res.total > options.length && (
          <p className="px-3 pb-3 text-xs text-muted-foreground">Showing {options.length} of {res.total}</p>
        )}
      </>
    );
  }

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative border-b border-border p-3">
        <label htmlFor={inputId} className="sr-only">Search {label.toLowerCase()}s</label>
        <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={input} id={inputId} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Search events by name, city or code" autoComplete="off" spellCheck={false} enterKeyHint="search"
          role="combobox" aria-expanded={options.length > 0} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={options[active] ? optId(active) : undefined}
          className={cn("h-11 pl-9 text-base sm:text-sm", q && "pr-10")} />
        {q && (
          <button type="button" aria-label="Empty the search box" onClick={() => { setQ(""); input.current?.focus(); }}
            className="absolute right-4 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-text-base/[0.06] hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {/* Screen readers hear how many events there are (the list itself isn't announced as it changes). */}
      <p role="status" className="sr-only">{status}</p>
      {/* The one scroll region: the panel and the page around it never scroll with it. */}
      <div className={cn("min-h-0 overflow-y-auto overscroll-contain", small ? "flex-1" : "max-h-[min(28rem,60dvh)]")} data-picker-scroll>
        {body}
      </div>
    </div>
  );

  const button = (
    <button ref={trigger} id={triggerId} type="button" aria-haspopup="dialog" aria-expanded={open} aria-labelledby={`${labelId} ${triggerId}`}
      className={cn("flex min-h-12 w-full items-start gap-3 rounded-xl border border-border bg-secondary px-3 py-2.5 text-left transition-colors hover:border-accent/50",
        value ? "pr-12" : "pr-10", value && "border-accent/40 bg-accent/[0.06]")}>
      <CalendarDays className={cn("mt-0.5 size-4 shrink-0", value ? "text-accent" : "text-muted-foreground")} aria-hidden />
      <span className="min-w-0 flex-1">
        {selected ? (
          <>
            <span className="block break-words text-sm font-medium text-foreground" data-picker-chosen>{selected.name}</span>
            <Meta e={selected} className="mt-0.5" />
          </>
        ) : value ? (
          <span className="block text-sm font-medium text-foreground"><span className="font-mono">{value}</span>{events.loading && <span className="sr-only"> (loading)</span>}</span>
        ) : (
          <span className="block text-sm text-muted-foreground">Search events by name, city or code</span>
        )}
      </span>
      {!value && <ChevronDown className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" aria-hidden />}
    </button>
  );

  const motion = "motion-reduce:animate-none motion-reduce:transition-none";
  return (
    <div className="w-full">
      <span id={labelId} className="mb-1.5 block text-sm font-medium text-foreground">{label}</span>
      <div className="relative">
        {small ? (
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>{button}</SheetTrigger>
            <SheetContent side="bottom" aria-describedby={undefined}
              onOpenAutoFocus={(e) => { e.preventDefault(); input.current?.focus(); }}
              className={cn("inset-0 h-[100dvh] max-h-none gap-0 overflow-hidden rounded-none border-0 p-0", motion)}>
              <div className="flex min-h-14 items-center border-b border-border px-4 pr-14">
                <SheetTitle className="text-base">Choose {label.toLowerCase()}</SheetTitle>
              </div>
              {panel}
            </SheetContent>
          </Sheet>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{button}</PopoverTrigger>
            <PopoverContent align="start" aria-label={`Choose ${label.toLowerCase()}`}
              onOpenAutoFocus={(e) => { e.preventDefault(); input.current?.focus(); }}
              onInteractOutside={() => { leftOutside.current = true; }}
              // Back to the trigger on close (a pick, Escape), unless the click that closed it went somewhere else.
              onCloseAutoFocus={(e) => { e.preventDefault(); if (!leftOutside.current) trigger.current?.focus(); leftOutside.current = false; }}
              className={cn("flex w-[min(40rem,calc(100vw-2rem))] flex-col overflow-hidden p-0", motion)}>
              {panel}
            </PopoverContent>
          </Popover>
        )}
        {value && (
          <button type="button" aria-label={`Clear ${label.toLowerCase()} (${selected?.name ?? value})`}
            onClick={() => { onChange(null); trigger.current?.focus(); }}
            className="absolute right-1.5 top-1.5 inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-text-base/[0.06] hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {/* The list didn't load: said under the closed picker too, not only once it's opened. */}
      {events.error && !events.loading && !open && (
        <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          Couldn’t load {seasonLabel(season)} events.
          <button type="button" className="font-medium text-accent-text underline underline-offset-2" onClick={() => { void events.reload(); }}>Try again</button>
        </p>
      )}
    </div>
  );
}
