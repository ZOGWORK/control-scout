// Team profile — any team, any season. Control Point's Team Stats design
// (hero, OPR cards with world rank, one trend chart, event history),
// generalised from "my team" to every team.
import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Award, Bookmark, BookmarkCheck, CalendarDays, ChevronDown, ClipboardList, ExternalLink, Eye, EyeOff, Flag, Gauge, GraduationCap, MapPin, Scale, Star, Target, TrendingDown, TrendingUp, Trophy, Zap,
} from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useTitle } from "../lib/meta";
import { usePersonal, useTeamFlags } from "../lib/personal";
import { useScouting } from "../lib/scouting";
import type { MatchView, TeamEventRow, TeamProfile } from "../shared/api";
import { Section, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Reveal, Stagger, StaggerItem } from "../components/motion";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/basic";
import { ToggleGroup, ToggleGroupItem, Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/controls";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/overlay";
import { MatchList } from "../components/predict";
import { SeasonToggle } from "../components/SeasonToggle";
import { cn } from "../components/cn";
import { awardLabel, dateRange, int, num, place, seasonLabel, topPct } from "../lib/format";
import { eventTypeLabel } from "../lib/labels";

export default function TeamPage() {
  const { number } = useParams();
  const [sp, setSp] = useSearchParams();
  const team = Number(number);
  const season = sp.get("season");
  const state = useApi<TeamProfile>(Number.isInteger(team) && team > 0 ? `/api/teams/${team}${qs({ season })}` : null);
  useTitle(state.data ? `${state.data.team.number} ${state.data.team.name ?? ""}` : `Team ${number}`);
  if (!Number.isInteger(team) || team <= 0) return <EmptyState title="That's not a team number" description="FTC team numbers are whole numbers, like 4215." />;
  return (
    <Async state={state}>
      {(p) => <Profile p={p} onSeason={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />}
    </Async>
  );
}

function Profile({ p, onSeason }: { p: TeamProfile; onSeason: (s: number) => void }) {
  const hasResults = p.events.length > 0;
  return (
    <div className="min-w-0">
      <Hero p={p} onSeason={onSeason} />
      {!hasResults ? (
        <EmptyState icon={CalendarDays} title={`No ${seasonLabel(p.season)} results for ${p.team.number} yet`}
          description={p.seasons.length > 1 ? "Pick another season above to see past results." : "This team hasn't played an event we have data for."} />
      ) : (
        <>
          <OprSection p={p} />
          <TrendChart events={p.events} season={p.season} />
          <Section title={`Event history (${p.events.length})`} description={`${seasonLabel(p.season)}, newest first`}>
            <EventHistory events={p.events} team={p.team.number} />
          </Section>
          <MatchesSection team={p.team.number} season={p.season} events={p.events} />
        </>
      )}
      <AwardsAllTime p={p} />
      <ScoutNotes team={p.team.number} season={p.season} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({ p, onSeason }: { p: TeamProfile; onSeason: (s: number) => void }) {
  const t = p.team;
  const flags = useTeamFlags(t.number);
  const loc = place(t.city, t.state, t.country);
  return (
    <Reveal className="relative mb-8 overflow-hidden rounded-2xl border border-border bg-card p-6 sm:p-8">
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-72 rounded-full bg-accent opacity-20 blur-3xl" />
      <div className="relative min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">FTC team · {seasonLabel(p.season)}</p>
        <h1 className="mt-1 font-display text-5xl font-semibold leading-none tracking-tight text-foreground sm:text-6xl">{t.number}</h1>
        <p className="mt-2 break-words text-xl text-foreground/90">{t.name ?? "Name not on file"}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          {t.school && <span className="flex min-w-0 items-center gap-1.5"><GraduationCap className="size-4 shrink-0" /><span className="truncate sm:max-w-[22rem]">{t.school}</span></span>}
          {loc && <span className="flex items-center gap-1.5"><MapPin className="size-4" />{loc}</span>}
          {t.rookieYear && <span>Rookie year {t.rookieYear}</span>}
          {t.website && <a href={t.website.startsWith("http") ? t.website : `https://${t.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground">Website <ExternalLink className="size-3" /></a>}
        </div>
        {t.sponsors.length > 0 && (
          <Collapsible className="mt-3">
            <CollapsibleTrigger className="group inline-flex min-h-8 max-w-full items-center gap-1.5 rounded text-left text-sm text-muted-foreground hover:text-foreground max-sm:min-h-11">
              <span className="font-medium text-foreground">Sponsors ({t.sponsors.length})</span>
              <span className="truncate group-data-[state=open]:hidden">{t.sponsors.slice(0, 2).join(" · ")}{t.sponsors.length > 2 ? " …" : ""}</span>
              <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1 text-sm text-muted-foreground">{t.sponsors.join(" · ")}</CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <div className="relative mt-6 flex flex-wrap items-center gap-3">
        <SeasonToggle seasons={p.seasons} value={p.season} onChange={onSeason} />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button variant={flags.isMine ? "secondary" : "outline"} size="sm" aria-pressed={flags.isMine} onClick={() => flags.setMine(!flags.isMine)} className="max-sm:h-11">
            <Star className={cn(flags.isMine && "fill-accent text-accent")} /> {flags.isMine ? "My team" : "Mark as my team"}
          </Button>
          <Button variant={flags.tracked ? "secondary" : "outline"} size="sm" aria-pressed={flags.tracked} onClick={flags.toggleTracked} className="max-sm:h-11">
            {flags.tracked ? <EyeOff /> : <Eye />} {flags.tracked ? "Tracking" : "Track"}
          </Button>
          <Button variant={flags.bookmarked ? "secondary" : "outline"} size="sm" aria-pressed={flags.bookmarked} onClick={flags.toggleBookmark} className="max-sm:h-11">
            {flags.bookmarked ? <BookmarkCheck /> : <Bookmark />} {flags.bookmarked ? "Shortlisted" : "Shortlist"}
          </Button>
          <Button variant="outline" size="sm" asChild className="max-sm:h-11"><Link to={`/compare?teams=${t.number}`}><Scale /> Compare</Link></Button>
        </div>
      </div>
      <a href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener" className="relative mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent">
        Manage this team in Control Point <ExternalLink className="size-3" />
      </a>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// OPR + rating
// ---------------------------------------------------------------------------

const OPR_CARDS = [["np", "Total OPR", Target], ["auto", "Autonomous", Zap], ["teleop", "TeleOp", Gauge], ["endgame", "Endgame", Flag]] as const;

function OprSection({ p }: { p: TeamProfile }) {
  const s = p.stats;
  const [open, setOpen] = useState<(typeof OPR_CARDS)[number][0] | null>(null);
  return (
    <Section title="Offensive power rating" description={<>Best event OPR this season and its world rank. Non-penalty points; ridge-regularised so thin data can't go negative. <Link to="/methodology#opr" className="underline">How it's computed</Link></>}>
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {OPR_CARDS.map(([k, label, Icon]) => {
          const stat = s?.opr[k];
          const top = topPct(stat?.rank, stat?.of);
          const pc = stat?.rank && stat.of ? Math.round((1 - (stat.rank - 1) / stat.of) * 100) : 0;
          return (
            <StaggerItem key={k}>
              <button onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} aria-label={`${label}: ${num(stat?.value)}. Show event by event`}
                className={cn("group w-full rounded-xl border p-4 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-accent/50 motion-reduce:hover:translate-y-0", k === "np" ? "border-accent/30 bg-accent/[0.05]" : "border-border bg-card", open === k && "border-accent/60")}>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Icon className={cn("size-4", k === "np" && "text-accent")} />{label}</span>
                <span className="mt-1 block font-display text-3xl font-semibold tabular-nums text-foreground">{num(stat?.value)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{stat?.rank ? `Rank #${stat.rank.toLocaleString()} of ${stat.of?.toLocaleString()}` : "Unranked"}{top && ` · ${top}`}</span>
                <span className="mt-2 block h-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${pc}%` }} /></span>
              </button>
            </StaggerItem>
          );
        })}
      </Stagger>
      {open && <OprBreakdown events={p.events} k={open} />}
      {s?.rating && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr]">
          <div className="rounded-xl border border-border bg-card p-4">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Trophy className="size-4" />Prediction rating</span>
            <span className="mt-1 block font-display text-3xl font-semibold tabular-nums">{num(s.rating.np)} <span className="text-base font-medium text-muted-foreground">± {num(s.rating.sd)}</span></span>
            <span className="mt-1 block text-xs text-muted-foreground">{s.rating.rank ? `#${s.rating.rank.toLocaleString()} worldwide · ` : ""}{s.rating.matches} matches this season</span>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <p>The rating is what the prediction engine expects this robot to add to its alliance <em>now</em> (auto {num(s.rating.auto)}, TeleOp {num(s.rating.teleop)}, endgame {num(s.rating.endgame)}; gives away ~{num(s.rating.pen)} penalty pts a match). Unlike OPR it updates after every match and carries over from last season, so it's what drives win odds. <Link to="/methodology#rating" className="underline">How ratings work</Link></p>
            <p className="mt-2 text-xs">Season record {s.record.wins}-{s.record.losses}-{s.record.ties} across {s.record.events} event{s.record.events === 1 ? "" : "s"} · avg alliance score {num(s.avg.score)}</p>
          </div>
        </div>
      )}
    </Section>
  );
}

function OprBreakdown({ events, k }: { events: TeamEventRow[]; k: "np" | "auto" | "teleop" | "endgame" }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-text-muted"><th className="h-10 px-3">Event</th><th className="px-3 text-right">OPR</th><th className="px-3 text-right">Auto</th><th className="px-3 text-right">TeleOp</th><th className="px-3 text-right">Endgame</th><th className="px-3 text-right">Pen. given</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.code} className="border-t border-border">
              <td className="px-3 py-2"><Link to={`/events/${e.season}/${e.code}`} className="hover:underline">{e.name}</Link></td>
              {(["np", "auto", "teleop", "endgame", "pen"] as const).map((c) => <td key={c} className={cn("px-3 text-right tabular-nums", c === k && "font-semibold text-accent")}>{num(e.opr[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

type TrendKey = "opr" | "winRate" | "avgScore" | "avgPen" | "auto" | "teleop" | "endgame" | "rp";
const TRENDS: { key: TrendKey; label: string; suffix?: string; lowerIsBetter?: boolean; get: (e: TeamEventRow) => number | null }[] = [
  { key: "opr", label: "OPR by event", get: (e) => e.opr.np },
  { key: "winRate", label: "Win rate", suffix: "%", get: (e) => { const n = (e.wins ?? 0) + (e.losses ?? 0) + (e.ties ?? 0); return n ? Math.round(((e.wins ?? 0) / n) * 100) : null; } },
  { key: "avgScore", label: "Avg alliance score", get: (e) => e.avg.score },
  { key: "avgPen", label: "Avg penalties given", lowerIsBetter: true, get: (e) => e.avg.pen },
  { key: "auto", label: "Auto OPR", get: (e) => e.opr.auto },
  { key: "teleop", label: "TeleOp OPR", get: (e) => e.opr.teleop },
  { key: "endgame", label: "Endgame OPR", get: (e) => e.opr.endgame },
  { key: "rp", label: "Ranking points", get: (e) => e.rp },
];

function direction(vals: (number | null)[]): "up" | "down" | "flat" | null {
  const xs = vals.filter((v): v is number => v != null);
  if (xs.length < 2) return null;
  const first = xs[0], last = xs[xs.length - 1];
  const d = (last - first) / Math.max(1, Math.abs(first));
  return Math.abs(d) < 0.08 ? "flat" : d > 0 ? "up" : "down";
}

function TrendChart({ events, season }: { events: TeamEventRow[]; season: number }) {
  const [key, setKey] = useState<TrendKey>("opr");
  const t = TRENDS.find((x) => x.key === key)!;
  const rows = useMemo(() => events.map((e, i) => ({ i, name: e.name, value: t.get(e) == null ? null : Math.round(t.get(e)! * 10) / 10 })), [events, t]);
  const vals = rows.map((r) => r.value);
  const dir = direction(vals);
  const good = dir === "flat" || dir == null ? null : (dir === "up") !== !!t.lowerIsBetter;
  const last = [...vals].reverse().find((v) => v != null) ?? null;
  return (
    <Section title="Trends" description={`${seasonLabel(season)}, event by event`}>
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
        <ToggleGroup type="single" variant="chips" aria-label="Trend metric" value={key} onValueChange={(v) => { if (v) setKey(v as TrendKey); }} className="mb-4 flex w-full justify-start gap-1.5 overflow-x-auto pb-1">
          {TRENDS.map((x) => <ToggleGroupItem key={x.key} value={x.key} className="shrink-0">{x.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <span className="font-display text-3xl font-semibold tabular-nums">{num(last)}{last != null && t.suffix}</span>
          <span className="text-sm text-muted-foreground">latest</span>
          {dir && <Badge variant={good == null ? "secondary" : good ? "success" : "destructive"}>{dir === "up" ? <TrendingUp /> : dir === "down" ? <TrendingDown /> : null}{dir === "up" ? "Rising" : dir === "down" ? "Falling" : "Steady"}</Badge>}
        </div>
        {rows.length < 2 ? <p className="py-8 text-center text-sm text-muted-foreground">One event so far — the trend line appears after a second event.</p> : (
          <ChartContainer config={{ value: { label: t.label, color: "var(--color-chart-1)" } }} className="h-56 w-full">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="i" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(i: number) => `E${i + 1}`} />
              <YAxis tickLine={false} axisLine={false} width={36} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(i: number) => rows[i]?.name ?? ""} />} />
              <Line dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--color-value)" }} activeDot={{ r: 6 }} connectNulls animationDuration={700} />
            </LineChart>
          </ChartContainer>
        )}
        {vals.some((v) => v == null) && <p className="mt-2 text-xs text-muted-foreground">Gaps: that event didn't have enough qualification matches to measure this stat.</p>}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Events, matches, awards, scouting
// ---------------------------------------------------------------------------

function RankMedal({ rank }: { rank: number | null }) {
  if (!rank) return <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-xs text-muted-foreground">—</span>;
  return <span className={cn("flex size-10 shrink-0 flex-col items-center justify-center rounded-xl border font-display text-sm font-bold tabular-nums", rank === 1 ? "border-accent/50 bg-accent/15 text-accent" : rank <= 4 ? "border-border bg-muted" : "border-border")}>
    <span className="text-[9px] font-medium uppercase leading-none text-muted-foreground">rank</span>{rank}
  </span>;
}

function EventHistory({ events, team }: { events: TeamEventRow[]; team: number }) {
  return (
    <div className="space-y-2">
      {[...events].reverse().map((e) => (
        <Link key={e.code} to={`/events/${e.season}/${e.code}?team=${team}`} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:border-accent/40 sm:flex-nowrap">
          <RankMedal rank={e.rank} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{e.name}</p>
            <p className="truncate text-xs text-muted-foreground">{dateRange(e.start, e.end)} · {place(e.city, e.state)} · {eventTypeLabel(e.type)}</p>
            {(e.awards.length > 0 || e.alliance) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {e.alliance && <Badge variant="secondary">Alliance {e.alliance.number} · {e.alliance.seat === "captain" ? "captain" : e.alliance.seat === "pick1" ? "1st pick" : e.alliance.seat === "pick2" ? "2nd pick" : "backup"}</Badge>}
                {e.awards.map((a) => <Badge key={`${a.type}${a.placement}`} variant="soft"><Award />{awardLabel(a.type, a.placement)}</Badge>)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 text-right text-sm tabular-nums">
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Record</p><p className="font-medium">{e.wins ?? "–"}-{e.losses ?? "–"}-{e.ties ?? "–"}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">RS</p><p className="font-medium">{num(e.rp, 2)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">OPR</p><p className="font-medium">{num(e.opr.np)}</p></div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function MatchesSection({ team, season, events }: { team: number; season: number; events: TeamEventRow[] }) {
  const state = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches?season=${season}`);
  const names = Object.fromEntries(events.map((e) => [e.code, e.name]));
  const [all, setAll] = useState(false);
  return (
    <Section title="Matches" description="Every match this season with the prediction made for it. Hover a bar for details.">
      <Async state={state} loading={<div className="skeleton h-40 rounded-xl" />}>
        {(d) => {
          const ms = [...d.matches].reverse();
          const shown = all ? ms : ms.slice(0, 12);
          return (
            <>
              <MatchList matches={shown} highlight={team} eventNames={names} empty="No matches this season yet." />
              {ms.length > 12 && <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${ms.length} matches`}</Button>}
            </>
          );
        }}
      </Async>
    </Section>
  );
}

function AwardsAllTime({ p }: { p: TeamProfile }) {
  if (!p.awardsAllTime.length) return null;
  return (
    <Section title={`Awards (${p.awardsAllTime.length})`} description="Every award in the seasons we cover">
      <div className="flex flex-wrap gap-2">
        {p.awardsAllTime.map((a, i) => (
          <Tooltip key={i}>
            <TooltipTrigger asChild>
              <Link to={`/events/${a.season}/${a.code}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs hover:border-accent/40">
                <Award className="size-3.5 text-accent" />{awardLabel(a.type, a.placement)}<span className="text-muted-foreground">· {seasonLabel(a.season)}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent>{a.event}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </Section>
  );
}

function ScoutNotes({ team, season }: { team: number; season: number }) {
  const { syncReady } = usePersonal();
  const { entries } = useScouting({ season, team }, syncReady);
  return (
    <Section title="My scouting notes" description="Only you see these. They're saved on this device and sync to your account when you're signed in."
      action={<Button variant="secondary" size="sm" asChild><Link to={`/scout?team=${team}&season=${season}`}><ClipboardList /> Scout this team</Link></Button>}>
      {!entries.length ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No notes for {team} in {seasonLabel(season)} yet.</p> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries.slice(0, 6).map((e) => (
            <Link key={e.uuid} to={`/scout?team=${team}&season=${season}&entry=${e.uuid}`} className="rounded-xl border border-border bg-card p-3 text-sm hover:border-accent/40">
              <p className="font-medium">{e.kind === "pit" ? "Pit scouting" : `Match ${e.matchLabel ?? ""}`} {e.eventCode && <span className="text-muted-foreground">· {e.eventCode}</span>}</p>
              <p className="mt-1 line-clamp-2 text-muted-foreground">{e.notes || `${Object.keys(e.data).length} fields recorded`}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{int(Object.keys(e.data).length)} fields · {new Date(e.updatedAt).toLocaleDateString()}</p>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}
