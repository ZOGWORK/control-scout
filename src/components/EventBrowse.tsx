// The Events list's parts, shared by the Events page and Scout's event picker: the filter bar (season, place,
// event type, dates, video, text and status) and the list of event cards by week. The picker gives each card
// a Scout button under it (`tileAction`); on the Events page a card is one link to the event.
import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, ChevronDown, MapPin, MonitorPlay, Search, Users, X } from "lucide-react";
import type { EventListItem } from "../shared/api";
import { EmptyState } from "./page";
import { Input } from "./ui/basic";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/overlay";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/controls";
import { dateRangeText, DateRangePicker, SeasonSelect } from "./records/Controls";
import { CompactFilters, FilterSection, useCompactFilters, type FilterChip } from "./CompactFilters";
import { cn } from "./cn";
import { EVENT_FILTER_COUNT, EVENT_TYPE_TONE } from "../lib/textTones";
import { EventStatusChip, LiveDot } from "./EventChips";
import { dateRange, place } from "../lib/format";
import { eventTypeLabel } from "../shared/labels";
import { regionLabel, regionNames } from "../shared/regions";
import { applyFilters, FIRST_EVENTS, groupWeeks, MORE_EVENTS, placeKey, takeBatch, weekOf, type Filters, type Status } from "../pages/eventsList";

const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
// Formatters made once (toLocaleDateString builds a new one on every call).
const DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const DAY_YEAR = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const fmtDay = (d: string, year = false) => (year ? DAY_YEAR : DAY).format(new Date(`${d}T00:00:00Z`));

const placeName = (key: string) => (key.includes(":") ? regionLabel(key) : key);

const toneOfType = (t: string | null) => EVENT_TYPE_TONE[t ?? ""] ?? { bar: "bg-text-base/25", text: "text-muted-foreground" };


const STATUS: { v: Status; label: string; dot: string }[] = [
  { v: "all", label: "All", dot: "bg-text-base/40" },
  { v: "live", label: "Live now", dot: "bg-danger animate-pulse" },
  { v: "upcoming", label: "Upcoming", dot: "bg-sky-400" },
  { v: "finished", label: "Finished", dot: "bg-emerald-400" },
];
const VIDEO_LABEL: Record<"recording" | "clips", string> = { recording: "Has a recording", clips: "Match clips" };

/** A card's own action, under its link (Scout's picker), and whether to ring the card (the event picked now). */
export type TileAction = (e: EventListItem) => { node: ReactNode; ring?: boolean };

export function EventFilterBar({ season, onSeason, events, region, type, status, from, to, q, video = "all", listQ, onQ, set, active, onClear }: Filters & {
  season: number; onSeason: (s: number) => void; events: EventListItem[]; active: boolean;
  /** The text the list is filtered by (deferred behind the box's own `q`). */
  listQ: string; onQ: (q: string, replace?: boolean) => void; onClear: () => void;
  set: (patch: Record<string, string | null>, replace?: boolean) => void;
}) {
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) if (e.type) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);
  // Status counts follow the other filters, so each chip says what tapping it shows.
  const base = useMemo(() => applyFilters(events, { region, type, from, to, q: listQ, video }), [events, region, type, from, to, listQ, video]);
  const counts = { all: base.length, live: 0, upcoming: 0, finished: 0 } as Record<Status, number>;
  for (const e of base) counts[e.status]++;
  const compact = useCompactFilters();
  const place = <PlacePicker events={events} value={region} onChange={(r) => set({ region: r }, false)} />;
  const typePicker = (
    <Select value={type} onValueChange={(v) => set({ type: v }, false)}>
      <SelectTrigger className={cn("h-9 w-auto gap-2 rounded-lg px-3 font-medium max-sm:h-10", type !== "all" ? "border-accent/60 bg-accent/[0.08]" : "border-line bg-card")} aria-label="Event type"><SelectValue /></SelectTrigger>
      <SelectContent className="min-w-[14rem]">
        <SelectItem value="all">All event types</SelectItem>
        {types.map(([t, n]) => <SelectItem key={t} value={t}><span className="inline-flex items-center gap-2"><span className={cn("size-2 rounded-full", toneOfType(t).bar)} />{eventTypeLabel(t)} <span className="text-muted-foreground">{n}</span></span></SelectItem>)}
      </SelectContent>
    </Select>
  );
  const videoCounts = { recording: 0, clips: 0 };
  for (const e of events) { if (e.video) videoCounts.recording++; if (e.video === "clips") videoCounts.clips++; }
  const videoPicker = (
    <Select value={video} onValueChange={(v) => set({ video: v }, false)}>
      <SelectTrigger className={cn("h-9 w-auto gap-2 rounded-lg px-3 font-medium max-sm:h-10", video !== "all" ? "border-accent/60 bg-accent/[0.08]" : "border-line bg-card")} aria-label="Video"><SelectValue /></SelectTrigger>
      <SelectContent className="min-w-[14rem]">
        <SelectItem value="all">Any video</SelectItem>
        <SelectItem value="recording"><span className="inline-flex items-center gap-2"><MonitorPlay className="size-4 text-video" />Has a recording <span className="text-muted-foreground">{videoCounts.recording}</span></span></SelectItem>
        <SelectItem value="clips"><span className="inline-flex items-center gap-2"><MonitorPlay className="size-4 text-video" />Match clips <span className="text-muted-foreground">{videoCounts.clips}</span></span></SelectItem>
      </SelectContent>
    </Select>
  );
  const dates = <DateRangePicker from={from} to={to} onChange={(a, b) => set({ from: a, to: b }, false)} />;
  const search = (
    <div className="relative min-w-[12rem] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={q} onChange={(e) => onQ(e.target.value)} placeholder="Name, code, city or state" className="h-9 pl-9 max-sm:h-10" aria-label="Filter events" />
    </div>
  );
  const statusChips = STATUS.map((s) => (
    <button key={s.v} type="button" aria-pressed={status === s.v} onClick={() => set({ status: s.v }, false)}
      className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors max-sm:h-10",
        status === s.v ? "border-accent bg-accent text-accent-ink" : "border-line text-muted-foreground hover:border-text-base/25 hover:text-foreground")}>
      <span className={cn("size-1.5 rounded-full", status === s.v ? "bg-accent-ink" : s.dot)} />{s.label}<span className={EVENT_FILTER_COUNT}>{counts[s.v]}</span>
    </button>
  ));

  if (compact) {
    const chips: FilterChip[] = [];
    if (region) chips.push({ id: "region", label: <><MapPin className="inline size-3.5 text-sky-500" aria-hidden /> {placeName(region)}</>, name: `Place: ${placeName(region)}`, onRemove: () => set({ region: null }, false) });
    if (type !== "all") chips.push({ id: "type", label: eventTypeLabel(type), name: `Event type: ${eventTypeLabel(type)}`, onRemove: () => set({ type: null }, false) });
    if (from || to) chips.push({ id: "dates", label: dateRangeText(from, to), name: `Dates: ${dateRangeText(from, to)}`, onRemove: () => set({ from: null, to: null }, false) });
    if (video !== "all") chips.push({ id: "video", label: <><MonitorPlay className="inline size-3.5 text-video" aria-hidden /> {VIDEO_LABEL[video]}</>, name: `Video: ${VIDEO_LABEL[video]}`, onRemove: () => set({ video: null }, false) });
    if (status !== "all") { const s = STATUS.find((x) => x.v === status)!; chips.push({ id: "status", label: s.label, name: `Status: ${s.label}`, onRemove: () => set({ status: null }, false) }); }
    if (q.trim()) chips.push({ id: "q", label: <><Search className="inline size-3.5" aria-hidden /> {q.trim()}</>, name: `Text: ${q.trim()}`, onRemove: () => onQ("", false) });
    const n = counts[status];
    return (
      <CompactFilters className="mb-4" lead={<SeasonSelect value={season} onChange={onSeason} />} chips={chips}
        summary={`${n.toLocaleString()} ${n === 1 ? "event" : "events"}`} doneLabel={`Show ${n.toLocaleString()} ${n === 1 ? "event" : "events"}`} onClearAll={onClear}>
        <FilterSection label="Search">{search}</FilterSection>
        <FilterSection label="Status">{statusChips}</FilterSection>
        <FilterSection label="Where, what and when">{place}{typePicker}{dates}</FilterSection>
        <FilterSection label="Video">{videoPicker}</FilterSection>
      </CompactFilters>
    );
  }
  return (
    <div className="mb-8 max-sm:mb-5 space-y-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeasonSelect value={season} onChange={onSeason} />
        {place}
        {typePicker}
        {dates}
        {videoPicker}
        {search}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {statusChips}
        {active && (
          <Button variant="ghost" size="sm" className="ml-auto text-danger hover:text-danger max-sm:h-10" onClick={onClear}><X /> Clear filters</Button>
        )}
      </div>
    </div>
  );
}

/** Place filter: every state / province / country with events this season, by full name, searchable. */
function PlacePicker({ events, value, onChange }: { events: EventListItem[]; value: string | null; onChange: (k: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const places = useMemo(() => {
    const m = new Map<string, { key: string; name: string; country: string; n: number }>();
    for (const e of events) {
      const k = placeKey(e);
      if (!k) continue;
      const cur = m.get(k);
      if (cur) cur.n++; else m.set(k, { key: k, name: placeName(k), country: e.country ?? "", n: 1 });
    }
    return [...m.values()];
  }, [events]);
  const f = q.trim().toLowerCase();
  const shown = !open ? [] : places // the list is only built while it's open
    .filter((p) => !f || `${p.name} ${p.key} ${regionNames(p.key.split(":")[1], p.country)}`.toLowerCase().includes(f))
    .sort((a, b) => (a.country === "USA" ? 0 : 1) - (b.country === "USA" ? 0 : 1) || a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  const label = value ? placeName(value) : "Everywhere";
  let lastCountry = "";
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <span className={cn("inline-flex h-9 max-w-full items-center rounded-lg border text-sm font-medium max-sm:h-10", value ? "border-accent/60 bg-accent/[0.08]" : "border-line bg-card hover:border-text-base/25")}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`Place: ${label}`} className="inline-flex h-full min-w-0 items-center gap-2 rounded-lg px-3">
            <MapPin className="size-4 text-sky-500" /><span className="max-w-[12rem] truncate">{label}</span>
            {!value && <ChevronDown className="size-4 opacity-60" />}
          </button>
        </PopoverTrigger>
        {value && (
          <button type="button" onClick={() => onChange(null)} aria-label={`Remove filter: ${label}`} className="-ml-1 mr-1 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-text-base/[0.08] hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </span>
      {/* A fixed height wherever the Filters sheet is used (under 768px): there the popover counts toward the sheet's scroll height, so a
          list that shrank with each letter typed pulled the sheet back to its top, out from under the box. */}
      <PopoverContent align="start" className="flex max-h-[min(28rem,70dvh)] w-[min(92vw,20rem)] flex-col gap-2 p-2 max-md:h-[min(22rem,50dvh)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="New Jersey, Ontario, Mexico…" aria-label="Search places" className="h-9 pl-8 max-sm:h-10" autoFocus />
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto" role="listbox" aria-label="Places">
          <PlaceRow on={!value} name="Everywhere" n={events.length} onClick={() => { onChange(null); setOpen(false); }} />
          {shown.map((p) => {
            const head = p.key.includes(":") && p.country !== lastCountry ? p.country : null;
            lastCountry = p.country;
            return (
              <div key={p.key}>
                {head && <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{head === "USA" ? "United States" : head}</p>}
                <PlaceRow on={value === p.key} name={p.name} n={p.n} onClick={() => { onChange(p.key); setOpen(false); }} />
              </div>
            );
          })}
          {!shown.length && <p className="px-2 py-4 text-center text-sm text-muted-foreground">No place matches.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PlaceRow({ on, name, n, onClick }: { on: boolean; name: string; n: number; onClick: () => void }) {
  return (
    <button type="button" role="option" aria-selected={on} onClick={onClick} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-text-base/[0.06] max-sm:py-2.5", on && "bg-accent/[0.08]")}>
      <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
      {on && <Check className="size-4 text-accent" />}
    </button>
  );
}

// The list renders a bounded first batch (FIRST_EVENTS cards) and adds MORE_EVENTS each time the
// end of the list nears the screen, or on "Show more". Memoised, so typing in the filter box
// re-renders the box alone and the cards follow on the deferred text.
export const EventWeeks = memo(function EventWeeks({ events, region, type, status, from, to, q, video, onClear, tileAction }: { events: EventListItem[]; onClear: () => void; tileAction?: TileAction } & Filters) {
  const list = useMemo(() => applyFilters(events, { region, type, from, to, q, video }).filter((e) => status === "all" || e.status === status), [events, region, type, status, from, to, q, video]);
  // The budget belongs to one result list: new filters start from the first batch again, in the same render.
  const [page, setPage] = useState({ list, n: FIRST_EVENTS });
  const budget = page.list === list ? page.n : FIRST_EVENTS;
  // A transition, so scrolling and typing stay responsive while the next batch renders.
  const more = useCallback(() => startTransition(() => setPage((p) => ({ list, n: (p.list === list ? p.n : FIRST_EVENTS) + MORE_EVENTS }))), [list]);
  const thisWeek = weekOf(new Date().toISOString().slice(0, 10));
  const weeks = useMemo(() => groupWeeks(list, thisWeek), [list, thisWeek]);
  const { shown, hidden } = useMemo(() => takeBatch(weeks, budget), [weeks, budget]);
  // Load the next batch while the end of the list is still a screen away (the page scrolls the document).
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || hidden <= 0 || typeof IntersectionObserver === "undefined") return;
    // Re-observed after every batch: if the end is still near (a tall screen), the next batch follows.
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) more(); }, { rootMargin: "0px 0px 800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, hidden, more]);
  if (!weeks.length) return <EmptyState icon={Search} title="No events match" description="Try another place, type or date range." action={<Button onClick={onClear}><X /> Clear filters</Button>} />;
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground max-md:mb-2"><span className="font-semibold tabular-nums text-foreground">{list.length.toLocaleString()}</span> events in {weeks.length} week{weeks.length === 1 ? "" : "s"}</p>
      <div className="space-y-8 max-sm:space-y-5">
        {shown.map(([w, evs, all]) => (
          <section key={w} aria-label={w === "TBA" ? "Date to be announced" : `Week of ${fmtDay(w, true)}`}>
            <div className="mb-3 flex items-baseline gap-3 border-b border-border pb-2">
              <h2 className="font-display text-lg font-semibold">{w === "TBA" ? "Date TBA" : `${fmtDay(w)} – ${fmtDay(addDays(w, 6), true)}`}</h2>
              {w === thisWeek && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">This week</span>}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{all} event{all === 1 ? "" : "s"}</span>
            </div>
            {tileAction
              ? <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{evs.map((e) => <EventTile key={e.code} e={e} action={tileAction} />)}</ul>
              : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{evs.map((e) => <EventTile key={e.code} e={e} />)}</div>}
          </section>
        ))}
      </div>
      {hidden > 0 && (
        <div ref={sentinel} className="mt-8 max-sm:mt-5 text-center">
          <Button variant="outline" onClick={more}>Show more events <span className="text-muted-foreground">({hidden.toLocaleString()} more)</span></Button>
        </div>
      )}
    </div>
  );
});

const EventTile = memo(function EventTile({ e, action }: { e: EventListItem; action?: TileAction }) {
  const href = `/events/${e.season}/${e.code}`;
  const bar = <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", toneOfType(e.type).bar)} />;
  if (!action) return <Link to={href} className="lift group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-4 pl-5">{bar}<TileBody e={e} /></Link>;
  // With an action the card is a list item: the link to the event on top, the action (a button) under it, never inside it.
  const { node, ring } = action(e);
  return (
    <li aria-label={e.name} className={cn("lift relative flex h-full flex-col overflow-hidden rounded-xl border bg-card", ring ? "border-accent/70" : "border-border")}>
      {bar}
      <Link to={href} className="group flex flex-1 flex-col p-4 pb-3 pl-5"><TileBody e={e} /></Link>
      <div className="px-4 pb-4 pl-5">{node}</div>
    </li>
  );
});

function TileBody({ e }: { e: EventListItem }) {
  const tone = toneOfType(e.type);
  // A finished event fills its bar even with results missing; the count still says how many were posted.
  const played = e.matchesTotal ? Math.round((e.matchesPlayed / e.matchesTotal) * 100) : 0;
  return (
    <>
      <div className="flex items-center gap-2 text-xs">
        <EventStatusChip status={e.status} className="px-2 py-0.5" />
        <span className={cn("truncate font-semibold", tone.text)}>{e.typeLabel}</span>
        {/* On now with a stream to watch on its page (Watch live). */}
        {e.status === "live" && e.stream && <span className="inline-flex shrink-0 items-center gap-1 font-bold text-danger" title="Live stream on the event page" data-stream-live><LiveDot />LIVE<span className="sr-only"> stream</span></span>}
        {/* Finished with something to watch: the recording, or matches that link to their own second in it. */}
        {e.status === "finished" && e.video && <span className="inline-flex shrink-0 items-center gap-1 font-semibold text-video" title={e.video === "clips" ? "Recording with a Watch button on each match" : "Recording on the event page"} data-video={e.video}><MonitorPlay className="size-3.5" aria-hidden />{e.video === "clips" ? "Clips" : "Video"}</span>}
        {e.teams > 0 && <span className="ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground"><Users className="size-3.5" />{e.teams}</span>}
      </div>
      <p className="mt-2 line-clamp-2 font-medium leading-snug group-hover:text-accent-text">{e.name}</p>
      <div className="mt-auto space-y-1 pt-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5"><CalendarDays className="size-3.5 shrink-0" />{dateRange(e.start, e.end)}</p>
        <p className="flex items-center gap-1.5 truncate"><MapPin className="size-3.5 shrink-0" />{place(e.city, e.state ? regionLabel(`${e.country}:${e.state}`) : null, e.country === "USA" ? null : e.country) || "Location TBA"}</p>
      </div>
      {e.matchesPlayed > 0 && e.status !== "upcoming" ? (
        <div className="mt-3 flex items-center gap-2" title={`${e.matchesPlayed} of ${e.matchesTotal} matches played`} data-match-bar>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", e.status === "live" ? "bg-danger" : "bg-success")} style={{ width: `${e.status === "finished" ? 100 : played}%` }} /></div>
          <span className="text-[11px] tabular-nums text-muted-foreground">{e.matchesPlayed}/{e.matchesTotal}</span>
        </div>
      ) : e.status === "finished" ? (
        // Finished with no results posted (most scrimmages, some meets): still a full bar, so every finished card reads as done.
        <div className="mt-3 flex items-center gap-2" title="Finished; no match results posted" data-match-bar>
          <div className="h-1 flex-1 rounded-full bg-success" />
          <span className="text-[11px] text-muted-foreground">Done</span>
        </div>
      ) : e.status === "live" && e.matchesTotal > 0 && (
        <div className="mt-3 flex items-center gap-2" title={`0 of ${e.matchesTotal} matches played`} data-match-bar>
          <div className="h-1 flex-1 rounded-full bg-muted" />
          <span className="text-[11px] tabular-nums text-muted-foreground">0/{e.matchesTotal}</span>
        </div>
      )}
    </>
  );
}
