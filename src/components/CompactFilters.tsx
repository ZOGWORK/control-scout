// Phones (under 768px): a list page's filter area as one row, so the first result is in the first view.
// The row holds the season, the filters that are on (each a chip that removes it) and a Filters button
// opening a bottom sheet with every control the wide layout shows inline. The controls are the same
// components either way, so the URL state, Back / Forward and the saved filters behave alike. The sheet is
// the ui-kit's: focus stays inside it, Escape closes it and focus goes back to the Filters button.
// Used by /teams (every view), /matches, /events and /rankings.
import { useRef, useState, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { useMediaQuery } from "../lib/meta";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/overlay";
import { cn } from "./cn";

export const COMPACT_FILTERS_QUERY = "(max-width: 767px)";

/** True on phones, where list pages use the compact row and sheet. */
export function useCompactFilters(): boolean {
  return useMediaQuery(COMPACT_FILTERS_QUERY);
}

export interface FilterChip {
  /** Stable while the filter is on (React key, and where focus goes after a neighbour is removed). */
  id: string;
  label: ReactNode;
  /** The filter in words, for "Remove filter: …". */
  name: string;
  onRemove: () => void;
}

/** Closes the sheet, then runs `then` once focus is back on the Filters button (e.g. open another panel). */
export type CloseSheet = (then?: () => void) => void;

export interface CompactFiltersProps {
  /** First on the row: the season selector. */
  lead?: ReactNode;
  chips: FilterChip[];
  /** A full-width line under the row, outside the sheet (the directory's search box). */
  search?: ReactNode;
  /** The sheet's title. */
  title?: string;
  /** What's showing, under the title ("1,234 teams"). */
  summary?: ReactNode;
  /** The main button at the sheet's foot ("Show 1,234 teams"); it closes the sheet. */
  doneLabel?: string;
  /** Clears every filter (offered in the sheet while any is on). */
  onClearAll?: () => void;
  /** Every control, as the sheet shows them. */
  children: ReactNode | ((close: CloseSheet) => ReactNode);
  className?: string;
}

export function CompactFilters({ lead, chips, search, title = "Filters", summary, doneLabel = "Done", onClearAll, children, className }: CompactFiltersProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const after = useRef<(() => void) | null>(null);
  const close: CloseSheet = (then) => { after.current = then ?? null; setOpen(false); };
  const n = chips.length;

  // A removed chip takes its button with it: focus moves to the chip that takes its place, else the one
  // before, else the Filters button, never to the top of the page.
  const remove = (i: number) => {
    const next = chips[i + 1]?.id ?? chips[i - 1]?.id ?? null;
    chips[i].onRemove();
    requestAnimationFrame(() => {
      const el = next ? row.current?.querySelector<HTMLElement>(`[data-chip="${CSS.escape(next)}"]`) : null;
      (el ?? button.current)?.focus();
    });
  };

  return (
    <div className={cn("space-y-2", className)} data-compact-filters="">
      {/* Wraps rather than scrolling sideways, so every chip and its × stays in view. */}
      <div ref={row} className="flex flex-wrap items-center gap-2">
        {lead}
        {chips.length > 0 && (
          <ul role="list" className="contents" aria-label="Filters on">
            {chips.map((c, i) => (
              <li key={c.id} className="min-w-0 max-w-full">
                <button type="button" data-chip={c.id} onClick={() => remove(i)} aria-label={`Remove filter: ${c.name}`}
                  className="inline-flex h-11 max-w-full items-center gap-1.5 rounded-full border border-accent/50 bg-accent/10 pl-3 pr-2.5 text-sm font-medium text-text-base outline-none transition-colors hover:bg-accent/[0.16] focus-visible:ring-2 focus-visible:ring-accent/60">
                  <span className="min-w-0 truncate">{c.label}</span><X className="size-4 shrink-0 text-text-muted" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button ref={button} variant="outline" className="ml-auto h-11 shrink-0 px-3.5" onClick={() => setOpen(true)} aria-haspopup="dialog"
          aria-label={n ? `Filters, ${n} on` : "Filters"}>
          <SlidersHorizontal className="text-accent" /> Filters
          {n > 0 && <span aria-hidden className="grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] font-bold tabular-nums text-accent-ink">{n}</span>}
        </Button>
      </div>
      {search}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="gap-0 p-0" returnFocus={() => button.current}
          onCloseAutoFocus={() => {
            // Runs just before focus goes back to the Filters button: the follow-up waits a frame for it.
            const then = after.current;
            after.current = null;
            if (then) requestAnimationFrame(then);
          }}>
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-text-base/20" />
          <SheetHeader className="px-5 pb-3 pt-3 text-left">
            <SheetTitle>{title}</SheetTitle>
            {summary != null ? <SheetDescription aria-live="polite">{summary}</SheetDescription> : <SheetDescription className="sr-only">Every filter for this list.</SheetDescription>}
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-4">
            {typeof children === "function" ? children(close) : children}
          </div>
          <div className="flex shrink-0 gap-2 border-t border-line px-5 py-3">
            {onClearAll && <Button variant="outline" className="flex-1" onClick={onClearAll} disabled={!n}><X /> Clear filters</Button>}
            <Button className="flex-1" onClick={() => close()}>{doneLabel}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** A labelled group of controls inside the sheet. */
export function FilterSection({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="mb-2 text-sm font-semibold text-text-base">{label}</h3>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </section>
  );
}
