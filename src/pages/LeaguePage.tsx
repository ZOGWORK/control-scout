// /leagues/:season/:region/:code: one league's standings, FIRST's official league rankings over every meet so far
// (server/api/leagues.ts), and the league's meets. Linked from the league standing search answer, league meet pages
// and the team page. ?team= marks that team's row. Server-rendered as its first paint (server/firstPaint.ts). A New
// Jersey league also has its conference rankings, a button to their own page (src/pages/ConferencePage.tsx), for
// visitors the gate lets see them (src/lib/conferenceGate.ts): never for a league elsewhere. An old link to the
// league page's #conferences opens that page.
import { CalendarDays, ListOrdered } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/api";
import { useTitle } from "../lib/meta";
import { ago } from "../lib/format";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { OfflineNote } from "../components/OfflineNote";
import { LeagueTable } from "../components/LeagueTable";
import { useConferenceGate } from "../lib/conferenceGate";
import { cn } from "../components/cn";
import { active, trigger } from "./RankingsPage";
import { conferenceHref, CONFERENCE_REGION, type LeagueConferences } from "../shared/conferences";
import { dateRange, seasonLabel } from "../shared/format";
import { leaguePageTitle, leagueTitle, type LeagueStandings } from "../shared/leagues";
import { regionHref, regionName } from "../shared/regionRankings";
// The league page has a server-drawn first paint (server/firstPaint.ts), where v8 can't be read: its v8 look is CSS
// only (`v8:` classes), so the first paint and the app's own draw are the same markup.
import { RankingsTabs, V8_CAPTION, V8_CARD_LINK, V8_EYEBROW, V8_HEAD, V8_ICON, V8_LINK } from "../components/rankings/v8";


export default function LeaguePage() {
  const { season = "", region = "", code = "" } = useParams();
  const [sp] = useSearchParams();
  const team = Number(sp.get("team")) || null;
  const navigate = useNavigate();
  const { hash } = useLocation();
  const ok = /^\d{4}$/.test(season) && /^[A-Za-z0-9]{1,16}$/.test(region) && /^[A-Za-z0-9]{1,16}$/.test(code);
  const state = useApi<LeagueStandings>(ok ? `/api/leagues/${season}/${region}/${code}` : null);
  const conferencesShown = useConferenceGate(ok ? region : null, ok ? Number(season) : null);
  const conf = useApi<LeagueConferences>(ok && conferencesShown && region.toUpperCase() === CONFERENCE_REGION ? `/api/leagues/${season}/${region}/${code}/conferences` : null);
  useTitle(state.data ? leaguePageTitle(state.data) : `${code.toUpperCase()} League`);
  // A link made before conference rankings had their own page (…#conferences): that page, same conference and team.
  useEffect(() => {
    if (ok && hash === "#conferences") navigate(conferenceHref(Number(season), region.toUpperCase(), code.toUpperCase(), { slug: sp.get("conference"), team }), { replace: true });
  }, [ok, hash]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ok) return <EmptyState icon={ListOrdered} title="No such league" description="This address doesn't name a league." />;
  return (
    <div className={cn("space-y-6", V8_HEAD)}>
      <Async state={state}>
        {(d) => {
          // Meets with a result (a meet on its day, before its first match, isn't in FIRST's standing yet).
          const played = d.meets.filter((m) => m.type === "LeagueMeet" && m.played).length;
          const waiting = d.rows.filter((r) => !r.played).length;
          return (
            <>
              <PageHeader eyebrow={<span className={V8_EYEBROW}>{seasonLabel(d.season)} league standings</span>} title={`${leagueTitle(d.name, d.code)}${d.place ? ` · ${d.place}` : ""}`}
                description={`FIRST's official league ranking: every team's matches across the league's ${played === 1 ? "first meet" : `${played} meets so far`}, ranked by ranking score.`}
                phoneDescription={`FIRST's league ranking after ${played === 1 ? "1 meet" : `${played} meets`}.`}>
                <RankingsTabs at="leagues" season={d.season} ssr />
              </PageHeader>
              <OfflineNote data={d} what="League standings" at={d.readAt} />
              {/* v8: the links are one quiet row; the conference button is an outline one, never the accent. */}
              <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm v8:-mt-3" aria-label="League links" data-league-links>
                {d.placeKey && <Link to={regionHref(d.placeKey, { season: d.season })} className={cn("text-accent-text hover:underline", V8_LINK)}>{regionName(d.placeKey)} rankings</Link>}
                <Link to={`/leagues?season=${d.season}`} className={cn("text-accent-text hover:underline", V8_LINK, "v8:hidden")}>All leagues</Link>
                {conf.data && (
                  <Link to={conferenceHref(d.season, d.region, d.code, { team })} className={cn(trigger, active, "v8:bg-transparent v8:hover:bg-white/[0.06]")} data-conference-button>
                    <ListOrdered className={cn("size-4 text-accent-text", V8_ICON)} aria-hidden />View Conference Rankings
                  </Link>
                )}
              </nav>
              {d.rows.length ? (
                <section aria-label="Standings" className="space-y-2">
                  <LeagueTable rows={d.rows} season={d.season} team={team} scout frameless />
                  <p className={cn("text-xs text-muted-foreground", V8_CAPTION)} data-league-note>
                    RS is the ranking score, FIRST's first sort key: average ranking points per match. Scout rating, OPR and region rank are Control Scout's, beside FIRST's standing, never part of it.{waiting ? ` ${waiting === 1 ? "1 team hasn't" : `${waiting} teams haven't`} played a league meet yet.` : ""}{d.readAt ? ` Read from FIRST ${ago(d.readAt)}.` : ""}
                  </p>
                </section>
              ) : <EmptyState icon={ListOrdered} title="No standings yet" description="FIRST publishes a league's standings once its first meet has scores. They show here within a few hours of that." />}
              {d.meets.length > 0 && (
                <section aria-labelledby="league-meets" className="space-y-2">
                  <h2 id="league-meets" className="font-display text-lg font-semibold v8:font-sans v8:text-base">Meets</h2>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {d.meets.map((m) => (
                      <li key={m.code}>
                        {/* v8 overrides the lift (no hover lifts) with `!` classes, since .lift is plain CSS and this page's markup is server-drawn. */}
                        <Link to={`/events/${d.season}/${encodeURIComponent(m.code)}`} className={cn("lift flex h-full items-center gap-3 rounded-xl border border-border bg-card p-3 hover:border-accent/60 v8:transition-colors! v8:duration-150! v8:hover:transform-none! v8:hover:shadow-none! v8:hover:border-white/[0.12]!", V8_CARD_LINK)}>
                          <CalendarDays className={cn("size-4 shrink-0 text-muted-foreground", V8_ICON)} aria-hidden />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{m.name}</span>
                            <span className={cn("block text-xs text-muted-foreground", V8_CAPTION)}>{dateRange(m.start) || "Date to be set"}{m.type === "LeagueTournament" ? " · League tournament" : ""}</span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          );
        }}
      </Async>
    </div>
  );
}
