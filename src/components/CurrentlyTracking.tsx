// "Currently tracking" on the Events page: the events you track (Track event on an event page) as
// small cards, live ones first, so they're one tap away from the list. Events in the season on screen
// come from its list; any other is looked up on its own (its season's list filtered by its code).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Eye } from "lucide-react";
import { load } from "../lib/api";
import { usePersonal } from "../lib/personal";
import { dateRange, seasonLabel } from "../lib/format";
import type { EventListItem } from "../shared/api";
import { EventStatusChip } from "./EventChips";
import { cn } from "./cn";
import { lookupPath, resolveTracked, TRACKED_LOOKUPS, TRACKED_SHOWN, type TrackedRef } from "../pages/trackedEvents";

/** Answers to the one-by-one lookups, by path: the events, or null when the lookup failed. */
function useLookups(paths: string[]) {
  const [got, setGot] = useState<Record<string, EventListItem[] | null>>({});
  const key = paths.join("|");
  useEffect(() => {
    let on = true;
    for (const p of paths) {
      load<{ events: EventListItem[] }>(p).then(
        (d) => { if (on) setGot((g) => ({ ...g, [p]: Array.isArray(d?.events) ? d.events : null })); },
        () => { if (on) setGot((g) => ({ ...g, [p]: null })); },
      );
    }
    return () => { on = false; };
  }, [key]); // the paths, by value
  return got;
}

export function CurrentlyTracking({ season, current, events, listSettled, className }: {
  /** The season on screen, and its list (undefined while it loads). */
  season: number; events: EventListItem[] | undefined;
  /** The list's answer is in (or it failed): events of this season missing from it are then looked up. */
  listSettled: boolean;
  /** The current season: other seasons' events say which season they're from. */
  current: number; className?: string;
}) {
  const refs = usePersonal().state.tracked.events;
  const [all, setAll] = useState(false);
  const lists = useMemo(() => new Map(events ? [[season, events]] : []), [season, events]);
  // First pass with no lookups: what the season on screen already answers.
  const first = useMemo(() => resolveTracked(refs, lists, {}), [refs, lists]);
  const toLook = first.missing.filter((r) => r.season !== season || listSettled).slice(0, TRACKED_LOOKUPS);
  const lookups = useLookups(toLook.map(lookupPath));
  const { found, missing } = useMemo(() => resolveTracked(refs, lists, lookups), [refs, lists, lookups]);
  if (!found.length && !missing.length) return null;
  // Still on its way: the season's list, or a lookup sent and not answered yet.
  const looking = new Set(toLook.map((r) => r.ref));
  const waiting = (r: TrackedRef) => (r.season === season && !listSettled) || (looking.has(r.ref) && lookups[lookupPath(r)] === undefined);
  const pending = missing.filter(waiting);
  const unknown = missing.filter((r) => !waiting(r));
  const total = found.length + missing.length;
  const items: ({ kind: "event"; e: EventListItem } | { kind: "pending" | "unknown"; r: TrackedRef })[] = [
    ...found.map((e) => ({ kind: "event" as const, e })),
    ...pending.map((r) => ({ kind: "pending" as const, r })),
    ...unknown.map((r) => ({ kind: "unknown" as const, r })),
  ];
  const shown = all ? items : items.slice(0, TRACKED_SHOWN);
  const more = items.length - shown.length;
  return (
    <section aria-label="Currently tracking" className={cn("min-w-0", className)} data-currently-tracking>
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Eye className="size-4 text-accent-text" aria-hidden />Currently tracking:
        <span className="font-normal tabular-nums text-muted-foreground">{total} event{total === 1 ? "" : "s"}</span>
      </h2>
      {/* A phone scrolls the row sideways (edge to edge); wider screens lay it out as a grid. No scroll snapping:
          when the placeholders turn into events and reorder, a snapped row follows its card and opens mid-row. */}
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
        {shown.map((it) => (
          <li key={it.kind === "event" ? `${it.e.season}:${it.e.code}` : it.r.ref} className="w-[15.5rem] shrink-0 sm:w-auto sm:min-w-0">
            {it.kind === "event" ? <TrackedCard e={it.e} current={current} />
              : it.kind === "pending" ? <div className="skeleton h-[4.75rem] rounded-xl" aria-hidden />
                : <UnknownCard r={it.r} />}
          </li>
        ))}
        {more > 0 && (
          <li className="shrink-0 sm:justify-self-start">
            <button type="button" onClick={() => setAll(true)}
              className="flex h-full min-h-[4.75rem] items-center rounded-xl border border-dashed border-line px-4 text-sm font-semibold text-muted-foreground hover:border-accent/60 hover:text-foreground">
              and {more} more
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function TrackedCard({ e, current }: { e: EventListItem; current: number }) {
  const live = e.status === "live";
  return (
    <Link to={`/events/${e.season}/${e.code}`}
      className={cn("lift group flex h-full flex-col gap-1.5 rounded-xl border bg-card px-3 py-2.5", live ? "border-red-500/40" : "border-border")}>
      <span className="flex items-center gap-2 text-xs">
        <EventStatusChip status={e.status} className="px-2 py-0.5" />
        {/* On now with a stream to watch on its page, as on the cards below. */}
        {live && e.stream && <span className="inline-flex items-center gap-1 font-bold text-red-500" title="Live stream on the event page" data-stream-live><span aria-hidden className="size-2 animate-pulse rounded-full bg-red-500" />LIVE<span className="sr-only"> stream</span></span>}
        {e.season !== current && <span className="ml-auto tabular-nums text-muted-foreground">{seasonLabel(e.season)}</span>}
      </span>
      <span className="truncate text-sm font-medium leading-snug group-hover:text-accent-text" title={e.name}>{e.name}</span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5 shrink-0" aria-hidden />{dateRange(e.start, e.end)}</span>
    </Link>
  );
}

/** A tracked event we couldn't find in any list: still a link to its page. */
function UnknownCard({ r }: { r: TrackedRef }) {
  return (
    <Link to={`/events/${r.season}/${r.code}`} className="lift group flex h-full flex-col justify-center gap-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <span className="truncate font-mono text-sm font-medium group-hover:text-accent-text">{r.code}</span>
      <span className="text-xs text-muted-foreground">{seasonLabel(r.season)} season</span>
    </Link>
  );
}
