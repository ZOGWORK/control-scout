// Events: the season's calendar grouped by week, searchable and filterable.
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, MapPin, Search, X } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import type { EventSummary, EventListItem } from "../shared/api";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Input } from "../components/ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/controls";
import { SeasonToggle } from "../components/SeasonToggle";
import { EventCard } from "./Home";
import { seasonLabel } from "../lib/format";
import { regionLabel, regionNames } from "@/shared/regions";

const weekOf = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
};

export default function EventsPage() {
  const current = useCurrentSeason();
  const [sp, setSp] = useSearchParams();
  const season = Number(sp.get("season")) || current;
  // ?region=USA:NJ (from search's "All events in New Jersey"): kept when the season changes.
  const region = sp.get("region");
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  useTitle(`Events ${seasonLabel(season)}`);
  const state = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season })}`);
  return (
    <div>
      <PageHeader title="Events" description="Every FTC event this season — results, rankings, brackets and advancement odds." >
        <div className="flex flex-wrap items-center gap-3">
          <SeasonToggle value={season} onChange={(s) => setSp({ season: String(s), ...(region ? { region } : {}) })} />
          {region && (
            <button type="button" onClick={() => setSp(sp.get("season") ? { season: sp.get("season")! } : {})} aria-label={`Remove filter: ${regionLabel(region)}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/[0.08] px-3 text-sm text-foreground hover:border-accent">
              <MapPin className="size-4 text-accent" />{regionLabel(region)}<X className="size-3.5 text-muted-foreground" />
            </button>
          )}
          <div className="relative min-w-[14rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, code, city or state" className="h-10 pl-9" aria-label="Filter events" />
          </div>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-10 w-48" aria-label="Event type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="LeagueMeet">League meets</SelectItem>
              <SelectItem value="LeagueTournament">League tournaments</SelectItem>
              <SelectItem value="Qualifier">Qualifiers</SelectItem>
              <SelectItem value="SuperQualifier">Super qualifiers</SelectItem>
              <SelectItem value="Championship">Championships</SelectItem>
              <SelectItem value="Premier">Premier events</SelectItem>
              <SelectItem value="Scrimmage">Scrimmages</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PageHeader>
      <Async state={state} empty={(d) => !d.events.length && <EmptyState icon={CalendarDays} title={`No events listed for ${seasonLabel(season)} yet`} />}>
        {(d) => <Weeks events={d.events} q={q} type={type} region={region} />}
      </Async>
    </div>
  );
}

function Weeks({ events, q, type, region }: { events: EventListItem[]; q: string; type: string; region: string | null }) {
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = events.filter((e) => (type === "all" || e.type === type) && (!region || `${e.country}:${e.state}` === region) && (!needle || `${e.name} ${e.code} ${e.city ?? ""} ${e.state ?? ""} ${e.country ?? ""} ${regionNames(e.state, e.country)}`.toLowerCase().includes(needle)));
    const m = new Map<string, EventListItem[]>();
    for (const e of list) { const w = e.start ? weekOf(e.start) : "TBA"; m.set(w, [...(m.get(w) ?? []), e]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events, q, type, region]);
  const thisWeek = weekOf(new Date().toISOString().slice(0, 10));
  if (!groups.length) return <EmptyState icon={Search} title="No events match" description="Try a different name, code or type." />;
  // Upcoming/current weeks first, then the past (newest first).
  const ordered = [...groups.filter(([w]) => w >= thisWeek), ...groups.filter(([w]) => w < thisWeek).reverse()];
  return (
    <div>
      {ordered.slice(0, 30).map(([w, evs]) => (
        <Section key={w} title={w === "TBA" ? "Date TBA" : w === thisWeek ? "This week" : `Week of ${new Date(`${w}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`} description={`${evs.length} event${evs.length === 1 ? "" : "s"}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{evs.map((e) => <EventCard key={e.code} e={e} />)}</div>
        </Section>
      ))}
      {ordered.length > 30 && <p className="text-center text-sm text-muted-foreground">Showing 30 weeks — filter to narrow down.</p>}
    </div>
  );
}
