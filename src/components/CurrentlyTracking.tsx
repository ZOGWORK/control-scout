// "Currently tracking" on the Events page: the events you track (Track event on an event page) as
// small cards, live ones first, so they're one tap away from the list. Predict uses the same row as quick
// picks (`onPick`): a card picks the event there instead of opening its page. Events in the season on screen
// come from its list; any other is looked up on its own (its season's list filtered by its code).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Eye } from "lucide-react";
import { useApi } from "../lib/api";
import { usePersonal } from "../lib/personal";
import { dateRange, seasonLabel } from "../lib/format";
import type { EventListItem } from "../shared/api";
import { EventStatusChip } from "./EventChips";
import { cn } from "./cn";
import { lookupPath, resolveTracked, TRACKED_LOOKUPS, TRACKED_SHOWN, type TrackedRef } from "../pages/trackedEvents";

type Answer = (path: string, events: EventListItem[] | null) => void;

/**
 * One event's lookup, through useApi: it subscribes to the answer, so a lookup that failed offline is
 * retried when the connection is back (and a later answer replaces the failure). Renders nothing.
 */
function Lookup({ path, onAnswer }: { path: string; onAnswer: Answer }) {
  const { data, error } = useApi<{ events: EventListItem[] }>(path);
  useEffect(() => {
    if (data) onAnswer(path, Array.isArray(data.events) ? data.events : null);
    else if (error) onAnswer(path, null);
  }, [path, data, error, onAnswer]);
  return null;
}

export function CurrentlyTracking({ season, current, events, listSettled, className, onPick, picked, only }: {
  /** The season on screen, and its list (undefined while it loads). */
  season: number; events: EventListItem[] | undefined;
  /** The list's answer is in (or it failed): events of this season missing from it are then looked up. */
  listSettled: boolean;
  /** The current season: other seasons' events say which season they're from. */
  current: number; className?: string;
  /** Quick-pick mode (Predict): a card picks its event instead of linking to its page. */
  onPick?: (season: number, code: string) => void;
  /** The picked event ("season:code"), shown pressed. */
  picked?: string | null;
  /** Only the tracked events this accepts (Advancement: events that advance teams). Ones not found can't be
   *  checked, so they're left out; ones still loading show as placeholders until they can be. */
  only?: (e: EventListItem) => boolean;
}) {
  const refs = usePersonal().state.tracked.events;
  const [all, setAll] = useState(false);
  const lists = useMemo(() => new Map(events ? [[season, events]] : []), [season, events]);
  // First pass with no lookups: what the season on screen already answers.
  const first = useMemo(() => resolveTracked(refs, lists, {}), [refs, lists]);
  const toLook = first.missing.filter((r) => r.season !== season || listSettled).slice(0, TRACKED_LOOKUPS);
  // Answers to the one-by-one lookups, by path: the events, or null when the lookup failed.
  const [lookups, setLookups] = useState<Record<string, EventListItem[] | null>>({});
  const onAnswer = useCallback<Answer>((p, v) => setLookups((g) => (g[p] === v ? g : { ...g, [p]: v })), []);
  const { found, missing } = useMemo(() => resolveTracked(refs, lists, lookups), [refs, lists, lookups]);
  // Mounted while their event isn't in the season list (resolved or not), so each stays subscribed.
  const lookupEls = toLook.map((r) => <Lookup key={r.ref} path={lookupPath(r)} onAnswer={onAnswer} />);
  const kept = only ? found.filter(only) : found;
  if (!found.length && !missing.length) return <>{lookupEls}</>; // nothing tracked (so nothing to look up)
  // Still on its way: the season's list, or a lookup sent and not answered yet.
  const looking = new Set(toLook.map((r) => r.ref));
  const waiting = (r: TrackedRef) => (r.season === season && !listSettled) || (looking.has(r.ref) && lookups[lookupPath(r)] === undefined);
  const pending = missing.filter(waiting);
  const unknown = only ? [] : missing.filter((r) => !waiting(r));
  const total = kept.length + pending.length + unknown.length;
  if (!total) return <>{lookupEls}</>;
  const items: ({ kind: "event"; e: EventListItem } | { kind: "pending" | "unknown"; r: TrackedRef })[] = [
    ...kept.map((e) => ({ kind: "event" as const, e })),
    ...pending.map((r) => ({ kind: "pending" as const, r })),
    ...unknown.map((r) => ({ kind: "unknown" as const, r })),
  ];
  const shown = all ? items : items.slice(0, TRACKED_SHOWN);
  const more = items.length - shown.length;
  return (
    <section aria-label="Currently tracking" className={cn("min-w-0", className)} data-currently-tracking>
      {lookupEls}
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Eye className="size-4 text-accent-text" aria-hidden />Currently tracking:
        <span className="font-normal tabular-nums text-muted-foreground">{total} event{total === 1 ? "" : "s"}</span>
      </h2>
      {/* A phone scrolls the row sideways (edge to edge); wider screens lay it out as a grid. No scroll snapping:
          when the placeholders turn into events and reorder, a snapped row follows its card and opens mid-row. */}
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
        {shown.map((it) => (
          <li key={it.kind === "event" ? `${it.e.season}:${it.e.code}` : it.r.ref} className="w-[15.5rem] shrink-0 sm:w-auto sm:min-w-0">
            {it.kind === "event" ? <TrackedCard e={it.e} current={current} onPick={onPick} picked={picked === `${it.e.season}:${it.e.code}`} />
              : it.kind === "pending" ? <div className="skeleton h-[4.75rem] rounded-xl" aria-hidden />
                : <UnknownCard r={it.r} onPick={onPick} picked={picked === it.r.ref} />}
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

/** A link to the event's page, or (quick-pick mode) a button that picks it, pressed while it's the one picked. */
function CardShell({ season, code, onPick, picked, className, children }: { season: number; code: string; onPick?: (season: number, code: string) => void; picked?: boolean; className: string; children: ReactNode }) {
  return onPick
    ? <button type="button" aria-pressed={!!picked} onClick={() => onPick(season, code)} className={cn(className, "w-full text-left", picked && "border-accent/70 bg-accent/[0.08]")}>{children}</button>
    : <Link to={`/events/${season}/${code}`} className={className}>{children}</Link>;
}

function TrackedCard({ e, current, onPick, picked }: { e: EventListItem; current: number; onPick?: (season: number, code: string) => void; picked?: boolean }) {
  const live = e.status === "live";
  return (
    <CardShell season={e.season} code={e.code} onPick={onPick} picked={picked}
      className={cn("lift group flex h-full flex-col gap-1.5 rounded-xl border bg-card px-3 py-2.5", live ? "border-red-500/40" : "border-border")}>
      <span className="flex items-center gap-2 text-xs">
        <EventStatusChip status={e.status} className="px-2 py-0.5" />
        {/* On now with a stream to watch on its page, as on the cards below. */}
        {live && e.stream && <span className="inline-flex items-center gap-1 font-bold text-red-500" title="Live stream on the event page" data-stream-live><span aria-hidden className="size-2 animate-pulse rounded-full bg-red-500" />LIVE<span className="sr-only"> stream</span></span>}
        {e.season !== current && <span className="ml-auto tabular-nums text-muted-foreground">{seasonLabel(e.season)}</span>}
      </span>
      <span className="truncate text-sm font-medium leading-snug group-hover:text-accent-text" title={e.name}>{e.name}</span>
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5 shrink-0" aria-hidden />{dateRange(e.start, e.end)}</span>
    </CardShell>
  );
}

/** A tracked event we couldn't find in any list: still a link to its page. */
function UnknownCard({ r, onPick, picked }: { r: TrackedRef; onPick?: (season: number, code: string) => void; picked?: boolean }) {
  return (
    <CardShell season={r.season} code={r.code} onPick={onPick} picked={picked} className="lift group flex h-full flex-col justify-center gap-1 rounded-xl border border-border bg-card px-3 py-2.5">
      <span className="truncate font-mono text-sm font-medium group-hover:text-accent-text">{r.code}</span>
      <span className="text-xs text-muted-foreground">{seasonLabel(r.season)} season</span>
    </CardShell>
  );
}
