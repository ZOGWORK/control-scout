// v8's "On now and next" on the Events page (docs/design/v8-revamp-brief.md §7.9): the live events first, then the
// next to start, in one card above the filters, so "what's on now and soon" is answered before anything is picked.
// Always NOW_ROWS rows (NOW_ROWS_PHONE on a phone) and a skeleton of the same size while the list loads, so the
// filter bar under it never moves when the list arrives (the page's layout-shift work, #346).
import { Link } from "react-router-dom";
import { CalendarClock } from "lucide-react";
import type { EventListItem } from "../shared/api";
import { cn } from "./cn";
import { LiveDot } from "./EventChips";
import { RowStatus, shortDates, where } from "./EventBrowse";
import { nowAndNext, NOW_ROWS, NOW_ROWS_PHONE } from "../pages/eventsList";

const ROW = "flex h-14 min-w-0 items-center gap-3 px-4";
// The phone shows the first rows only; the rest are hidden by CSS, so its height is fixed before data too.
const phoneHidden = (i: number) => i >= NOW_ROWS_PHONE && "max-sm:hidden";

export function EventsNow({ events, loading, onLive, className }: {
  /** The season's list (undefined while it loads). */
  events: EventListItem[] | undefined; loading: boolean;
  /** Show every live event in the list below (the Live now status). */
  onLive: () => void; className?: string;
}) {
  if (!events) {
    if (!loading) return null; // the list failed: the error shows below
    return (
      <section aria-busy="true" aria-label="On now and next" className={cn("overflow-hidden rounded-xl border border-line bg-card", className)} data-events-now="loading">
        <div className="flex h-12 items-center px-4"><span className="skeleton h-4 w-32 rounded" /></div>
        <ul className="grid border-t border-line lg:grid-cols-2">
          {Array.from({ length: NOW_ROWS }, (_, i) => (
            <li key={i} className={cn(ROW, "border-b border-line lg:odd:border-r", phoneHidden(i))}><span className="skeleton h-4 w-2/3 rounded" /></li>
          ))}
        </ul>
      </section>
    );
  }
  const { items, live } = nowAndNext(events);
  if (!items.length) return null;
  const title = live ? "On now and next" : items[0].status === "upcoming" ? "Coming up" : "Latest results";
  return (
    <section aria-labelledby="events-now-title" className={cn("overflow-hidden rounded-xl border border-line bg-card", className)} data-events-now>
      <div className="flex h-12 items-center gap-2 px-4">
        {live > 0 ? <LiveDot /> : <CalendarClock className="size-4 text-text-faint" aria-hidden />}
        <h2 id="events-now-title" className="font-sans text-sm font-semibold text-text-base">{title}</h2>
        {live > 0 && <span className="text-sm tabular-nums text-text-faint">{live} live</span>}
        {live > 0 && (
          <button type="button" onClick={onLive} className="tap-44 ml-auto rounded-md px-2 py-1 text-sm font-medium text-text-muted transition-colors duration-150 still-hover:text-text-base active:scale-[0.97] motion-reduce:active:scale-100" data-all-live>
            {live > items.length ? `All ${live} live` : "Show live only"}
          </button>
        )}
      </div>
      <ul className="grid border-t border-line lg:grid-cols-2">
        {items.map((e, i) => (
          <li key={e.code} className={cn("min-w-0 border-b border-line lg:odd:border-r", phoneHidden(i))}>
            <Link to={`/events/${e.season}/${e.code}`} className={cn(ROW, "transition-colors duration-150 still-hover:bg-ink/[0.03]")} data-now-row={e.status}>
              <span className="w-[4.75rem] shrink-0 text-sm tabular-nums text-text-muted max-sm:hidden">{shortDates(e.start, e.end)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-text-base" title={e.name}>{e.name}</span>
                <span className="block truncate text-xs text-text-faint"><span className="sm:hidden">{shortDates(e.start, e.end)} · </span>{e.typeLabel} · {where(e)}</span>
              </span>
              {/* The title says "Coming up": only live, finished and video say anything here. */}
              {e.status !== "upcoming" && <span className="shrink-0"><RowStatus e={e} /></span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
