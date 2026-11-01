// The event picker: what the Scout page is until an event is picked (and again from Change event). Events on
// today first, then the ones your teams are at, then the next ones by date, with a search (name, city or code)
// for the rest. Each card says whether your teams compete there, how far scouting has got there (from this
// space's entries: src/shared/scoutProgress.ts), and has one action, Scout this event.
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CalendarDays, MapPin, RefreshCw, Search, SearchX, Users, X } from "lucide-react";
import { apiFetch, qs } from "../../../lib/api";
import { dateRange, place } from "../../../lib/format";
import type { EventListItem, TeamProfile } from "../../../shared/api";
import { matchesWithEntries, pitProgress } from "../../../shared/scoutProgress";
import { Badge, Input, Label } from "../../ui/basic";
import { Button } from "../../ui/button";
import { EmptyState } from "../../page";
import { Skeleton } from "../../states";
import { cn } from "../../cn";
import { EVENT_SEARCH_DEBOUNCE, rankEvents } from "../EventPicker";

/** How many events the list shows before "Show more", and how many upcoming ones it asks for. */
const PAGE = 9;
const UPCOMING = 40;
const SEARCH_CAP = 3000;

/** Today's date on this device, as event dates are written (YYYY-MM-DD, event-local). */
export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const isOnToday = (e: Pick<EventListItem, "start" | "end">, today: string) => !!e.start && e.start <= today && (e.end ?? e.start) >= today;

export interface EventRow { event: EventListItem; today: boolean; /** Your teams competing there. */ ours: number[] }

/**
 * The list's order: events on today, then the ones your teams are at, then the rest by start date (each group by
 * date, then name). Events already over are left out; codes are listed once.
 */
export function orderEvents(events: readonly EventListItem[], today: string, ours: ReadonlyMap<string, number[]> = new Map()): EventRow[] {
  const seen = new Set<string>();
  const rows: EventRow[] = [];
  for (const e of events) {
    if (seen.has(e.code) || (e.end ?? e.start ?? today) < today) continue;
    seen.add(e.code);
    rows.push({ event: e, today: isOnToday(e, today), ours: ours.get(e.code) ?? [] });
  }
  const group = (r: EventRow) => (r.today ? 0 : r.ours.length ? 1 : 2);
  return rows.sort((a, b) => group(a) - group(b) || (a.event.start ?? "9").localeCompare(b.event.start ?? "9") || a.event.name.localeCompare(b.event.name));
}

type Entry = Parameters<typeof pitProgress>[0][number];

export interface EventChooserProps {
  season: number;
  /** This space's entries, for each event's progress. */
  entries: readonly Entry[];
  /** Your teams (the account's own and its Control Point teams): the events they're at come first, marked. */
  ourTeams: readonly number[];
  /** The event picked now, or the workspace's suggestion (listed even when it's past the upcoming page). */
  current?: string | null;
  onPick: (code: string) => void;
  /** Back to the event already picked (absent with none). */
  onCancel?: () => void;
}

export function EventChooser({ season, entries, ourTeams, current, onPick, onCancel }: EventChooserProps) {
  const today = localToday();
  const start = (current ?? "").trim().toUpperCase();
  const [list, setList] = useState<{ events: EventListItem[]; ours: Map<string, number[]> } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [text, setText] = useState("");
  const [hits, setHits] = useState<{ q: string; events: EventListItem[] } | null>(null);
  const [searchFailed, setSearchFailed] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const searchId = useId();
  const teamsKey = [...new Set(ourTeams)].sort((a, b) => a - b).join(",");

  // Upcoming events, your teams' events and the current one (both may be past the upcoming page), together.
  useEffect(() => {
    let live = true;
    setFailed(false);
    const teams = teamsKey ? teamsKey.split(",").map(Number) : [];
    const byCode = (c: string) => apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, q: c, all: 1, limit: 20 })}`)
      .then((r) => r.events.find((e) => e.code === c) ?? null, () => null);
    (async () => {
      const [upcoming, ...profiles] = await Promise.all([
        apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, from: today, all: 1, limit: UPCOMING })}`),
        ...teams.map((t) => apiFetch<TeamProfile>(`/api/teams/${t}${qs({ season })}`).catch(() => null)),
      ]);
      const ours = new Map<string, number[]>();
      profiles.forEach((p, i) => {
        for (const e of p?.events ?? []) {
          if (e.season !== season || (e.end ?? e.start ?? today) < today) continue;
          ours.set(e.code, [...(ours.get(e.code) ?? []), teams[i]]);
        }
      });
      const have = new Set(upcoming.events.map((e) => e.code));
      const missing = [...new Set([...ours.keys(), ...(start ? [start] : [])])].filter((c) => !have.has(c));
      const extra = (await Promise.all(missing.map(byCode))).filter((e): e is EventListItem => !!e);
      if (live) setList({ events: [...upcoming.events, ...extra], ours });
    })().catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [season, teamsKey, start, today, retry]);

  useEffect(() => {
    const q = text.trim();
    setHits(null); setSearchFailed(null);
    if (q.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      apiFetch<{ events: EventListItem[] }>(`/api/events${qs({ season, q, all: 1, limit: SEARCH_CAP })}`)
        .then((r) => { if (live) setHits({ q, events: rankEvents(r.events, q).slice(0, PAGE) }); }, () => { if (live) setSearchFailed(q); });
    }, EVENT_SEARCH_DEBOUNCE);
    return () => { live = false; clearTimeout(t); };
  }, [text, season, searchRetry]);

  const rows = useMemo(() => (list ? orderEvents(list.events, today, list.ours) : []), [list, today]);
  const searching = text.trim().length >= 2;
  const results = hits && hits.q === text.trim() ? hits.events : null;
  const visible: EventRow[] = searching
    ? (results ?? []).map((e) => ({ event: e, today: isOnToday(e, today), ours: list?.ours.get(e.code) ?? [] }))
    : rows.slice(0, shown);
  // The event picked now stays on screen, first, when it isn't among the rows (an event already over).
  const currentEvent = start ? list?.events.find((e) => e.code === start) : undefined;
  if (!searching && currentEvent && !visible.some((r) => r.event.code === start)) {
    visible.unshift({ event: currentEvent, today: isOnToday(currentEvent, today), ours: list?.ours.get(start) ?? [] });
  }

  return (
    <section aria-labelledby={`${searchId}-title`} className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${searchId}-title`} className="text-lg font-semibold text-foreground">Which event are you scouting?</h2>
          <p className="text-sm text-muted-foreground">Pick it once. Scout stays on it until you change it.</p>
        </div>
        {onCancel && <Button variant="outline" onClick={onCancel} className="max-sm:h-11">Back to {start || "the event"}</Button>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={searchId} className="sr-only">Search events</Label>
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id={searchId} type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by event name, city or code" autoComplete="off" className="h-11 pl-9 pr-11" />
          {text && <Button variant="ghost" size="icon" onClick={() => setText("")} aria-label="Clear search" className="absolute right-0.5 top-1/2 -translate-y-1/2"><X /></Button>}
        </div>
        <p role="status" className="sr-only">{searching && results ? (results.length ? `${results.length} ${results.length === 1 ? "event" : "events"} found` : "No events found") : ""}</p>
      </div>

      {!searching && failed && (
        <EmptyState icon={AlertTriangle} title="Couldn’t load events" description="Check your connection, or search for the event above."
          action={<Button variant="secondary" onClick={() => setRetry((n) => n + 1)}><RefreshCw /> Try again</Button>} />
      )}
      {!searching && !list && !failed && <div role="status" aria-label="Loading events" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((k) => <Skeleton key={k} className="h-40 rounded-xl" />)}</div>}
      {!searching && list && !visible.length && <EmptyState icon={CalendarDays} title={`No ${season} events coming up`} description="Search for the event you’re at." />}
      {searching && searchFailed === text.trim() && (
        <EmptyState icon={AlertTriangle} title="Couldn’t search events" action={<Button variant="secondary" onClick={() => setSearchRetry((n) => n + 1)}><RefreshCw /> Try again</Button>} />
      )}
      {searching && results && !results.length && <EmptyState icon={SearchX} title={`No ${season} event matches “${text.trim()}”`} />}

      {visible.length > 0 && (
        <ul aria-label="Events" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => <EventCard key={r.event.code} row={r} entries={entries} current={r.event.code === start} teamsKnown={!!teamsKey} onPick={onPick} />)}
        </ul>
      )}
      {!searching && rows.length > shown && (
        <div className="flex justify-center"><Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>Show more events</Button></div>
      )}
    </section>
  );
}

function Meter({ label, done, total, empty }: { label: string; done: number; total: number; /** What shows with nothing to count against. */ empty: string }) {
  const pct = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  return (
    <div className="min-w-0">
      <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className={cn("tabular-nums", total > 0 || done ? "text-foreground" : "text-muted-foreground")}>{total > 0 ? `${done} / ${total}` : done ? `${done}` : empty}</span>
      </p>
      {total > 0 && <div aria-hidden className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>}
    </div>
  );
}

function EventCard({ row, entries, current, teamsKnown, onPick }: { row: EventRow; entries: readonly Entry[]; current: boolean; teamsKnown: boolean; onPick: (code: string) => void }) {
  const { event: e, today, ours } = row;
  const pit = pitProgress(entries, e.code, e.teams ?? 0);
  const matches = matchesWithEntries(entries, e.code, e.matchesTotal ?? 0);
  const where = place(e.city, e.state);
  const titleId = useId();
  return (
    <li aria-labelledby={titleId} className={cn("flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4", current ? "border-accent/60" : "border-border")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={titleId} className="font-semibold leading-snug text-foreground">{e.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-mono">{e.code}</span>
            <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" aria-hidden />{dateRange(e.start, e.end)}</span>
            {where && <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden />{where}</span>}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {today && <Badge variant="success">Today</Badge>}
          {current && <Badge variant="soft">Picked</Badge>}
        </div>
      </div>
      {/* With no team on the account there's nothing to say either way. */}
      {teamsKnown && <p className={cn("flex items-center gap-1.5 text-sm", ours.length ? "font-medium text-foreground" : "text-muted-foreground")}>
        <Users className={cn("size-4 shrink-0", ours.length ? "text-accent-text" : "text-muted-foreground")} aria-hidden />
        {ours.length ? `Your team${ours.length > 1 ? "s" : ""} ${ours.join(", ")} ${ours.length > 1 ? "are" : "is"} competing` : "None of your teams are listed here"}
      </p>}
      <div className="grid grid-cols-2 gap-3">
        <Meter label="Pit scouted" done={pit.done} total={pit.total} empty="No team list yet" />
        <Meter label="Matches with entries" done={matches.done} total={matches.total} empty="No schedule yet" />
      </div>
      <Button className="mt-auto w-full max-sm:min-h-11" variant={!current && (today || ours.length > 0) ? "default" : "outline"} onClick={() => onPick(e.code)} aria-label={`Scout ${e.name}`}>
        {current ? "Keep scouting this event" : "Scout this event"} <ArrowRight />
      </Button>
    </li>
  );
}
