// Predict (Scheduled): this week's events as a compact list grouped by day, so a long week stays scannable.
// Each row is one button (aria-pressed for the picked event) with the full name, where it is, its type and
// a status chip. When the week is long, a search box and a Filters button (type chips and a "Has matches
// scheduled" switch, folded away until asked for) sit on top; until one is used, the list starts with the
// most useful few (on now, then matches to play).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, MapPin, Search, SlidersHorizontal, X } from "lucide-react";
import { useApi, qs } from "../../lib/api";
import { useCurrentSeason } from "../../lib/meta";
import { eventMatches } from "../../lib/labEvents";
import { dateRange, place } from "../../lib/format";
import type { EventListItem } from "../../shared/api";
import { EmptyState } from "../page";
import { ErrorState, Skeleton } from "../states";
import { Button } from "../ui/button";
import { Badge, Input, Label } from "../ui/basic";
import { Switch } from "../ui/controls";
import { cn } from "../cn";

/** More events than this: the discovery controls show, and the list starts with this many. */
export const WEEK_FIRST = 8;

export type WeekKind = "all" | "advancing" | "league" | "other";
export const KIND_LABEL: Record<WeekKind, string> = { all: "All", advancing: "Qualifiers & championships", league: "League", other: "Scrimmage & other" };
const ADVANCING_TYPES = new Set(["Qualifier", "SuperQualifier", "Championship", "Premier", "FIRSTChampionship"]);
const LEAGUE_TYPES = new Set(["LeagueMeet", "LeagueTournament"]);

/** Which type chip an event falls under. */
export function weekKind(type: string | null): Exclude<WeekKind, "all"> {
  return ADVANCING_TYPES.has(type ?? "") ? "advancing" : LEAGUE_TYPES.has(type ?? "") ? "league" : "other";
}

/** Matches scheduled and not yet played (0 once the event is finished). */
export const toPlay = (e: EventListItem) => (e.status === "finished" ? 0 : Math.max(0, e.matchesTotal - e.matchesPlayed));

/** On now: the server's status, which reads the venue's own calendar (src/shared/eventDay.ts), not the viewer's. */
export const onNow = (e: EventListItem) => e.status === "live";

export type WeekStatus = { kind: "toPlay"; n: number } | { kind: "finished" } | { kind: "noSchedule" };
export function weekStatus(e: EventListItem): WeekStatus {
  const n = toPlay(e);
  if (n > 0) return { kind: "toPlay", n };
  if (e.status === "finished" || (e.matchesTotal > 0 && e.matchesPlayed >= e.matchesTotal)) return { kind: "finished" };
  return { kind: "noSchedule" };
}

/** Most useful first: on now, then with matches to play, then upcoming by date, then finished (latest first). */
function usefulness(e: EventListItem, today: string): number {
  if (onNow(e)) return 0;
  if (toPlay(e) > 0) return 1;
  if (weekStatus(e).kind !== "finished" && (e.start ?? "") >= today) return 2;
  return weekStatus(e).kind === "finished" ? 4 : 3;
}
export function byUsefulness(events: EventListItem[], today: string): EventListItem[] {
  return [...events].sort((a, b) => {
    const ua = usefulness(a, today), ub = usefulness(b, today);
    if (ua !== ub) return ua - ub;
    if (ua === 4) return (b.start ?? "").localeCompare(a.start ?? "") || a.name.localeCompare(b.name);
    return toPlay(b) - toPlay(a) || (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name);
  });
}

export interface WeekDay { day: string | null; label: string; events: EventListItem[] }

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const utc = (d: string) => new Date(`${d}T12:00:00Z`);
const addDays = (d: string, n: number) => new Date(utc(d).getTime() + n * 864e5).toISOString().slice(0, 10);
/** "Sat Oct 25" for a YYYY-MM-DD day. */
export function dayName(d: string): string {
  const x = utc(d);
  return `${WEEKDAY[x.getUTCDay()]} ${MONTH[x.getUTCMonth()]} ${x.getUTCDate()}`;
}
export function dayLabel(d: string, today: string): string {
  const rel = d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : d === addDays(today, -1) ? "Yesterday" : null;
  return rel ? `${rel} · ${dayName(d)}` : dayName(d);
}

/**
 * Events by their start day, in date order, so a multi-day event sits under the day it starts. A past day
 * whose events are all over moves to the end (it is the least useful part of the week); one with an event
 * still on stays in place. Undated events come last. Within a day: on now, then matches to play, then name.
 */
export function groupByDay(events: EventListItem[], today: string): WeekDay[] {
  const days = new Map<string | null, EventListItem[]>();
  for (const e of events) {
    const k = e.start ?? null;
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  const done = (d: string | null, es: EventListItem[]) => d !== null && d < today && es.every((e) => !onNow(e));
  const order = (d: string | null, es: EventListItem[]) => (d === null ? 2 : done(d, es) ? 1 : 0);
  return [...days.entries()]
    .sort(([a, ea], [b, eb]) => order(a, ea) - order(b, eb) || (order(a, ea) === 1 ? (b ?? "").localeCompare(a ?? "") : (a ?? "").localeCompare(b ?? "")))
    .map(([day, es]) => ({
      day,
      label: day ? dayLabel(day, today) : "Date to be announced",
      events: es.sort((a, b) => Number(onNow(b)) - Number(onNow(a)) || toPlay(b) - toPlay(a) || a.name.localeCompare(b.name)),
    }));
}

/** The local calendar day as YYYY-MM-DD (event dates are event-local days, so compare like with like). */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The local day, kept current: checked every minute and whenever the tab comes back into view. */
export function useLocalDay(): string {
  const [day, setDay] = useState(localDay);
  useEffect(() => {
    const check = () => setDay(localDay());
    const id = window.setInterval(check, 60_000);
    document.addEventListener("visibilitychange", check);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", check); };
  }, []);
  return day;
}

export interface WeekFilters { q: string; kind: WeekKind; scheduled: boolean }
export const NO_FILTERS: WeekFilters = { q: "", kind: "all", scheduled: false };
export const filtering = (f: WeekFilters) => !!f.q.trim() || f.kind !== "all" || f.scheduled;
export function applyFilters(events: EventListItem[], f: WeekFilters): EventListItem[] {
  return events.filter((e) => eventMatches(e, f.q) && (f.kind === "all" || weekKind(e.type) === f.kind) && (!f.scheduled || toPlay(e) > 0));
}

export function WeekEvents({ onPick, picked }: { onPick: (season: number, code: string) => void; picked: string | null }) {
  const season = useCurrentSeason();
  // The same window as before: two days back (an event still finishing) to a week out. It moves on with the
  // calendar, so a page left open overnight asks for the new week and "Today" is today.
  const today = useLocalDay();
  const range = useMemo(() => {
    const now = utc(today).getTime(), iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    return { from: iso(now - 2 * 864e5), to: iso(now + 7 * 864e5), today };
  }, [today]);
  const state = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season, from: range.from, to: range.to })}`);
  const [filters, setFilters] = useState<WeekFilters>(NO_FILTERS);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(false);

  const events = state.data?.events;
  const view = useMemo(() => {
    if (!events) return null;
    const controls = events.length > WEEK_FIRST;
    const on = controls && filtering(filters);
    const matched = on ? applyFilters(events, filters) : events;
    const shown = on || all || !controls ? matched : byUsefulness(matched, range.today).slice(0, WEEK_FIRST);
    return { controls, on, matched, shown, days: groupByDay(shown, range.today) };
  }, [events, filters, all, range.today]);

  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!events || !view) return <WeekSkeleton />;
  if (!events.length) {
    return (
      <EmptyState icon={CalendarDays} title={`No events from ${dayName(range.from)} to ${dayName(range.to)}`}
        description="Nothing is scheduled in this window. Every event of the season is on the events page."
        action={<Button asChild variant="secondary"><Link to="/events">Browse all events</Link></Button>} />
    );
  }
  const set = (p: Partial<WeekFilters>) => setFilters((f) => ({ ...f, ...p }));
  // Filters beyond the search box, counted on the Filters button so a closed panel never hides one that's on.
  const extra = Number(filters.kind !== "all") + Number(filters.scheduled);
  return (
    <div className="@container/week min-w-0">
      {view.controls && (
        <div className="mb-4" role="search" aria-label="Filter this week's events">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search this week"
                aria-label="Filter events by name or place" className="pl-9" />
            </div>
            <Button variant="outline" aria-label={extra > 0 ? `Filters, ${extra} on` : "Filters"} aria-expanded={open} aria-controls="week-filters" onClick={() => setOpen((x) => !x)}
              className={cn(extra > 0 && "border-accent/60 text-accent-text")}>
              <SlidersHorizontal /> Filters{extra > 0 && <span className="rounded-full bg-accent px-1.5 text-xs leading-5 text-accent-ink">{extra}</span>}
            </Button>
          </div>
          {open && (
            <div id="week-filters" className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border p-3">
              <div role="group" aria-label="Event type" className="flex flex-wrap gap-1.5">
                {(Object.keys(KIND_LABEL) as WeekKind[]).map((k) => (
                  <button key={k} type="button" aria-pressed={filters.kind === k} onClick={() => set({ kind: k })}
                    className={cn("min-h-8 rounded-full border px-3 text-xs font-medium motion-safe:transition-colors",
                      filters.kind === k ? "border-accent/60 bg-accent/15 text-accent-text" : "border-border text-muted-foreground hover:border-text-base/35 hover:text-foreground")}>
                    {KIND_LABEL[k]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Switch id="week-scheduled" checked={filters.scheduled} onCheckedChange={(v) => set({ scheduled: v })} />
                <Label htmlFor="week-scheduled" className="text-xs font-medium text-foreground">Has matches scheduled</Label>
              </div>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground" aria-live="polite">
            <span>Showing {view.shown.length} of {events.length}</span>
            {view.on && <> · <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button></>}
          </p>
        </div>
      )}
      {!view.shown.length ? (
        <EmptyState icon={Search} title="No events match these filters" description="Try another name or place, or a different type."
          action={<Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}><X /> Clear filters</Button>} />
      ) : (
        <div className="space-y-5">
          {view.days.map((g) => (
            <section key={g.day ?? "tba"} aria-label={g.label}>
              <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{g.label}</h3>
              <ul className="grid gap-2 @4xl/week:grid-cols-2">
                {g.events.map((e) => <li key={e.code} className="min-w-0"><WeekRow e={e} picked={picked === e.code} onPick={onPick} /></li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
      {view.controls && !view.on && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setAll((x) => !x)}>
          {all ? "Show fewer" : `Show all ${events.length}`}
        </Button>
      )}
    </div>
  );
}

function WeekRow({ e, picked, onPick }: { e: EventListItem; picked: boolean; onPick: (season: number, code: string) => void }) {
  const s = weekStatus(e);
  const now = onNow(e);
  const multiDay = !!e.start && !!e.end && e.end !== e.start;
  const where = place(e.city, e.state, e.country);
  return (
    <button type="button" aria-pressed={picked} onClick={() => onPick(e.season, e.code)}
      className={cn("flex h-full w-full min-w-0 items-start gap-3 rounded-xl border bg-card px-3.5 py-3 text-left motion-safe:transition-colors hover:border-accent/50",
        picked ? "border-accent/70 bg-accent/[0.07]" : "border-border")}>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground [overflow-wrap:anywhere]">{e.name}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {where && <span className="inline-flex items-center gap-1"><MapPin aria-hidden className="size-3 shrink-0" />{where}</span>}
          <span>{e.typeLabel || e.type || "Event"}</span>
          {multiDay && <span>{dateRange(e.start, e.end)}</span>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {now && <Badge variant="soft">On now</Badge>}
        {s.kind === "toPlay" ? <Badge variant="success">{s.n} to play</Badge>
          : s.kind === "finished" ? <Badge variant="secondary">Finished</Badge>
            : <Badge variant="outline">No schedule yet</Badge>}
      </span>
    </button>
  );
}

function WeekSkeleton() {
  return (
    <div role="status" aria-label="Loading this week's events" className="space-y-5">
      {[3, 2].map((n, i) => (
        <div key={i}>
          <Skeleton className="mb-2 h-3 w-28" />
          <div className="space-y-2">{Array.from({ length: n }, (_, j) => <Skeleton key={j} className="h-16 rounded-xl" />)}</div>
        </div>
      ))}
    </div>
  );
}
