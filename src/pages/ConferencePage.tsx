// /leagues/:season/:region/:code/conferences: a New Jersey league's conference rankings (src/shared/conferences.ts),
// laid out as region rankings is: a header with the season picker, the conference switch, the season note, the count
// line, the winner, the week's movers (by Scout rating among the conference's teams: Scout keeps no history of FIRST's
// league table), the table, its unranked teams and the links around it. ?conference= (a slug, or the tournament's code)
// and ?team= (that team's row, marked, on its page) are in the URL. New Jersey only, and only for visitors the gate
// lets see conferences (src/lib/conferenceGate.ts). No charts: linked around, kept light.
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, ListOrdered, Trophy } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useTitle } from "../lib/meta";
import { ago, seasonLabel } from "../lib/format";
import { useMyTeamNumber } from "../lib/personal";
import { useConferenceGateState } from "../lib/conferenceGate";
import { PageHeader, EmptyState } from "../components/page";
import { ErrorState } from "../components/states";
import { MoverCards } from "../components/rankings/MoverCards";
import { ConferenceSwitch, ConferenceTable, ConferenceUnranked, conferenceMovers, pickConference, sourceText, unknownConference } from "../components/ConferenceSection";
import { asOfDate, conferenceHref, CONFERENCE_LABEL, CONFERENCE_REGION, type Conference, type LeagueConferences } from "../shared/conferences";
import { dateRange } from "../shared/format";
import { leagueHref, leagueTitle, type LeagueStandings } from "../shared/leagues";
import { regionHref, regionName } from "../shared/regionRankings";
import { SeasonPick, weekLabel } from "./RankingsPage";

export default function ConferencePage() {
  const { season: seasonRaw = "", region = "", code = "" } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const ok = /^\d{4}$/.test(seasonRaw) && /^[A-Za-z0-9]{1,16}$/.test(region) && /^[A-Za-z0-9]{1,16}$/.test(code);
  const season = Number(seasonRaw);
  const nj = region.toUpperCase() === CONFERENCE_REGION;
  // The team to mark: the link's, else My team (a My team not in the table marks nothing).
  const myTeam = useMyTeamNumber();
  const team = Number(sp.get("team")) || myTeam || null;
  const slug = sp.get("conference");
  const { shown, deciding } = useConferenceGateState(ok ? region : null, ok ? season : null);
  const league = useApi<LeagueStandings>(ok && nj ? `/api/leagues/${season}/${region}/${code}` : null);
  const conf = useApi<LeagueConferences>(ok && nj && shown ? `/api/leagues/${season}/${region}/${code}/conferences` : null);
  const list = conf.data?.conferences ?? [];
  const unknown = unknownConference(list, slug);
  const picked = unknown ? null : pickConference(list, slug, team);
  const name = league.data ? leagueTitle(league.data.name, league.data.code) : `${code.toUpperCase()} League`;
  useTitle(picked ? `${picked.name} rankings · ${seasonLabel(season)}` : `Conference rankings · ${name}`);

  if (!ok) return <EmptyState icon={ListOrdered} title="No such league" description="This address doesn't name a league." />;
  const back = leagueHref(season, region.toUpperCase(), code.toUpperCase());
  if (!nj) return <EmptyState icon={ListOrdered} title="No conference rankings here" description="Conferences are FTC New Jersey's: only a New Jersey league has them." action={<Link to={back} className="text-accent-text underline">The league's standings</Link>} />;
  // Hidden from a My team outside New Jersey, as the league page hides its button.
  if (!shown && !deciding) return <EmptyState icon={ListOrdered} title="Conference rankings are New Jersey's" description="Your My team isn't a New Jersey team, so conference rankings aren't shown." action={<Link to={back} className="text-accent-text underline">The league's standings</Link>} />;

  // Another season: the same conference's edition when there is one (it can change leagues), else this league's.
  const toSeason = (s: number) => {
    const o = picked?.seasons.find((x) => x.season === s);
    navigate(o ? conferenceHref(o.season, o.region, o.league, { slug: o.slug, team }) : conferenceHref(s, region.toUpperCase(), code.toUpperCase(), { team }));
  };
  const placeKey = league.data?.placeKey ?? null;
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<span className="text-accent-text"><Link to={back} className="hover:underline">{name}</Link> · Conference rankings · {seasonLabel(season)}</span>}
        title={picked ? `Rankings: ${picked.name}` : "Conference rankings"}
        description={`Each conference tournament's teams in ${name}, ranked by FIRST's league standing over the league meets only, with Scout's rating, OPR and this week's moves beside it.`}
        phoneDescription="Each conference's teams, by league RS, league meets only."
      >
        <div className="flex flex-wrap items-center gap-2"><SeasonPick value={season} onChange={toSeason} /></div>
      </PageHeader>

      {conf.error && !conf.data ? <ErrorState error={conf.error} onRetry={conf.reload} /> : !conf.data ? <Skeleton /> : !list.length ? (
        <EmptyState icon={ListOrdered} title="No conferences known yet" description={`FIRST hasn't listed ${name}'s conference tournaments for ${seasonLabel(season)}.`} action={<Link to={back} className="text-accent-text underline">The league's standings</Link>} />
      ) : (
        <div className={`space-y-6 transition-opacity ${conf.loading ? "opacity-60" : ""}`} aria-busy={conf.loading}>
          <ConferenceSwitch list={list} picked={picked} leagueName={league.data?.name ?? null} region={conf.data.region} league={conf.data.code} team={team} />
          {unknown && <p className="text-sm text-text-muted" data-conference-unknown>This league has no one conference by that name this season, so no table is shown: pick a conference above.</p>}
          {picked && <ConferenceView c={picked} team={team} />}
          <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="More rankings" data-conference-links>
            <Link to={`/rankings${qs({ season })}`} className="text-accent-text hover:underline">World rankings</Link>
            {placeKey && <Link to={regionHref(placeKey, { season })} className="text-accent-text hover:underline">{regionName(placeKey)} rankings</Link>}
            <Link to={`/rankings/regions${qs({ season })}`} className="text-accent-text hover:underline">All regions</Link>
            <Link to={`/leagues${qs({ season })}`} className="text-accent-text hover:underline">All leagues</Link>
            <Link to={back} className="text-accent-text hover:underline">{name} standings</Link>
            {picked && <Link to={`/events/${picked.season}/${encodeURIComponent(picked.code)}`} className="text-accent-text hover:underline">{picked.event}</Link>}
          </nav>
        </div>
      )}
    </div>
  );
}

/** One conference: the season note, the count line, the winner (or the teams going in), the movers, the table, its
 *  unranked teams, and its other seasons as labelled links. */
function ConferenceView({ c, team }: { c: Conference; team: number | null }) {
  const ranked = c.rows.filter((r) => r.rank != null).length;
  const going = c.status === "upcoming";
  const where = [c.venue, c.city].filter(Boolean).join(", ");
  const asOf = c.rs.kind === "live" || c.rs.kind === "final" ? c.rs.asOf : c.rs.kind === "snapshot" ? c.rs.asOf : null;
  const lead = c.rs.kind === "final" ? `league meets ended ${asOfDate(c.rs.lastMeet)}, before this tournament` : c.rs.kind === "snapshot" ? `league RS as of ${asOfDate(c.rs.asOf)}, the week before the tournament`
    : c.rs.kind === "live" ? `league RS as of ${asOfDate(c.rs.asOf) ?? "the last read from FIRST"}` : "the going-in standing is no longer available";
  const movers = conferenceMovers(c);
  const next = c.seasons.filter((o) => o.season > c.season).sort((a, b) => a.season - b.season)[0];
  const prev = c.seasons.filter((o) => o.season < c.season).sort((a, b) => b.season - a.season)[0];
  return (
    <div className="space-y-6" data-conference={c.slug}>
      <div className="space-y-2">
        <p className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-text-muted" data-season-note>
          <span className="font-semibold text-text-base" data-conference-label>{CONFERENCE_LABEL}</span>{" "}<span data-rs-source>{sourceText(c)}</span>
          {c.rs.kind === "gone" && <> <Link to={`/events/${c.season}/${encodeURIComponent(c.code)}`} className="text-accent-text hover:underline">The tournament's own ranking</Link>.</>}
          {" "}Tournament rank and league rank are two different rankings; the tournament's is on <Link to={`/events/${c.season}/${encodeURIComponent(c.code)}`} className="text-accent-text hover:underline">its event page</Link>.
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-text-muted" data-conference-event>
          <CalendarDays className="size-4 shrink-0" aria-hidden />
          <Link to={`/events/${c.season}/${encodeURIComponent(c.code)}`} className="text-accent-text hover:underline">{c.event}</Link>
          <span>· {dateRange(c.start) || "Date to be set"}{where ? ` · ${where}` : ""}</span>
        </p>
        {c.firstName && <p className="text-xs text-text-muted">FIRST's event list calls it {c.firstName}; this is FTC New Jersey's name for it.</p>}
      </div>

      {c.winner ? (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2.5 text-sm" data-conference-winner>
          <Trophy className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
          <span>Won by <TeamLink season={c.season} t={c.winner.captain} /> (Winning Alliance Captain){c.winner.picks.length ? <> with {c.winner.picks.map((p, i) => <span key={p.team}>{i ? ", " : ""}<TeamLink season={c.season} t={p} /></span>)}</> : null}, from FIRST's awards.</span>
        </p>
      ) : going ? (
        <p className="rounded-xl border border-accent/50 bg-accent/[0.07] px-3 py-2.5 text-sm" data-going-in>
          {c.teamsFrom === "registered" && c.registered ? <>
            Tournament hasn't started yet — {c.registered.count} teams registered via <a href={c.registered.url} target="_blank" rel="noreferrer" className="text-accent-text hover:underline">FTC New Jersey</a>, fetched {asOfDate(c.registered.fetchedAt)}.
            {" "}Registered, not the final field: teams may be added or dropped before FIRST posts it.
            {c.registered.sessionUnknown && <span data-session-unknown>{" "}This tournament runs morning and afternoon sessions; FTC New Jersey&apos;s list doesn&apos;t say which session each team is in.</span>}
          </> : c.teamsFrom === "field" ? <>Tournament hasn't started yet — FIRST's team list: {c.rows.length} teams.</> : <>Tournament hasn't started yet, and no team list is out for it yet.</>}
        </p>
      ) : null}

      <p className="text-sm text-text-muted" data-conference-count>
        {ranked} ranked team{ranked === 1 ? "" : "s"} of {c.leagueOf} in the league · {lead}
        {c.moves ? ` · moves by Scout rating since the week of ${weekLabel(c.moves.baseline)}` : ""}
        {asOf ? ` · updated ${ago(asOf)}` : ""}
      </p>

      {c.moves ? (
        <div className="space-y-1.5">
          <MoverCards season={c.season} {...movers} rankTitle="Rank by Scout rating among this conference's teams · rating" label="The conference's moves" />
          <p className="text-xs text-text-muted" data-moves-note>
            Moves are places by Scout rating among this conference's teams, the {c.moves.week ? `week of ${weekLabel(c.moves.week)}` : "live ranking"} against the week of {weekLabel(c.moves.baseline)}: Scout's ranking, not FIRST's league table, which Scout keeps no history of.
          </p>
        </div>
      ) : (
        <p className="text-sm text-text-muted" data-movers>No climbers or fallers to show: no Scout ranking saved a week before {c.status === "finished" ? "the tournament" : "this one"} to compare with.</p>
      )}

      <section aria-labelledby="conference-table" className="space-y-2">
        <h2 id="conference-table" className="sr-only">{c.name} table</h2>
        <ConferenceTable c={c} team={team} />
        <p className="text-xs text-text-muted">Scout rating and OPR are Control Scout's, this season's: ratings only compare within one season, never against another season's.</p>
      </section>

      <ConferenceUnranked c={c} team={team} />

      {(next || prev) && (
        <nav className="flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Other seasons" data-conference-seasons>
          {prev && <Link to={conferenceHref(prev.season, prev.region, prev.league, { slug: prev.slug, team })} className="text-accent-text hover:underline">← Last season: {prev.name}, {seasonLabel(prev.season)} ({leagueTitle(null, prev.league)})</Link>}
          {next && <Link to={conferenceHref(next.season, next.region, next.league, { slug: next.slug, team })} className="text-accent-text hover:underline">Next season: {next.name}, {seasonLabel(next.season)} ({leagueTitle(null, next.league)}) →</Link>}
        </nav>
      )}
    </div>
  );
}

function TeamLink({ season, t }: { season: number; t: { team: number; name: string | null } }) {
  return <Link to={`/teams/${t.team}?season=${season}`} className="font-medium text-accent-text hover:underline">{t.team}{t.name ? ` ${t.name}` : ""}</Link>;
}

function Skeleton() {
  return <div className="space-y-3" aria-busy="true"><div className="h-14 animate-pulse rounded-xl bg-muted" /><div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />)}</div><div className="h-64 animate-pulse rounded-xl bg-muted" /></div>;
}
