// My teams: the FTC teams the signed-in account is on or manages in Control Point (src/lib/myTeams.ts),
// each with its season at a glance: OPR and rank, prediction rating, record, events, and its next and
// latest matches. Every team links to its full team page; each workspace to its shared scout space.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, ClipboardList, ExternalLink, Hash, LogIn, RefreshCw, Sparkles, Star, Target, Trophy, Users } from "lucide-react";
import { qs, useApi } from "../lib/api";
import { useCurrentSeason, useMeta, useTitle } from "../lib/meta";
import { useFlag } from "../lib/flags";
import { usePersonal } from "../lib/personal";
import { myTeamsOf, type MyTeam } from "../lib/myTeams";
import { scoutSpaceHref, workspaceLabel, type WorkspaceSpace } from "../lib/scoutSpace";
import { FOLLOWED_TEAM_PATH } from "../lib/yoursRow";
import { defaultSeason } from "../lib/myTeamSeason";
import type { MatchView, TeamEventRow, TeamProfile } from "../shared/api";
import { EmptyState, PageHeader } from "../components/page";
import { Reveal, Stagger, StaggerItem } from "../components/motion";
import { Meter, RecordMeter, StatTile, TONES, rankPc } from "../components/StatTile";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/basic";
import { MatchList } from "../components/predict";
import { DiscordCard } from "../components/DiscordCard";
import { dateRange, num, rankPct, seasonLabel } from "../lib/format";

const CP_FALLBACK = "https://tryctrlpoint.org";

export default function MyTeamsPage() {
  useTitle("My teams");
  const { user, providers, refreshUser } = usePersonal();
  const mine = useMemo(() => myTeamsOf(user), [user]);
  const cpUrl = user?.controlPoint?.url || CP_FALLBACK;
  const header = <PageHeader title="My teams" description="The FTC teams you're on or manage in Control Point, with how each one's season is going." />;

  if (!providers) return <div>{header}<div className="skeleton h-64 rounded-2xl" /></div>;
  if (!user) {
    return (
      <div>
        {header}
        <EmptyState icon={LogIn} title="Sign in to see your teams"
          description="Your teams come from your Control Point account. Browsing, search and predictions need no account."
          action={<div className="flex flex-wrap justify-center gap-2">
            <Button asChild><Link to="/settings?section=profile"><LogIn /> Sign in</Link></Button>
            <Button variant="secondary" asChild><Link to={FOLLOWED_TEAM_PATH}><Star /> Follow a team on this device</Link></Button>
          </div>} />
      </div>
    );
  }
  if (!mine.known) {
    return (
      <div>
        {header}
        <EmptyState icon={RefreshCw} title="Couldn't reach Control Point"
          description="Your teams come from Control Point, and it didn't answer just now, so this page can't list them yet."
          action={<div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => void refreshUser()}><RefreshCw /> Try again</Button>
            <Button variant="secondary" asChild><Link to={FOLLOWED_TEAM_PATH}><Star /> Followed team</Link></Button>
          </div>} />
      </div>
    );
  }
  if (!mine.teams.length && !mine.unnumbered.length) {
    return (
      <div>
        {header}
        <EmptyState icon={Users} title="You're not on a team yet"
          description="Teams you join or create in Control Point show up here with their stats. You can also follow any team on this device."
          action={<div className="flex flex-wrap justify-center gap-2">
            <Button asChild><a href={cpUrl} target="_blank" rel="noreferrer noopener"><ExternalLink /> Join or create a team in Control Point</a></Button>
            <Button variant="secondary" asChild><Link to={FOLLOWED_TEAM_PATH}><Star /> Follow a team</Link></Button>
          </div>} />
      </div>
    );
  }
  return (
    <div>
      {header}
      <div className="space-y-6">
        {mine.teams.map((t, i) => <TeamCard key={t.teamNumber} mine={t} delay={Math.min(i, 4) * 0.08} />)}
        {mine.unnumbered.map((w) => <UnnumberedCard key={w.id} w={w} cpUrl={cpUrl} />)}
        {/* The Discord bot: add it to your team's server and follow your teams there (components/DiscordCard.tsx). */}
        <DiscordCard teams={mine.teams.map((t) => t.teamNumber)} />
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        Missing a team? Teams come from your Control Point workspaces.{" "}
        <a href={cpUrl} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-accent-text">Join or create one there</a>, or{" "}
        <Link to={FOLLOWED_TEAM_PATH} className="underline underline-offset-2 hover:text-accent-text">follow any team on this device</Link>.
      </p>
    </div>
  );
}

/** A workspace's role there, linking to its shared scout space (when workspace scouting is on). */
function WorkspaceChip({ w }: { w: WorkspaceSpace }) {
  const scouting = useFlag("workspaceScouting");
  const body = <>{workspaceLabel(w)}<span className="text-muted-foreground">{w.role === "admin" ? "Admin" : "Member"}</span></>;
  if (!scouting) return <Badge variant="outline" className="gap-1.5">{body}</Badge>;
  return (
    <Link to={scoutSpaceHref(w.id)} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium hover:border-accent/50 hover:text-accent-text">
      <ClipboardList className="size-3.5" aria-hidden />{body}<span className="sr-only"> (open its scout space)</span>
    </Link>
  );
}

function TeamCard({ mine, delay = 0 }: { mine: MyTeam; delay?: number }) {
  const team = mine.teamNumber;
  const current = useCurrentSeason();
  const meta = useMeta();
  const offered = (x: number) => meta?.seasons.find((m) => m.season === x)?.predictable ?? x >= 2023;
  // The current season once the team has played in it, else its latest earlier season (as My team does).
  const probe = useApi<TeamProfile>(`/api/teams/${team}${qs({ season: current })}`);
  const probed = probe.data?.team.number === team && probe.data.season === current ? probe.data : undefined;
  const season = probed ? defaultSeason(probed, offered) : null;
  const shown = useApi<TeamProfile>(season != null && season !== current ? `/api/teams/${team}${qs({ season })}` : null);
  const profile = season === current ? probe : season == null ? { ...probe, data: undefined } : shown;
  const matches = useApi<{ matches: MatchView[] }>(season != null ? `/api/teams/${team}/matches${qs({ season })}` : null);
  const p = profile.data?.team.number === team ? profile.data : undefined;
  const name = probe.data?.team.number === team ? probe.data.team.name : undefined;
  const isCurrent = season === current;

  return (
    <Reveal fade={false} delay={delay} className="overflow-hidden rounded-2xl border border-border bg-card">
      <article aria-label={`Team ${team}`}>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-5 sm:p-6">
          <div className="min-w-0">
            <Link to={season != null ? `/teams/${team}?season=${season}` : `/teams/${team}`} className="group block">
              <span className="font-display text-4xl font-semibold leading-none tracking-tight transition-colors group-hover:text-accent-text">{team}</span>
              <span className="mt-1.5 block break-words text-lg text-foreground/90">
                {name === undefined ? (probe.error ? "Name not loaded" : <span className="skeleton inline-block h-5 w-44 rounded-md align-middle" />) : name ?? "Name not on file"}
              </span>
            </Link>
            <div className="mt-3 flex flex-wrap gap-2">{mine.workspaces.map((w) => <WorkspaceChip key={w.id} w={w} />)}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {season != null && <Badge variant={isCurrent ? "secondary" : "outline"}>{seasonLabel(season)}{!isCurrent && " · latest played"}</Badge>}
            <Button variant="secondary" size="sm" asChild className="max-sm:h-11">
              <Link to={season != null ? `/teams/${team}?season=${season}` : `/teams/${team}`}>Full team page <ArrowRight /></Link>
            </Button>
          </div>
        </header>
        <div className="p-5 sm:p-6">
          <Async state={profile} loading={<div className="skeleton h-28 rounded-xl" />}>
            {() => (p ? <Season p={p} isCurrent={isCurrent} current={current} /> : <div className="skeleton h-28 rounded-xl" />)}
          </Async>
          {season != null && (
            <Async state={matches} loading={<div className="skeleton mt-6 h-32 rounded-xl" />}>
              {(d) => <Matches team={team} matches={d.matches} events={p?.events ?? []} isCurrent={isCurrent} />}
            </Async>
          )}
        </div>
      </article>
    </Reveal>
  );
}

/** The team page's tiles: OPR with world rank, prediction rating, record, and the next (or latest) event. */
function Season({ p, isCurrent, current }: { p: TeamProfile; isCurrent: boolean; current: number }) {
  const s = p.stats;
  const r = s?.record;
  const when = isCurrent ? "this season" : `in ${seasonLabel(p.season)}`;
  const top = rankPct(s?.opr.np.rank, s?.opr.np.of);
  const today = new Date().toISOString().slice(0, 10);
  const next = isCurrent ? p.events.find((e) => (e.end ?? e.start ?? "") >= today) : undefined;
  const played = p.events.filter((e) => (e.end ?? e.start ?? "") < today || !isCurrent);
  const last = played[played.length - 1];
  return (
    <>
      {!isCurrent && <p className="mb-3 text-sm text-muted-foreground">No results in {seasonLabel(current)} yet, so this is {seasonLabel(p.season)}, the latest season it played.</p>}
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StaggerItem><StatTile tone="accent" icon={Target} label="OPR" value={num(s?.opr.np.value)}
          hint={s?.opr.np.rank ? `#${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}${top ? ` · ${top}` : ""}` : isCurrent ? "not ranked yet" : "not ranked"}
          bar={s?.opr.np.rank ? <Meter parts={[{ pc: rankPc(s.opr.np.rank, s.opr.np.of), cls: TONES.accent.bar }]} /> : null} /></StaggerItem>
        <StaggerItem><StatTile tone="amber" icon={Sparkles} label="Prediction rating"
          value={s?.rating ? <>{num(s.rating.np)}<span className="ml-1 text-base font-medium text-muted-foreground">±{num(s.rating.sd)}</span></> : "—"}
          hint={s?.rating ? `${s.rating.rank ? `#${s.rating.rank.toLocaleString()} worldwide · ` : ""}${s.rating.matches} matches` : `no matches ${when}`} /></StaggerItem>
        <StaggerItem><StatTile tone="emerald" icon={Trophy} label="Record"
          value={r ? <span aria-label={`${r.wins} wins, ${r.losses} losses, ${r.ties} ties`}><span className="text-success">{r.wins}</span><span className="text-muted-foreground">-</span><span className="text-destructive">{r.losses}</span><span className="text-muted-foreground">-{r.ties}</span></span> : "—"}
          hint={r ? `${r.matches} matches · ${r.events} event${r.events === 1 ? "" : "s"}` : `no matches ${when}`}
          bar={r && r.wins + r.losses + r.ties > 0 ? <RecordMeter w={r.wins} l={r.losses} t={r.ties} /> : null} /></StaggerItem>
        <StaggerItem>{next
          ? <StatTile tone="violet" icon={CalendarDays} label="Next event" value={dateRange(next.start, next.end).split(",")[0]} hint={next.name} />
          : <StatTile tone="violet" icon={CalendarDays} label={isCurrent ? "Next event" : "Events"} value={isCurrent ? "—" : String(p.events.length)}
              hint={isCurrent ? "none scheduled in our data" : last ? `last: ${last.name}` : "none in our data"} />}</StaggerItem>
      </Stagger>
      {p.events.length > 0 && <Events events={p.events} isCurrent={isCurrent} today={today} />}
    </>
  );
}

/** The season's events: ones not started yet, then the latest started (one on now included), each with rank and record there. */
function Events({ events, isCurrent, today }: { events: TeamEventRow[]; isCurrent: boolean; today: string }) {
  const upcoming = isCurrent ? events.filter((e) => (e.start ?? e.end ?? "") > today) : [];
  const played = events.filter((e) => !upcoming.includes(e)).reverse();
  const rows = [...upcoming.slice(0, 2).map((e) => ({ e, next: true })), ...played.slice(0, 3).map((e) => ({ e, next: false }))];
  return (
    <ul className="mt-4 divide-y divide-border rounded-xl border border-border" aria-label="Events">
      {rows.map(({ e, next }) => {
        const rec = e.wins != null ? `${e.wins}-${e.losses ?? 0}-${e.ties ?? 0}` : null;
        return (
          <li key={e.code}>
            <Link to={`/events/${e.season}/${e.code}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-text-base/[0.04]">
              <span className="min-w-0 basis-full truncate font-medium sm:basis-0 sm:flex-1">{e.name}</span>
              <span className="text-xs text-muted-foreground">{dateRange(e.start, e.end)}</span>
              {next ? <Badge variant="secondary">Upcoming</Badge> : e.rank == null && rec == null && (e.end ?? e.start ?? "") >= today ? <Badge variant="secondary">On now</Badge> : (
                <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
                  {e.rank != null && <span className="inline-flex items-center gap-0.5"><Hash className="size-3" aria-hidden />{e.rank}<span className="sr-only"> rank</span></span>}
                  {rec && <span>{rec}</span>}
                  {e.opr.np != null && <span>OPR {num(e.opr.np)}</span>}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Matches({ team, matches, events, isCurrent }: { team: number; matches: MatchView[]; events: TeamEventRow[]; isCurrent: boolean }) {
  const info = useMemo(() => {
    const names: Record<string, string> = {}, dates: Record<string, string> = {};
    for (const e of events) { names[e.code] = e.name; dates[e.code] = dateRange(e.start, e.end); }
    return { names, dates };
  }, [events]);
  // Unplayed matches at events that have ended (a result never posted) aren't upcoming: they'd push out the real next ones.
  const today = new Date().toISOString().slice(0, 10);
  const ended = new Set(events.filter((e) => (e.end ?? e.start ?? "9999") < today).map((e) => e.code));
  const upcoming = isCurrent ? matches.filter((m) => !m.played && !ended.has(m.code)).slice(0, 3) : [];
  const recent = matches.filter((m) => m.played).reverse().slice(0, 3);
  return (
    <div className={isCurrent ? "mt-6 grid gap-6 lg:grid-cols-2" : "mt-6"}>
      {isCurrent && (
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold">Upcoming matches</h3>
          <MatchList matches={upcoming} highlight={team} eventNames={info.names} eventDates={info.dates} empty="No scheduled matches yet. Schedules usually appear the morning of an event." />
        </div>
      )}
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold">Latest results</h3>
        <MatchList matches={recent} highlight={team} eventNames={info.names} eventDates={info.dates} outcomeAccent empty={isCurrent ? "No matches played this season yet." : "No matches played that season."} />
      </div>
    </div>
  );
}

/** A workspace whose Control Point team has no FTC number: nothing to show stats for, and how to fix it. */
function UnnumberedCard({ w, cpUrl }: { w: WorkspaceSpace; cpUrl: string }) {
  const scouting = useFlag("workspaceScouting");
  return (
    <section aria-label={workspaceLabel(w)} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-border p-5 sm:p-6">
      <div className="min-w-0">
        <p className="font-display text-lg font-semibold">{workspaceLabel(w)} <span className="ml-1 text-sm font-normal text-muted-foreground">{w.role === "admin" ? "Admin" : "Member"}</span></p>
        <p className="mt-1 text-sm text-muted-foreground">No FTC team number is set for this team in Control Point, so there are no stats to show. {w.role === "admin" ? "Add the number in Control Point's team settings." : "An admin can add it in Control Point's team settings."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {scouting && <Button variant="secondary" size="sm" asChild><Link to={scoutSpaceHref(w.id)}><ClipboardList /> Scout space</Link></Button>}
        <Button variant="secondary" size="sm" asChild><a href={cpUrl} target="_blank" rel="noreferrer noopener"><ExternalLink /> Control Point</a></Button>
      </div>
    </section>
  );
}
