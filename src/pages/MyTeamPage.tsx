// My Team dashboard: your team's next matches (with odds), recent results,
// next event outlook, and activity from the teams and events you track.
// Works with no account (saved on this device); signed in, it syncs.
import { OFFICIAL_ONLY } from "../shared/eventRecord";
import { recordWords } from "../shared/format";
import { useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarDays, Crosshair, Eye, History, Sparkles, Star, Swords, Target, Trophy, X } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useMeta, usePredictable, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventSummary, EventListItem, MatchView, TeamProfile, TeamSummary } from "../shared/api";
import { PageHeader, Section, EmptyState } from "../components/page";
import { Reveal, Stagger, StaggerItem } from "../components/motion";
import { Meter, RecordMeter, StatTile, TONES, rankPc } from "../components/StatTile";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/basic";
import { MatchList } from "../components/predict";
import { TeamInput, lookupTeamName } from "../components/TeamInput";
import { teamError } from "../lib/teamCheck";
import { SeasonToggle } from "../components/SeasonToggle";
import { EventCard } from "./Home";
import { dateRange, num, seasonLabel, rankPct } from "../lib/format";
import { callTally, pct } from "../lib/seasonSoFar";
import { DiscordCard } from "../components/DiscordCard";
import { defaultSeason } from "../lib/myTeamSeason";
import { PROFILE_PERCENTILE_TEXT } from "../lib/textTones";
import { useIsV8 } from "../lib/v8";
import { oddsPct } from "../shared/share";
import { cn } from "../components/cn";
import { V8Empty, V8Figures, V8Heading, V8Title, V8_CARD, V8_LABEL, V8_PRESS, V8_ROW } from "../components/myteams/v8";

export default function MyTeamPage() {
  useTitle("My team");
  const { state, set, user } = usePersonal();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current = useCurrentSeason();
  // An unknown number is caught here, not saved: the dashboard would be empty for it.
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const team = draft;
    setChecking(true);
    const err = await teamError(team, lookupTeamName);
    setChecking(false);
    if (latestDraft.current !== team) return; // edited while checking
    if (err) { setError(err); input.current?.focus(); return; }
    set("myTeam", Number(team));
  };
  const v8 = useIsV8();
  if (!state.myTeam && v8) {
    return <V8Pick draft={draft} error={error} checking={checking} input={input} onDraft={(v) => { setDraft(v); setError(null); }} onSubmit={submit}
      user={!!user} tracked={state.tracked.teams.length + state.tracked.events.length > 0} season={current} />;
  }
  if (!state.myTeam) {
    return (
      <div>
        <PageHeader title="My team" description="Pick your team to get a personal dashboard: your next matches with predictions, recent results, your next event's odds, and news from teams you track." />
        <div className="grid items-start gap-6 max-sm:gap-4 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-border bg-card p-6 max-sm:p-4">
          <form onSubmit={submit} noValidate className="flex items-start gap-2">
            <div className="flex-1"><TeamInput label="Your team number" value={draft} onChange={(v) => { setDraft(v); setError(null); }} autoFocus error={error} inputRef={input} /></div>
            <Button type="submit" className="h-11" disabled={!draft || checking}><Star /> Set</Button>
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
        {/* Teams tracked before picking your own still show up here. */}
        {state.tracked.teams.length + state.tracked.events.length > 0 && <div className="mt-8 max-sm:mt-5"><TrackedFeed season={current} /></div>}
      </div>
    );
  }
  return v8 ? <V8Dashboard team={state.myTeam} /> : <Dashboard team={state.myTeam} />;
}

/** Everything the dashboard shows for a team, the season chosen the same way for both looks. */
function useDashboard(team: number) {
  // ?season= shows a chosen season (kept in the URL, so it's linkable and Back works). Without it: the current
  // season once the team has played in it, else the latest season it played (decided before anything renders).
  const current = useCurrentSeason();
  const [sp, setSp] = useSearchParams();
  const meta = useMeta();
  const offered = (x: number) => meta?.seasons.find((m) => m.season === x)?.predictable ?? x >= 2023;
  const asked = Number(sp.get("season")) || null;
  // The season shown with no ?season=, per team: picked once from the current season's profile.
  const [picked, setPicked] = useState<{ team: number; season: number } | null>(null);
  const pickedSeason = picked?.team === team ? picked.season : null;
  const season = asked ?? pickedSeason ?? current;
  const isCurrent = season === current;
  const when = isCurrent ? "this season" : "that season";
  // A chosen season always goes in the URL (the current one too), so a reload or shared link keeps it.
  const setSeason = (s: number) => setSp((x) => { const n = new URLSearchParams(x); n.set("season", String(s)); return n; }, { replace: true });
  const { set } = usePersonal();
  // The team's seasons from the last load, so the toggle stays put while another season is fetched.
  const [known, setKnown] = useState<{ team: number; seasons: number[] } | null>(null);
  const fetched = useApi<TeamProfile>(`/api/teams/${team}${qs({ season })}`);
  // Deciding until the current season's profile is in (on an error the current season stays, with the error shown).
  const deciding = !asked && pickedSeason == null && !fetched.error;
  const probe = deciding && fetched.data?.team.number === team && fetched.data.season === current ? fetched.data : undefined;
  const auto = probe ? defaultSeason(probe, offered) : null;
  useEffect(() => { if (auto != null) setPicked({ team, season: auto }); }, [auto, team]);
  const fetchedMatches = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  // While deciding, everything shows its loading state, so the empty current season never flashes up.
  const profile = deciding ? { ...fetched, data: undefined } : fetched;
  const matches = deciding ? { ...fetchedMatches, data: undefined, error: undefined } : fetchedMatches;
  const loaded = profile.data?.team.number === team ? profile.data.seasons : undefined;
  useEffect(() => { if (loaded?.length) setKnown({ team, seasons: loaded }); }, [loaded, team]);
  const knownSeasons = loaded?.length ? loaded : known?.team === team ? known.seasons : null;
  // This team's profile for this season (not a previous team's or season's still on screen).
  const prof = profile.data?.team.number === team && profile.data.season === season ? profile.data : undefined;
  // Each event's full name and dates, for the match list's event headings.
  const eventInfo = useMemo(() => {
    const names: Record<string, string> = {}, dates: Record<string, string> = {};
    for (const e of prof?.events ?? []) { names[e.code] = e.name; dates[e.code] = dateRange(e.start, e.end); }
    return { names, dates };
  }, [prof]);
  // The latest earlier season the toggle offers (it lists predictable seasons only), so the button never opens one without a tab.
  const earlier = knownSeasons?.find((x) => x < season && offered(x));
  return { current, season, isCurrent, when, setSeason, set, deciding, profile, matches, knownSeasons, prof, eventInfo, earlier };
}

function Dashboard({ team }: { team: number }) {
  const { season, isCurrent, when, setSeason, set, deciding, profile, matches, knownSeasons, eventInfo, earlier } = useDashboard(team);
  return (
    <div>
      {/* Hero: who this is (big number, gold), and how the season is going. */}
      <Reveal fade={false} className="mb-4 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div className="relative min-w-0 p-4 sm:p-8">
            <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-accent opacity-[0.12] blur-3xl" />
            <div className="relative flex items-center justify-between gap-3">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.08em] text-accent-text"><Star className="size-3.5 fill-current" aria-hidden />My team{!deciding && ` · ${seasonLabel(season)}`}</p>
              <Button variant="ghost" size="sm" onClick={() => set("myTeam", null)} className="-mr-2 max-sm:h-10"><X /> Change team</Button>
            </div>
            <h1 className="relative mt-1">
              <Link to={`/teams/${team}`} className="group block">
                <span className="block font-display text-5xl font-semibold leading-none tracking-tight transition-colors group-hover:text-accent-text sm:text-6xl">{team}</span>
                <span className="mt-2 block break-words text-xl text-foreground/90">{profile.data?.team.number === team ? profile.data.team.name ?? "Name not on file" : <span className="skeleton inline-block h-6 w-48 rounded-md align-middle" />}</span>
              </Link>
            </h1>
            {/* The team's own seasons only: kept from the last load while a new season is fetched. */}
            <div className="relative mt-5 max-sm:mt-4">{knownSeasons ? <SeasonToggle predictOnly seasons={knownSeasons} value={season} onChange={setSeason} /> : <div className="skeleton h-9 w-72 max-w-full rounded-lg" />}</div>
            <Link to={`/teams/${team}?season=${season}`} className="relative mt-4 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-accent-text hover:underline">Full {team} page for this season <ArrowRight className="size-3" aria-hidden /></Link>
          </div>
          <div className="min-w-0 border-t border-border bg-secondary/60 p-4 sm:p-8 lg:border-l lg:border-t-0">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Season so far</p>
            <Async state={profile} loading={<div className="skeleton mt-3 h-40 rounded-xl" />}>
              {(d) => <SeasonSoFar p={d} team={team} matches={matches.data?.matches} matchesFailed={!!matches.error} when={when} earlier={earlier} onSeason={setSeason} />}
            </Async>
          </div>
        </div>
      </Reveal>
      <Async state={profile} loading={<div className="skeleton mb-8 max-sm:mb-5 h-36 rounded-xl" />}>
        {(p) => {
          const s = p.stats;
          const today = new Date().toISOString().slice(0, 10);
          const next = isCurrent ? p.events.find((e) => (e.end ?? e.start ?? "") >= today) : undefined;
          const top = rankPct(s?.opr.np.rank, s?.opr.np.of);
          const r = s?.record;
          const last = p.events[p.events.length - 1];
          return (
            <>
              <Stagger className="mb-8 max-sm:mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StaggerItem><StatTile tone="accent" icon={Target} label="OPR" value={num(s?.opr.np.value)}
                  hint={s?.opr.np.rank ? `#${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}${top ? ` · ${top}` : ""}` : isCurrent ? "not ranked yet" : "not ranked"}
                  bar={s?.opr.np.rank ? <Meter parts={[{ pc: rankPc(s.opr.np.rank, s.opr.np.of), cls: TONES.accent.bar }]} /> : null} /></StaggerItem>
                {/* Same colours as the team page: rating amber, record green, events violet. */}
                <StaggerItem><StatTile tone="amber" icon={Sparkles} label="Prediction rating"
                  value={s?.rating ? <>{num(s.rating.np)}<span className="ml-1 text-base font-medium text-muted-foreground">±{num(s.rating.sd)}</span></> : "—"}
                  hint={s?.rating ? `${s.rating.rank ? `#${s.rating.rank.toLocaleString()} worldwide · ` : ""}${s.rating.matches} matches` : `no matches ${when}`} /></StaggerItem>
                <StaggerItem><StatTile tone="emerald" icon={Trophy} label="Record"
                  value={r ? <span aria-label={recordWords(r.wins, r.losses, r.ties)}><span className="text-success">{r.wins}</span><span className="text-muted-foreground">-</span><span className="text-destructive">{r.losses}</span><span className="text-muted-foreground">-{r.ties}</span></span> : "—"}
                  // The record is official events only; the matches and events counted beside it are every one played.
                  hint={r ? `${OFFICIAL_ONLY} · ${r.matches} matches at ${r.events} event${r.events === 1 ? "" : "s"} in all` : `no matches ${when}`}
                  bar={r && r.wins + r.losses + r.ties > 0 ? <RecordMeter w={r.wins} l={r.losses} t={r.ties} /> : null} /></StaggerItem>
                <StaggerItem>{isCurrent
                  ? <StatTile tone="violet" icon={CalendarDays} label="Next event" value={next ? dateRange(next.start, next.end).split(",")[0] : "—"} hint={next?.name ?? "none scheduled in our data"} />
                  : <StatTile tone="violet" icon={CalendarDays} label="Events" value={String(p.events.length)} hint={last ? `last: ${last.name}` : "none in our data"} />}</StaggerItem>
              </Stagger>
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
                  <MatchList matches={upcoming} highlight={team} eventNames={eventInfo.names} eventDates={eventInfo.dates} empty="No scheduled matches yet — schedules usually appear the morning of an event." />
                </Section>
              )}
              <Section title={isCurrent ? "Recent results" : `Every match (${d.matches.length})`} description="Was each one called before it was played?">
                <MatchList matches={recent} highlight={team} eventNames={eventInfo.names} eventDates={eventInfo.dates} outcomeAccent newestFirst empty={`No matches played ${when}.`} />
              </Section>
            </>
          );
        }}
      </Async>
      {!deciding && <TrackedFeed season={season} />}
      {/* Your team's match alerts in your Discord server (components/DiscordCard.tsx). */}
      <div className="mt-10"><DiscordCard teams={[team]} /></div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season so far + stat tiles (the team page's tile language: a tinted tile per stat, its icon, a bar where there's a rank)
// ---------------------------------------------------------------------------

/** The hero's right half: world standing by OPR in gold, then win rate and how many calls were right. */
function SeasonSoFar({ p, team, matches, matchesFailed, when, earlier, onSeason }: { p: TeamProfile; team: number; matches?: MatchView[]; matchesFailed: boolean; when: string; earlier?: number; onSeason: (s: number) => void }) {
  const s = p.stats;
  const predictable = usePredictable(p.season);
  const calls = useMemo(() => (matches ? callTally(matches, team) : null), [matches, team]);
  // Any match counts (a scrimmage's too): the record holds official events only, the season's numbers every event.
  if (!s || s.record.matches === 0) {
    return (
      <div className="mt-4 space-y-3 text-sm">
        <p className="text-muted-foreground">No results {when} yet.</p>
        {earlier && (
          <button type="button" onClick={() => onSeason(earlier)} className="lift flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left">
            <span>See how {team} did in {seasonLabel(earlier)}</span><ArrowRight className="size-4 shrink-0 text-accent-text" aria-hidden />
          </button>
        )}
      </div>
    );
  }
  const r = s.record;
  const top = rankPct(s.opr.np.rank, s.opr.np.of, true);
  const winRate = pct(r.wins, r.wins + r.losses + r.ties);
  // Live calls first; replayed ones only when there are no live ones, and always labelled as replayed.
  const shown = calls ? (calls.live.of ? { ...calls.live, live: true } : calls.backtest.of ? { ...calls.backtest, live: false } : null) : null;
  return (
    <>
      <p className={`mt-3 font-display text-5xl font-semibold tabular-nums ${PROFILE_PERCENTILE_TEXT}`}>{top ?? "Unranked"}</p>
      <p className="text-sm text-muted-foreground">worldwide by OPR{s.opr.np.rank ? ` · #${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}` : ""}</p>
      <div className="mt-5 max-sm:mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-success/30 bg-success/[0.07] p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Trophy className="size-3.5 text-success" aria-hidden />Win rate</p>
          {/* Off-season matches and scrimmages only: no official result to make a win rate from (the record counts
              official events only), said so instead of an empty rate. */}
          {r.wins + r.losses + r.ties === 0 ? <p className="mt-1 text-sm text-muted-foreground" data-no-official>No official results yet: {r.matches} match{r.matches === 1 ? "" : "es"} at off-season events and scrimmages, not in the record.</p> : <>
          <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-success">{winRate}%</p>
          <div className="mt-2"><RecordMeter w={r.wins} l={r.losses} t={r.ties} /></div>
          <p className="mt-1.5 text-xs text-muted-foreground"><span className="font-medium text-success">{r.wins} won</span> · <span className="font-medium text-destructive">{r.losses} lost</span>{r.ties > 0 && <> · {r.ties} tied</>}</p>
          </>}
        </div>
        {predictable && (
          <div className="rounded-xl border border-info/30 bg-info/[0.07] p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Crosshair className="size-3.5 text-info" aria-hidden />Our calls</p>
            {matchesFailed ? <p className="mt-1 text-sm text-muted-foreground">Couldn't load this season's matches, so there's no tally of calls. The match list below can retry.</p>
              : !calls ? <div className="skeleton mt-2 h-14 rounded-lg" /> : shown ? (
              <>
                <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-info">{shown.right} of {shown.of}<span className="ml-1.5 text-sm font-medium text-muted-foreground">{pct(shown.right, shown.of)}%</span></p>
                <div className="mt-2"><Meter parts={[{ pc: pct(shown.right, shown.of) ?? 0, cls: TONES.sky.bar }]} /></div>
                <p className="mt-1.5 text-xs text-muted-foreground">{shown.live ? "called right before the match" : "right when replayed afterward (not live calls)"}</p>
              </>
            ) : <p className="mt-1 text-sm text-muted-foreground">No decided matches with a call {when}.</p>}
          </div>
        )}
      </div>
    </>
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
            {/* grid-cols-1, not the implicit column: an implicit track grows to its longest line, so a long event name would
                push the row (and its Stop tracking button) off a phone screen instead of truncating. */}
            {(d) => (
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {d.teams.map((t) => (
                  <li key={t.team} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
                    <Link to={`/teams/${t.team}?season=${season}`} className="min-w-0 flex-1">
                      <p className="truncate font-medium"><span className="font-mono">{t.team}</span> <span className="text-muted-foreground">{t.name}</span></p>
                      <p className="mt-0.5 text-xs text-muted-foreground">OPR {num(t.opr)}{t.oprRank ? ` (#${t.oprRank})` : ""} · rating {num(t.rating)} · {t.record ?? "no record"}</p>
                      {t.lastEvent && <p className="mt-1 truncate text-xs">Last: {t.lastEvent.name}{t.lastEvent.rank ? ` — ranked #${t.lastEvent.rank}` : ""}</p>}
                      {t.nextEvent && <p className="truncate text-xs text-accent-text">Next: {t.nextEvent.name} · {dateRange(t.nextEvent.start, t.nextEvent.end)}</p>}
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
              return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{evs.map((e) => <EventCard key={e.code} e={e} />)}{!evs.length && <Badge variant="outline">Tracked events aren't in this season's list</Badge>}</div>;
            }}
          </Async>
        )}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// v8 (docs/design/v8-revamp-brief.md): the page rebuilt around "what's my team's next match, and our chances?".
// First screen: who the team is, then the next match with its chance to win as the hero number (or the next event
// and its odds), then the season's standing in one row. The match lists, tracked teams and events, and the Discord
// card follow. Without a team: one box to pick it, and a quiet list of what the dashboard will show.
// Drawn only while <html data-v8> is set; the functions above are the page without it.
// ---------------------------------------------------------------------------

const V8_PROMISE = [
  { icon: Swords, title: "Your next match", body: "The chance to win and the reasons why, before every match." },
  { icon: Trophy, title: "Your next event's odds", body: "Chance to advance, to captain, to win." },
  { icon: History, title: "Recent results", body: "Every match this season, with the call made before it." },
  { icon: Eye, title: "Teams you track", body: "Rivals and partners: their latest events and OPR." },
];

function V8Pick({ draft, error, checking, input, onDraft, onSubmit, user, tracked, season }: {
  draft: string; error: string | null; checking: boolean; input: RefObject<HTMLInputElement | null>; onDraft: (v: string) => void;
  onSubmit: (e: FormEvent) => void; user: boolean; tracked: boolean; season: number;
}) {
  return (
    <div className="min-w-0" data-myteam-v8>
      <V8Title title="My team" line="Pick your team to see its next match and its chances." />
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section aria-label="Pick your team" className={V8_CARD} data-pick-team>
          <form onSubmit={onSubmit} noValidate className="flex items-start gap-2">
            <div className="min-w-0 flex-1"><TeamInput label="Your team number" value={draft} onChange={onDraft} autoFocus error={error} inputRef={input} /></div>
            <Button type="submit" className="h-11" disabled={!draft || checking}><Star /> Set</Button>
          </form>
          <p className="mt-2 text-xs text-text-faint">{user ? "Saved to your account." : <>Saved on this device. <Link to="/settings?section=profile" className="text-text-muted underline underline-offset-2 hover:text-text-base">Sign in</Link> to sync it.</>}</p>
        </section>
        <ul className="divide-y divide-line rounded-xl border border-line bg-card" aria-label="What your dashboard shows">
          {V8_PROMISE.map((x) => (
            <li key={x.title} className="flex gap-3 px-4 py-3 sm:px-5">
              <x.icon className="mt-0.5 size-4 shrink-0 text-text-faint" aria-hidden />
              <div className="min-w-0"><p className="text-sm font-medium text-text-base">{x.title}</p><p className="text-sm text-text-muted">{x.body}</p></div>
            </li>
          ))}
        </ul>
      </div>
      {tracked && <div className="mt-8 max-sm:mt-6"><V8Tracked season={season} /></div>}
    </div>
  );
}

function V8Dashboard({ team }: { team: number }) {
  const { season, isCurrent, when, setSeason, set, deciding, profile, matches, knownSeasons, prof, eventInfo, earlier } = useDashboard(team);
  const name = profile.data?.team.number === team ? profile.data.team.name : undefined;
  const ready = !deciding && !!prof;
  return (
    <div className="min-w-0" data-myteam-v8>
      <header className="mb-5 max-sm:mb-4" data-myteam-hero>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1 text-xs text-text-faint"><Star className="size-3 fill-current text-accent" aria-hidden />My team</p>
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link to={`/teams/${team}?season=${season}`} className="font-display text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums hover:underline sm:text-[3.25rem]" data-team-number>{team}</Link>
              <span className="min-w-0 break-words text-xl font-semibold tracking-tight text-text-base sm:text-[1.375rem]">
                {name === undefined ? <span className="skeleton inline-block h-6 w-44 rounded-md align-middle" /> : name ?? <span className="text-text-muted">Name not on file</span>}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2" data-print-hide>
            <Button variant="outline" asChild><Link to={`/teams/${team}?season=${season}`}>Team page <ArrowRight /></Link></Button>
            <Button variant="ghost" onClick={() => set("myTeam", null)}><X /> Change team</Button>
          </div>
        </div>
        <div className="mt-4">{knownSeasons ? <SeasonToggle predictOnly seasons={knownSeasons} value={season} onChange={setSeason} /> : <div className="skeleton h-9 w-72 max-w-full rounded-lg" />}</div>
      </header>
      {profile.error && !deciding ? <div className="mb-8"><Async state={profile}>{() => null}</Async></div> : (
        <div className="mb-8 grid gap-3 max-sm:mb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
          {ready && (matches.data || matches.error) ? <V8Next team={team} p={prof} matches={matches.data?.matches ?? null} isCurrent={isCurrent} names={eventInfo.names} />
            : <div className="skeleton h-48 rounded-xl" aria-hidden />}
          {ready ? <V8Standing p={prof} team={team} matches={matches.data?.matches} matchesFailed={!!matches.error} when={when} earlier={earlier} onSeason={setSeason} />
            : <div className="skeleton h-48 rounded-xl" aria-hidden />}
        </div>
      )}
      <Async state={matches} loading={<div className="skeleton h-40 rounded-xl" />}>
        {(d) => {
          const upcoming = d.matches.filter((m) => !m.played);
          const played = d.matches.filter((m) => m.played).reverse();
          const recent = isCurrent ? played.slice(0, 6) : [...d.matches].reverse();
          return (
            <>
              {isCurrent && (
                <section className="mb-8 max-sm:mb-6" aria-labelledby="v8-upcoming">
                  <V8Heading id="v8-upcoming" title={`Upcoming matches${upcoming.length ? ` (${upcoming.length})` : ""}`} line="With the chance to win from today's ratings, or the call already logged." />
                  <MatchList matches={upcoming} highlight={team} eventNames={eventInfo.names} eventDates={eventInfo.dates} empty="No scheduled matches yet. Schedules usually appear the morning of an event." />
                </section>
              )}
              <section className="mb-8 max-sm:mb-6" aria-labelledby="v8-recent">
                <V8Heading id="v8-recent" title={isCurrent ? "Recent results" : `Every match (${d.matches.length})`} line="Was each one called right before it was played?" />
                <MatchList matches={recent} highlight={team} eventNames={eventInfo.names} eventDates={eventInfo.dates} outcomeAccent newestFirst empty={`No matches played ${when}.`} />
              </section>
            </>
          );
        }}
      </Async>
      {!deciding && <V8Tracked season={season} />}
      <div className="mt-8"><DiscordCard teams={[team]} /></div>
    </div>
  );
}

/** The side a team is on in a match, who's with and against it, and its chance to win there. */
export function sideOf(m: MatchView, team: number) {
  const red = m.red.teams.some((t) => t.number === team);
  const blue = m.blue.teams.some((t) => t.number === team);
  if (!red && !blue) return null;
  const mine = red ? m.red : m.blue, theirs = red ? m.blue : m.red;
  const p = m.prediction ? (red ? m.prediction.pRed : 1 - m.prediction.pRed) : null;
  return { color: red ? "red" as const : "blue" as const, partners: mine.teams.filter((t) => t.number !== team), opponents: theirs.teams, p };
}

/** The answer first: the next match and the chance to win it, else the next event and its odds, else what's known. */
function V8Next({ team, p, matches, isCurrent, names }: { team: number; p: TeamProfile; matches: MatchView[] | null; isCurrent: boolean; names: Record<string, string> }) {
  const today = new Date().toISOString().slice(0, 10);
  // A match never posted at an event that has ended isn't next: it would hide the real next one.
  const ended = new Set(p.events.filter((e) => (e.end ?? e.start ?? "9999") < today).map((e) => e.code));
  const nextMatch = isCurrent && matches ? matches.find((m) => !m.played && !ended.has(m.code)) ?? null : null;
  const nextEvent = isCurrent ? p.events.find((e) => (e.end ?? e.start ?? "") >= today) ?? null : null;
  const side = nextMatch ? sideOf(nextMatch, team) : null;
  const oddsHref = nextEvent ? `/events/${nextEvent.season}/${nextEvent.code}?tab=odds&team=${team}` : null;
  const last = p.events[p.events.length - 1];
  return (
    <section aria-labelledby="v8-next" className={V8_CARD} data-next>
      <h2 id="v8-next" className={V8_LABEL}>{nextMatch && side ? "Next match" : nextEvent ? "Next event" : isCurrent ? "What's next" : `Last event · ${seasonLabel(p.season)}`}</h2>
      {nextMatch && side ? (
        <div data-next-match>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <p className="font-display text-[2.5rem] font-semibold leading-none tabular-nums text-text-base" data-next-chance>{side.p == null ? "—" : oddsPct(side.p)}</p>
              <p className="mt-1.5 text-xs text-text-muted">{side.p == null ? "no call yet for this match" : "chance to win"}</p>
            </div>
            <div className="min-w-0 text-right max-sm:basis-full max-sm:text-left">
              <p className="text-sm font-medium tabular-nums text-text-base">{nextMatch.label}<span className={cn("ml-2 text-xs font-normal", side.color === "red" ? "text-red-alliance" : "text-blue-alliance")}>{side.color === "red" ? "Red" : "Blue"} alliance</span></p>
              <p className="truncate text-xs text-text-faint" title={names[nextMatch.code]}>{names[nextMatch.code] ?? nextMatch.code}{nextMatch.time ? ` · ${nextMatch.time.slice(11, 16)}` : ""}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
            <div className="min-w-0"><dt className={V8_LABEL}>With</dt><dd className="truncate tabular-nums text-text-base">{side.partners.length ? side.partners.map((t) => t.number).join(", ") : "—"}</dd></div>
            <div className="min-w-0"><dt className={V8_LABEL}>Against</dt><dd className="truncate tabular-nums text-text-base">{side.opponents.map((t) => t.number).join(", ") || "—"}</dd></div>
          </dl>
          {oddsHref && <div className="mt-3 -ml-2"><Button variant="ghost" size="sm" asChild><Link to={oddsHref}><Trophy /> Chance to advance at {nextEvent!.name}</Link></Button></div>}
        </div>
      ) : nextEvent ? (
        <div className="mt-2" data-next-event>
          <p className="text-lg font-semibold tracking-tight text-text-base">{nextEvent.name}</p>
          <p className="mt-0.5 text-sm text-text-muted">{dateRange(nextEvent.start, nextEvent.end)}</p>
          <p className="mt-2 text-xs text-text-faint">{matches === null ? "Couldn't load the matches, so the next one isn't shown. The list below can retry." : "No schedule yet: it usually appears the morning of the event."}</p>
          {oddsHref && <div className="mt-3"><Button variant="outline" size="sm" asChild><Link to={oddsHref}><Trophy /> Chance to advance</Link></Button></div>}
        </div>
      ) : (
        <div className="mt-2 text-sm" data-next-none>
          {isCurrent ? <p className="text-text-muted">No event scheduled in our data yet. It shows here once {team} is registered for one.</p>
            : last ? <Link to={`/events/${last.season}/${last.code}?team=${team}`} className="block hover:underline"><span className="font-medium text-text-base">{last.name}</span><span className="block text-text-muted">{dateRange(last.start, last.end)}{last.rank ? ` · ranked #${last.rank}` : ""}</span></Link>
            : <p className="text-text-muted">No events in our data for {seasonLabel(p.season)}.</p>}
        </div>
      )}
    </section>
  );
}

/** How the season is going: the world standing by OPR as the figure, then OPR, rating, record and the calls. */
function V8Standing({ p, team, matches, matchesFailed, when, earlier, onSeason }: { p: TeamProfile; team: number; matches?: MatchView[]; matchesFailed: boolean; when: string; earlier?: number; onSeason: (s: number) => void }) {
  const s = p.stats;
  const predictable = usePredictable(p.season);
  const calls = useMemo(() => (matches ? callTally(matches, team) : null), [matches, team]);
  if (!s || s.record.matches === 0) {
    return (
      <section aria-labelledby="v8-standing" className={V8_CARD} data-standing>
        <h2 id="v8-standing" className={V8_LABEL}>Season so far · {seasonLabel(p.season)}</h2>
        <p className="mt-2 text-sm text-text-muted">No results {when} yet.</p>
        {earlier && (
          <button type="button" onClick={() => onSeason(earlier)} className={cn(V8_ROW, V8_PRESS, "mt-3 w-full justify-between rounded-lg border border-line px-3 text-left text-sm")}>
            <span>See how {team} did in {seasonLabel(earlier)}</span><ArrowRight className="size-4 shrink-0 text-text-muted" aria-hidden />
          </button>
        )}
      </section>
    );
  }
  const r = s.record;
  const top = rankPct(s.opr.np.rank, s.opr.np.of, true);
  const decided = r.wins + r.losses + r.ties;
  // Live calls first; replayed ones only when there are no live ones, and labelled as replayed.
  const shown = calls ? (calls.live.of ? { ...calls.live, live: true } : calls.backtest.of ? { ...calls.backtest, live: false } : null) : null;
  const items = [
    { label: "OPR", value: num(s.opr.np.value) },
    { label: "Rating", value: s.rating ? <>{num(s.rating.np)}<span className="text-xs font-normal text-text-faint"> ±{num(s.rating.sd, 0)}</span></> : "—" },
    { label: "Record", value: decided ? <span aria-label={recordWords(r.wins, r.losses, r.ties)}>{r.wins}-{r.losses}-{r.ties}</span> : "—", sub: decided ? `${pct(r.wins, decided)}% won` : "no official results", title: OFFICIAL_ONLY },
    ...(predictable ? [{
      label: "Our calls",
      value: matchesFailed ? "—" : !calls ? <span className="skeleton inline-block h-5 w-10 rounded align-middle" /> : shown ? `${pct(shown.right, shown.of)}%` : "—",
      sub: matchesFailed ? "matches didn't load" : shown ? `${shown.right} of ${shown.of} right${shown.live ? "" : ", replayed"}` : calls ? "none decided yet" : undefined,
    }] : []),
  ];
  return (
    <section aria-labelledby="v8-standing" className={V8_CARD} data-standing>
      <h2 id="v8-standing" className={V8_LABEL}>Season so far · {seasonLabel(p.season)}</h2>
      <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div>
          <p className="font-display text-[2.5rem] font-semibold leading-none tabular-nums text-text-base" data-hero-figure>{top ?? "Unranked"}</p>
          <p className="mt-1.5 text-xs text-text-muted">worldwide by OPR{s.opr.np.rank ? ` · #${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}` : ""}</p>
        </div>
        <V8Figures items={items} className="flex-1 basis-[20rem] max-sm:basis-full max-sm:border-t max-sm:border-line max-sm:pt-3" />
      </div>
      {decided === 0 && <p className="mt-3 text-xs text-text-faint" data-no-official>{r.matches} match{r.matches === 1 ? "" : "es"} at off-season events and scrimmages, not in the record.</p>}
    </section>
  );
}

/** Tracked teams as quiet rows in one card, then tracked events. */
function V8Tracked({ season }: { season: number }) {
  const { state, update } = usePersonal();
  const teams = state.tracked.teams;
  const events = state.tracked.events.filter((e) => e.startsWith(`${season}:`));
  const summary = useApi<{ teams: TeamSummary[] }>(teams.length ? `/api/teams-summary${qs({ teams: teams.slice(0, 100).join(","), season })}` : null);
  const evList = useApi<{ events: EventListItem[] }>(events.length ? `/api/events${qs({ season })}` : null);
  return (
    <>
      <section className="mb-8 max-sm:mb-6" aria-labelledby="v8-tracked">
        <V8Heading id="v8-tracked" title={`Tracked teams${teams.length ? ` (${teams.length})` : ""}`} line="Teams you follow: press Track on any team's page." />
        {!teams.length ? <V8Empty icon={Eye} title="Not tracking any teams" line="Open a team and press Track. Tracked teams show up here and come first in search." /> : (
          <Async state={summary} loading={<div className="skeleton h-32 rounded-xl" />}>
            {(d) => (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card" data-tracked-teams>
                {d.teams.map((t) => (
                  <li key={t.team} className={cn(V8_ROW, "gap-2 pl-3 pr-1.5 sm:pl-4")}>
                    <Link to={`/teams/${t.team}?season=${season}`} className="grid min-w-0 flex-1 grid-cols-[3.75rem_minmax(0,1fr)] items-baseline gap-x-3 py-2 sm:grid-cols-[3.75rem_minmax(0,1fr)_minmax(0,16rem)_4.5rem_4.5rem]">
                      <span className="font-display font-semibold tabular-nums text-text-base">{t.team}</span>
                      <span className="truncate text-sm text-text-base">{t.name ?? "Name not on file"}</span>
                      <span className="col-start-2 truncate text-xs text-text-faint sm:col-start-auto" title={t.nextEvent?.name ?? t.lastEvent?.name}>
                        {t.nextEvent ? <>Next: {t.nextEvent.name}, {dateRange(t.nextEvent.start, t.nextEvent.end)}</> : t.lastEvent ? <>Last: {t.lastEvent.name}{t.lastEvent.rank ? `, ranked #${t.lastEvent.rank}` : ""}</> : null}
                      </span>
                      <span className="text-right text-sm tabular-nums text-text-muted max-sm:hidden"><span className="text-xs text-text-faint">OPR </span>{num(t.opr)}</span>
                      <span className="text-right text-sm tabular-nums text-text-muted max-sm:hidden">{t.record ?? "—"}</span>
                    </Link>
                    <Button variant="ghost" size="icon-sm" aria-label={`Stop tracking ${t.team}`} onClick={() => update("tracked", (x) => ({ ...x, teams: x.teams.filter((n) => n !== t.team) }))}><X /></Button>
                  </li>
                ))}
              </ul>
            )}
          </Async>
        )}
      </section>
      <section className="mb-8 max-sm:mb-6" aria-labelledby="v8-tracked-events">
        <V8Heading id="v8-tracked-events" title="Tracked events" line={`Events you follow in ${seasonLabel(season)}.`} />
        {!events.length ? <V8Empty icon={CalendarDays} title="Not tracking any events" line="Open an event and press Track event." /> : (
          <Async state={evList} loading={<div className="skeleton h-28 rounded-xl" />}>
            {(d) => {
              const evs = d.events.filter((e) => events.includes(`${e.season}:${e.code}`));
              return evs.length ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{evs.map((e) => <EventCard key={e.code} e={e} />)}</div>
                : <p className="text-sm text-text-muted">Your tracked events aren't in this season's list.</p>;
            }}
          </Async>
        )}
      </section>
    </>
  );
}
