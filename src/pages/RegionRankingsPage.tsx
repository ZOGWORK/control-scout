// /rankings/regions/:country/:state?: one region's rankings (src/shared/regionRankings.ts). The region's ranked teams
// out of the world ranking, each with its rank in the region (world rank beside it), rating, season record, OPR, events
// and rated matches, its move in the region since last week; the week's climbers, fallers and new teams at the top; the
// region's unranked teams, labeled; and its leagues. ?season=, ?week=, ?sort=, ?page= and ?team= (that team's row,
// marked, on its page) are in the URL. Same numbers as /rankings?region=. No charts: linked around, kept light.
import { useEffect, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, CalendarDays, ListOrdered, MapPin, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { ago, seasonLabel } from "../lib/format";
import { leagueHref, leagueTitle, rankingScore } from "../shared/leagues";
import { parsePlaces, placeKey } from "../shared/rankings";
import {
  isRegionSort, regionHref, regionName, unrankedLabel,
  type LeagueListItem, type RegionMover, type RegionNewcomer, type RegionRankingsResponse, type RegionRow, type RegionSort, type UnrankedTeam,
} from "../shared/regionRankings";
import { SWING_LINE, swingText, swingTitle } from "../shared/reliability";
import { PageHeader, EmptyState } from "../components/page";
import { ErrorState } from "../components/states";
import { TeamNumber } from "../components/records/RecordsTable";
import { cn } from "../components/cn";
import { Move, Pager, SeasonPick, TrendBadge, WeekPick, weekLabel } from "./RankingsPage";

const SORT_LABEL: Record<RegionSort, string> = { rank: "Rank", rating: "Rating", opr: "OPR", record: "Record", events: "Events played", move: "Move" };
const th = "h-11 whitespace-nowrap bg-card px-2 align-bottom pb-2 text-[11px] font-bold uppercase tracking-wider text-text-muted shadow-[inset_0_-2px_0_color-mix(in_srgb,var(--color-text-base)_20%,transparent)] sm:px-3";
const td = "px-2 py-2.5 sm:px-3";
const record = (r: Pick<RegionRow, "wins" | "losses" | "ties">) => (r.wins == null || r.losses == null ? "—" : `${r.wins}-${r.losses}-${r.ties ?? 0}`);
const one = (v: number | null) => (v == null ? "—" : v.toFixed(1));

export default function RegionRankingsPage() {
  const { country = "", state } = useParams();
  const [sp, setSp] = useSearchParams();
  const current = useCurrentSeason();
  const { state: personal } = usePersonal();
  const myTeam = personal.myTeam;
  // The route's place, read as the API reads a ?region= key ("USA" + "NJ" → USA:NJ).
  const place = useMemo(() => parsePlaces(state ? `${country}:${state}` : country)?.[0] ?? null, [country, state]);
  const key = place ? placeKey(place) : null;
  const seasonParam = Number(sp.get("season")) || null;
  const week = sp.get("week");
  const sortRaw = sp.get("sort") ?? "rank";
  const sort: RegionSort = isRegionSort(sortRaw) ? sortRaw : "rank";
  const page = Number(sp.get("page")) || null;
  const team = Number(sp.get("team")) || null;

  const res = useApi<RegionRankingsResponse>(key ? `/api/rankings/region${qs({ season: seasonParam, region: key, week, sort: sort === "rank" ? null : sort, page, team })}` : null);
  const data = res.data;
  const season = data?.season ?? seasonParam ?? current;
  const name = data?.region.name ?? (key ? regionName(key) : "");
  useTitle(`FTC rankings: ${name} ${seasonLabel(season)}${week ? `, week of ${weekLabel(week)}` : ""}`);

  /** Change the URL: a new season, week or sort starts from the asked team's page (or page 1). */
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") q.delete(k); else q.set(k, v); }
    if (!("page" in patch)) q.delete("page");
    setSp(q);
  };

  // The asked team's row in view, once its page is drawn.
  const marked = team != null && data?.asked?.status === "ranked" && data.rows.some((r) => r.team === team);
  useEffect(() => {
    if (!marked) return;
    document.querySelector<HTMLElement>("tr[data-marked]")?.scrollIntoView?.({ block: "center" });
  }, [marked, data]);

  if (!key) return <EmptyState icon={MapPin} title="No such region" description="This address doesn't name a country or a state." action={<Link to="/rankings/regions" className="text-accent-text underline">All regions</Link>} />;
  const liveLabel = season === current ? "This week" : "Season end";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<span className="text-accent-text"><Link to="/rankings/regions" className="hover:underline">Region rankings</Link> · {seasonLabel(season)}</span>}
        title={`Rankings: ${name}`}
        description={`Every rated FTC team from ${name}, ranked by prediction rating, with its record, OPR, events and the matches its rating is based on.`}
        phoneDescription={`Rated teams from ${name}, and this week's moves.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <SeasonPick value={season} onChange={(s) => go({ season: String(s), week: null })} />
          {data && data.weeks.length > 0 && <WeekPick weeks={data.weeks} value={week} liveLabel={liveLabel} onChange={(w) => go({ week: w })} />}
        </div>
      </PageHeader>
      <p className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-text-muted" data-season-note>
        Ratings are only comparable inside one season. Do not compare a {seasonLabel(season - 1)} rating to a {seasonLabel(season)} rating.
      </p>

      {res.error && !data ? <ErrorState error={res.error} onRetry={res.reload} /> : !data ? <Skeleton /> : (
        <div className={cn("space-y-6 transition-opacity", res.loading && "opacity-60")} aria-busy={res.loading}>
          <Asked data={data} />
          {data.total > 0 && <Movers data={data} finished={data.season !== current} />}
          <section aria-labelledby="region-table" className="space-y-2">
            <h2 id="region-table" className="sr-only">{name} table</h2>
            <p className="text-sm text-text-muted">
              {data.total.toLocaleString()} ranked team{data.total === 1 ? "" : "s"} of {data.worldRanked.toLocaleString()} worldwide
              {data.baseline ? ` · moves in ${name} since the week of ${weekLabel(data.baseline)}` : ""}
              {data.week ? ` · as of ${weekLabel(data.week)}, 00:00 UTC` : data.asOf ? ` · updated ${ago(data.asOf)}` : ""}
            </p>
            {data.total === 0 ? (
              <EmptyState icon={ListOrdered} title="No rated teams yet"
                description={`No team from ${name} has three rated matches in ${seasonLabel(data.season)} yet. A team is ranked after its third rated match.`} />
            ) : (
              <>
                <RegionTable data={data} team={team} myTeam={myTeam} sort={sort} onSort={(s) => go({ sort: s === "rank" ? null : s })} />
                <Pager data={data} sp={sp} />
              </>
            )}
            {!data.stats && data.total > 0 && <p className="text-xs text-text-muted" data-week-note>A past week shows the rank and rating saved that Monday. Record, OPR, events and rated matches are shown for this week only.</p>}
          </section>
          {data.stats && data.unrankedTotal > 0 && <Unranked data={data} team={team} />}
          <Leagues leagues={data.leagues} name={name} season={data.season} />
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="More rankings">
            <Link to={`/rankings${qs({ season: data.season, region: key })}`} className="text-accent-text hover:underline">World rankings: {name}</Link>
            <Link to={`/rankings${qs({ season: data.season })}`} className="text-accent-text hover:underline">World rankings</Link>
            <Link to={`/rankings/regions${qs({ season: data.season })}`} className="text-accent-text hover:underline">All regions</Link>
          </nav>
        </div>
      )}
    </div>
  );
}

/** Where the asked team (?team=) is when its row isn't on the table: not ranked yet, from elsewhere, or no such team. */
function Asked({ data }: { data: RegionRankingsResponse }) {
  const a = data.asked;
  if (!a || a.status === "ranked") return null;
  const box = "rounded-xl border border-accent/50 bg-accent/[0.07] px-3 py-2.5 text-sm";
  if (a.status === "unknown") return <p className={box} data-asked>No team {a.team} on Control Scout.</p>;
  if (a.status === "elsewhere") {
    return (
      <p className={box} data-asked>
        <Link to={`/teams/${a.team}?season=${data.season}`} className="font-semibold hover:underline">{a.team}{a.name ? ` ${a.name}` : ""}</Link> isn't from {data.region.name}.
        {a.region && <> <Link to={regionHref(a.region, { season: data.season, team: a.team })} className="text-accent-text underline">Rank in {regionName(a.region)}</Link></>}
      </p>
    );
  }
  const who = <Link to={`/teams/${a.team}?season=${data.season}`} className="font-semibold hover:underline">{a.team}{a.name ? ` ${a.name}` : ""}</Link>;
  if (a.status === "notInWeek") return <p className={box} data-asked>{who} wasn't in the ranking saved the week of {weekLabel(a.week)}.</p>;
  return <p className={box} data-asked>{who}: <span data-unranked-label>{unrankedLabel(a.ratedMatches)}</span> in {seasonLabel(data.season)}.</p>;
}

/** The week in a glance: biggest climbers and fallers (places moved in the region), and teams new to the table. */
function Movers({ data, finished }: { data: RegionRankingsResponse; finished: boolean }) {
  if (!data.baseline) {
    return <p className="text-sm text-text-muted" data-movers>No climbers or fallers to show: {data.week ? "no ranking was saved the week before this one." : finished ? "a finished season's ranking has no weekly moves (pick a week to see that week's)." : "no ranking saved at least a week ago to compare with yet."}</p>;
  }
  const href = (t: number) => `/teams/${t}?season=${data.season}`;
  const Card = ({ title, icon: Icon, tone, children }: { title: string; icon: typeof TrendingUp; tone: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-line bg-card p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Icon className={cn("size-4", tone)} aria-hidden />{title}</h3>
      {children}
    </div>
  );
  const MoverList = ({ rows, up }: { rows: RegionMover[]; up: boolean }) => rows.length ? (
    <ol className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.team} className="flex items-baseline gap-2">
          <span className={cn("inline-flex w-12 shrink-0 items-center gap-0.5 font-semibold tabular-nums", up ? "text-success" : "text-danger")}>
            {up ? <ArrowUp className="size-3.5" strokeWidth={2.5} /> : <ArrowDown className="size-3.5" strokeWidth={2.5} />}{Math.abs(r.move)}
            <span className="sr-only"> places {up ? "up" : "down"}</span>
          </span>
          <Link to={href(r.team)} className="min-w-0 flex-1 truncate hover:underline"><span className="font-mono font-semibold tabular-nums">{r.team}</span> {r.name ?? ""}</Link>
          <span className="shrink-0 tabular-nums text-text-muted" title="Rank in the region · rating">#{r.rank} · {r.rating.toFixed(1)}</span>
        </li>
      ))}
    </ol>
  ) : <p className="text-sm text-text-muted">{up ? "No team moved up." : "No team moved down."}</p>;
  const NewList = ({ rows }: { rows: RegionNewcomer[] }) => rows.length ? (
    <ol className="space-y-1.5 text-sm">
      {rows.slice(0, 5).map((r) => (
        <li key={r.team} className="flex items-baseline gap-2">
          <Link to={href(r.team)} className="min-w-0 flex-1 truncate hover:underline"><span className="font-mono font-semibold tabular-nums">{r.team}</span> {r.name ?? ""}</Link>
          <span className="shrink-0 tabular-nums text-text-muted" title="Rank in the region · rating">#{r.rank} · {r.rating.toFixed(1)}</span>
        </li>
      ))}
      {data.newTotal > 5 && <li className="text-xs text-text-muted">and {(data.newTotal - 5).toLocaleString()} more (sort by Move)</li>}
    </ol>
  ) : <p className="text-sm text-text-muted">No team is new to the table.</p>;
  return (
    <section aria-label="This week's moves" className="grid gap-3 sm:grid-cols-3" data-movers>
      <Card title="Biggest climbers" icon={TrendingUp} tone="text-success"><MoverList rows={data.climbers} up /></Card>
      <Card title="Biggest fallers" icon={TrendingDown} tone="text-danger"><MoverList rows={data.fallers} up={false} /></Card>
      <Card title={`New to the table${data.newTotal ? ` (${data.newTotal.toLocaleString()})` : ""}`} icon={Sparkles} tone="text-accent"><NewList rows={data.newcomers} /></Card>
    </section>
  );
}

function RegionTable({ data, team, myTeam, sort, onSort }: { data: RegionRankingsResponse; team: number | null; myTeam: number | null; sort: RegionSort; onSort: (s: RegionSort) => void }) {
  const moves = data.baseline != null;
  const stats = data.stats;
  const swing = data.rows.some((r) => r.swing !== undefined);
  const name = data.region.name;
  /** A header that sorts: the rank numbers stay as they are. */
  const H = ({ s, label, title, className }: { s: RegionSort; label: React.ReactNode; title?: string; className?: string }) => (
    <th scope="col" className={cn(th, className)} aria-sort={sort === s ? (s === "rank" ? "ascending" : "descending") : undefined} title={title}>
      <button type="button" onClick={() => onSort(s)} className={cn("inline-flex items-center gap-0.5 uppercase hover:text-text-base max-sm:min-h-[44px]", sort === s && "text-accent-text")} aria-label={`Sort by ${SORT_LABEL[s]}`}>
        {label}{sort === s && <ArrowDown className="size-3" aria-hidden />}
      </button>
    </th>
  );
  return (
    <div className="custom-scrollbar overflow-x-auto rounded-xl border border-text-base/15 bg-card" data-region-table>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            <H s="rank" label={<><span className="sm:hidden">#</span><span className="max-sm:hidden">Rank</span></>} title={`Rank in ${name} (world rank below)`} className="w-12 text-right" />
            {moves && <H s="move" label="Move" title={`Places moved in ${name} since last week`} className="text-left" />}
            <th scope="col" className={cn(th, "text-left")}>Team</th>
            <H s="rating" label="Rating" title="Expected points added to an alliance per match (auto + TeleOp + endgame)" className="text-right" />
            {stats && <H s="opr" label="OPR" title="Season OPR, penalties left out" className="text-right" />}
            {stats && <H s="record" label={<>Record<span className="font-normal normal-case max-sm:hidden"> (season)</span></>} title="Wins-losses-ties: every official match this season, at every event" className="text-right" />}
            {stats && <H s="events" label="Events" title="Events played this season" className={cn("text-right", sort !== "events" && "max-sm:hidden")} />}
            {stats && <th scope="col" className={cn(th, "text-right max-sm:hidden")} title="Rated matches the rating is based on: the sample size">Matches</th>}
            {swing && <th scope="col" className={cn(th, "text-right max-sm:hidden")} title={SWING_LINE}>Swing</th>}
            {moves && <th scope="col" className={cn(th, "text-left max-sm:hidden")}>Trend</th>}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const asked = r.team === team, mine = r.team === myTeam;
            const href = `/teams/${r.team}?season=${data.season}`;
            return (
              <tr key={r.team} data-team={r.team} data-marked={asked ? "" : undefined} aria-current={asked ? "true" : undefined}
                className={cn("border-t border-text-base/10 hover:bg-text-base/[0.03]", (asked || mine) && "bg-accent/[0.09]", asked && "shadow-[inset_3px_0_0_var(--color-accent)]")}>
                <td className={cn(td, "text-right tabular-nums")}>
                  <span className={cn("font-display text-base font-semibold", r.rank <= 3 && "text-accent-text")} data-rank>{r.rank.toLocaleString()}</span>
                  <span className="block text-[11px] text-text-muted" title="World rank">W{r.world.toLocaleString()}</span>
                </td>
                {moves && <td className={td}><Move row={r} /></td>}
                <td className={cn(td, "max-w-[16rem] min-w-[6rem]")}>
                  <span className="sm:hidden"><TeamNumber team={r.team} name={r.name ?? ""} href={href} /></span>
                  <Link to={href} className="group block min-w-0 max-sm:hidden">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono font-semibold tabular-nums group-hover:text-accent-text">{r.team}</span>
                      <span className="truncate group-hover:text-accent-text">{r.name ?? ""}</span>
                    </span>
                  </Link>
                </td>
                <td className={cn(td, "text-right tabular-nums")}>
                  <span className="font-semibold">{r.rating.toFixed(1)}</span>
                  {r.dRating != null && r.dRating !== 0 && <span className={cn("block text-[11px]", r.dRating > 0 ? "text-success" : "text-danger")}>{r.dRating > 0 ? "+" : ""}{r.dRating.toFixed(1)}</span>}
                </td>
                {stats && <td className={cn(td, "text-right tabular-nums")}>{one(r.opr)}</td>}
                {stats && <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                  {record(r)}
                  {/* Phones: the sample size sits under the record instead of in its own column. */}
                  <span className="block text-[11px] text-text-muted sm:hidden" data-phone-matches>{r.ratedMatches ?? 0} matches</span>
                </td>}
                {stats && <td className={cn(td, "text-right tabular-nums", sort !== "events" && "max-sm:hidden")}>{r.events ?? "—"}</td>}
                {stats && <td className={cn(td, "whitespace-nowrap text-right tabular-nums max-sm:hidden")} title={`${r.ratedMatches ?? 0} rated matches`}>{r.ratedMatches ?? "—"}<span className="text-text-muted"> matches</span></td>}
                {swing && <td className={cn(td, "text-right tabular-nums max-sm:hidden")} title={swingTitle(r.swing)}>{swingText(r.swing)}</td>}
                {moves && <td className={cn(td, "max-sm:hidden")}><TrendBadge row={r} /></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-text-base/10 px-2 py-2 text-xs text-text-muted sm:px-3">
        Sorted by {SORT_LABEL[sort].toLowerCase()}. The rank is always the place in {name} by rating; sorting doesn't change it.{swing && <> {SWING_LINE} <Link to="/methodology#swing" className="underline">How it's computed</Link></>}
      </p>
    </div>
  );
}

/** The region's teams that aren't ranked: each labeled, never given a rank, rating or OPR. */
function Unranked({ data, team }: { data: RegionRankingsResponse; team: number | null }) {
  const more = data.unrankedTotal - data.unranked.length;
  return (
    <section aria-labelledby="unranked" className="space-y-2" data-unranked>
      <h2 id="unranked" className="font-display text-lg font-semibold">Not ranked yet <span className="text-sm font-normal text-text-muted">({data.unrankedTotal.toLocaleString()})</span></h2>
      <p className="text-sm text-text-muted">A team is ranked after its third rated match this season.</p>
      <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {data.unranked.map((u: UnrankedTeam) => (
          <li key={u.team} data-team={u.team} className={cn("flex min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1", u.team === team && "bg-accent/[0.09] font-semibold")}>
            <Link to={`/teams/${u.team}?season=${data.season}`} className="min-w-0 truncate hover:underline"><span className="font-mono tabular-nums">{u.team}</span> {u.name ?? ""}</Link>
            <span className="ml-auto shrink-0 text-xs text-text-muted">{unrankedLabel(u.ratedMatches)}</span>
          </li>
        ))}
      </ul>
      {more > 0 && <p className="text-xs text-text-muted">and {more.toLocaleString()} more.</p>}
    </section>
  );
}

/** The region's leagues, each to its standings (FIRST's league ranking). */
function Leagues({ leagues, name, season }: { leagues: LeagueListItem[]; name: string; season: number }) {
  return (
    <section aria-labelledby="region-leagues" className="space-y-2" data-region-leagues>
      <h2 id="region-leagues" className="flex flex-wrap items-baseline gap-x-3 font-display text-lg font-semibold">Leagues in {name}<Link to={`/leagues?season=${season}`} className="text-sm font-normal text-accent-text hover:underline">All leagues →</Link></h2>
      {leagues.length === 0 ? <p className="text-sm text-text-muted">No league plays in {name} in {seasonLabel(season)}.</p> : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {leagues.map((l) => (
            <li key={`${l.region}-${l.code}`}>
              <Link to={leagueHref(season, l.region, l.code)} className="lift flex h-full flex-col gap-0.5 rounded-xl border border-border bg-card p-3 hover:border-accent/60">
                <span className="flex items-center gap-2 text-sm font-medium"><CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{leagueTitle(l.name, l.code)}</span></span>
                <span className="text-xs text-muted-foreground">{l.meetsPlayed} of {l.meets} meet{l.meets === 1 ? "" : "s"} played{l.teams ? ` · ${l.teams} teams` : ""}</span>
                <span className="truncate text-xs text-muted-foreground">{l.top ? <>#1 by RS: <span className="font-mono tabular-nums">{l.top.team}</span> {l.top.name ?? ""}{l.top.rs != null ? ` (${rankingScore(l.top.rs)})` : ""}</> : "No standings yet"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading rankings" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-32 rounded-xl" />)}</div>
      <div className="space-y-2 rounded-xl border border-line bg-card p-3">{Array.from({ length: 15 }, (_, i) => <div key={i} className="skeleton h-10 rounded-md" />)}</div>
    </div>
  );
}
