// My Team dashboard: your team's next matches (with odds), recent results,
// next event outlook, and activity from the teams and events you track.
// Works with no account (saved on this device); signed in, it syncs.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarDays, Eye, History, Star, Swords, Trophy, X } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventSummary, EventListItem, MatchView, TeamProfile, TeamSummary } from "../shared/api";
import { PageHeader, Section, EmptyState, Stat } from "../components/page";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/basic";
import { MatchList } from "../components/predict";
import { TeamInput } from "../components/TeamInput";
import { SeasonToggle } from "../components/SeasonToggle";
import { EventCard } from "./Home";
import { dateRange, num, topPct } from "../lib/format";

export default function MyTeamPage() {
  useTitle("My team");
  const { state, set, user } = usePersonal();
  const [draft, setDraft] = useState("");
  if (!state.myTeam) {
    return (
      <div>
        <PageHeader title="My team" description="Pick your team to get a personal dashboard: your next matches with predictions, recent results, your next event's odds, and news from teams you track." />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-card p-6">
          <form onSubmit={(e) => { e.preventDefault(); if (draft) set("myTeam", Number(draft)); }} className="flex items-start gap-2">
            <div className="flex-1"><TeamInput label="Your team number" value={draft} onChange={setDraft} autoFocus /></div>
            <Button type="submit" className="h-11" disabled={!draft}><Star /> Set</Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">{user ? "Saved to your account." : <>Saved on this device. <Link to="/settings?section=profile" className="underline">Sign in</Link> to sync it across devices.</>}</p>
        </div>
        {/* What the dashboard will hold, so the first visit isn't an empty page. */}
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="What your dashboard shows">
          {[
            { icon: Swords, title: "Your next matches", body: "Win odds and the three reasons why, before every match you play." },
            { icon: Trophy, title: "Your next event's odds", body: "Chance to advance, to captain, to win, from 2,000 simulated events." },
            { icon: History, title: "Recent results", body: "Every match this season with the call we made before it, right or wrong." },
            { icon: Eye, title: "Teams you track", body: "Rivals and partners: their latest events and OPR, in one feed." },
          ].map((x) => (
            <li key={x.title} className="flex gap-3 rounded-xl border border-border/70 bg-card/60 p-4">
              <x.icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
              <div><p className="text-sm font-semibold">{x.title}</p><p className="mt-0.5 text-sm text-muted-foreground">{x.body}</p></div>
            </li>
          ))}
        </ul>
        </div>
      </div>
    );
  }
  return <Dashboard team={state.myTeam} />;
}

function Dashboard({ team }: { team: number }) {
  // The current season by default; ?season= shows an earlier one (kept in the URL, so it's linkable and Back works).
  const current = useCurrentSeason();
  const [sp, setSp] = useSearchParams();
  const season = Number(sp.get("season")) || current;
  const isCurrent = season === current;
  const when = isCurrent ? "this season" : "that season";
  const setSeason = (s: number) => setSp((x) => { const n = new URLSearchParams(x); if (s === current) n.delete("season"); else n.set("season", String(s)); return n; }, { replace: true });
  const { set } = usePersonal();
  const [knownSeasons, setKnownSeasons] = useState<number[] | null>(null);
  const profile = useApi<TeamProfile>(`/api/teams/${team}${qs({ season })}`);
  const matches = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  const loaded = profile.data?.seasons;
  useEffect(() => { if (loaded?.length) setKnownSeasons(loaded); }, [loaded]);
  useEffect(() => { setKnownSeasons(null); }, [team]);
  return (
    <div>
      <PageHeader eyebrow="My team" title={<Link to={`/teams/${team}`} className="hover:underline">{team} {profile.data?.team.name ?? ""}</Link>}
        actions={<Button variant="ghost" size="sm" onClick={() => set("myTeam", null)}><X /> Change team</Button>} />
      <div className="-mt-2 mb-6 flex flex-wrap items-center gap-3">
        {/* The team's own seasons only: kept from the last load while a new season is fetched. */}
        {knownSeasons ? <SeasonToggle seasons={knownSeasons} value={season} onChange={setSeason} /> : <div className="skeleton h-9 w-72 rounded-lg" />}
        <Link to={`/teams/${team}?season=${season}`} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Full {team} page for this season</Link>
      </div>
      <Async state={profile}>
        {(p) => {
          const s = p.stats;
          const today = new Date().toISOString().slice(0, 10);
          const next = isCurrent ? p.events.find((e) => (e.end ?? e.start ?? "") >= today) : undefined;
          return (
            <>
              <div className="mb-8 grid grid-cols-2 gap-6 rounded-2xl border border-border bg-card p-6 lg:grid-cols-4">
                <Stat label="OPR" value={num(s?.opr.np.value)} hint={topPct(s?.opr.np.rank, s?.opr.np.of) ?? (isCurrent ? "not ranked yet" : "not ranked")} />
                <Stat label="Prediction rating" value={s?.rating ? num(s.rating.np) : "—"} hint={s?.rating ? `± ${num(s.rating.sd)} · ${s.rating.matches} matches` : `no matches ${when}`} />
                <Stat label="Record" value={s ? `${s.record.wins}-${s.record.losses}-${s.record.ties}` : "—"} hint={s ? `${s.record.events} events` : undefined} />
                {isCurrent
                  ? <Stat label="Next event" value={next ? dateRange(next.start, next.end).split(",")[0] : "—"} hint={next?.name ?? "none scheduled in our data"} />
                  : <Stat label="Events" value={String(p.events.length)} hint={p.events.length ? `last: ${p.events[p.events.length - 1].name}` : "none in our data"} />}
              </div>
              {next && (
                <Section title={`Next event: ${next.name}`} description={dateRange(next.start, next.end)} action={<Button variant="secondary" size="sm" asChild><Link to={`/events/${next.season}/${next.code}?tab=odds&team=${team}`}><Trophy /> Advancement odds</Link></Button>}>
                  <p className="text-sm text-muted-foreground">Open the odds tab for {team}'s chance to advance, captain and pick odds, likely rank and who'd make the best partner.</p>
                </Section>
              )}
            </>
          );
        }}
      </Async>
      <Async state={matches} loading={<div className="skeleton h-40 rounded-xl" />}>
        {(d) => {
          const upcoming = d.matches.filter((m) => !m.played);
          const played = d.matches.filter((m) => m.played).reverse();
          // This season: the latest few. Earlier seasons: every match, newest first.
          // Earlier seasons: everything returned (a match with no posted result still belongs to that season).
          const recent = isCurrent ? played.slice(0, 6) : [...d.matches].reverse();
          return (
            <>
              {isCurrent && (
                <Section title="Upcoming matches" description="With win odds from today's ratings (or the call already logged).">
                  <MatchList matches={upcoming} highlight={team} empty="No scheduled matches yet — schedules usually appear the morning of an event." />
                </Section>
              )}
              <Section title={isCurrent ? "Recent results" : `Every match (${d.matches.length})`} description="Was each one called before it was played?">
                <MatchList matches={recent} highlight={team} empty={`No matches played ${when}.`} />
              </Section>
            </>
          );
        }}
      </Async>
      <TrackedFeed season={season} />
    </div>
  );
}

function TrackedFeed({ season }: { season: number }) {
  const { state, update } = usePersonal();
  const teams = state.tracked.teams;
  const events = state.tracked.events.filter((e) => e.startsWith(`${season}:`));
  const summary = useApi<{ teams: TeamSummary[] }>(teams.length ? `/api/teams-summary${qs({ teams: teams.slice(0, 100).join(","), season })}` : null);
  const evList = useApi<{ events: EventListItem[] }>(events.length ? `/api/events${qs({ season })}` : null);
  return (
    <>
      <Section title="Tracked teams" description="Teams you follow — track any team from its page.">
        {!teams.length ? <EmptyState icon={Eye} title="Not tracking any teams" description="Open a team and press Track. Tracked teams show up here and get priority in search." /> : (
          <Async state={summary} loading={<div className="skeleton h-32 rounded-xl" />}>
            {(d) => (
              <ul className="grid gap-2 sm:grid-cols-2">
                {d.teams.map((t) => (
                  <li key={t.team} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                    <Link to={`/teams/${t.team}?season=${season}`} className="min-w-0 flex-1">
                      <p className="truncate font-medium"><span className="font-mono">{t.team}</span> <span className="text-muted-foreground">{t.name}</span></p>
                      <p className="mt-0.5 text-xs text-muted-foreground">OPR {num(t.opr)}{t.oprRank ? ` (#${t.oprRank})` : ""} · rating {num(t.rating)} · {t.record ?? "no record"}</p>
                      {t.lastEvent && <p className="mt-1 truncate text-xs">Last: {t.lastEvent.name}{t.lastEvent.rank ? ` — ranked #${t.lastEvent.rank}` : ""}</p>}
                      {t.nextEvent && <p className="truncate text-xs text-accent">Next: {t.nextEvent.name} · {dateRange(t.nextEvent.start, t.nextEvent.end)}</p>}
                    </Link>
                    <Button variant="ghost" size="icon-sm" aria-label={`Stop tracking ${t.team}`} onClick={() => update("tracked", (x) => ({ ...x, teams: x.teams.filter((n) => n !== t.team) }))}><X /></Button>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        )}
      </Section>
      <Section title="Tracked events" description="Events you follow this season.">
        {!events.length ? <EmptyState icon={CalendarDays} title="Not tracking any events" description="Open an event and press Track event." /> : (
          <Async state={evList} loading={<div className="skeleton h-28 rounded-xl" />}>
            {(d) => {
              const evs = d.events.filter((e) => events.includes(`${e.season}:${e.code}`));
              return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{evs.map((e) => <EventCard key={e.code} e={e} />)}{!evs.length && <Badge variant="outline">Tracked events aren't in this season's list</Badge>}</div>;
            }}
          </Async>
        )}
      </Section>
    </>
  );
}
