// My teams: the FTC teams the signed-in account is on or manages in Control Point (src/lib/myTeams.ts),
// each with its season at a glance: OPR and rank, prediction rating, record, events, and its next and
// latest matches. Every team links to its full team page; each workspace to its shared scout space.
// Tapping a team's number and name folds its card down to the header, remembered per team on this device.
import { useMemo, useState, type ReactNode } from "react";
import { recordWords } from "../shared/format";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, ChevronDown, ClipboardList, ExternalLink, Hash, LogIn, RefreshCw, Sparkles, Star, Target, Trophy, Users } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/controls";
import { MatchList } from "../components/predict";
import { DiscordCard } from "../components/DiscordCard";
import { dateRange, num, rankPct, seasonLabel } from "../lib/format";
import { OFFICIAL_ONLY } from "../shared/eventRecord";
import { useIsV8 } from "../lib/v8";
import { cn } from "../components/cn";
import { V8Empty, V8Title, V8_LABEL, V8_ROW } from "../components/myteams/v8";

const CP_FALLBACK = "https://tryctrlpoint.org";

/** The teams folded down on this device (Tier 3, device-only: DEVICE_ONLY_KEYS). */
export const COLLAPSED_KEY = "cs-my-teams-collapsed";
function loadCollapsed(): number[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n): n is number => typeof n === "number") : [];
  } catch { return []; }
}
function saveCollapsed(team: number, collapsed: boolean) {
  const rest = loadCollapsed().filter((n) => n !== team);
  try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed ? [...rest, team] : rest)); } catch { /* blocked */ }
}

export default function MyTeamsPage() {
  useTitle("My teams");
  const { user, providers, refreshUser } = usePersonal();
  const mine = useMemo(() => myTeamsOf(user), [user]);
  const cpUrl = user?.controlPoint?.url || CP_FALLBACK;
  const v8 = useIsV8();
  if (v8) return <V8MyTeams mine={mine} cpUrl={cpUrl} providers={!!providers} signedIn={!!user} onRetry={() => void refreshUser()} />;
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
      <div className="space-y-6 max-sm:space-y-4">
        {mine.teams.map((t, i) => <TeamCard key={t.teamNumber} mine={t} delay={Math.min(i, 4) * 0.08} />)}
        {mine.unnumbered.map((w) => <UnnumberedCard key={w.id} w={w} cpUrl={cpUrl} />)}
        {/* The Discord bot: add it to your team's server and follow your teams there (components/DiscordCard.tsx). */}
        <DiscordCard teams={mine.teams.map((t) => t.teamNumber)} />
      </div>
      <p className="mt-8 max-sm:mt-5 text-sm text-muted-foreground">
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

/** One team's card data (both looks): the season shown, folded or open (remembered), and what's fetched for it. */
function useTeamCard(mine: MyTeam) {
  const team = mine.teamNumber;
  const current = useCurrentSeason();
  const meta = useMeta();
  const offered = (x: number) => meta?.seasons.find((m) => m.season === x)?.predictable ?? x >= 2023;
  // The current season once the team has played in it, else its latest earlier season (as My team does).
  const probe = useApi<TeamProfile>(`/api/teams/${team}${qs({ season: current })}`);
  const probed = probe.data?.team.number === team && probe.data.season === current ? probe.data : undefined;
  const season = probed ? defaultSeason(probed, offered) : null;
  // Folded down, the card shows only its header (number, name, season), so the rest isn't fetched until it opens.
  const [open, setOpen] = useState(() => !loadCollapsed().includes(team));
  const toggle = (o: boolean) => { setOpen(o); saveCollapsed(team, !o); };
  const shown = useApi<TeamProfile>(open && season != null && season !== current ? `/api/teams/${team}${qs({ season })}` : null);
  const profile = season === current ? probe : season == null ? { ...probe, data: undefined } : shown;
  const matches = useApi<{ matches: MatchView[] }>(open && season != null ? `/api/teams/${team}/matches${qs({ season })}` : null);
  const p = profile.data?.team.number === team ? profile.data : undefined;
  const name = probe.data?.team.number === team ? probe.data.team.name : undefined;
  const isCurrent = season === current;
  return { team, current, season, open, toggle, profile, matches, p, name, isCurrent, probe };
}

function TeamCard({ mine, delay = 0 }: { mine: MyTeam; delay?: number }) {
  const { team, current, season, open, toggle, profile, matches, p, name, isCurrent, probe } = useTeamCard(mine);
  return (
    <Reveal fade={false} delay={delay} className="overflow-hidden rounded-2xl border border-border bg-card">
      <Collapsible asChild open={open} onOpenChange={toggle}>
      <article aria-label={`Team ${team}`}>
        <header className={`flex flex-wrap items-start justify-between gap-4 p-4 sm:p-6 ${open ? "border-b border-border" : ""}`}>
          <div className="min-w-0">
            <CollapsibleTrigger className="group block max-w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <span className="flex items-center gap-2">
                <span className="font-display text-4xl font-semibold leading-none tracking-tight transition-colors group-hover:text-accent-text v8:text-accent">{team}</span>
                <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=closed]:-rotate-90 motion-reduce:transition-none" aria-hidden />
              </span>
              <span className="mt-1.5 block break-words text-lg text-foreground/90">
                {name === undefined ? (probe.error ? "Name not loaded" : <span className="skeleton inline-block h-5 w-44 rounded-md align-middle" />) : name ?? "Name not on file"}
              </span>
            </CollapsibleTrigger>
            <div className="mt-3 flex flex-wrap gap-2">{mine.workspaces.map((w) => <WorkspaceChip key={w.id} w={w} />)}</div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {season != null && <Badge variant={isCurrent ? "secondary" : "outline"}>{seasonLabel(season)}{!isCurrent && " · latest played"}</Badge>}
            <Button variant="secondary" size="sm" asChild className="max-sm:h-10">
              <Link to={season != null ? `/teams/${team}?season=${season}` : `/teams/${team}`}>Full team page <ArrowRight /></Link>
            </Button>
          </div>
        </header>
        <CollapsibleContent className="p-4 sm:p-6 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none">
          <Async state={profile} loading={<div className="skeleton h-28 rounded-xl" />}>
            {() => (p ? <Season p={p} isCurrent={isCurrent} current={current} /> : <div className="skeleton h-28 rounded-xl" />)}
          </Async>
          {season != null && (
            <Async state={matches} loading={<div className="skeleton mt-6 max-sm:mt-4 h-32 rounded-xl" />}>
              {(d) => <Matches team={team} matches={d.matches} events={p?.events ?? []} isCurrent={isCurrent} />}
            </Async>
          )}
        </CollapsibleContent>
      </article>
      </Collapsible>
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
          value={r ? <span aria-label={recordWords(r.wins, r.losses, r.ties)}><span className="text-success">{r.wins}</span><span className="text-muted-foreground">-</span><span className="text-destructive">{r.losses}</span><span className="text-muted-foreground">-{r.ties}</span></span> : "—"}
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
              <span className="min-w-0 basis-full truncate font-medium sm:basis-0 sm:flex-1" title={e.name}>{e.name}</span>
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
    <div className={isCurrent ? "mt-6 max-sm:mt-4 grid gap-6 max-sm:gap-4 lg:grid-cols-2" : "mt-6 max-sm:mt-4"}>
      {isCurrent && (
        <div className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold">Upcoming matches</h3>
          <MatchList matches={upcoming} highlight={team} eventNames={info.names} eventDates={info.dates} empty="No scheduled matches yet. Schedules usually appear the morning of an event." />
        </div>
      )}
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold">Latest results</h3>
        <MatchList matches={recent} highlight={team} eventNames={info.names} eventDates={info.dates} outcomeAccent newestFirst empty={isCurrent ? "No matches played this season yet." : "No matches played that season."} />
      </div>
    </div>
  );
}

/** A workspace whose Control Point team has no FTC number: nothing to show stats for, and how to fix it. */
function UnnumberedCard({ w, cpUrl }: { w: WorkspaceSpace; cpUrl: string }) {
  const scouting = useFlag("workspaceScouting");
  return (
    <section aria-label={workspaceLabel(w)} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-border p-4 sm:p-6">
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

// ---------------------------------------------------------------------------
// v8 (docs/design/v8-revamp-brief.md): the page rebuilt around "how are the teams I'm on doing?". Each team is one
// card whose header already answers it: number and name, the world standing by OPR, OPR, record and what's next,
// all visible while folded. Opened, it shows the season's events and the upcoming and latest matches. The states
// without teams are one quiet empty state each: one primary action, one outline.
// Drawn only while <html data-v8> is set; the functions above are the page without it.
// ---------------------------------------------------------------------------

function V8MyTeams({ mine, cpUrl, providers, signedIn, onRetry }: { mine: ReturnType<typeof myTeamsOf>; cpUrl: string; providers: boolean; signedIn: boolean; onRetry: () => void }) {
  const count = mine.teams.length + mine.unnumbered.length;
  const title = <V8Title title="My teams" line={signedIn && mine.known && count ? `${count} team${count === 1 ? "" : "s"} from your Control Point workspaces` : "The FTC teams you're on or manage in Control Point."} />;
  const body = !providers ? <div className="skeleton h-64 rounded-xl" aria-hidden />
    : !signedIn ? (
      <V8Empty icon={LogIn} title="Sign in to see your teams" line="Your teams come from your Control Point account. Browsing, search and predictions need no account."
        action={<><Button asChild><Link to="/settings?section=profile"><LogIn /> Sign in</Link></Button><Button variant="outline" asChild><Link to={FOLLOWED_TEAM_PATH}><Star /> Follow a team on this device</Link></Button></>} />
    ) : !mine.known ? (
      <V8Empty icon={RefreshCw} title="Couldn't reach Control Point" line="Your teams come from Control Point, and it didn't answer just now."
        action={<><Button onClick={onRetry}><RefreshCw /> Try again</Button><Button variant="outline" asChild><Link to={FOLLOWED_TEAM_PATH}><Star /> Followed team</Link></Button></>} />
    ) : !count ? (
      <V8Empty icon={Users} title="You're not on a team yet" line="Teams you join or create in Control Point show up here with their season. You can also follow any team on this device."
        action={<><Button asChild><a href={cpUrl} target="_blank" rel="noreferrer noopener"><ExternalLink /> Join or create a team</a></Button><Button variant="outline" asChild><Link to={FOLLOWED_TEAM_PATH}><Star /> Follow a team</Link></Button></>} />
    ) : (
      <>
        <div className="space-y-3">
          {mine.teams.map((t) => <V8TeamCard key={t.teamNumber} mine={t} />)}
          {mine.unnumbered.map((w) => <V8Unnumbered key={w.id} w={w} cpUrl={cpUrl} />)}
        </div>
        <div className="mt-8"><DiscordCard teams={mine.teams.map((t) => t.teamNumber)} /></div>
        <p className="mt-6 text-sm text-text-muted">
          Missing a team? Teams come from your Control Point workspaces.{" "}
          <a href={cpUrl} target="_blank" rel="noreferrer noopener" className="text-text-base underline underline-offset-2">Join or create one there</a>, or{" "}
          <Link to={FOLLOWED_TEAM_PATH} className="text-text-base underline underline-offset-2">follow any team on this device</Link>.
        </p>
      </>
    );
  return <div className="min-w-0" data-myteams-v8>{title}{body}</div>;
}

/** A workspace's role there: a quiet pill, linking to its shared scout space when workspace scouting is on. */
function V8Workspace({ w }: { w: WorkspaceSpace }) {
  const scouting = useFlag("workspaceScouting");
  const body = <>{workspaceLabel(w)}<span className="text-text-faint">{w.role === "admin" ? "Admin" : "Member"}</span></>;
  const pill = "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-xs text-text-muted pointer-coarse:min-h-[44px]";
  if (!scouting) return <span className={pill}>{body}</span>;
  return <Link to={scoutSpaceHref(w.id)} className={cn(pill, "transition-colors hover:bg-white/[0.04] hover:text-text-base")}><ClipboardList className="size-3.5" aria-hidden />{body}<span className="sr-only"> (open its scout space)</span></Link>;
}

/** v8 colours the owner asked for on this strip (Nov 19): OPR in soft gold, the rating in the slate-blue accent, wins
 *  green and losses red (the v8 tokens draw wins white elsewhere, so these are this strip's own). Deeper on light. */
const GOLD = "text-[#fcd34d] [html.light_&]:text-amber-700";
const WIN = "text-emerald-400 [html.light_&]:text-emerald-700";
const LOSS = "text-[#fb7185] [html.light_&]:text-rose-700";

/** A thin line under a figure (no box): the classic tiles' bars, drawn as hairlines. */
function Line({ children, label }: { children: ReactNode; label?: string }) {
  return <span className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-white/[0.06] [html.light_&]:bg-black/[0.06]" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} data-glance-line>{children}</span>;
}

/** The rating's ± as a marker: a band as wide as its uncertainty (relative to the rating) around a tick at the
 *  middle, so a narrow band reads as a sure number and a wide one as a guess. */
function SpreadMarker({ np, sd }: { np: number; sd: number }) {
  const w = Math.max(6, Math.min(100, np > 0 ? (2 * sd / np) * 100 : 100));
  return (
    <Line label={`± ${num(sd)} uncertainty`}>
      <span className="relative h-full w-full">
        <span className="absolute inset-y-0 rounded-full bg-accent/40" style={{ left: `${50 - w / 2}%`, width: `${w}%` }} />
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent" />
      </span>
    </Line>
  );
}

/**
 * The answer while folded, as one clean strip (no boxed, tinted tiles): standing, OPR, rating, record and what's next,
 * every number the classic tiles showed (OPR rank, the rating's ± and world rank, matches and events), each with a thin
 * line under it like the classic bars. Five columns on a wide card; two a row on a phone.
 */
function V8Glance({ p, next, isCurrent }: { p: TeamProfile; next: TeamEventRow | undefined; isCurrent: boolean }) {
  const s = p.stats!;
  const r = s.record;
  const decided = r.wins + r.losses + r.ties;
  const top = rankPct(s.opr.np.rank, s.opr.np.of, true);
  const cell = "min-w-0 sm:border-l sm:border-line sm:px-4 sm:first:border-l-0 sm:first:pl-0";
  const dd = "mt-0.5 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums";
  const sub = "text-[0.6875rem] leading-snug text-text-faint";
  return (
    <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-5 sm:gap-x-0" data-glance-strip>
      <div className={cell}>
        <dt className={V8_LABEL}>World</dt>
        <dd className={cn(dd, "text-text-base")}>{top ?? "—"}</dd>
        <dd className={sub}>{s.opr.np.rank ? "by OPR" : "not ranked"}</dd>
      </div>
      <div className={cell} data-glance="opr">
        <dt className={V8_LABEL}>OPR</dt>
        <dd className={cn(dd, GOLD)}>{num(s.opr.np.value)}</dd>
        <dd className={sub}>{s.opr.np.rank ? `#${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}` : "not ranked"}</dd>
        {s.opr.np.rank ? <Line><span className="h-full rounded-full bg-[#fcd34d] [html.light_&]:bg-amber-500" style={{ width: `${rankPc(s.opr.np.rank, s.opr.np.of)}%` }} data-bar /></Line> : null}
      </div>
      <div className={cell} data-glance="rating">
        <dt className={V8_LABEL}>Rating</dt>
        <dd className={cn(dd, "text-accent")}>{s.rating ? <>{num(s.rating.np)}<span className="ml-0.5 text-xs font-normal text-text-faint">±{num(s.rating.sd)}</span></> : "—"}</dd>
        <dd className={sub}>{s.rating ? `${s.rating.rank ? `#${s.rating.rank.toLocaleString()} worldwide · ` : ""}${s.rating.matches} match${s.rating.matches === 1 ? "" : "es"}` : p.season < 2023 ? "no ratings that season" : "not rated yet"}</dd>
        {s.rating && <SpreadMarker np={s.rating.np} sd={s.rating.sd} />}
      </div>
      <div className={cell} title={OFFICIAL_ONLY} data-glance="record">
        <dt className={V8_LABEL}>Record</dt>
        <dd className={dd}>{decided ? <span aria-label={recordWords(r.wins, r.losses, r.ties)}><span className={WIN}>{r.wins}</span><span className="text-text-faint">-</span><span className={LOSS}>{r.losses}</span><span className="text-text-faint">-</span><span className="text-text-muted">{r.ties}</span></span> : <span className="text-text-base">—</span>}</dd>
        <dd className={sub}>{decided ? `${r.matches} match${r.matches === 1 ? "" : "es"} · ${r.events} event${r.events === 1 ? "" : "s"}` : "no official results"}</dd>
        {decided > 0 && (
          <Line>
            <span className="h-full bg-emerald-400 [html.light_&]:bg-emerald-600" style={{ width: `${(r.wins / decided) * 100}%` }} data-bar />
            <span className="h-full bg-[#fb7185] [html.light_&]:bg-rose-600" style={{ width: `${(r.losses / decided) * 100}%` }} data-bar />
            <span className="h-full bg-text-muted/50" style={{ width: `${(r.ties / decided) * 100}%` }} data-bar />
          </Line>
        )}
      </div>
      <div className={cn(cell, "max-sm:col-span-2")} title={next?.name}>
        <dt className={V8_LABEL}>{next ? "Next event" : "Events"}</dt>
        <dd className={cn(dd, "text-text-base")}>{next ? dateRange(next.start, next.end).split(",")[0] : String(p.events.length)}</dd>
        <dd className={cn(sub, "truncate")}>{next ? next.name : isCurrent ? "none scheduled" : "that season"}</dd>
      </div>
    </dl>
  );
}

function V8TeamCard({ mine }: { mine: MyTeam }) {
  const { team, current, season, open, toggle, profile, matches, p, name, isCurrent, probe } = useTeamCard(mine);
  const s = p?.stats;
  const today = new Date().toISOString().slice(0, 10);
  const next = p && isCurrent ? p.events.find((e) => (e.end ?? e.start ?? "") >= today) : undefined;
  const href = season != null ? `/teams/${team}?season=${season}` : `/teams/${team}`;
  return (
    <Collapsible asChild open={open} onOpenChange={toggle}>
      <article aria-label={`Team ${team}`} className="overflow-hidden rounded-xl border border-line bg-card" data-team-card>
        <header className="flex flex-wrap items-start gap-x-6 gap-y-3 p-4 sm:p-5">
          <div className="min-w-0 flex-1 basis-[16rem]">
            <CollapsibleTrigger className="group flex max-w-full items-start gap-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              <ChevronDown className="mt-1.5 size-4 shrink-0 text-text-faint transition-transform duration-200 ease-out group-data-[state=closed]:-rotate-90 motion-reduce:transition-none" aria-hidden />
              <span className="min-w-0">
                <span className="block font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-text-base v8:text-accent">{team}</span>
                <span className="mt-1 block break-words text-sm font-medium text-text-base">
                  {name === undefined ? (probe.error ? <span className="text-text-muted">Name not loaded</span> : <span className="skeleton inline-block h-4 w-40 rounded align-middle" />) : name ?? <span className="text-text-muted">Name not on file</span>}
                </span>
              </span>
            </CollapsibleTrigger>
            <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6">{mine.workspaces.map((w) => <V8Workspace key={w.id} w={w} />)}</div>
          </div>
          {/* The answer while folded: standing, OPR, record, and what's next. */}
          <div className="min-w-0 flex-[3] basis-[30rem] max-sm:basis-full" data-team-glance>
            {!p ? (probe.error ? <p className="text-sm text-text-muted">Couldn't load this team's season.</p> : <div className="skeleton h-12 rounded-lg" aria-hidden />)
              : !s || s.record.matches === 0 ? <p className="text-sm text-text-muted">No results {isCurrent ? "this season" : `in ${seasonLabel(p.season)}`} yet.{next ? <> Next: <span className="text-text-base">{next.name}</span>, {dateRange(next.start, next.end)}.</> : ""}</p>
              : <V8Glance p={p} next={next} isCurrent={isCurrent} />}
          </div>
          <div className="flex items-center gap-1 max-sm:w-full" data-print-hide>
            {season != null && !isCurrent && <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-text-muted">{seasonLabel(season)} · latest played</span>}
            <Button variant="ghost" size="sm" asChild className="max-sm:ml-auto"><Link to={href}>Team page <ArrowRight /></Link></Button>
          </div>
        </header>
        <CollapsibleContent className="border-t border-line p-4 sm:p-5 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none">
          <Async state={profile} loading={<div className="skeleton h-28 rounded-xl" />}>
            {() => (p ? (
              <>
                {!isCurrent && <p className="mb-3 text-sm text-text-muted">No results in {seasonLabel(current)} yet, so this is {seasonLabel(p.season)}, the latest season it played.</p>}
                {p.events.length > 0 ? <V8Events events={p.events} isCurrent={isCurrent} today={today} /> : <p className="text-sm text-text-muted">No events in our data for {seasonLabel(p.season)}.</p>}
              </>
            ) : <div className="skeleton h-28 rounded-xl" />)}
          </Async>
          {season != null && (
            <Async state={matches} loading={<div className="skeleton mt-5 h-32 rounded-xl" />}>
              {(d) => <Matches team={team} matches={d.matches} events={p?.events ?? []} isCurrent={isCurrent} />}
            </Async>
          )}
        </CollapsibleContent>
      </article>
    </Collapsible>
  );
}

/** The season's events as hairline rows: ones not started yet, then the latest started, with rank and record there. */
function V8Events({ events, isCurrent, today }: { events: TeamEventRow[]; isCurrent: boolean; today: string }) {
  const upcoming = isCurrent ? events.filter((e) => (e.start ?? e.end ?? "") > today) : [];
  const played = events.filter((e) => !upcoming.includes(e)).reverse();
  const rows = [...upcoming.slice(0, 2).map((e) => ({ e, next: true })), ...played.slice(0, 3).map((e) => ({ e, next: false }))];
  return (
    <>
      <h3 className={cn(V8_LABEL, "mb-1.5")}>Events</h3>
      <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Events">
        {rows.map(({ e, next }) => {
          const rec = e.wins != null ? `${e.wins}-${e.losses ?? 0}-${e.ties ?? 0}` : null;
          const onNow = !next && e.rank == null && rec == null && (e.end ?? e.start ?? "") >= today;
          return (
            <li key={e.code}>
              <Link to={`/events/${e.season}/${e.code}`} className={cn(V8_ROW, "flex-wrap gap-x-3 gap-y-0.5 px-3 py-2 text-sm")}>
                <span className="min-w-0 basis-full truncate font-medium text-text-base sm:basis-0 sm:flex-1" title={e.name}>{e.name}</span>
                <span className="text-xs text-text-faint">{dateRange(e.start, e.end)}</span>
                {next ? <span className="text-xs text-text-muted">Upcoming</span> : onNow ? <span className="inline-flex items-center gap-1.5 text-xs text-text-muted"><span className="size-1.5 rounded-full bg-live" aria-hidden />On now</span> : (
                  <span className="flex items-center gap-3 text-xs tabular-nums text-text-muted">
                    {e.rank != null && <span>#{e.rank}<span className="sr-only"> rank</span></span>}
                    {e.wins != null && <span aria-label={recordWords(e.wins, e.losses ?? 0, e.ties ?? 0)}><span className={WIN}>{e.wins}</span>-<span className={LOSS}>{e.losses ?? 0}</span>-{e.ties ?? 0}</span>}
                    {e.opr.np != null && <span><span className="text-text-faint">OPR</span> {num(e.opr.np)}</span>}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A workspace whose Control Point team has no FTC number: nothing to show, and how to fix it. */
function V8Unnumbered({ w, cpUrl }: { w: WorkspaceSpace; cpUrl: string }) {
  const scouting = useFlag("workspaceScouting");
  return (
    <section aria-label={workspaceLabel(w)} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-line p-4 sm:p-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text-base">{workspaceLabel(w)} <span className="ml-1 font-normal text-text-faint">{w.role === "admin" ? "Admin" : "Member"}</span></p>
        <p className="mt-1 text-sm text-text-muted">No FTC team number is set for this team in Control Point, so there's no season to show. {w.role === "admin" ? "Add it in Control Point's team settings." : "An admin can add it in Control Point's team settings."}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {scouting && <Button variant="ghost" size="sm" asChild><Link to={scoutSpaceHref(w.id)}><ClipboardList /> Scout space</Link></Button>}
        <Button variant="outline" size="sm" asChild><a href={cpUrl} target="_blank" rel="noreferrer noopener"><ExternalLink /> Control Point</a></Button>
      </div>
    </section>
  );
}
