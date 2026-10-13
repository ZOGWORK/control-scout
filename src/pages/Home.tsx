// Home: search first; the core loop (events, prediction lab) big and inviting;
// the track record impossible to miss; your team's next match one tap away.
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BadgeCheck, CalendarDays, Download, MapPin, Radio, Scale, Search, Sparkles, Star } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useMeta, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventSummary, MatchView, TrackRecord } from "../shared/api";
import { useSearch } from "../components/layout/Search";
import { Section } from "../components/page";
import { Async } from "../components/states";
import { Reveal, Stagger, StaggerItem } from "../components/motion";
import { Badge } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { WinBar } from "../components/predict";
import { cn } from "../components/cn";
import { dateRange, matchTime, oddsPct, pct, place, seasonLabel, ago } from "../lib/format";
import { BrandMark } from "../components/layout/Shell";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function Home() {
  useTitle(null);
  const { user, state } = usePersonal();
  const nav = useNavigate();
  // Signed-in users with a team land on their dashboard (once per visit).
  useEffect(() => {
    if (user && state.myTeam && !sessionStorage.getItem("cs-landed")) {
      sessionStorage.setItem("cs-landed", "1");
      nav("/my-team", { replace: true });
    }
  }, [user, state.myTeam, nav]);
  return (
    <div className="space-y-10">
      <Hero />
      {state.myTeam && <MyTeamNext team={state.myTeam} />}
      <CoreLoop />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ThisWeek />
        <TrackRecordCard />
      </div>
      <MoreTools />
    </div>
  );
}

function Hero() {
  const { open } = useSearch();
  const meta = useMeta();
  return (
    <Reveal className="pt-2 text-center sm:pt-8">
      <BrandMark className="mx-auto size-12" />
      <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">FTC Control Scout</h1>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Every FTC team, event and match — with predictions that keep a public score of how often they come true. Free, no login.</p>
      <button onClick={open} className="lift mx-auto mt-7 flex h-14 w-full max-w-2xl items-center gap-3 rounded-2xl border border-line bg-card px-5 text-left text-muted-foreground shadow-[0_8px_40px_-12px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]">
        <Search className="size-5 text-accent" />
        <span className="flex-1 truncate">Team number or name (typos are fine), an event, or “USNJQ1 Q12”…</span>
        <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-xs sm:inline">⌘K</kbd>
      </button>
      {meta && <p className="mt-3 text-xs text-muted-foreground">{meta.seasons.length} seasons · data updated {ago(meta.dataAsOf)} · engine v{meta.engineVersion}</p>}
    </Reveal>
  );
}

/** Event-day: your team's next match and its odds, one tap from home. */
function MyTeamNext({ team }: { team: number }) {
  const season = useCurrentSeason();
  const { data, error } = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  const next = data?.matches.find((m) => !m.played);
  const side = next ? (next.red.teams.some((t) => t.number === team) ? "red" : "blue") : null;
  const pWin = next?.prediction ? (side === "red" ? next.prediction.pRed : 1 - next.prediction.pRed) : null;
  return (
    <Link to="/my-team" className="lift flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3 text-sm">
      <Star className="size-4 fill-accent text-accent" />
      <span className="font-mono font-semibold">{team}</span>
      {next ? (
        <>
          <span className="text-muted-foreground">Next: {next.label} · {next.code} · {matchTime(next.time)}</span>
          {pWin != null && <><WinBar pRed={next.prediction!.pRed} size="sm" className="w-24" /><span className="font-semibold">{oddsPct(pWin)} to win</span></>}
        </>
      ) : !data ? (
        <span className="text-muted-foreground">{error ? "Couldn't load the schedule — open your dashboard" : "Checking the schedule…"}</span>
      ) : <span className="text-muted-foreground">No scheduled match yet — your dashboard has the next event's odds.</span>}
      <ArrowRight className="ml-auto size-4 text-accent" />
    </Link>
  );
}

/** The core loop, big: find an event, ask who wins. */
function CoreLoop() {
  const items = [
    { to: "/predict", icon: Sparkles, title: "Who wins?", body: "Pick any four teams — win odds, predicted scores, the three reasons why, and how sure we are.", cta: "Open the prediction lab" },
    { to: "/events", icon: CalendarDays, title: "Events", body: "Every event this season: live results, rankings, brackets, and any team's odds of advancing.", cta: "Browse events" },
  ];
  return (
    <Stagger className="grid gap-4 md:grid-cols-2">
      {items.map((x) => (
        <StaggerItem key={x.to}>
          <Link to={x.to} className="lift group relative flex h-full items-start gap-4 overflow-hidden rounded-2xl border border-border bg-card p-6">
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-accent/10 blur-2xl transition-opacity group-hover:opacity-100 opacity-60" />
            <span className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/15"><x.icon className="size-5 text-accent" /></span>
            <span className="relative min-w-0">
              <span className="block font-display text-xl font-semibold">{x.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{x.body}</span>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent">{x.cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
            </span>
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  );
}

function ThisWeek() {
  const season = useCurrentSeason();
  const now = new Date();
  const from = iso(new Date(now.getTime() - 2 * 864e5)), to = iso(new Date(now.getTime() + 7 * 864e5));
  const state = useApi<{ events: EventSummary[] }>(`/api/events${qs({ season, from, to })}`);
  return (
    <Section title="This week" description={`${seasonLabel(season)} events running now or in the next 7 days`} action={<Button variant="ghost" size="sm" asChild><Link to="/events">All events <ArrowRight /></Link></Button>} className="mb-0">
      <Async state={state} loading={<div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28 rounded-xl" />)}</div>}
        empty={(d) => !d.events.length && <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No events this week. <Link to="/events" className="underline">Browse the season calendar</Link>.</p>}>
        {(d) => {
          const order = { live: 0, upcoming: 1, finished: 2 } as const;
          const evs = [...d.events].sort((a, b) => order[a.status] - order[b.status] || (a.start ?? "").localeCompare(b.start ?? "")).slice(0, 8);
          return (
            <>
              <Stagger className="grid gap-3 sm:grid-cols-2">{evs.map((e) => <StaggerItem key={e.code}><EventCard e={e} /></StaggerItem>)}</Stagger>
              {d.events.length > evs.length && <p className="mt-3 text-sm text-muted-foreground"><Link to="/events" className="underline">{d.events.length - evs.length} more this week</Link></p>}
            </>
          );
        }}
      </Async>
    </Section>
  );
}

export function EventCard({ e }: { e: EventSummary }) {
  return (
    <Link to={`/events/${e.season}/${e.code}`} className="lift group flex h-full flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        {e.status === "live" ? <Badge variant="destructive"><Radio /> Live</Badge> : e.status === "upcoming" ? <Badge variant="secondary">Upcoming</Badge> : <Badge variant="outline">Finished</Badge>}
        <span className="truncate text-xs text-muted-foreground">{e.typeLabel}</span>
        {e.matchesTotal > 0 && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{e.matchesPlayed}/{e.matchesTotal}</span>}
      </div>
      <p className="mt-2 line-clamp-2 font-medium leading-snug group-hover:text-accent">{e.name}</p>
      <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />{dateRange(e.start, e.end)}</p>
      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" />{place(e.city, e.state, e.country) || "Location TBA"}{e.teams ? ` · ${e.teams} teams` : ""}</p>
    </Link>
  );
}

function TrackRecordCard() {
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  return (
    <Section title="Track record" description="Every call, scored after the match." action={<Button variant="ghost" size="sm" asChild><Link to="/predict/accuracy">Full record <ArrowRight /></Link></Button>} className="mb-0">
      <Async state={state} loading={<div className="skeleton h-64 rounded-xl" />}>
        {(t) => {
          const h = t.headline;
          if (!h) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No scored predictions yet.</p>;
          const block = t.seasons.find((s) => s.season === h.season)?.[h.kind];
          const bins = block?.reliability.filter((b) => b.n > 0) ?? [];
          return (
            <Link to="/predict/accuracy" className="lift block rounded-2xl border border-border bg-card p-5">
              <p className="font-display text-6xl font-semibold tabular-nums text-accent">{pct(h.accuracy)}</p>
              <p className="mt-1 text-sm text-muted-foreground">of {h.n.toLocaleString()} matches called correctly</p>
              <Badge variant={h.kind === "live" ? "success" : "secondary"} className="mt-2">{h.kind === "live" ? "Live — called before each match" : `Backtest · ${seasonLabel(h.season)}`}</Badge>
              {bins.length > 0 && (
                <>
                  <div className="mt-5 flex h-20 items-end gap-1" role="img" aria-label="Calibration: how often teams at each predicted chance actually won">
                    {bins.map((b) => (
                      <div key={b.lo} className="flex flex-1 flex-col items-center justify-end" title={`Said ${pct(b.predicted)} → won ${pct(b.actual)} (${b.n.toLocaleString()} matches)`}>
                        <div className="w-full rounded-t bg-accent/80" style={{ height: `${Math.max(4, b.actual * 80)}px` }} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Each bar: teams we gave 5%, 15% … 95% — and how often they actually won. The staircase means the odds mean what they say.</p>
                </>
              )}
            </Link>
          );
        }}
      </Async>
    </Section>
  );
}

function MoreTools() {
  const items = [
    { to: "/compare", icon: Scale, title: "Compare", body: "Head-to-head: OPR, ratings, records, every meeting." },
    { to: "/download", icon: Download, title: "Offline packs", body: "No signal at the venue? Predictions run on your device." },
    { to: "/predict/accuracy", icon: BadgeCheck, title: "How sure are we?", body: "Calibration by confidence tier, week by week." },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {items.map((x) => (
        <Link key={x.to} to={x.to} className={cn("lift flex items-start gap-3 rounded-xl border border-border bg-card p-4")}>
          <x.icon className="mt-0.5 size-5 shrink-0 text-accent" />
          <span><span className="block font-medium">{x.title}</span><span className="mt-0.5 block text-sm text-muted-foreground">{x.body}</span></span>
        </Link>
      ))}
    </div>
  );
}
