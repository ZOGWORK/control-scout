// Home: search first, then what's happening this week, the prediction track
// record, and the three things nobody else does (lab, compare, offline).
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, BadgeCheck, CalendarDays, Download, MapPin, Radio, Scale, Search, Sparkles } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useMeta, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { EventSummary, TrackRecord } from "../shared/api";
import { useSearch } from "../components/layout/Search";
import { Section } from "../components/page";
import { Async } from "../components/states";
import { Reveal, Stagger, StaggerItem } from "../components/motion";
import { Badge } from "../components/ui/basic";
import { Button } from "../components/ui/button";
import { cn } from "../components/cn";
import { dateRange, pct, place, seasonLabel, ago } from "../lib/format";
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
      {state.myTeam && <MyTeamStrip team={state.myTeam} />}
      <ThisWeek />
      <TrackRecordStrip />
      <QuickLinks />
    </div>
  );
}

function Hero() {
  const { open } = useSearch();
  const meta = useMeta();
  return (
    <Reveal className="pt-4 text-center sm:pt-10">
      <BrandMark className="mx-auto size-12" />
      <h1 className="mt-4 font-display text-4xl font-bold tracking-tight sm:text-5xl">FTC Control Scout</h1>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">Every FTC team, event and match — with predictions that keep a public score of how often they come true. Free, no login.</p>
      <button onClick={open} className="mx-auto mt-7 flex h-14 w-full max-w-2xl items-center gap-3 rounded-2xl border border-line bg-card px-5 text-left text-muted-foreground shadow-[0_8px_40px_-12px_color-mix(in_srgb,var(--color-accent)_25%,transparent)] transition-colors hover:border-accent/50">
        <Search className="size-5 text-accent" />
        <span className="flex-1 truncate">Search a team number, team name, event, or “USNJQ1 Q12”…</span>
        <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-mono text-xs sm:inline">⌘K</kbd>
      </button>
      {meta && <p className="mt-3 text-xs text-muted-foreground">{meta.seasons.length} seasons · data updated {ago(meta.dataAsOf)} · engine v{meta.engineVersion}</p>}
    </Reveal>
  );
}

function MyTeamStrip({ team }: { team: number }) {
  return (
    <Link to="/my-team" className="flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3 text-sm hover:border-accent/60">
      <span>Your team <span className="font-mono font-semibold">{team}</span> — upcoming matches, odds and tracked activity</span>
      <ArrowRight className="size-4 text-accent" />
    </Link>
  );
}

function ThisWeek() {
  const season = useCurrentSeason();
  const now = new Date();
  const from = iso(new Date(now.getTime() - 2 * 864e5)), to = iso(new Date(now.getTime() + 7 * 864e5));
  const state = useApi<{ events: EventSummary[] }>(`/api/events${qs({ season, from, to })}`);
  return (
    <Section title="This week" description={`${seasonLabel(season)} events running now or in the next 7 days`} action={<Button variant="ghost" size="sm" asChild><Link to="/events">All events <ArrowRight /></Link></Button>}>
      <Async state={state} loading={<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-xl" />)}</div>}
        empty={(d) => !d.events.length && <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No events this week. <Link to="/events" className="underline">Browse the season calendar</Link>.</p>}>
        {(d) => {
          const order = { live: 0, upcoming: 1, finished: 2 } as const;
          const evs = [...d.events].sort((a, b) => order[a.status] - order[b.status] || (a.start ?? "").localeCompare(b.start ?? "")).slice(0, 9);
          return (
            <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {evs.map((e) => <StaggerItem key={e.code}><EventCard e={e} /></StaggerItem>)}
            </Stagger>
          );
        }}
      </Async>
    </Section>
  );
}

export function EventCard({ e }: { e: EventSummary }) {
  return (
    <Link to={`/events/${e.season}/${e.code}`} className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/50 motion-reduce:hover:translate-y-0">
      <div className="flex items-center gap-2">
        {e.status === "live" ? <Badge variant="destructive"><Radio /> Live</Badge> : e.status === "upcoming" ? <Badge variant="secondary">Upcoming</Badge> : <Badge variant="outline">Finished</Badge>}
        <span className="truncate text-xs text-muted-foreground">{e.typeLabel}</span>
      </div>
      <p className="mt-2 line-clamp-2 font-medium leading-snug group-hover:text-accent">{e.name}</p>
      <p className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />{dateRange(e.start, e.end)}</p>
      <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><MapPin className="size-3.5 shrink-0" />{place(e.city, e.state, e.country) || "Location TBA"}{e.teams ? ` · ${e.teams} teams` : ""}</p>
    </Link>
  );
}

function TrackRecordStrip() {
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  return (
    <Section title="Track record" description="How often the favourite actually won — logged before matches, scored after." action={<Button variant="ghost" size="sm" asChild><Link to="/predict/accuracy">Full record <ArrowRight /></Link></Button>}>
      <Async state={state} loading={<div className="skeleton h-28 rounded-xl" />}>
        {(t) => {
          const h = t.headline;
          if (!h) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No scored predictions yet.</p>;
          const block = t.seasons.find((s) => s.season === h.season)?.[h.kind];
          return (
            <Link to="/predict/accuracy" className="grid gap-4 rounded-xl border border-border bg-card p-5 hover:border-accent/40 sm:grid-cols-[auto_1fr]">
              <div>
                <p className="font-display text-5xl font-semibold tabular-nums text-accent">{pct(h.accuracy)}</p>
                <p className="mt-1 text-sm text-muted-foreground">of {h.n.toLocaleString()} matches called</p>
                <Badge variant={h.kind === "live" ? "success" : "secondary"} className="mt-2">{h.kind === "live" ? "Live — called before each match" : `Backtest · ${seasonLabel(h.season)}`}</Badge>
              </div>
              {block && (
                <div className="flex min-w-0 flex-col justify-center gap-2">
                  <div className="flex h-16 items-end gap-1" aria-label="Calibration: predicted vs actual win rate by probability bucket">
                    {block.reliability.filter((b) => b.n > 0).map((b) => (
                      <div key={b.lo} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`Predicted ${pct(b.predicted)} → won ${pct(b.actual)} (${b.n} matches)`}>
                        <div className="w-full rounded-t bg-accent/80" style={{ height: `${Math.max(4, b.actual * 64)}px` }} />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Calibration: bars are how often teams given 5%, 15% … 95% actually won — they climb in step with the odds. {h.kind === "backtest" ? `The live record switches on after ${t.liveThreshold} pre-match calls this season.` : ""}</p>
                </div>
              )}
            </Link>
          );
        }}
      </Async>
    </Section>
  );
}

function QuickLinks() {
  const items = [
    { to: "/predict", icon: Sparkles, title: "Prediction lab", body: "Any alliance against any alliance, or any team's odds of advancing from any event." },
    { to: "/compare", icon: Scale, title: "Compare", body: "Head-to-head: OPR, ratings, records and every match they've met." },
    { to: "/download", icon: Download, title: "Offline packs", body: "Take the data to a venue with no signal. Predictions run on your device." },
    { to: "/predict/accuracy", icon: BadgeCheck, title: "Track record", body: "Every call we've made, scored. Calibration you can check." },
  ];
  return (
    <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((x) => (
        <StaggerItem key={x.to}>
          <Link to={x.to} className={cn("group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-accent/50")}>
            <x.icon className="size-5 text-accent" />
            <p className="mt-3 font-medium">{x.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{x.body}</p>
          </Link>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
