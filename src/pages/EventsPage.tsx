// Events: a season's calendar grouped by week, with one filter bar — season,
// place (full names: "New Jersey", not "NJ"), event type, dates, status and
// text — all kept in the URL so a filtered list can be shared or bookmarked
// (search links here with ?region=USA:NJ).
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarDays, Check, ChevronDown, MapPin, Radio, Search, Users, X } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import type { EventListItem } from "../shared/api";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Input } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/overlay";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/controls";
import { DateRangePicker, SeasonSelect } from "../components/records/Controls";
import { cn } from "../components/cn";
import { dateRange, place, seasonLabel } from "../lib/format";
import { eventTypeLabel } from "../shared/labels";
import { regionLabel, regionNames } from "@/shared/regions";

const weekOf = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const fmtDay = (d: string, year = false) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });

/** A place key: "USA:NJ" (country:state) or a country alone ("Mexico"). */
const placeKey = (e: Pick<EventListItem, "country" | "state">) => (e.country ? (e.state ? `${e.country}:${e.state}` : e.country) : "");
const placeMatches = (e: EventListItem, key: string) => (key.includes(":") ? `${e.country}:${e.state}` === key : e.country === key);
const placeName = (key: string) => (key.includes(":") ? regionLabel(key) : key);

/** Colour per event type: the stripe on each card and the type label. */
const TYPE_TONE: Record<string, { bar: string; text: string }> = {
  Qualifier: { bar: "bg-violet-500", text: "text-violet-600 dark:text-violet-400" },
  LeagueMeet: { bar: "bg-sky-400", text: "text-sky-600 dark:text-sky-400" },
  LeagueTournament: { bar: "bg-blue-500", text: "text-blue-600 dark:text-blue-400" },
  SuperQualifier: { bar: "bg-orange-400", text: "text-orange-600 dark:text-orange-400" },
  Championship: { bar: "bg-accent", text: "text-accent-text" },
  FIRSTChampionship: { bar: "bg-accent", text: "text-accent-text" },
  Premier: { bar: "bg-pink-400", text: "text-pink-600 dark:text-pink-400" },
};
const toneOfType = (t: string | null) => TYPE_TONE[t ?? ""] ?? { bar: "bg-text-base/25", text: "text-muted-foreground" };

type Status = "all" | "live" | "upcoming" | "finished";
const STATUS: { v: Status; label: string; dot: string }[] = [
  { v: "all", label: "All", dot: "bg-text-base/40" },
  { v: "live", label: "Live now", dot: "bg-red-500 animate-pulse" },
  { v: "upcoming", label: "Upcoming", dot: "bg-sky-400" },
  { v: "finished", label: "Finished", dot: "bg-emerald-400" },
];

export default function EventsPage() {
  const current = useCurrentSeason();
  const [sp, setSp] = useSearchParams();
  const season = Number(sp.get("season")) || current;
  const region = sp.get("region");
  const type = sp.get("type") ?? "all";
  const status = (["live", "upcoming", "finished"].includes(sp.get("status") ?? "") ? sp.get("status") : "all") as Status;
  const from = sp.get("from"), to = sp.get("to");
  const q = sp.get("q") ?? "";
  // One place for URL edits: empty values drop out, history isn't flooded while typing.
  const set = (patch: Record<string, string | null>, replace = true) => setSp((x) => {
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "" || v === "all") x.delete(k); else x.set(k, v); }
    return x;
  }, { replace });
  useTitle(`Events ${seasonLabel(season)}`);
  const state = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season })}`);
  const active = !!(region || type !== "all" || status !== "all" || from || to || q);
  return (
    <div>
      <PageHeader
        eyebrow={<span className="text-accent-text">{seasonLabel(season)} season</span>}
        title="Events"
        description="Every FTC event — results, rankings, brackets and advancement odds. Filter by place, type and dates."
        actions={<Button variant="outline" size="sm" asChild><Link to={`/teams${season !== current ? `?season=${season}` : ""}`}><Users /> Team records <ArrowRight /></Link></Button>}
      />
      <Async state={state} empty={(d) => !d.events.length && (
        <>
          <FilterBar season={season} onSeason={(s) => set({ season: String(s), from: null, to: null }, false)} events={[]} {...{ region, type, status, from, to, q, set, active }} />
          <EmptyState icon={CalendarDays} title={`No events listed for ${seasonLabel(season)} yet`} />
        </>
      )}>
        {(d) => (
          <>
            <FilterBar season={season} onSeason={(s) => set({ season: String(s), from: null, to: null }, false)} events={d.events} {...{ region, type, status, from, to, q, set, active }} />
            <Weeks events={d.events} {...{ region, type, status, from, to, q }} onClear={() => set({ region: null, type: null, status: null, from: null, to: null, q: null }, false)} />
          </>
        )}
      </Async>
    </div>
  );
}

interface Filters { region: string | null; type: string; status: Status; from: string | null; to: string | null; q: string }

function applyFilters(events: EventListItem[], f: Omit<Filters, "status">): EventListItem[] {
  const needle = f.q.trim().toLowerCase();
  return events.filter((e) =>
    (f.type === "all" || e.type === f.type)
    && (!f.region || placeMatches(e, f.region))
    && (!f.from || (e.end ?? e.start ?? "") >= f.from)
    && (!f.to || (!!e.start && e.start <= f.to))
    && (!needle || `${e.name} ${e.code} ${e.city ?? ""} ${e.state ?? ""} ${e.country ?? ""} ${regionNames(e.state, e.country)}`.toLowerCase().includes(needle)));
}

function FilterBar({ season, onSeason, events, region, type, status, from, to, q, set, active }: Filters & {
  season: number; onSeason: (s: number) => void; events: EventListItem[]; active: boolean;
  set: (patch: Record<string, string | null>, replace?: boolean) => void;
}) {
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of events) if (e.type) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);
  // Status counts follow the other filters, so each chip says what tapping it shows.
  const base = useMemo(() => applyFilters(events, { region, type, from, to, q }), [events, region, type, from, to, q]);
  const counts = { all: base.length, live: 0, upcoming: 0, finished: 0 } as Record<Status, number>;
  for (const e of base) counts[e.status]++;
  return (
    <div className="mb-8 space-y-3 rounded-2xl border border-border bg-card p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SeasonSelect value={season} onChange={onSeason} />
        <PlacePicker events={events} value={region} onChange={(r) => set({ region: r }, false)} />
        <Select value={type} onValueChange={(v) => set({ type: v }, false)}>
          <SelectTrigger className={cn("h-9 w-auto gap-2 rounded-lg px-3 font-medium max-sm:h-11", type !== "all" ? "border-accent/60 bg-accent/[0.08]" : "border-line bg-card")} aria-label="Event type"><SelectValue /></SelectTrigger>
          <SelectContent className="min-w-[14rem]">
            <SelectItem value="all">All event types</SelectItem>
            {types.map(([t, n]) => <SelectItem key={t} value={t}><span className="inline-flex items-center gap-2"><span className={cn("size-2 rounded-full", toneOfType(t).bar)} />{eventTypeLabel(t)} <span className="text-muted-foreground">{n}</span></span></SelectItem>)}
          </SelectContent>
        </Select>
        <DateRangePicker from={from} to={to} onChange={(a, b) => set({ from: a, to: b }, false)} />
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => set({ q: e.target.value })} placeholder="Name, code, city or state" className="h-9 pl-9 max-sm:h-11" aria-label="Filter events" />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {STATUS.map((s) => (
          <button key={s.v} type="button" aria-pressed={status === s.v} onClick={() => set({ status: s.v }, false)}
            className={cn("inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors max-sm:h-10",
              status === s.v ? "border-accent bg-accent text-accent-ink" : "border-line text-muted-foreground hover:border-text-base/25 hover:text-foreground")}>
            <span className={cn("size-1.5 rounded-full", status === s.v ? "bg-accent-ink" : s.dot)} />{s.label}<span className="tabular-nums opacity-70">{counts[s.v]}</span>
          </button>
        ))}
        {active && (
          <Button variant="ghost" size="sm" className="ml-auto text-danger hover:text-danger max-sm:h-10" onClick={() => set({ region: null, type: null, status: null, from: null, to: null, q: null }, false)}><X /> Clear filters</Button>
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
  const shown = places
    .filter((p) => !f || `${p.name} ${p.key} ${regionNames(p.key.split(":")[1], p.country)}`.toLowerCase().includes(f))
    .sort((a, b) => (a.country === "USA" ? 0 : 1) - (b.country === "USA" ? 0 : 1) || a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  const label = value ? placeName(value) : "Everywhere";
  let lastCountry = "";
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={`Place: ${label}`}
          className={cn("inline-flex h-9 max-w-full items-center gap-2 rounded-lg border px-3 text-sm font-medium max-sm:h-11", value ? "border-accent/60 bg-accent/[0.08]" : "border-line bg-card hover:border-text-base/25")}>
          <MapPin className="size-4 text-sky-500" /><span className="max-w-[12rem] truncate">{label}</span>
          {value ? <X className="size-3.5 text-muted-foreground" onClick={(e) => { e.stopPropagation(); e.preventDefault(); onChange(null); }} aria-label={`Remove filter: ${label}`} /> : <ChevronDown className="size-4 opacity-60" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-[min(28rem,70dvh)] w-[min(92vw,20rem)] flex-col gap-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="New Jersey, Ontario, Mexico…" aria-label="Search places" className="h-9 pl-8 max-sm:h-11" autoFocus />
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
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
      {on && <Check className="size-4 text-accent" />}
    </button>
  );
}

/** Events shown at first and per "Show more" (a busy week has a hundred; the page stays light on a phone). */
const PAGE_EVENTS = 60;

function Weeks({ events, region, type, status, from, to, q, onClear }: { events: EventListItem[]; onClear: () => void } & Filters) {
  const [budget, setBudget] = useState(PAGE_EVENTS);
  const list = useMemo(() => applyFilters(events, { region, type, from, to, q }).filter((e) => status === "all" || e.status === status), [events, region, type, status, from, to, q]);
  useEffect(() => setBudget(PAGE_EVENTS), [list]); // new filters start from the top again
  const groups = useMemo(() => {
    const m = new Map<string, EventListItem[]>();
    for (const e of list) { const w = e.start ? weekOf(e.start) : "TBA"; m.set(w, [...(m.get(w) ?? []), e]); }
    for (const evs of m.values()) evs.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [list]);
  const thisWeek = weekOf(new Date().toISOString().slice(0, 10));
  if (!groups.length) return <EmptyState icon={Search} title="No events match" description="Try another place, type or date range." action={<Button onClick={onClear}><X /> Clear filters</Button>} />;
  // Current and upcoming weeks first, then the past (newest first).
  const ordered = [...groups.filter(([w]) => w >= thisWeek), ...groups.filter(([w]) => w < thisWeek).reverse()];
  // Whole weeks in order, the last one cut at the budget.
  const shown: [string, EventListItem[], number][] = [];
  let left = budget;
  for (const [w, evs] of ordered) { if (left <= 0) break; shown.push([w, evs.slice(0, left), evs.length]); left -= evs.length; }
  const hidden = list.length - shown.reduce((a, [, evs]) => a + evs.length, 0);
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground"><span className="font-semibold tabular-nums text-foreground">{list.length.toLocaleString()}</span> events in {groups.length} week{groups.length === 1 ? "" : "s"}</p>
      <div className="space-y-8">
        {shown.map(([w, evs, all]) => (
          <section key={w} aria-label={w === "TBA" ? "Date to be announced" : `Week of ${fmtDay(w, true)}`}>
            <div className="mb-3 flex items-baseline gap-3 border-b border-border pb-2">
              <h2 className="font-display text-lg font-semibold">{w === "TBA" ? "Date TBA" : `${fmtDay(w)} – ${fmtDay(addDays(w, 6), true)}`}</h2>
              {w === thisWeek && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">This week</span>}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{all} event{all === 1 ? "" : "s"}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{evs.map((e) => <EventTile key={e.code} e={e} />)}</div>
          </section>
        ))}
      </div>
      {hidden > 0 && (
        <div className="mt-8 text-center">
          <Button variant="outline" onClick={() => setBudget((n) => n + PAGE_EVENTS)}>Show more events <span className="text-muted-foreground">({hidden.toLocaleString()} more)</span></Button>
        </div>
      )}
    </div>
  );
}

function EventTile({ e }: { e: EventListItem }) {
  const tone = toneOfType(e.type);
  const played = e.matchesTotal ? Math.round((e.matchesPlayed / e.matchesTotal) * 100) : 0;
  return (
    <Link to={`/events/${e.season}/${e.code}`} className="lift group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-4 pl-5">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} />
      <div className="flex items-center gap-2 text-xs">
        {e.status === "live"
          ? <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 font-bold text-red-500"><Radio className="size-3" /> Live</span>
          : e.status === "upcoming"
            ? <span className="rounded-full bg-sky-400/15 px-2 py-0.5 font-semibold text-sky-600 dark:text-sky-400">Upcoming</span>
            : <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 font-semibold text-emerald-600 dark:text-emerald-400">Finished</span>}
        <span className={cn("truncate font-semibold", tone.text)}>{e.typeLabel}</span>
        {e.teams > 0 && <span className="ml-auto inline-flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground"><Users className="size-3.5" />{e.teams}</span>}
      </div>
      <p className="mt-2 line-clamp-2 font-medium leading-snug group-hover:text-accent">{e.name}</p>
      <div className="mt-auto space-y-1 pt-3 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5"><CalendarDays className="size-3.5 shrink-0" />{dateRange(e.start, e.end)}</p>
        <p className="flex items-center gap-1.5 truncate"><MapPin className="size-3.5 shrink-0" />{place(e.city, e.state ? regionLabel(`${e.country}:${e.state}`) : null, e.country === "USA" ? null : e.country) || "Location TBA"}</p>
      </div>
      {e.matchesTotal > 0 && e.status !== "upcoming" && (
        <div className="mt-3 flex items-center gap-2" title={`${e.matchesPlayed} of ${e.matchesTotal} matches played`}>
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", e.status === "live" ? "bg-red-500" : "bg-emerald-400")} style={{ width: `${played}%` }} /></div>
          <span className="text-[11px] tabular-nums text-muted-foreground">{e.matchesPlayed}/{e.matchesTotal}</span>
        </div>
      )}
    </Link>
  );
}
