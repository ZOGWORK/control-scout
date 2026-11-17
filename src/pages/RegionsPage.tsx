// /rankings/regions: every region with rated teams this season (src/shared/regionRankings.ts), each country with its
// states or provinces, the count of rated teams, the top team and the leagues there, each to its region page.
// Most teams first, then by name; searchable by name; ?season= in the URL.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronRight, MapPin, Search } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { seasonLabel } from "../lib/format";
import { regionHref, type RegionListItem, type RegionsResponse } from "../shared/regionRankings";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Input } from "../components/ui/basic";
import { cn } from "../components/cn";
import { SeasonPick } from "./RankingsPage";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function RegionsPage() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const seasonParam = Number(sp.get("season")) || null;
  const [q, setQ] = useState("");
  const state = useApi<RegionsResponse>(`/api/rankings/regions${qs({ season: seasonParam })}`);
  const season = state.data?.season ?? seasonParam ?? current;
  const myTeam = usePersonal().state.myTeam;
  useTitle(`FTC rankings by region ${seasonLabel(season)}`);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="text-accent-text"><Link to={`/rankings${qs({ season: seasonParam })}`} className="hover:underline">World rankings</Link> · {seasonLabel(season)}</span>}
        title="Rankings by region"
        description="Every country, state and province with rated FTC teams. Open one for its table: rank, record, OPR, events and this week's moves."
        phoneDescription="Pick a region for its rankings table."
      >
        <div className="flex flex-wrap items-center gap-2">
          <SeasonPick value={season} onChange={(s) => { const n = new URLSearchParams(sp); n.set("season", String(s)); setSp(n); }} />
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="New Jersey, Texas, Romania…" aria-label="Search regions" className="h-9 pl-8 max-sm:h-10" />
          </div>
        </div>
      </PageHeader>
      <p className="text-sm text-text-muted">Ratings are only comparable inside one season.</p>
      <Async state={state}>
        {(d) => <RegionList d={d} q={q} myTeam={myTeam} />}
      </Async>
    </div>
  );
}

function RegionList({ d, q, myTeam }: { d: RegionsResponse; q: string; myTeam: number | null }) {
  if (!d.regions.length) return <EmptyState icon={MapPin} title={`No team is rated yet in ${seasonLabel(d.season)}`} description="A team is ranked after its third rated match. Regions fill in as the season's first qualifiers and league meets are played." />;
  const f = fold(q.trim());
  const countries = d.regions.filter((r) => !r.state);
  const states = (c: string) => d.regions.filter((r) => r.state && r.country === c);
  const hit = (r: RegionListItem) => !f || fold(r.name).includes(f) || (r.state ?? "").toLowerCase() === f;
  const shown = countries.flatMap((c) => {
    const kids = states(c.country).filter(hit);
    return hit(c) || kids.length ? [{ c, kids: hit(c) && !f ? states(c.country) : kids }] : [];
  });
  if (!shown.length) return <EmptyState icon={Search} title="No region by that name" description={`None of the ${d.regions.length.toLocaleString()} regions with rated teams matches “${q.trim()}”.`} />;
  return (
    <div className="space-y-4" data-regions>
      {shown.map(({ c, kids }) => (
        <section key={c.key} aria-label={c.name} className="overflow-hidden rounded-xl border border-text-base/15 bg-card">
          <Row r={c} season={d.season} myTeam={myTeam} country />
          {kids.length > 0 && <ul className="border-t border-text-base/10">{kids.map((s) => <li key={s.key} className="border-b border-text-base/10 last:border-b-0"><Row r={s} season={d.season} myTeam={myTeam} /></li>)}</ul>}
        </section>
      ))}
    </div>
  );
}

function Row({ r, season, myTeam, country }: { r: RegionListItem; season: number; myTeam: number | null; country?: boolean }) {
  return (
    <Link to={regionHref(r.key, { season })} data-region={r.key}
      className={cn("flex items-center gap-3 px-3 py-2.5 hover:bg-text-base/[0.04] pointer-coarse:min-h-[44px]", country ? "bg-text-base/[0.02]" : "pl-6")}>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", country ? "font-display text-base font-semibold" : "text-sm font-medium")}>{r.name}</span>
        <span className="block truncate text-xs text-text-muted">
          #1 <span className={cn("font-mono tabular-nums", r.top.team === myTeam && "font-semibold text-accent-text")}>{r.top.team}</span> {r.top.name ?? ""} · {r.top.rating.toFixed(1)}
          {r.leagues ? ` · ${r.leagues} league${r.leagues === 1 ? "" : "s"}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right text-sm tabular-nums"><span className="font-semibold">{r.teams.toLocaleString()}</span><span className="block text-[11px] text-text-muted">rated</span></span>
      <ChevronRight className="size-4 shrink-0 text-text-muted" aria-hidden />
    </Link>
  );
}
