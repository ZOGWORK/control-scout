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
import { RankingsTabs, V8_CAPTION, V8_EYEBROW, V8_HEAD, V8_SEARCH } from "../components/rankings/v8";

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
    <div className={cn("space-y-5", V8_HEAD)}>
      <PageHeader
        eyebrow={<span className={cn("text-accent-text", V8_EYEBROW)}><Link to={`/rankings${qs({ season: seasonParam })}`} className="hover:underline">World rankings</Link> · {seasonLabel(season)}</span>}
        title="Rankings by region"
        description="Every country, state and province with rated FTC teams. Open one for its table: rank, record, OPR, events and this week's moves."
        phoneDescription="Pick a region for its rankings table."
      >
        <RankingsTabs at="regions" season={seasonParam} />
        <div className="flex flex-wrap items-center gap-2 max-sm:v8:flex-nowrap">
          <SeasonPick value={season} onChange={(s) => { const n = new URLSearchParams(sp); n.set("season", String(s)); setSp(n); }} />
          <div className="relative w-full max-w-xs max-sm:v8:min-w-0 max-sm:v8:flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted v8:text-text-faint" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="New Jersey, Texas, Romania…" aria-label="Search regions" className={cn("h-9 pl-8 max-sm:h-10", V8_SEARCH)} />
          </div>
        </div>
      </PageHeader>
      <p className={cn("text-sm text-text-muted v8:-mt-2 v8:text-xs", V8_CAPTION)}>Ratings are only comparable inside one season.</p>
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
    // v8: one hairline list, no boxes: a country is a stronger row, its states indented under it.
    <div className="space-y-4 v8:space-y-0 v8:border-t v8:border-white/[0.08]" data-regions>
      {shown.map(({ c, kids }) => (
        <section key={c.key} aria-label={c.name} className="overflow-hidden rounded-xl border border-text-base/15 bg-card v8:rounded-none v8:border-0 v8:border-b v8:border-white/[0.08] v8:bg-transparent">
          <Row r={c} season={d.season} myTeam={myTeam} country />
          {kids.length > 0 && <ul className="border-t border-text-base/10 v8:border-white/[0.08]">{kids.map((s) => <li key={s.key} className="border-b border-text-base/10 last:border-b-0 v8:border-white/[0.08]"><Row r={s} season={d.season} myTeam={myTeam} /></li>)}</ul>}
        </section>
      ))}
    </div>
  );
}

function Row({ r, season, myTeam, country }: { r: RegionListItem; season: number; myTeam: number | null; country?: boolean }) {
  return (
    <Link to={regionHref(r.key, { season })} data-region={r.key}
      className={cn("flex items-center gap-3 px-3 py-2.5 hover:bg-text-base/[0.04] pointer-coarse:min-h-[44px]", "v8:min-h-11 v8:py-2 v8:transition-colors v8:duration-150 v8:hover:bg-white/[0.03]", country ? "bg-text-base/[0.02] v8:bg-transparent v8:px-0 v8:pr-3" : "pl-6 v8:pl-4")}>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", country ? "font-display text-base font-semibold v8:font-sans v8:text-[0.9375rem]" : "text-sm font-medium v8:font-normal")}>{r.name}</span>
        <span className={cn("block truncate text-xs text-text-muted", V8_CAPTION)}>
          #1 <span className={cn("font-mono tabular-nums v8:font-sans", r.top.team === myTeam && "font-semibold text-accent-text v8:font-medium v8:text-text-base")}>{r.top.team}</span> {r.top.name ?? ""} · <span className="tabular-nums">{r.top.rating.toFixed(1)}</span>
          {r.leagues ? ` · ${r.leagues} league${r.leagues === 1 ? "" : "s"}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-right text-sm tabular-nums"><span className="font-semibold v8:font-medium">{r.teams.toLocaleString()}</span><span className={cn("block text-[11px] text-text-muted v8:text-[0.6875rem]", V8_CAPTION)}>rated</span></span>
      <ChevronRight className="size-4 shrink-0 text-text-muted v8:text-text-faint" aria-hidden />
    </Link>
  );
}
