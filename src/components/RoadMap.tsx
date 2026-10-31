// The team page's season road map: the team's events in date order with their advancement state and, where
// Scout has encoded the home region's rules for the season, the official points earned at each event and what
// the next stop takes. Elsewhere it's the neutral view: results so far and what's next, never a "needed" number.
// Every encoded ruleset shows its sources and season (server/data/roadmapRules.ts, docs/season-road-map.md).
import { Link } from "react-router-dom";
import { Award, Check, ChevronRight, Flag, MapPinned, Route, Target, Trophy } from "lucide-react";
import { isFeatureDisabled, useApi } from "../lib/api";
import { useFlag } from "../lib/flags";
import type { RoadAdvanceStatus, RoadNeed, RoadStop, TeamRoadMap } from "../shared/roadmap";
import { Section } from "./page";
import { Async } from "./states";
import { Badge } from "./ui/basic";
import { Meter, TONES } from "./StatTile";
import { awardLabel, dateRange, seasonLabel } from "../lib/format";
import { eventTypeLabel } from "../lib/labels";
import { cn } from "./cn";

/** `quiet`: render nothing until there's something to show (a page that already says there are no results).
 *  Switched off by the owner (the seasonRoadMap feature toggle): not asked for, and nothing shown. */
export function RoadMapSection({ team, season, quiet = false }: { team: number; season: number; quiet?: boolean }) {
  const on = useFlag("seasonRoadMap");
  const state = useApi<TeamRoadMap>(on ? `/api/teams/${team}/roadmap?season=${season}` : null);
  if (!on || isFeatureDisabled(state.error)) return null;
  if (quiet && !state.data?.stops.length) return null;
  return (
    <Section title="Season road map" description="Every event this season in date order, how the team is advancing, and what the next stop takes.">
      <Async state={state} loading={<div className="skeleton h-48 rounded-xl" />}>
        {(r) => (r.stops.length || r.need ? <RoadMap r={r} /> : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground max-sm:py-4">No {seasonLabel(r.season)} events on this team's calendar yet.</p>
        ))}
      </Async>
    </Section>
  );
}

function RoadMap({ r }: { r: TeamRoadMap }) {
  return (
    <div data-testid="roadmap" className="space-y-4">
      {r.ruleset && <Pipeline r={r} />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <Timeline r={r} />
        {r.ruleset ? <NeedPanel r={r} /> : <NeutralPanel r={r} />}
      </div>
      {r.ruleset && <Sources r={r} />}
    </div>
  );
}

/** The region's levels, the team's current one lit. */
function Pipeline({ r }: { r: TeamRoadMap }) {
  const levels = r.ruleset!.levels;
  const current = r.stage === "beyond" ? "world" : r.stage === "regional" ? "regional" : "entry";
  const at = levels.findIndex((l) => l.kind === current);
  return (
    <ol aria-label={`${r.ruleset!.name} ${seasonLabel(r.season)} advancement path`} className="flex flex-wrap items-center gap-1.5">
      {levels.map((l, i) => {
        // Meets run until the league tournament: no tick on them while the team is still working toward it.
        const done = i < at && !(l.kind === "meet" && r.stage === "entry");
        const tone = done ? TONES.emerald : i === at ? TONES.accent : null;
        return (
          <li key={l.label} className="flex items-center gap-1.5">
            <span aria-current={i === at ? "step" : undefined}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", tone ? cn(tone.box, tone.text) : "border-border text-muted-foreground", i === at && "ring-2 ring-accent/40")}>
              {done && <Check className="mr-1 inline size-3" aria-hidden />}{l.label}{i === at && <span className="sr-only"> (the team's next step)</span>}
            </span>
            {i < levels.length - 1 && <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

const STATUS: Record<RoadAdvanceStatus, { label: (to: string | null) => string; cls: string }> = {
  advanced: { label: (to) => (to ? `Advanced to ${to}` : "Advanced"), cls: "border-success/30 bg-success/15 text-success" },
  declined: { label: () => "Declined its slot", cls: "border-warning/30 bg-warning/15 text-warning" },
  already: { label: () => "Already advancing", cls: "border-success/30 bg-success/[0.08] text-success" },
  above: { label: () => "Advancing from a higher level", cls: "border-success/30 bg-success/[0.08] text-success" },
  ineligible: { label: () => "Not eligible to advance here", cls: "border-line bg-text-base/[0.06] text-text-muted" },
  missed: { label: () => "Didn't take a slot", cls: "border-line bg-text-base/[0.06] text-text-muted" },
  pending: { label: (to) => (to ? `Advances to ${to}` : "Advancing event"), cls: "border-info/30 bg-info/[0.08] text-info" },
};

function Timeline({ r }: { r: TeamRoadMap }) {
  if (!r.stops.length) return <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No events on this team's calendar yet.</p>;
  return (
    <ol aria-label="Events in date order" className="relative space-y-3 border-l-2 border-border pl-5 max-sm:pl-4">
      {r.stops.map((s) => <StopRow key={s.code} s={s} team={r.team} season={r.season} />)}
    </ol>
  );
}

function StopRow({ s, team, season }: { s: RoadStop; team: number; season: number }) {
  const adv = s.advancement;
  const dot = adv?.status === "advanced" ? "bg-success border-success" : s.when === "live" ? "bg-accent border-accent" : s.when === "done" ? "bg-muted-foreground/60 border-muted-foreground/60" : "bg-background border-border";
  return (
    <li className="relative">
      <span aria-hidden className={cn("absolute top-4 size-3 rounded-full border-2 -left-[1.71rem] max-sm:-left-[1.46rem]", dot)} />
      <div className={cn("rounded-xl border bg-card p-3", s.when === "live" ? "border-accent/50" : "border-border")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Link to={`/events/${season}/${s.code}?team=${team}`} className="min-w-0 font-medium hover:underline">{s.name}</Link>
          <span className="text-xs text-muted-foreground tabular-nums">{dateRange(s.start, s.end)}{s.when === "live" ? " · on now" : ""}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Badge variant="outline">{s.level ?? eventTypeLabel(s.type)}</Badge>
          {!s.home && <Badge variant="outline">Outside home region</Badge>}
          {s.counts === false && s.home && s.type && (s.type === "Qualifier" || s.type === "LeagueTournament") && <Badge variant="outline">Past the first 3: doesn't advance</Badge>}
          {adv && <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium leading-none", STATUS[adv.status].cls)}>
            {adv.status === "advanced" && <Trophy className="size-3" aria-hidden />}{STATUS[adv.status].label(adv.to)}{adv.slots && adv.status === "pending" ? ` · ${adv.slots} slots` : ""}
          </span>}
          {s.alliance && <Badge variant="secondary">Alliance {s.alliance.number} · {s.alliance.seat === "captain" ? "captain" : s.alliance.seat === "pick1" ? "1st pick" : s.alliance.seat === "pick2" ? "2nd pick" : "backup"}</Badge>}
          {s.awards.map((a) => <Badge key={`${a.type}${a.placement}`} variant="soft"><Award />{awardLabel(a.type, a.placement)}</Badge>)}
        </div>
        <Result s={s} />
        {s.points && <PointsLine s={s} />}
      </div>
    </li>
  );
}

function Result({ s }: { s: RoadStop }) {
  const parts: string[] = [];
  if (s.rank != null) parts.push(`Rank ${s.rank}${s.ranked ? ` of ${s.ranked}` : ""}`);
  if (s.record) parts.push(`${s.record.wins}-${s.record.losses}-${s.record.ties}`);
  if (s.qualPlayed) parts.push(`${s.qualPlayed} qual match${s.qualPlayed === 1 ? "" : "es"}`);
  if (!parts.length) {
    if (s.when === "done") return <p className="mt-1.5 text-xs text-muted-foreground">No results published.</p>;
    return s.roster ? <p className="mt-1.5 text-xs text-muted-foreground">{s.roster} teams registered</p> : null;
  }
  return <p className="mt-1.5 text-sm tabular-nums">{parts.join(" · ")}</p>;
}

function PointsLine({ s }: { s: RoadStop }) {
  const p = s.points!;
  const max = Math.max(p.total, s.cutoff ?? 0, 1);
  return (
    <div className="mt-2 rounded-lg bg-accent/[0.06] px-2.5 py-2">
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-display text-lg font-semibold tabular-nums text-accent-text">{p.total}</span>
        <span className="text-xs text-muted-foreground">advancement points (official)</span>
        {s.cutoff != null && <span className="text-xs text-muted-foreground">· last team in had {s.cutoff}</span>}
      </p>
      <Meter parts={[
        { pc: (p.awards / max) * 100, cls: "bg-violet-500" }, { pc: (p.playoffs / max) * 100, cls: "bg-accent" },
        { pc: (p.alliance / max) * 100, cls: "bg-info" }, { pc: (p.quals / max) * 100, cls: "bg-success" },
      ]} />
      <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">{p.awards} awards · {p.playoffs} playoffs · {p.alliance} alliance · {p.quals} quals</p>
    </div>
  );
}

const day = (d: string | null) => (d ? dateRange(d, d) : "date to be set");

function NeedPanel({ r }: { r: TeamRoadMap }) {
  if (r.stage === "beyond" || !r.need) {
    return (
      <div className={cn("rounded-xl border p-4", TONES.emerald.box)}>
        <p className="flex items-center gap-2 font-semibold"><Trophy className="size-4 text-success" aria-hidden />Past the {r.ruleset!.name} championship</p>
        <p className="mt-1 text-sm text-muted-foreground">Advanced beyond its region: FIRST Championship or a Premier event.</p>
      </div>
    );
  }
  const n = r.need, ls = n.lastSeason;
  const cut = ls?.fcmp?.cutoff ?? ls?.cutoff;
  const clears = n.routes.filter((x) => x.clears), short = n.routes.filter((x) => !x.clears);
  return (
    <div data-testid="roadmap-need" className={cn("rounded-xl border p-4", TONES.accent.box)}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><span className={cn("flex size-7 items-center justify-center rounded-lg", TONES.accent.chip)}><Target className="size-4" aria-hidden /></span>What's needed next</p>
      <NextLine n={n} season={r.season} />
      {n.target != null && cut && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3">
          <p className="font-display text-4xl font-semibold tabular-nums">~{n.target}<span className="ml-1 text-base font-medium text-muted-foreground">pts</span></p>
          <p className="text-xs text-muted-foreground">{ls!.fcmp ? "for a FIRST Championship slot · " : ""}last season's cutoff{cut.min !== cut.max ? `, ${cut.min}–${cut.max}` : ""}</p>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Fact label="Slots" value={n.slots ? String(n.slots) : "TBA"} />
        <Fact label="Best this season" value={n.best != null ? String(n.best) : "–"} />
        {n.leagueMatches
          ? <Fact label="Meet matches" value={`${n.leagueMatches.counted}/${n.leagueMatches.max}`} bar={n.leagueMatches.counted / n.leagueMatches.max} />
          : <Fact label="Teams" value={String(n.teams)} />}
      </dl>
      {n.overLimit && <p className="mt-2 text-sm text-warning">Past the team's first {r.ruleset!.points.entryEvents} qualifiers or league tournaments: it can't advance from it.</p>}
      {n.target != null && n.routes.length > 0 && (
        <div className="mt-3">
          {clears.length > 0 && <>
            <p className="text-xs font-medium text-muted-foreground">Gets there on its own</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {clears.map((x) => <li key={x.label} className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-2 py-1 text-xs font-medium text-success"><Check className="size-3" aria-hidden />{x.label}<span className="tabular-nums opacity-70">{x.min}+</span></li>)}
            </ul>
          </>}
          {short.length > 0 && <>
            <p className="mt-2 text-xs font-medium text-muted-foreground">Needs more on top</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {short.map((x) => <li key={x.label} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">{x.label}<span className="tabular-nums opacity-70">{x.min}+</span></li>)}
            </ul>
          </>}
        </div>
      )}
      <HowItWorks r={r} />
    </div>
  );
}

function Fact({ label, value, bar }: { label: string; value: string; bar?: number }) {
  return (
    <div className="flex flex-col rounded-lg bg-card/70 px-2 py-2">
      <dd className="order-1 font-display text-lg font-semibold tabular-nums">{value}</dd>
      <dt className="order-2 text-[11px] leading-tight text-muted-foreground">{label}</dt>
      {bar != null && <dd className="order-3 mt-1"><Meter parts={[{ pc: bar * 100, cls: "bg-success" }]} /></dd>}
    </div>
  );
}

function NextLine({ n, season }: { n: RoadNeed; season: number }) {
  const when = n.event
    ? <><Link to={`/events/${season}/${n.event.code}`} className="hover:underline">{n.event.name}</Link> · {day(n.event.start)}</>
    : n.options.length
      ? <>{n.options.map((o, i) => <span key={o.code}>{i > 0 && " or "}<Link to={`/events/${season}/${o.code}`} title={o.name} className="underline decoration-dotted underline-offset-2">{day(o.start)}</Link></span>)}</>
      : <>not on the calendar yet</>;
  return (
    <p className="mt-2 text-sm"><span className="font-semibold">{n.level}</span> · {when}
      <span className="block text-xs text-muted-foreground">Leads to {n.leadsTo}</span>
    </p>
  );
}

const range = (x: { min: number; max: number }) => (x.min === x.max ? `${x.min}` : `${x.min}–${x.max}`);

/** Everything behind the numbers, one tap away. */
function HowItWorks({ r }: { r: TeamRoadMap }) {
  const p = r.ruleset!.points, n = r.need!, ls = n.lastSeason;
  return (
    <details className="mt-3 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">How this works</summary>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
        {ls && <li>{ls.fcmp
          ? <>Target: the last team inside the {range(ls.fcmp.slots)} FIRST Championship slots at {seasonLabel(ls.season)}'s championship (any slot, Premier included: {ls.cutoff.median}).</>
          : <>Target: the median points of the last team to take a slot at {r.ruleset!.name}'s {ls.events} {n.level.toLowerCase()}s in {seasonLabel(ls.season)} ({range(ls.slots)} slots each).</>}{" "}Same points system this season. A guide, not a guarantee.</li>}
        <li>Each finish shows the fewest points it guarantees alone at a {n.teams}-team event. Points add up across finishes; a backup robot earns no alliance points.</li>
        {n.options.length > 0 && <li>Every league team plays one of its league's tournaments: {n.options.map((o) => o.name).join("; ")}.</li>}
        {n.event && n.fromCalendar && <li>Taken from the season calendar: the team isn't registered for it yet.</li>}
        {n.leagueMatches && <li>The league tournament ranking adds each team's best {n.leagueMatches.max} meet matches; missing ones count as zero.</li>}
        <li>Slots go to the top point totals not already advanced, only from a team's first {p.entryEvents} qualifiers or league tournaments in its home region. FIRST posts slots by alliance selection.</li>
      </ul>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Qualification rank</dt><dd>{p.qual.max} (top seed) down to {p.qual.min}</dd>
        <dt className="text-muted-foreground">Alliance selection</dt><dd>21 − alliance or draft pick number</dd>
        <dt className="text-muted-foreground">Playoffs</dt><dd>{p.playoff.join(" / ")} (1st–4th)</dd>
        <dt className="text-muted-foreground">Inspire Award</dt><dd>{p.inspire.join(" / ")} (1st–3rd)</dd>
        <dt className="text-muted-foreground">Other judged awards</dt><dd>{p.otherAwards.join(" / ")} (1st–3rd)</dd>
      </dl>
      <p className="mt-2 text-[11px] text-muted-foreground">Source: <a href={p.source.url} target="_blank" rel="noreferrer" className="underline">{p.source.label}</a>, {p.where}.</p>
    </details>
  );
}

function NeutralPanel({ r }: { r: TeamRoadMap }) {
  const next = r.next;
  return (
    <div data-testid="roadmap-neutral" className={cn("rounded-xl border p-4", TONES.sky.box)}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><span className={cn("flex size-7 items-center justify-center rounded-lg", TONES.sky.chip)}><Flag className="size-4" aria-hidden /></span>What's next</p>
      {next ? (
        <p className="mt-2 text-sm"><span className="font-semibold">{next.name}</span> · {dateRange(next.start, next.end)}
          <span className="block text-xs text-muted-foreground">{eventTypeLabel(next.type)}{next.advancement?.to ? ` · advances to ${next.advancement.to}` : ""}</span></p>
      ) : <p className="mt-2 text-sm">No more events on the team's calendar yet.</p>}
      <p className="mt-3 flex gap-2 text-xs text-muted-foreground">
        <MapPinned className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Results and FIRST's published advancement only. Control Scout hasn't encoded {r.region ? `the ${r.region} region's` : "this team's region's"} {seasonLabel(r.season)} advancement rules, so there's no points target here.
          {r.encoded.length > 0 && <> Encoded for {seasonLabel(r.season)}: {r.encoded.map((e) => e.name).join(", ")}.</>}
        </span>
      </p>
    </div>
  );
}

function Sources({ r }: { r: TeamRoadMap }) {
  const rs = r.ruleset!;
  return (
    <p className="flex gap-2 text-xs text-muted-foreground">
      <Route className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        {rs.name} rules for {seasonLabel(rs.season)}, encoded from{" "}
        {rs.sources.map((s, i) => <span key={s.url}>{i > 0 && (i === rs.sources.length - 1 ? " and " : ", ")}<a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.label}</a></span>)}
        . Checked {dateRange(rs.checked, rs.checked)}. Points earned are FIRST's official figures.
      </span>
    </p>
  );
}
