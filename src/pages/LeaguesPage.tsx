// /leagues: every league of the season (server/api/leagues.ts leagueList), grouped by where its meets are, each with
// its meets played, its teams and FIRST's #1 by ranking score, to its standings page. Each place links to its region
// rankings. ?season= in the URL. FIRST's league standing only: Scout's ratings are on the region pages. New Jersey's
// group alone gets View Conference Rankings (src/lib/conferenceGate.ts): to My team's league, or one per league.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, ListOrdered, Search } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { seasonLabel } from "../lib/format";
import { leagueHref, leagueTitle, rankingScore } from "../shared/leagues";
import { regionHref, type LeagueListItem, type LeaguesResponse } from "../shared/regionRankings";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Input } from "../components/ui/basic";
import { SeasonPick } from "./RankingsPage";
import { conferenceShown, useMyConference } from "../lib/conferenceGate";
import { CONFERENCE_REGION, conferenceHref } from "../shared/conferences";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function LeaguesPage() {
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const seasonParam = Number(sp.get("season")) || null;
  const [q, setQ] = useState("");
  const state = useApi<LeaguesResponse>(`/api/leagues${qs({ season: seasonParam })}`);
  const season = state.data?.season ?? seasonParam ?? current;
  useTitle(`FTC leagues ${seasonLabel(season)}`);
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<span className="text-accent-text"><Link to={`/rankings/regions${qs({ season: seasonParam })}`} className="hover:underline">Region rankings</Link> · {seasonLabel(season)}</span>}
        title="Leagues"
        description="Every FTC league this season, by where it plays: meets played, teams, and FIRST's league leader by ranking score. Open one for its standings."
        phoneDescription="Every league, by where it plays."
      >
        <div className="flex flex-wrap items-center gap-2">
          <SeasonPick value={season} onChange={(s) => { const n = new URLSearchParams(sp); n.set("season", String(s)); setSp(n); }} />
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Northeast, New Jersey…" aria-label="Search leagues" className="h-9 pl-8 max-sm:h-10" />
          </div>
        </div>
      </PageHeader>
      <Async state={state}>{(d) => <Groups d={d} q={q} />}</Async>
    </div>
  );
}

function Groups({ d, q }: { d: LeaguesResponse; q: string }) {
  if (!d.leagues.length) return <EmptyState icon={ListOrdered} title={`No leagues in ${seasonLabel(d.season)} yet`} description="Leagues show here once FIRST lists their meets." />;
  const f = fold(q.trim());
  const shown = f ? d.leagues.filter((l) => fold(`${leagueTitle(l.name, l.code)} ${l.placeName ?? ""} ${l.code}`).includes(f)) : d.leagues;
  if (!shown.length) return <EmptyState icon={Search} title="No league by that name" description={`None of the ${d.leagues.length} leagues matches “${q.trim()}”.`} />;
  const groups = new Map<string, LeagueListItem[]>();
  for (const l of shown) { const k = l.place ?? ""; groups.set(k, [...(groups.get(k) ?? []), l]); }
  return (
    <div className="space-y-5" data-leagues>
      {[...groups].map(([place, list]) => (
        <section key={place || "-"} aria-label={list[0].placeName ?? "Place not listed"} className="space-y-2">
          <h2 className="flex flex-wrap items-baseline gap-x-3 font-display text-lg font-semibold">
            {list[0].placeName ?? "Place not listed"}
            {place && <Link to={regionHref(place, { season: d.season })} className="text-sm font-normal text-accent-text hover:underline">{list[0].placeName} rankings →</Link>}
          </h2>
          {list.some((l) => l.region.toUpperCase() === CONFERENCE_REGION) && <ConferenceButton season={d.season} leagues={list.filter((l) => l.region.toUpperCase() === CONFERENCE_REGION)} />}
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((l) => (
              <li key={`${l.region}-${l.code}`}>
                <Link to={leagueHref(d.season, l.region, l.code)} data-league={`${l.region}/${l.code}`} className="lift flex h-full flex-col gap-0.5 rounded-xl border border-border bg-card p-3 hover:border-accent/60">
                  <span className="flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{leagueTitle(l.name, l.code)}</span></span>
                  <span className="text-xs text-muted-foreground">{l.meetsPlayed} of {l.meets} meet{l.meets === 1 ? "" : "s"} played{l.teams ? ` · ${l.teams} teams` : ""}</span>
                  <span className="truncate text-xs text-muted-foreground">{l.top ? <>#1 by RS: <span className="font-mono tabular-nums">{l.top.team}</span> {l.top.name ?? ""}{l.top.rs != null ? ` (${rankingScore(l.top.rs)})` : ""}</> : "No standings yet"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** New Jersey's "View Conference Rankings": straight to My team's league's conferences (its row marked) when My team has
 *  a New Jersey league that season, else a link per league. Nothing when My team is based elsewhere. */
function ConferenceButton({ season, leagues }: { season: number; leagues: LeagueListItem[] }) {
  const my = useMyConference(season);
  if (!conferenceShown(CONFERENCE_REGION, my)) return null;
  const mine = my.info?.league && leagues.find((l) => l.region === my.info!.league!.region && l.code === my.info!.league!.code);
  const btn = "inline-flex h-9 items-center rounded-lg border border-accent/60 bg-accent/10 px-3 text-sm font-medium text-accent-text hover:bg-accent/15 max-sm:h-[44px]";
  if (mine) return <Link to={conferenceHref(season, mine.region, mine.code, { slug: my.info!.conference?.slug, team: my.team })} className={btn} data-conference-button>View Conference Rankings</Link>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-conference-button>
      <span className="text-sm font-medium">View Conference Rankings:</span>
      {leagues.map((l) => <Link key={l.code} to={conferenceHref(season, l.region, l.code)} className={btn}>{leagueTitle(l.name, l.code)}</Link>)}
    </div>
  );
}
