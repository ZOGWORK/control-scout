// Team profile — any team, any season. Control Point's Team Stats design
// (hero, OPR cards with world rank, one trend chart, event history),
// generalised from "my team" to every team.
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Award, Bookmark, BookmarkCheck, CalendarDays, ChevronDown, ClipboardList, ExternalLink, Eye, Flag, Gauge, GraduationCap, Link2, MapPin, Scale, Sparkles, Star, Target, TrendingDown, TrendingUp, Trophy, Zap,
} from "lucide-react";
import { type ApiError, useApi, qs } from "../lib/api";
import { NotFoundView } from "../components/NotFoundView";
import { useAfterFirstPaint } from "../lib/afterPaint";
import { usePredictable, useTitle } from "../lib/meta";
import { usePersonal, useTeamFlags } from "../lib/personal";
import { FOLLOWED_TEAM_PATH, useYoursRow } from "../lib/yoursRow";
import { toast } from "../components/ui/sonner";
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
import { PROFILE_PERCENTILE_TEXT } from "../lib/textTones";
import { Meter, StatTile, TONES, rankPc, type Tone } from "../components/StatTile";
import { awardLabel, dateRange, int, num, place, seasonLabel, rankPct } from "../lib/format";
import { eventTypeLabel } from "../lib/labels";
import { copyLink } from "../lib/clipboard";
import { direction, trendLabel } from "../shared/trend";
import { teamTitle } from "../shared/teamTitle";
import { OfflineNote } from "../components/OfflineNote";
import { StickyActions } from "../components/StickyActions";
import { TeamConsensusSection } from "../components/ScoutConsensus";
import { ReportCardSection } from "../components/ReportCard";
import { ReliabilitySection } from "../components/Reliability";
import { predictHref } from "../shared/predictUrl";

export default function TeamPage() {
  const { number } = useParams();
  const [sp, setSp] = useSearchParams();
  const team = Number(number);
  const season = sp.get("season");
  // FTC team numbers are 1–999999, digits only (as on the server); anything else can't exist, so don't ask the API.
  const valid = /^\d+$/.test(number ?? "") && team >= 1 && team <= 999_999;
  const state = useApi<TeamProfile>(valid ? `/api/teams/${team}${qs({ season })}` : null);
  // Not a team (the server answers these addresses with a 404 too), or a season the API doesn't cover: the branded not-found page.
  const notFound = (state.error as ApiError | undefined)?.status === 404 ? state.error! : null;
  useTitle(!valid || notFound ? "Team not found" : teamTitle(state.data?.team.number ?? team, state.data?.team.name)); // same as the server-rendered title
  if (!valid) return <NotFoundView title={`There's no team ${number}`} description="FTC team numbers are whole numbers from 1 to 999999, like 4215. Search for the team you're after." />;
  // The API's own reason: "No FTC team … in our data", or (with ?season=) "Season … isn't covered".
  if (notFound) {
    return season
      ? <NotFoundView title={notFound.message} description="This link asks for a specific season. Without it, the team's page opens on their newest one." action={<Button variant="secondary" asChild><Link to={`/teams/${team}`}>Open team {team}'s newest season</Link></Button>} />
      : <NotFoundView title={notFound.message} description="It may not have registered for a season we cover yet, or the number is mistyped. Search by number or name." />;
  }
  return (
    <Async state={state}>
      {(p) => <Profile p={p} onSeason={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />}
    </Async>
  );
}

function Profile({ p, onSeason }: { p: TeamProfile; onSeason: (s: number) => void }) {
  const hasResults = p.events.length > 0;
  // 2019–2022: results and stats only (no ratings, predictions or scouting templates).
  const predictable = usePredictable(p.season);
  // The hero paints first; the sections under it (charts, tables) mount right after.
  const rest = useAfterFirstPaint();
  return (
    <div className="min-w-0">
      <OfflineNote data={p} />
      <Hero p={p} onSeason={onSeason} />
      {!rest ? null : !hasResults ? (
        <EmptyState className="mb-8 max-sm:mb-5" icon={CalendarDays} title={`No ${seasonLabel(p.season)} results for ${p.team.number} yet`}
          description={p.seasons.length > 1 ? "Pick another season above to see past results." : "This team hasn't played an event we have data for."} />
      ) : (
        <>
          {/* Wide desktops: two columns, so the side space carries content instead of margins. */}
          <div className="min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:gap-x-8">
            <OprSection p={p} />
            <TrendChart events={p.events} season={p.season} />
          </div>
          {p.stats?.reliability !== undefined && <ReliabilitySection r={p.stats.reliability} />}
          {predictable && <ReportCardSection team={p.team.number} season={p.season} data={p.reportCards} />}
          <div className="min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:items-start min-[1700px]:gap-x-8">
            <Section title={`Event history (${p.events.length})`} description={`${seasonLabel(p.season)}, newest first`}>
              <EventHistory events={p.events} team={p.team.number} />
            </Section>
            <div className="min-w-0">
              <AwardsAllTime p={p} />
              {predictable && <ScoutNotes team={p.team.number} season={p.season} />}
            </div>
          </div>
          <MatchesSection team={p.team.number} season={p.season} events={p.events} predictable={predictable} />
        </>
      )}
      {rest && !hasResults && <><AwardsAllTime p={p} />{predictable && <ScoutNotes team={p.team.number} season={p.season} />}</>}
      {/* Workspace members only: their workspace's scouting on this team (nothing for anyone else). Last, after
          the team's own numbers and matches: it's the members' take, not the first thing a search opens on. */}
      {rest && predictable && <TeamConsensusSection team={p.team.number} season={p.season} reliability={p.stats?.reliability} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/** Event types with advancement (and so advancement odds). */
const ADVANCING = new Set(["LeagueTournament", "Qualifier", "Championship", "SuperQualifier", "Premier", "FIRSTChampionship"]);

function Hero({ p, onSeason }: { p: TeamProfile; onSeason: (s: number) => void }) {
  const t = p.team;
  const flags = useTeamFlags(t.number);
  const { state: personal } = usePersonal();
  const nav = useNavigate();
  // With Control Point workspaces, "My team" in the nav opens the workspace: the followed-team dashboard is linked from here.
  const workspaceUser = useYoursRow().row.kind !== "followed";
  // Say what each button did and where to see it: tracking and shortlisting change other pages, not this one.
  const track = () => {
    const on = !flags.tracked;
    flags.toggleTracked();
    if (!on) { toast(`Stopped tracking ${t.number}`); return; }
    toast.success(`Tracking ${t.number}`, {
      description: `It's on My team under Tracked teams, comes first in search and in Predict's quick picks.${personal.settings.notify.trackedTeams ? " While Control Scout is open in a tab, you'll get an alert before its matches." : " Turn on alerts for tracked teams in Settings › Notifications to hear before its matches (while Control Scout is open in a tab)."}`,
      action: { label: workspaceUser ? "Followed team" : "My team", onClick: () => nav(FOLLOWED_TEAM_PATH) },
    });
  };
  const shortlist = () => {
    const on = !flags.bookmarked;
    flags.toggleBookmark();
    if (!on) { toast(`Removed ${t.number} from your shortlist`); return; }
    toast.success(`${t.number} added to your shortlist`, { description: "Your shortlist compares the teams you're considering side by side.", action: { label: "Shortlist", onClick: () => nav("/shortlist") } });
  };
  const loc = place(t.city, t.state, t.country);
  const s = p.stats;
  const today = new Date().toISOString().slice(0, 10);
  const next = p.events.find((e) => (e.end ?? e.start ?? "") >= today) ?? null;
  const last = [...p.events].reverse().find((e) => (e.end ?? e.start ?? "") < today) ?? null;
  const top = rankPct(s?.opr.np.rank, s?.opr.np.of, true);
  const predictable = usePredictable(p.season);
  const share = () => copyLink();
  // The end of the header: the phone action bar shows once it has scrolled away.
  const [headerEnd, setHeaderEnd] = useState<HTMLDivElement | null>(null);
  const matchHref = predictHref({ mode: "match", season: p.season, red: [t.number] });
  return (
    <>
    <Reveal fade={false} className="mb-8 max-sm:mb-5 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Who this is */}
        <div className="relative min-w-0 p-4 sm:p-8">
          <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-64 rounded-full bg-accent opacity-[0.12] blur-3xl" />
          <p className="relative text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">FTC team · {seasonLabel(p.season)}</p>
          {/* The heading is the number and name together (what people search for), styled as two lines. */}
          <h1 className="relative mt-1">
            <span className="block font-display text-5xl font-semibold leading-none tracking-tight sm:text-6xl">{t.number}</span>
            {t.name && <span className="mt-2 block break-words font-sans text-xl font-normal tracking-normal text-foreground/90"><span className="sr-only"> </span>{t.name}</span>}
          </h1>
          {!t.name && <p className="relative mt-2 break-words text-xl text-foreground/90">Name not on file</p>}
          <div className="relative mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {t.school && <span className="flex min-w-0 items-center gap-1.5"><GraduationCap className="size-4 shrink-0" /><span className="truncate sm:max-w-[22rem]">{t.school}</span></span>}
            {loc && <span className="flex items-center gap-1.5"><MapPin className="size-4" />{loc}</span>}
            {t.rookieYear && <span>Rookie year {t.rookieYear}</span>}
            {t.website && <a href={t.website.startsWith("http") ? t.website : `https://${t.website}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground">Website <ExternalLink className="size-3" /></a>}
          </div>
          {t.sponsors.length > 0 && (
            <Collapsible className="relative mt-3">
              <CollapsibleTrigger className="group inline-flex min-h-8 max-w-full items-center gap-1.5 rounded text-left text-sm text-muted-foreground hover:text-foreground max-sm:min-h-10">
                <span className="font-medium text-foreground">Sponsors ({t.sponsors.length})</span>
                <span className="truncate group-data-[state=open]:hidden">{t.sponsors.slice(0, 2).join(" · ")}{t.sponsors.length > 2 ? " …" : ""}</span>
                <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1 text-sm text-muted-foreground">{t.sponsors.join(" · ")}</CollapsibleContent>
            </Collapsible>
          )}
          <div className="relative mt-5 max-sm:mt-4"><SeasonToggle seasons={p.seasons} value={p.season} onChange={onSeason} /></div>
          <div className="relative mt-4 flex flex-wrap gap-2">
            <Button variant={flags.isMine ? "secondary" : "outline"} size="sm" aria-pressed={flags.isMine} onClick={() => flags.setMine(!flags.isMine)} className="max-sm:h-10">
              <Star className={cn(flags.isMine && "fill-accent text-accent")} /> {flags.isMine ? "My team" : "Mark as my team"}
            </Button>
            <Button variant={flags.tracked ? "secondary" : "outline"} size="sm" aria-pressed={flags.tracked} onClick={track} className="max-sm:h-10" data-tour="track" title={flags.tracked ? "Tracked: on My team, first in search. Click to stop." : "Follow this team: it goes on My team and comes first in search"}>
              <Eye className={cn(flags.tracked && "text-accent")} /> {flags.tracked ? "Tracking" : "Track"}
            </Button>
            <Button variant={flags.bookmarked ? "secondary" : "outline"} size="sm" aria-pressed={flags.bookmarked} onClick={shortlist} className="max-sm:h-10">
              {flags.bookmarked ? <BookmarkCheck /> : <Bookmark />} {flags.bookmarked ? "Shortlisted" : "Shortlist"}
            </Button>
            <Button variant="outline" size="sm" asChild className="max-sm:h-10"><Link to={`/compare?teams=${t.number}`}><Scale /> Compare</Link></Button>
            <Button variant="outline" size="sm" onClick={share} className="max-sm:h-10"><Link2 /> Share</Button>
          </div>
          <a href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener" className="relative mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent-text">
            Manage this team in Control Point <ExternalLink className="size-3" />
          </a>
          {workspaceUser && flags.isMine && (
            <Link to={FOLLOWED_TEAM_PATH} className="relative ml-4 mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent-text">
              <Star className="size-3" aria-hidden /> My followed team dashboard
            </Link>
          )}
        </div>
        {/* At a glance: the five-second answer to "is this team good?" */}
        <div className="min-w-0 border-t border-border bg-secondary/60 p-4 sm:p-8 lg:border-l lg:border-t-0">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">At a glance · {seasonLabel(p.season)}</p>
          {!s ? (
            <div className="mt-4 space-y-3 text-sm">
              <p className="text-muted-foreground">No results this season yet.</p>
              {p.seasons.filter((x) => x < p.season).slice(0, 1).map((prev) => (
                <button key={prev} onClick={() => onSeason(prev)} className="lift flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left">
                  <span>See how {t.number} did in {seasonLabel(prev)}</span><span className="text-accent-text">→</span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <p className={cn("mt-3 font-display text-5xl font-semibold tabular-nums", PROFILE_PERCENTILE_TEXT)}>{top ?? "Unranked"}</p>
              <p className="text-sm text-muted-foreground">worldwide by OPR{s.opr.np.rank ? ` · #${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}` : ""}</p>
              <dl className={cn("mt-5 max-sm:mt-4 grid gap-3", s.reliability ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
                <div><dt className="text-xs text-muted-foreground">OPR</dt><dd className="font-display text-2xl font-semibold tabular-nums">{num(s.opr.np.value)}</dd></div>
                {predictable
                  ? <div><dt className="text-xs text-muted-foreground">Rating</dt><dd className="font-display text-2xl font-semibold tabular-nums">{s.rating ? num(s.rating.np) : "—"}{s.rating && <span className="text-sm font-normal text-muted-foreground"> ±{num(s.rating.sd, 0)}</span>}</dd></div>
                  : <div><dt className="text-xs text-muted-foreground">Avg score</dt><dd className="font-display text-2xl font-semibold tabular-nums">{num(s.avg.np)}</dd></div>}
                <div><dt className="text-xs text-muted-foreground">Record</dt><dd className="font-display text-2xl font-semibold tabular-nums">{s.record.wins}-{s.record.losses}-{s.record.ties}</dd></div>
                {s.reliability && <div><dt className="text-xs text-muted-foreground" title="An estimate from match results: no-shows, DQs, near-zero matches, swing, penalties">Reliability</dt><dd className="font-display text-2xl font-semibold tabular-nums">{s.reliability.index}<span className="text-sm font-normal text-muted-foreground"> /100</span></dd></div>}
              </dl>
            </>
          )}
          <div className="mt-5 max-sm:mt-4 space-y-2 text-sm">
            {last && (
              <Link to={`/events/${last.season}/${last.code}?team=${t.number}`} className="lift flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2">
                <span className="min-w-0 truncate"><span className="text-muted-foreground">Last · </span>{last.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{last.rank ? `ranked #${last.rank}` : ""}{last.awards.length ? ` · ${last.awards.length} award${last.awards.length > 1 ? "s" : ""}` : ""}</span>
              </Link>
            )}
            {next && (
              <Link to={ADVANCING.has(next.type ?? "") ? `/events/${next.season}/${next.code}?tab=odds&team=${t.number}` : `/events/${next.season}/${next.code}?team=${t.number}`} className="lift flex items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent/[0.05] px-3 py-2">
                <span className="min-w-0 truncate"><span className="text-muted-foreground">Next · </span>{next.name}</span>
                <span className="shrink-0 font-medium text-accent-text">{ADVANCING.has(next.type ?? "") ? "Odds to advance →" : "Schedule →"}</span>
              </Link>
            )}
          </div>
          {predictable ? (
            <div className="mt-5 max-sm:mt-4 flex flex-wrap gap-2">
              <Button size="sm" asChild><Link to={matchHref} data-tour="predict"><Sparkles /> Predict a match with {t.number}</Link></Button>
              {!(next && ADVANCING.has(next.type ?? "")) && <Button size="sm" variant="secondary" asChild><Link to={predictHref({ mode: "advancement", season: p.season, team: t.number })}><Trophy /> Advancement odds</Link></Button>}
            </div>
          ) : <p className="mt-5 max-sm:mt-4 text-xs text-muted-foreground">{seasonLabel(p.season)} is shown for history: results and stats, no predictions (those start with 2023–24).</p>}
        </div>
      </div>
      <div ref={setHeaderEnd} aria-hidden />
    </Reveal>
    {/* Phones: once the header has scrolled away, its main actions stay in reach (history seasons: Track only, no predictions). */}
    <StickyActions after={headerEnd} label={`Actions for team ${t.number}`}>
      {predictable && <Button asChild><Link to={matchHref}><Sparkles /> <span className="truncate">Predict with {t.number}</span></Link></Button>}
      <Button variant={flags.tracked ? "secondary" : "outline"} aria-pressed={flags.tracked} onClick={track} className={cn(predictable && "!flex-none")}>
        <Eye className={cn(flags.tracked && "text-accent")} /> {flags.tracked ? "Tracking" : "Track"}
      </Button>
    </StickyActions>
    </>
  );
}

// ---------------------------------------------------------------------------
// OPR + rating
// ---------------------------------------------------------------------------

const OPR_CARDS = [["np", "Total OPR", Target, "accent"], ["auto", "Autonomous", Zap, "sky"], ["teleop", "TeleOp", Gauge, "emerald"], ["endgame", "Endgame", Flag, "violet"]] as const satisfies readonly (readonly [string, string, unknown, Tone])[];
const OPR_TONE: Record<string, Tone> = Object.fromEntries(OPR_CARDS.map(([k, , , tone]) => [k, tone]));

/** Exported for its test. */
export function OprSection({ p }: { p: TeamProfile }) {
  const s = p.stats;
  const [open, setOpen] = useState<(typeof OPR_CARDS)[number][0] | null>(null);
  const predictable = usePredictable(p.season);
  return (
    <Section title="Offensive power rating" description={<>Best event OPR this season and its world rank. Non-penalty points, computed with standard least squares{p.season >= 2024 ? "; TeleOp includes the endgame, as FIRST reports it" : ""}. <Link to="/methodology#opr" className="underline">How it's computed</Link></>}>
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {OPR_CARDS.map(([k, label, Icon, tone]) => {
          const stat = s?.opr[k];
          const top = rankPct(stat?.rank, stat?.of);
          return (
            <StaggerItem key={k}>
              {/* Each stat in its own colour; only the open one gets the ring (data-selected), none at rest. */}
              <StatTile tone={tone} icon={Icon} label={label} value={num(stat?.value)} onClick={() => setOpen(open === k ? null : k)} selected={open === k}
                action="Show event by event"
                hint={<>{stat?.rank ? `Rank #${stat.rank.toLocaleString()} of ${stat.of?.toLocaleString()}` : "Unranked"}{top && ` · ${top}`}</>}
                bar={<Meter parts={[{ pc: rankPc(stat?.rank, stat?.of), cls: TONES[tone].bar }]} />} />
            </StaggerItem>
          );
        })}
      </Stagger>
      {open && <OprBreakdown events={p.events} k={open} />}
      {s && !predictable && s.record.matches > 0 && (
        <p className="mt-3 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          Season record {s.record.wins}-{s.record.losses}-{s.record.ties} across {s.record.events} event{s.record.events === 1 ? "" : "s"} · avg alliance score {num(s.avg.score)} ({num(s.avg.np)} without penalties)
        </p>
      )}
      {s?.rating && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr]">
          <StatTile tone="amber" icon={Sparkles} label="Prediction rating"
            value={<>{num(s.rating.np)} <span className="text-base font-medium text-muted-foreground">± {num(s.rating.sd)}</span></>}
            hint={`${s.rating.rank ? `#${s.rating.rank.toLocaleString()} worldwide · ` : ""}${s.rating.matches} matches this season`} />
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <p>The rating is what the prediction engine expects this robot to add to its alliance <em>now</em> (<span className={cn("font-medium", TONES.sky.text)}>auto {num(s.rating.auto)}</span>, <span className={cn("font-medium", TONES.emerald.text)}>TeleOp {num(s.rating.teleop)}</span>, <span className={cn("font-medium", TONES.violet.text)}>endgame {num(s.rating.endgame)}</span>; gives away ~{num(s.rating.pen)} penalty pts a match). Unlike OPR it updates after every match and carries over from last season, so it's what drives win odds. <Link to="/methodology#rating" className="underline">How ratings work</Link></p>
            <p className="mt-2 text-xs">Season record {s.record.wins}-{s.record.losses}-{s.record.ties} across {s.record.events} event{s.record.events === 1 ? "" : "s"} · avg alliance score {num(s.avg.score)}</p>
          </div>
        </div>
      )}
    </Section>
  );
}

const BREAKDOWN_COLS = [["np", "OPR"], ["auto", "Auto"], ["teleop", "TeleOp"], ["endgame", "Endgame"], ["pen", "Pen. given"]] as const;

function OprBreakdown({ events, k }: { events: TeamEventRow[]; k: "np" | "auto" | "teleop" | "endgame" }) {
  // Tied to the open tile: a top edge in its colour, and its column (header and values) in that colour too.
  const tone = TONES[OPR_TONE[k]];
  return (
    <div className={cn("mt-3 overflow-x-auto rounded-xl border border-t-2 border-border bg-card", tone.edge)}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[10px] font-bold uppercase tracking-wider text-text-muted"><th className="h-10 px-3">Event</th>{BREAKDOWN_COLS.map(([c, label]) => <th key={c} className={cn("px-3 text-right", c === k && tone.text)}>{label}</th>)}</tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.code} className="border-t border-border">
              <td className="px-3 py-2"><Link to={`/events/${e.season}/${e.code}`} className="hover:underline">{e.name}</Link></td>
              {BREAKDOWN_COLS.map(([c]) => <td key={c} className={cn("px-3 text-right tabular-nums", c === k && cn("font-semibold", tone.text))}>{num(e.opr[c])}</td>)}
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
          {dir && <Badge variant={good == null ? "secondary" : good ? "success" : "destructive"}>{dir === "up" ? <TrendingUp /> : dir === "down" ? <TrendingDown /> : null}{trendLabel(dir)}</Badge>}
        </div>
        {rows.length < 2 ? <p className="py-8 max-sm:py-5 text-center text-sm text-muted-foreground">One event so far — the trend line appears after a second event.</p> : (
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
        {vals.some((v) => v == null) && <p className="mt-2 text-xs text-muted-foreground">Gaps: no measurement for this stat at that event (too few qualification matches recorded).</p>}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Events, matches, awards, scouting
// ---------------------------------------------------------------------------

function RankMedal({ rank }: { rank: number | null }) {
  if (!rank) return <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-xs text-muted-foreground">—</span>;
  return <span className={cn("flex size-10 shrink-0 flex-col items-center justify-center rounded-xl border font-display text-sm font-bold tabular-nums", rank === 1 ? "border-accent/50 bg-accent/15 text-accent-text" : rank <= 4 ? "border-border bg-muted" : "border-border")}>
    <span className="text-[9px] font-medium uppercase leading-none text-muted-foreground">rank</span>{rank}
  </span>;
}

function EventHistory({ events, team }: { events: TeamEventRow[]; team: number }) {
  return (
    <div className="space-y-2">
      {[...events].reverse().map((e) => (
        <Link key={e.code} to={`/events/${e.season}/${e.code}?team=${team}`} className="lift flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 sm:flex-nowrap">
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
          <div className="grid grid-cols-3 gap-4 text-right text-sm tabular-nums max-sm:w-full max-sm:pl-[3.25rem] max-sm:text-left">
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Record</p><p className="font-medium">{e.wins ?? "–"}-{e.losses ?? "–"}-{e.ties ?? "–"}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">RS</p><p className="font-medium">{num(e.rp, 2)}</p></div>
            <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">OPR</p><p className="font-medium">{num(e.opr.np)}</p></div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function MatchesSection({ team, season, events, predictable }: { team: number; season: number; events: TeamEventRow[]; predictable: boolean }) {
  const state = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches?season=${season}`);
  const names = Object.fromEntries(events.map((e) => [e.code, e.name]));
  const [all, setAll] = useState(false);
  return (
    <Section title="Matches" description={predictable ? "Every match this season with the prediction made for it. Hover a bar for details." : "Every match this season with its score breakdown."}>
      <Async state={state} loading={<div className="skeleton h-40 rounded-xl" />}>
        {(d) => {
          const ms = [...d.matches].reverse();
          const shown = all ? ms : ms.slice(0, 12);
          return (
            <>
              <MatchList matches={shown} highlight={team} eventNames={names} newestFirst empty="No matches this season yet." />
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
              <Link to={`/events/${a.season}/${a.code}`} className="lift inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs">
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
      action={<Button variant="secondary" size="sm" asChild><Link to={`/scout?team=${team}&season=${season}&new=1`}><ClipboardList /> Scout this team</Link></Button>}>
      {!entries.length ? <p className="rounded-xl border border-dashed border-border px-4 py-6 max-sm:py-4 text-center text-sm text-muted-foreground">No notes for {team} in {seasonLabel(season)} yet.</p> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries.slice(0, 6).map((e) => (
            <Link key={e.uuid} to={`/scout?team=${team}&season=${season}&space=personal&entry=${e.uuid}`} className="lift rounded-xl border border-border bg-card p-3 text-sm">
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
