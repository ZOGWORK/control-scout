// /leagues/:season/:region/:code: one league's standings, FIRST's official league rankings over every meet so far
// (server/api/leagues.ts), and the league's meets. Linked from the league standing search answer, league meet pages
// and the team page. ?team= marks that team's row. Server-rendered as its first paint (server/firstPaint.ts).
import { CalendarDays, ListOrdered } from "lucide-react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/api";
import { useTitle } from "../lib/meta";
import { ago } from "../lib/format";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { OfflineNote } from "../components/OfflineNote";
import { LeagueTable } from "../components/LeagueTable";
import { dateRange, seasonLabel } from "../shared/format";
import { leaguePageTitle, leagueTitle, type LeagueStandings } from "../shared/leagues";


export default function LeaguePage() {
  const { season = "", region = "", code = "" } = useParams();
  const [sp] = useSearchParams();
  const team = Number(sp.get("team")) || null;
  const ok = /^\d{4}$/.test(season) && /^[A-Za-z0-9]{1,16}$/.test(region) && /^[A-Za-z0-9]{1,16}$/.test(code);
  const state = useApi<LeagueStandings>(ok ? `/api/leagues/${season}/${region}/${code}` : null);
  useTitle(state.data ? leaguePageTitle(state.data) : `${code.toUpperCase()} League`);
  if (!ok) return <EmptyState icon={ListOrdered} title="No such league" description="This address doesn't name a league." />;
  return (
    <div className="space-y-6">
      <Async state={state}>
        {(d) => {
          // Meets with a result (a meet on its day, before its first match, isn't in FIRST's standing yet).
          const played = d.meets.filter((m) => m.type === "LeagueMeet" && m.played).length;
          const waiting = d.rows.filter((r) => !r.played).length;
          return (
            <>
              <PageHeader eyebrow={`${seasonLabel(d.season)} league standings`} title={`${leagueTitle(d.name, d.code)}${d.place ? ` · ${d.place}` : ""}`}
                description={`FIRST's official league ranking: every team's matches across the league's ${played === 1 ? "first meet" : `${played} meets so far`}, ranked by ranking score.`}
                phoneDescription={`FIRST's league ranking after ${played === 1 ? "1 meet" : `${played} meets`}.`} />
              <OfflineNote data={d} what="League standings" at={d.readAt} />
              {d.rows.length ? (
                <section aria-label="Standings" className="space-y-2">
                  <LeagueTable rows={d.rows} season={d.season} team={team} />
                  <p className="text-xs text-muted-foreground" data-league-note>
                    RS is the ranking score, FIRST's first sort key: average ranking points per match.{waiting ? ` ${waiting === 1 ? "1 team hasn't" : `${waiting} teams haven't`} played a league meet yet.` : ""}{d.readAt ? ` Read from FIRST ${ago(d.readAt)}.` : ""}
                  </p>
                </section>
              ) : <EmptyState icon={ListOrdered} title="No standings yet" description="FIRST publishes a league's standings once its first meet has scores. They show here within a few hours of that." />}
              {d.meets.length > 0 && (
                <section aria-labelledby="league-meets" className="space-y-2">
                  <h2 id="league-meets" className="font-display text-lg font-semibold">Meets</h2>
                  <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {d.meets.map((m) => (
                      <li key={m.code}>
                        <Link to={`/events/${d.season}/${encodeURIComponent(m.code)}`} className="lift flex h-full items-center gap-3 rounded-xl border border-border bg-card p-3 hover:border-accent/60">
                          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{m.name}</span>
                            <span className="block text-xs text-muted-foreground">{dateRange(m.start) || "Date to be set"}{m.type === "LeagueTournament" ? " · League tournament" : ""}</span>
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
