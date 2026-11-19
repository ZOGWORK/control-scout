// Team profile — any team, any season. Control Point's Team Stats design
// (hero, OPR cards with world rank, one trend chart, event history),
// generalised from "my team" to every team.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { recordWords } from "../shared/format";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { leagueHref, leagueTitle } from "../shared/leagues";
import { CONFERENCE_REGION, ordinal, type TeamConferenceInfo } from "../shared/conferences";
import { useConferenceGate } from "../lib/conferenceGate";
import { regionHref } from "../shared/regionRankings";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
  Award, Bookmark, BookmarkCheck, CalendarDays, ChevronDown, ClipboardList, ExternalLink, Eye, GraduationCap, Info, Link2, MapPin, MoreHorizontal, Scale, Sparkles, Star, TrendingDown, TrendingUp, Trophy,
} from "lucide-react";
import { type ApiError, useApi, qs } from "../lib/api";
import { NotFoundView } from "../components/NotFoundView";
import { useAfterFirstPaint } from "../lib/afterPaint";
import { fromFirstPaint } from "../lib/pageData";
import { useCurrentSeason, useMeta, usePredictable, useTitle } from "../lib/meta";
import { usePersonal, useTeamFlags } from "../lib/personal";
import { FOLLOWED_TEAM_PATH, useYoursRow } from "../lib/yoursRow";
import { toast } from "../components/ui/sonner";
import { useScouting } from "../lib/scouting";
import type { ConfidenceTier, MatchView, TeamEventRow, TeamProfile } from "../shared/api";
import { Section, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Reveal, Stagger, StaggerItem } from "../components/motion";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/basic";
import { ToggleGroup, ToggleGroupItem, Collapsible, CollapsibleContent, CollapsibleTrigger, Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/overlay";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";
import { MatchList, TierMark } from "../components/predict";
import { SeasonToggle } from "../components/SeasonToggle";
import { cn } from "../components/cn";
import { PROFILE_PERCENTILE_TEXT } from "../lib/textTones";
import { Meter, StatTile, TONES, rankPc } from "../components/StatTile";
import { OPR_CARDS, OPR_TONE, oprRankHint } from "../components/oprCards";
import { ago, awardLabel, dateRange, dayDate, int, matchTime, num, oddsPct, place, seasonLabel, rankPct } from "../lib/format";
import { eventTypeLabel } from "../lib/labels";
import { copyLink } from "../lib/clipboard";
import { direction, trendLabel } from "../shared/trend";
import { teamTitle } from "../shared/teamTitle";
import { eventOver, onEventDates, type EventCalendar } from "../shared/eventDay";
import { nextMatchOf } from "../shared/nextMatch";
import { inWeekend, viewerToday, type NextMatchAnswer } from "../shared/weekend";
import { OFFICIAL_ONLY, OFFICIAL_RULE, RECORD_RULE, offSeasonRecord, wltText } from "../shared/eventRecord";
import { OfflineNote } from "../components/OfflineNote";
import { offlineSource } from "../lib/offline/saved";
import { StickyActions } from "../components/StickyActions";
import { TeamConsensusSection } from "../components/ScoutConsensus";
import { CommonsSection } from "../components/CommonsSection";
import { ReportCardSection } from "../components/ReportCard";
import { ReliabilitySection } from "../components/Reliability";
import { TeamScheduleSection } from "../components/ScheduleDifficulty";
import { predictHref } from "../shared/predictUrl";
import { useIsV8 } from "../lib/v8";

/** v8 (docs/design/v8-revamp-brief.md): a small label, sentence case and faint (the uppercase tracked eyebrows today). */
const V8_LABEL = "v8:text-xs v8:font-normal v8:normal-case v8:tracking-normal v8:text-text-faint";
/** A row or card that answers the pointer: the .lift class today (rise and glow); in v8 a faint hover fill only.
 *  .lift is plain CSS outside the layers, so no v8: class can undo it: it's left off in v8. */
const v8Row = (v8: boolean) => (v8 ? "transition-colors hover:bg-white/[0.03] border-line" : "lift");

/** Track and stop-tracking notes share one toast, so tapping Track twice replaces the note rather than stacking two. */
const TRACK_NOTE = "team-track-note";

/** The record rule, mid-sentence ("Records count every match played, …"). */
const RECORD_RULE_LOWER = RECORD_RULE.charAt(0).toLowerCase() + RECORD_RULE.slice(1);

export default function TeamPage() {
  const { number } = useParams();
  const [sp, setSp] = useSearchParams();
  const team = Number(number);
  const season = sp.get("season");
  // FTC team numbers are 1–999999, digits only (as on the server); anything else can't exist, so don't ask the API.
  const valid = /^\d+$/.test(number ?? "") && team >= 1 && team <= 999_999;
  const path = valid ? `/api/teams/${team}${qs({ season })}` : null;
  const state = useApi<TeamProfile>(path);
  // Drawn by the server already (the page's first paint: src/prerender/page.tsx): draw it whole, the same at once.
  const [drawn] = useState(() => fromFirstPaint(path));
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
      {(p) => <Profile p={p} drawn={drawn} asked={season != null} onSeason={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />}
    </Async>
  );
}

function Profile(props: { p: TeamProfile; drawn?: boolean; asked: boolean; onSeason: (s: number) => void }) {
  // v8 is a page of its own (V8Profile below); without it the page is drawn as it always was.
  return useIsV8() ? <V8Profile {...props} drawn={props.drawn ?? false} /> : <ClassicProfile {...props} />;
}

function ClassicProfile({ p, drawn = false, asked, onSeason }: { p: TeamProfile; drawn?: boolean; asked: boolean; onSeason: (s: number) => void }) {
  const hasResults = p.events.length > 0;
  // 2019–2022: results and stats only (no ratings, predictions or scouting templates).
  const predictable = usePredictable(p.season);
  // The hero paints first; the sections under it (charts, tables) mount right after. Unless the server drew the
  // whole page already: then all of it at once, as drawn.
  const rest = useAfterFirstPaint(drawn);
  const fellBackFrom = useFellBackFrom(p, asked);
  return (
    <div className="min-w-0">
      <OfflineNote data={p} />
      <Hero p={p} onSeason={onSeason} fellBackFrom={fellBackFrom} asked={asked} />
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
          {/* Closed at first, each asked for (or drawn) only when opened; closed again for another team or season. */}
          <Fragment key={`${p.team.number}-${p.season}`}>
            {p.stats?.reliability !== undefined && <ReliabilitySection r={p.stats.reliability} />}
            {predictable && <ReportCardSection team={p.team.number} season={p.season} />}
            {predictable && <TeamScheduleSection team={p.team.number} season={p.season} events={p.events} />}
          </Fragment>
          <div className="min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:items-start min-[1700px]:gap-x-8">
            <Section id="events" also={["ranking", "history"]} title={`Season Road Map (${p.events.length})`} description={`${seasonLabel(p.season)}, newest first`}>
              <EventHistory events={p.events} team={p.team.number} />
              {p.events.some((e) => e.played) && <p className="mt-2 text-xs text-muted-foreground">Records count {RECORD_RULE_LOWER}</p>}
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
      {/* The scouting commons: other workspaces' shared pit scouting, a separate layer after the reader's own take. */}
      {rest && predictable && <CommonsSection team={p.team.number} season={p.season} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/** Event types with advancement (and so advancement odds). */
const ADVANCING = new Set(["LeagueTournament", "Qualifier", "Championship", "SuperQualifier", "Premier", "FIRSTChampionship"]);

/**
 * The season the page would have opened on when the server fell back from it: no ?season= asked, and the
 * current season is one of the team's but has no results for it yet, so the newest season with results shows.
 */
function useFellBackFrom(p: TeamProfile, asked: boolean): number | null {
  const current = useCurrentSeason();
  return !asked && p.season < current && p.seasons.includes(current) ? current : null;
}

function Hero({ p, onSeason, fellBackFrom, asked = false }: { p: TeamProfile; onSeason: (s: number) => void; fellBackFrom: number | null; asked?: boolean }) {
  const t = p.team;
  const { flags, track, shortlist, workspaceUser } = useTeamActions(t.number);
  const loc = place(t.city, t.state, t.country);
  const s = p.stats;
  // Over or not on the event's own calendar (a California event's last evening is already tomorrow in UTC).
  const clock = Date.now();
  const next = p.events.find((e) => !eventOver(e, clock)) ?? null;
  const last = [...p.events].reverse().find((e) => eventOver(e, clock)) ?? null;
  const current = useCurrentSeason();
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
              <CollapsibleTrigger className="group inline-flex min-h-8 max-w-full items-center gap-1.5 rounded text-left text-sm text-muted-foreground hover:text-foreground max-sm:min-h-10 pointer-coarse:min-h-[44px]">
                <span className="shrink-0 whitespace-nowrap font-medium text-foreground">Sponsors ({t.sponsors.length})</span>
                <span className="truncate group-data-[state=open]:hidden">{t.sponsors.slice(0, 2).join(" · ")}{t.sponsors.length > 2 ? " …" : ""}</span>
                <ChevronDown className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-1 text-sm text-muted-foreground">{t.sponsors.join(" · ")}</CollapsibleContent>
            </Collapsible>
          )}
          <div className="relative mt-5 max-sm:mt-4"><SeasonToggle seasons={p.seasons} value={p.season} onChange={onSeason} /></div>
          {fellBackFrom != null && (
            <p className="relative mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-season-fallback>
              <Info className="size-3.5 shrink-0 text-accent-text" aria-hidden />
              <span>No {seasonLabel(fellBackFrom)} results yet, so this shows {seasonLabel(p.season)}.</span>
              <button type="button" onClick={() => onSeason(fellBackFrom)} className="tap-44 -my-1 py-1 font-medium text-accent-text underline-offset-2 hover:underline">See {seasonLabel(fellBackFrom)}</button>
            </p>
          )}
          <div className="relative mt-4 flex flex-wrap gap-2">
            <Button variant={flags.isMine ? "secondary" : "outline"} size="sm" aria-pressed={flags.isMine} onClick={() => flags.setMine(!flags.isMine)} className="max-sm:h-10">
              <Star className={cn(flags.isMine && "fill-accent text-accent")} /> {flags.isMine ? "My team" : "Mark as my team"}
            </Button>
            <Button variant={flags.tracked ? "secondary" : "outline"} size="sm" aria-pressed={flags.tracked} onClick={track} className="max-sm:h-10" title={flags.tracked ? "Tracked: on My team, first in search. Click to stop." : "Follow this team: it goes on My team and comes first in search"}>
              <Eye className={cn(flags.tracked && "text-accent")} /> {flags.tracked ? "Tracking" : "Track"}
            </Button>
            <Button variant={flags.bookmarked ? "secondary" : "outline"} size="sm" aria-pressed={flags.bookmarked} onClick={shortlist} className="max-sm:h-10">
              {flags.bookmarked ? <BookmarkCheck /> : <Bookmark />} {flags.bookmarked ? "Shortlisted" : "Shortlist"}
            </Button>
            <Button variant="outline" size="sm" asChild className="max-sm:h-10"><Link to={`/compare?teams=${t.number}`}><Scale /> Compare</Link></Button>
            {p.highlights && <Button variant="outline" size="sm" asChild className="max-sm:h-10"><Link to={`/teams/${t.number}/highlights`} data-highlights-link><Sparkles /> Highlights</Link></Button>}
            {p.recordSplit && <Button variant="outline" size="sm" asChild className="max-sm:h-10"><Link to={`/teams/${t.number}/record-split`} data-record-split-link><Trophy /> Quals vs playoffs</Link></Button>}
            <Button variant="outline" size="sm" onClick={share} className="max-sm:h-10"><Link2 /> Share</Button>
          </div>
          <a href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener" className="tap-44 relative mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground underline decoration-current/40 underline-offset-2 hover:text-accent-text">
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
              <p className="text-sm text-muted-foreground">worldwide by OPR{s.opr.np.rank ? ` · #${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()} teams with an OPR` : ""}</p>
              <dl className={cn("mt-5 max-sm:mt-4 grid gap-3", s.reliability ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
                <div><dt className="text-xs text-muted-foreground" title={OPR_TERM}>OPR</dt><dd className="font-display text-2xl font-semibold tabular-nums">{num(s.opr.np.value)}</dd></div>
                {predictable
                  ? <div><dt className="text-xs text-muted-foreground" title={RATING_TERM}>Rating</dt><dd className="font-display text-2xl font-semibold tabular-nums">{s.rating ? num(s.rating.np) : "—"}{s.rating && <span className="text-sm font-normal text-muted-foreground"> ±{num(s.rating.sd, 0)}</span>}</dd></div>
                  : <div><dt className="text-xs text-muted-foreground">Avg score</dt><dd className="font-display text-2xl font-semibold tabular-nums">{num(s.avg.np)}</dd></div>}
                <div><dt className="text-xs text-muted-foreground" title={`${OFFICIAL_RULE} ${RECORD_RULE}`}>Record</dt><dd className="font-display text-2xl font-semibold tabular-nums" title={`${OFFICIAL_RULE} ${RECORD_RULE}`}>{s.record.wins}-{s.record.losses}-{s.record.ties}</dd><dd className="text-xs text-muted-foreground" data-record-scope>{OFFICIAL_ONLY}</dd></div>
                {s.reliability && <div><dt className="text-xs text-muted-foreground" title="An estimate from match results: no-shows, DQs, near-zero matches, swing, penalties">Reliability</dt><dd className="font-display text-2xl font-semibold tabular-nums">{s.reliability.index}<span className="text-sm font-normal text-muted-foreground"> /100</span></dd></div>}
              </dl>
              <OffSeasonLine events={p.events} />
            </>
          )}
          {/* What's next: on the team's own page (its newest season, or the current one); a past season asked for shows only its last event. */}
          {!asked || p.season >= current ? <Upcoming p={p} next={next} last={last} /> : last && <LastEvent last={last} team={t.number} className="mt-5 max-sm:mt-4" />}
          {p.league && <LeagueStanding league={p.league} season={p.season} team={t.number} />}
          {p.league?.region.toUpperCase() === CONFERENCE_REGION && <ConferenceStanding season={p.season} team={t.number} />}
          {p.region && <RegionStanding region={p.region} season={p.season} team={t.number} />}
          {predictable ? (
            <div className="mt-5 max-sm:mt-4 flex flex-wrap gap-2">
              <Button size="sm" asChild><Link to={matchHref}><Sparkles /> Predict a match with {t.number}</Link></Button>
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

// The tiles (names, icons, colours) are shared with search's OPR answer (../components/oprCards.ts).

/** The hero's headline numbers, explained where they first appear (hover, or long-press on a phone; the
 *  Offensive power rating section right below says the same in full). */
const OPR_TERM = "OPR, offensive power rating: the points a team adds to its alliance's score per match, from least squares over its event (penalty points left out)";
const RATING_TERM = "Rating: what the prediction engine expects this robot to add now. Unlike OPR it updates after every match and carries over from last season; ± is its uncertainty";

/** Exported for its test. */
export function OprSection({ p }: { p: TeamProfile }) {
  const s = p.stats;
  const [open, setOpen] = useState<(typeof OPR_CARDS)[number][0] | null>(null);
  const predictable = usePredictable(p.season);
  // When the stats were last rebuilt, so last week's OPR never reads as live. Only for the current season (the
  // regular rebuild covers only that one, so the time would date an older season's numbers wrongly), and not for
  // a page drawn from a saved season offline (the server's time would date older numbers; its offline note does).
  const metaStatsAt = useMeta()?.statsAt;
  const current = useCurrentSeason();
  const statsAt = offlineSource(p) || p.season !== current ? null : metaStatsAt;
  return (
    <Section id="opr" title="Offensive power rating" description={<>Best event OPR this season and its world rank. Non-penalty points, computed with standard least squares{p.season >= 2024 ? "; TeleOp includes the endgame, as FIRST reports it" : ""}. <Link to="/methodology#opr" className="underline">How it's computed</Link>{statsAt && <span className="whitespace-nowrap"> · Stats updated {ago(statsAt)}</span>}</>}>
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {OPR_CARDS.map(([k, label, Icon, tone]) => {
          const stat = s?.opr[k];
          return (
            <StaggerItem key={k}>
              {/* Each stat in its own colour; only the open one gets the ring (data-selected), none at rest. */}
              <StatTile tone={tone} icon={Icon} label={label} value={num(stat?.value)} onClick={() => setOpen(open === k ? null : k)} selected={open === k}
                action="Show event by event"
                hint={oprRankHint(stat?.rank, stat?.of)}
                bar={<Meter parts={[{ pc: rankPc(stat?.rank, stat?.of), cls: TONES[tone].bar }]} />} />
            </StaggerItem>
          );
        })}
      </Stagger>
      {open && <OprBreakdown events={p.events} k={open} />}
      {s && !predictable && s.record.matches > 0 && (
        <p className="mt-3 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
          Season record {s.record.wins}-{s.record.losses}-{s.record.ties} at official events · avg alliance score {num(s.avg.score)} ({num(s.avg.np)} without penalties)
        </p>
      )}
      {s?.rating && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr]">
          <StatTile tone="amber" icon={Sparkles} label="Prediction rating"
            value={<>{num(s.rating.np)} <span className="text-base font-medium text-muted-foreground">± {num(s.rating.sd)}</span></>}
            hint={`${s.rating.rank ? `Rating #${s.rating.rank.toLocaleString()} worldwide, of teams rated on 3+ matches · ` : ""}${s.rating.matches} matches this season`} />
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <p>The rating is what the prediction engine expects this robot to add to its alliance <em>now</em> (<span className={cn("font-medium", TONES.sky.text)}>auto {num(s.rating.auto)}</span>, <span className={cn("font-medium", TONES.emerald.text)}>TeleOp {num(s.rating.teleop)}</span>, <span className={cn("font-medium", TONES.violet.text)}>endgame {num(s.rating.endgame)}</span>; gives away ~{num(s.rating.pen)} penalty pts a match). Unlike OPR it updates after every match and carries over from last season, so it's what drives win odds. It's read from alliance scores: random qualification partners let a team's share show, and playoffs (fixed partners) count half. <Link to="/methodology#rating-assumption" className="underline">How ratings work</Link></p>
            <p className="mt-2 text-xs">Season record {s.record.wins}-{s.record.losses}-{s.record.ties} at official events · avg alliance score {num(s.avg.score)}</p>
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
    <div className={cn("mt-3 overflow-x-auto rounded-xl border border-t-2 border-border bg-card", tone.edge, "v8:border-t v8:border-line")} data-opr-breakdown>
      <table className="w-full text-sm">
        <thead><tr className={cn("text-left text-[10px] font-bold uppercase tracking-wider text-text-muted", V8_LABEL, "v8:font-medium")}><th className="h-10 px-3">Event</th>{BREAKDOWN_COLS.map(([c, label]) => <th key={c} className={cn("px-3 text-right", c === k && cn(tone.text, "v8:text-text-base"))}>{label}</th>)}</tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.code} className="border-t border-border v8:border-line">
              <td className="px-3 py-2 v8:h-11"><Link to={`/events/${e.season}/${e.code}`} className="hover:underline">{e.name}</Link></td>
              {BREAKDOWN_COLS.map(([c]) => <td key={c} className={cn("px-3 text-right tabular-nums", c === k && cn("font-semibold", tone.text, "v8:text-text-base"))}>{num(e.opr[c])}</td>)}
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
  // v8: mint is the chart's one highlight series (brief §5, charts).
  const v8 = useIsV8();
  const t = TRENDS.find((x) => x.key === key)!;
  const rows = useMemo(() => events.map((e, i) => ({ i, name: e.name, value: t.get(e) == null ? null : Math.round(t.get(e)! * 10) / 10 })), [events, t]);
  const vals = rows.map((r) => r.value);
  const dir = direction(vals);
  const good = dir === "flat" || dir == null ? null : (dir === "up") !== !!t.lowerIsBetter;
  const last = [...vals].reverse().find((v) => v != null) ?? null;
  return (
    <Section title="Trends" description={`${seasonLabel(season)}, event by event`}>
      <div className="rounded-xl border border-border bg-card p-4 sm:p-5 v8:border-line">
        <ToggleGroup type="single" variant="chips" aria-label="Trend metric" value={key} onValueChange={(v) => { if (v) setKey(v as TrendKey); }} className="mb-4 flex w-full justify-start gap-1.5 overflow-x-auto pb-1">
          {TRENDS.map((x) => <ToggleGroupItem key={x.key} value={x.key} className="shrink-0">{x.label}</ToggleGroupItem>)}
        </ToggleGroup>
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <span className="font-display text-3xl font-semibold tabular-nums">{num(last)}{last != null && t.suffix}</span>
          <span className="text-sm text-muted-foreground">latest</span>
          {dir && <Badge variant={good == null ? "secondary" : good ? "success" : "destructive"}>{dir === "up" ? <TrendingUp /> : dir === "down" ? <TrendingDown /> : null}{trendLabel(dir)}</Badge>}
        </div>
        {rows.length < 2 ? <p className="py-8 max-sm:py-5 text-center text-sm text-muted-foreground">One event so far — the trend line appears after a second event.</p> : (
          <ChartContainer config={{ value: { label: t.label, color: v8 ? "var(--color-accent)" : "var(--color-chart-1)" } }} className="h-56 w-full">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 14 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="i" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={(i: number) => `E${i + 1}`} label={{ value: "Event, oldest to newest", position: "insideBottom", offset: -12, className: "fill-muted-foreground text-xs" }} />
              <YAxis tickLine={false} axisLine={false} width={44} label={{ value: t.suffix ? "Percent" : "Points", angle: -90, position: "insideLeft", offset: 8, style: { textAnchor: "middle" }, className: "fill-muted-foreground text-xs" }} />
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
  if (!rank) return <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-xs text-muted-foreground v8:rounded-lg v8:border-line">—</span>;
  // v8: the #1 rank is mint text on a hairline (mint marks "best", never as a fill behind text).
  return <span className={cn("flex size-10 shrink-0 flex-col items-center justify-center rounded-xl border font-display text-sm font-bold tabular-nums v8:rounded-lg v8:font-semibold", rank === 1 ? "border-accent/50 bg-accent/15 text-accent-text v8:border-accent/40 v8:bg-transparent" : rank <= 4 ? "border-border bg-muted v8:border-line v8:bg-white/[0.04]" : "border-border v8:border-line")}>
    <span className="text-[10px] font-medium uppercase leading-none text-muted-foreground v8:text-[0.625rem] v8:normal-case v8:text-text-faint">rank</span>{rank}
  </span>;
}

/** An event row's record: every match there (as the season record counts them), the quals alone under it when
 *  playoffs make it differ, and in words when there's none to show. */
export function RowRecord({ e }: { e: TeamEventRow }) {
  if (e.wins == null) {
    const over = (e.end ?? e.start ?? "9999") < new Date().toISOString().slice(0, 10);
    // A remote event (one robot a match) has no win-loss record, only matches played.
    // On the field with nothing on its record: it played there only as a surrogate (those matches don't count).
    const text = e.qualPlayed ? `${e.qualPlayed} remote ${e.qualPlayed === 1 ? "match" : "matches"}`
      : e.onField ? "Surrogate only" : over ? "No scored matches" : "Not played yet";
    return <p className="text-xs text-muted-foreground">{text}</p>;
  }
  const q = e.qual;
  return (
    <>
      <p className="font-medium" aria-label={`${recordWords(e.wins, e.losses, e.ties)}${q && q.played !== e.played ? ", playoffs included" : ""}`}>{e.wins}-{e.losses ?? 0}-{e.ties ?? 0}</p>
      {!e.onField ? <p className="text-[11px] text-muted-foreground">No-show</p>
        : q && q.played !== e.played && <p className="text-[11px] text-muted-foreground">{q.played ? `Quals ${q.wins}-${q.losses}-${q.ties}` : "Playoffs only"}</p>}
    </>
  );
}

function EventHistory({ events, team }: { events: TeamEventRow[]; team: number }) {
  const v8 = useIsV8();
  return (
    <div className="space-y-2">
      {[...events].reverse().map((e) => (
        <Link key={e.code} to={`/events/${e.season}/${e.code}?team=${team}`} className={cn(v8Row(v8), "flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 sm:flex-nowrap")}>
          <RankMedal rank={e.rank} />
          <div className="min-w-0 flex-1">
            {/* Two lines on a phone before it cuts off: long event names are the norm, and a tooltip needs a mouse. */}
            <p className="font-medium max-sm:line-clamp-2 sm:truncate" title={e.name}>{e.name}</p>
            <p className="truncate text-xs text-muted-foreground">{dateRange(e.start, e.end)} · {place(e.city, e.state)} · {eventTypeLabel(e.type)}</p>
            {(e.awards.length > 0 || e.alliance) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {e.alliance && <Badge variant="secondary">Alliance {e.alliance.number} · {e.alliance.seat === "captain" ? "captain" : e.alliance.seat === "pick1" ? "1st pick" : e.alliance.seat === "pick2" ? "2nd pick" : "backup"}</Badge>}
                {e.awards.map((a) => <Badge key={`${a.type}${a.placement}`} variant="soft"><Award />{awardLabel(a.type, a.placement)}</Badge>)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4 text-right text-sm tabular-nums max-sm:w-full max-sm:pl-[3.25rem] max-sm:text-left">
            <div><p className={cn("text-[10px] uppercase tracking-wider text-muted-foreground", V8_LABEL)}>Record</p><RowRecord e={e} /></div>
            <div><p className={cn("text-[10px] uppercase tracking-wider text-muted-foreground", V8_LABEL)}>RS</p><p className="font-medium">{num(e.rp, 2)}</p></div>
            <div><p className={cn("text-[10px] uppercase tracking-wider text-muted-foreground", V8_LABEL)}>OPR</p><p className="font-medium">{num(e.opr.np)}</p></div>
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
    <Section id="matches" title="Matches" description={predictable ? "Every match this season with the prediction made for it. Hover a bar for details." : "Every match this season with its score breakdown."}>
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

/** v8: awards mean gold (the owner's call), a soft gold on dark and a deep amber that stays readable on light. */
const V8_GOLD = "v8:text-[#fcd34d] v8:[html.light_&]:text-amber-700";

export function AwardsAllTime({ p }: { p: TeamProfile }) {
  const v8 = useIsV8();
  if (!p.awardsAllTime.length) return null;
  return (
    <Section id="awards" title={`Awards (${p.awardsAllTime.length})`} description="Every award in the seasons we cover">
      {/* Rows a little further apart on a touch screen, so one chip's 44px tap area (tap-44) never reaches the next row. */}
      <div className="flex flex-wrap gap-2 pointer-coarse:gap-y-[10px]">
        {p.awardsAllTime.map((a, i) => (
          // The event on its own muted line: a tooltip never opens on a tap.
          <Link key={i} to={`/events/${a.season}/${a.code}`} className={cn("tap-44", v8Row(v8), "inline-flex max-w-[18rem] flex-col rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs")}>
            <span className="inline-flex items-center gap-1.5"><Award className={cn("size-3.5 shrink-0 text-accent", V8_GOLD)} /><span className={cn("v8:font-medium", V8_GOLD)} data-award-name>{awardLabel(a.type, a.placement)}</span><span className="text-muted-foreground">· {seasonLabel(a.season)}</span></span>
            <span className="truncate pl-5 text-muted-foreground" title={a.event}>{a.event}</span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

function ScoutNotes({ team, season }: { team: number; season: number }) {
  const { syncReady } = usePersonal();
  const { entries } = useScouting({ season, team }, syncReady);
  const v8 = useIsV8();
  return (
    <Section title="My scouting notes" description="Only you see these. They're saved on this device and sync to your account when you're signed in."
      action={<Button variant="secondary" size="sm" asChild><Link to={`/scout?team=${team}&season=${season}&new=1`}><ClipboardList /> Scout this team</Link></Button>}>
      {!entries.length ? <p className="rounded-xl border border-dashed border-border px-4 py-6 max-sm:py-4 text-center text-sm text-muted-foreground">No notes for {team} in {seasonLabel(season)} yet.</p> : (
        <div className="grid gap-2 sm:grid-cols-2">
          {entries.slice(0, 6).map((e) => (
            <Link key={e.uuid} to={`/scout?team=${team}&season=${season}&space=personal&entry=${e.uuid}`} className={cn(v8Row(v8), "rounded-xl border border-border bg-card p-3 text-sm")}>
              <p className="font-medium">{e.kind === "pit" ? "Pit scouting" : `Match ${e.matchLabel ?? ""}`} {e.eventCode && <span className="text-muted-foreground">· {e.eventCode}</span>}</p>
              <p className="mt-1 line-clamp-2 text-muted-foreground">{e.notes || `${Object.keys(e.data).length} fields recorded`}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{int(Object.keys(e.data).length)} fields · {dayDate(e.updatedAt)}</p>
            </Link>
          ))}
        </div>
      )}
    </Section>
  );
}

/** The next match's call for this team: its chance to win with the call's confidence tier, as on every prediction. */
export function NextChance({ chance, tier }: { chance: number; tier: ConfidenceTier }) {
  return <span className="flex shrink-0 flex-col items-end tabular-nums font-medium text-accent-text v8:text-text-base">{oddsPct(chance)} to win<TierMark tier={tier} className="text-xs font-normal" /></span>;
}

const ROW_BASE = "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm pointer-coarse:min-h-[44px] v8:border-line";
/** A row under the glance (standings, last and next event), drawn for this page load's look (v8: no lift). */
const useRow = () => cn(v8Row(useIsV8()), ROW_BASE);

/** The team's last event, one tap to its page: where it ranked and what it won. */
/** The team's place in its league (FIRST's league rankings, every meet so far), linking to the league's standings
 *  with its row marked. Out of the teams that have played; a member with no match yet is "Not ranked yet". */
function LeagueStanding({ league, season, team }: { league: NonNullable<TeamProfile["league"]>; season: number; team: number }) {
  const row = useRow();
  return (
    <Link to={`${leagueHref(season, league.region, league.code)}?team=${team}`} data-league-standing className={cn(row, "mt-2 border-border bg-card text-sm")}>
      <span className="min-w-0 truncate"><span className="font-semibold tabular-nums">{league.played ? `#${league.rank} of ${league.of}` : "Not ranked yet"}</span> <span className="text-muted-foreground">in the {leagueTitle(league.name, league.code)}</span></span>
      <span className="shrink-0 text-muted-foreground">Standings →</span>
    </Link>
  );
}

/** A New Jersey team's place in its conference (src/shared/conferences.ts), once FIRST lists it in a conference
 *  tournament: by league standing among that tournament's teams, linking to the league page's conference table with
 *  its row marked. Nothing for a team with no conference, or for a visitor whose My team is based elsewhere. */
function ConferenceStanding({ season, team }: { season: number; team: number }) {
  const row = useRow();
  const shown = useConferenceGate(CONFERENCE_REGION, season);
  const r = useApi<TeamConferenceInfo>(shown ? `/api/teams/${team}/conference?season=${season}` : null);
  const c = r.data?.nj ? r.data.conference : null;
  if (!c) return null;
  return (
    <Link to={c.href} data-conference-standing className={cn(row, "mt-2 border-border bg-card text-sm")}>
      <span className="min-w-0 truncate"><span className="font-semibold">Rank in {c.name}</span> <span className="text-muted-foreground">{c.rank != null ? `${ordinal(c.rank)} of ${c.of} by league RS` : c.available ? "Not ranked yet: no league meets played" : "Going-in standing no longer available"}</span></span>
      <span className="shrink-0 text-muted-foreground">Table →</span>
    </Link>
  );
}

/** The team's place in its home region's rankings (src/shared/regionRankings.ts), linking to that region's table on the
 *  page its row is on, the row marked. A team not ranked yet says so, never a rank. */
function RegionStanding({ region, season, team }: { region: NonNullable<TeamProfile["region"]>; season: number; team: number }) {
  const row = useRow();
  return (
    <Link to={regionHref(region.key, { season, team })} data-region-standing className={cn(row, "mt-2 border-border bg-card text-sm")}>
      <span className="min-w-0 truncate"><span className="font-semibold tabular-nums">{region.rank != null ? `#${region.rank} of ${region.of}` : "Not ranked yet"}</span> <span className="text-muted-foreground">in {region.name}</span></span>
      <span className="shrink-0 text-muted-foreground">Rank in {region.name} →</span>
    </Link>
  );
}

function LastEvent({ last, team, className }: { last: TeamEventRow; team: number; className?: string }) {
  const row = useRow();
  const v8 = useIsV8();
  return (
    <Link to={`/events/${last.season}/${last.code}?team=${team}`} className={cn(row, "border-border bg-card", className)}>
      <span className="min-w-0 truncate" title={last.name}><span className="text-muted-foreground">Last · </span>{last.name}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{last.rank ? `ranked #${last.rank}` : ""}{v8 && last.wins != null ? ` · ${last.wins}-${last.losses ?? 0}-${last.ties ?? 0}` : ""}{last.awards.length ? ` · ${last.awards.length} award${last.awards.length > 1 ? "s" : ""}` : ""}</span>
    </Link>
  );
}

/** How often Upcoming asks for the matches again on an event day (the server checks FIRST about every minute). */
const UPCOMING_REFRESH_MS = 60_000;

/** The page's clock for the team's `events`: a check every UPCOMING_REFRESH_MS while the tab is visible, and once on
 *  coming back to it. Each check takes the event that is next at that moment, on its venue's calendar: a page opened
 *  the night before starts asking for the matches (`reload`) once the event day begins there, moves on to the team's
 *  following event when one ends, and stops for good once none is left. Returns the time of the last check. Hidden
 *  tabs do nothing. Exported for its test. */
export function useEventDayRefresh(events: EventCalendar[] | null, reload: () => Promise<void> | void): number {
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    if (!events?.length) return;
    let timer = 0;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const t = Date.now();
      setAt(t);
      const event = events.find((e) => !eventOver(e, t));
      if (!event) { clearInterval(timer); return; }
      if (onEventDates(event, t)) void reload();
    };
    timer = window.setInterval(tick, UPCOMING_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [events, reload]);
  return at;
}

/** An alliance as Predict takes it (two robots at most): this team first when it's on it, then the others, so a playoff
 *  alliance of three still opens as a matchup Predict can run. */
export const lineup = (teams: { number: number }[], team: number) =>
  [...teams.filter((t) => t.number === team), ...teams.filter((t) => t.number !== team)].slice(0, 2).map((t) => t.number);

/** The team's next match on a posted schedule, soonest first (not played, its event not over); null when none is posted. */
/** The one rule the "This weekend" page and search read too (src/shared/nextMatch.ts). */
export function nextMatch(matches: MatchView[], events: TeamEventRow[], now = Date.now()): MatchView | null {
  return nextMatchOf(matches, events, now);
}

/**
 * Upcoming, right under the team's name: its next match (with the call and one tap to its event or to Predict with the
 * alliances filled in) once a schedule is posted; else its next event, saying the match list comes at the event; else
 * plainly that none is published, with its last event. Drawn in the first paint from the answers the page already has.
 */
export function Upcoming({ p, next: first, last: before, title = "Upcoming" }: { p: TeamProfile; next: TeamEventRow | null; last: TeamEventRow | null; title?: string }) {
  const n = p.team.number;
  // The page's own matches request (MatchesSection asks for the same): no second request, and in the drawn page's data.
  const ms = useApi<{ matches: MatchView[] }>(first ? `/api/teams/${n}/matches?season=${p.season}` : null);
  // On the event's day the next match moves as the field plays: asked again every minute while the tab is visible
  // and on coming back to it, and the "late, not next" cutoff is read against the time of that check.
  const now = useEventDayRefresh(first ? p.events : null, ms.reload);
  // Next and last again on that clock: a page left open past the event's end says so instead of "Next event".
  const next = p.events.find((e) => !eventOver(e, now)) ?? null;
  const last = next === first ? before : [...p.events].reverse().find((e) => eventOver(e, now)) ?? null;
  const m = next && ms.data ? nextMatch(ms.data.matches, p.events, now) : null;
  const mEvent = m ? p.events.find((e) => e.code === m.code) : null;
  const side = m ? (m.red.teams.some((t) => t.number === n) ? "red" : "blue") : null;
  const chance = m?.prediction && side ? (side === "red" ? m.prediction.pRed : 1 - m.prediction.pRed) : null;
  const predictable = usePredictable(p.season);
  // This season's team with no match this weekend: its next event is said as the "This weekend" page says it.
  const current = useCurrentSeason();
  const away = !!next && !m && p.season === current && !inWeekend(next, "this", now, viewerToday(new Date(now)));
  // No event of its own listed this season: the events it's registered for are read as the "This weekend" page reads
  // them (GET /api/teams/:number/next), so the two never disagree.
  const wk = useApi<NextMatchAnswer>(!next && p.season === current ? `/api/teams/${n}/next` : null);
  const reg = wk.data && (wk.data.kind === "next-event" || wk.data.kind === "no-schedule") ? wk.data : null;
  const row = useRow();
  return (
    <section aria-labelledby={`upcoming-${n}`} className="mt-5 max-sm:mt-4 space-y-2 text-sm v8:mt-0" data-upcoming>
      <h2 id={`upcoming-${n}`} className={cn("text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground", V8_LABEL)} data-eyebrow>{title}</h2>
      {m && mEvent && (
        <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-3 v8:border-line v8:bg-white/[0.02]" data-next-match>
          <Link to={`/events/${m.season}/${m.code}?team=${n}&match=${m.key}`} className="flex items-baseline justify-between gap-3 hover:underline pointer-coarse:min-h-[44px] pointer-coarse:items-center">
            <span className="min-w-0"><span className="font-semibold">Next match · {m.label}</span> <span className="text-muted-foreground">{m.time ? matchTime(m.time) : "time not posted yet"}</span></span>
            {chance != null && m.prediction && <NextChance chance={chance} tier={m.prediction.tier} />}
          </Link>
          <p className="mt-1 truncate text-muted-foreground" title={mEvent.name}>{mEvent.name} · on <span className={side === "red" ? "text-red-alliance" : "text-blue-alliance"}>{side}</span>: {m.red.teams.map((t) => t.number).join(" + ")} vs {m.blue.teams.map((t) => t.number).join(" + ")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" asChild className="max-sm:h-11 pointer-coarse:h-[44px]"><Link to={`/events/${m.season}/${m.code}?team=${n}&match=${m.key}`}><CalendarDays /> Event schedule</Link></Button>
            {/* At an event that advances teams, its odds stay one tap away all event day (the hero's button hands over to these). */}
            {ADVANCING.has(mEvent.type ?? "") && <Button size="sm" variant="outline" asChild className="max-sm:h-11 pointer-coarse:h-[44px]"><Link to={`/events/${m.season}/${m.code}?tab=odds&team=${n}`}><Trophy /> Odds to advance</Link></Button>}
            {predictable && <Button size="sm" variant="outline" asChild className="max-sm:h-11 pointer-coarse:h-[44px]"><Link to={predictHref({ mode: "match", season: m.season, red: lineup(m.red.teams, n), blue: lineup(m.blue.teams, n) })}><Sparkles /> Predict this match</Link></Button>}
          </div>
        </div>
      )}
      {next && !m && (
        <Link to={ADVANCING.has(next.type ?? "") ? `/events/${next.season}/${next.code}?tab=odds&team=${n}` : `/events/${next.season}/${next.code}?team=${n}`} className={cn(row, "border-accent/30 bg-accent/[0.05] v8:border-line v8:bg-white/[0.02]")}>
          {away ? (
            // Its next event isn't this weekend: said as the "This weekend" page and search say it (server/api/weekend.ts).
            <span className="min-w-0" data-no-weekend-match><span className="block">No matches this weekend — next event is <span className="font-medium">{next.name}</span> on {dateRange(next.start, next.end)}.</span></span>
          ) : (
            <span className="min-w-0"><span className="block truncate" title={next.name}><span className="text-muted-foreground">Next event · </span>{next.name}</span>
              <span className="block text-xs text-muted-foreground">{[dateRange(next.start, next.end), ms.data ? "match list is posted at the event" : ms.error ? "match list couldn't be checked just now" : null].filter(Boolean).join(" · ")}</span></span>
          )}
          <span className="shrink-0 font-medium text-accent-text v8:text-text-muted">{ADVANCING.has(next.type ?? "") ? "Odds to advance →" : "Schedule →"}</span>
        </Link>
      )}
      {!next && reg?.event ? (
        // An event it's registered for, not yet in its event list: the "This weekend" page's own line and link.
        <Link to={reg.event.href} className={cn(row, "border-accent/30 bg-accent/[0.05] v8:border-line v8:bg-white/[0.02]")} data-no-weekend-match>
          <span className="min-w-0">{reg.line}</span>
          <span className="shrink-0 font-medium text-accent-text v8:text-text-muted">Schedule →</span>
        </Link>
      ) : !next && <p className="text-muted-foreground">{p.season === current ? `No matches this weekend — ${n} has no upcoming event in ${seasonLabel(p.season)}` : `No upcoming event is published for ${n} yet`}{last ? "; its last event:" : "."}</p>}
      {last && <LastEvent last={last} team={n} />}
    </section>
  );
}

/** Off-season events and scrimmages, added up on a line of their own under the record: never in it (OFFICIAL_RULE). */
function OffSeasonLine({ events }: { events: TeamEventRow[] }) {
  const off = offSeasonRecord(events);
  if (!off) return null;
  return (
    <p className="mt-3 text-xs text-muted-foreground" data-off-season-record>
      Off-season and scrimmages, not in the record: <span className="font-medium tabular-nums text-foreground">{wltText(off)}</span> at {off.events} event{off.events === 1 ? "" : "s"}
    </p>
  );
}

// ---------------------------------------------------------------------------
// v8 (docs/design/v8-revamp-brief.md): the page rebuilt around its question, "how good is this team right now,
// and what's next for them?". First screen: who it is, its standing in one row, what's next; then its matches.
// The rest moves down (events, strength, trends), the closed sections stay closed, and the secondary actions sit
// in one More menu. Drawn only while <html data-v8> is set; Profile above is the page without it.
// ---------------------------------------------------------------------------

function V8Profile({ p, drawn, asked, onSeason }: { p: TeamProfile; drawn: boolean; asked: boolean; onSeason: (s: number) => void }) {
  const hasResults = p.events.length > 0;
  const predictable = usePredictable(p.season);
  const rest = useAfterFirstPaint(drawn);
  const fellBackFrom = useFellBackFrom(p, asked);
  return (
    <div className="min-w-0" data-team-v8>
      <OfflineNote data={p} />
      <V8Header p={p} onSeason={onSeason} fellBackFrom={fellBackFrom} />
      <div className="mb-8 grid gap-3 max-sm:mb-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
        {/* The left column: the standing, then every action in one row under it (beside the taller What's next). */}
        <div className="min-w-0 space-y-3">
          <V8Standing p={p} onSeason={onSeason} />
          <V8Actions p={p} />
        </div>
        <V8Next p={p} asked={asked} />
      </div>
      {!rest ? null : !hasResults ? (
        // No results: the Standing card above already says so, with the way to the season before.
        <>
          <AwardsAllTime p={p} />
          {predictable && <ScoutNotes team={p.team.number} season={p.season} />}
        </>
      ) : (
        <>
          <MatchesSection team={p.team.number} season={p.season} events={p.events} predictable={predictable} />
          <Section id="events" also={["ranking", "history"]} title={`Events (${p.events.length})`} description={`Season road map, ${seasonLabel(p.season)}, newest first`}>
            <EventHistory events={p.events} team={p.team.number} />
            {p.events.some((e) => e.played) && <p className="mt-2 text-xs text-text-faint">Records count {RECORD_RULE_LOWER}</p>}
          </Section>
          <div className="min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:items-start min-[1700px]:gap-x-8">
            <StrengthSection p={p} />
            <TrendChart events={p.events} season={p.season} />
          </div>
          {/* Closed at first, each asked for only when opened; closed again for another team or season. */}
          <Fragment key={`${p.team.number}-${p.season}`}>
            {p.stats?.reliability !== undefined && <ReliabilitySection r={p.stats.reliability} />}
            {predictable && <ReportCardSection team={p.team.number} season={p.season} />}
            {predictable && <TeamScheduleSection team={p.team.number} season={p.season} events={p.events} />}
          </Fragment>
          <div className="mt-8 min-[1700px]:grid min-[1700px]:grid-cols-2 min-[1700px]:items-start min-[1700px]:gap-x-8">
            <AwardsAllTime p={p} />
            {predictable && <ScoutNotes team={p.team.number} season={p.season} />}
          </div>
        </>
      )}
      {rest && predictable && <TeamConsensusSection team={p.team.number} season={p.season} reliability={p.stats?.reliability} />}
      {rest && predictable && <CommonsSection team={p.team.number} season={p.season} />}
    </div>
  );
}

/** A team's website as a link (some are stored without the scheme). */
const websiteHref = (w: string) => (w.startsWith("http") ? w : `https://${w}`);

/**
 * Every action, visible (as classic's row): My team (the one primary until it's set, then filled), Track, Shortlist,
 * Compare, Highlights outlined; quals vs playoffs and Share quiet; the rare ones (Manage in Control Point, the followed
 * team dashboard) as small links under the row. Under the standing, in the space beside the taller What's next. On a phone the
 * sticky bar keeps Predict and Track in reach once this row has scrolled away, and its More holds all the rest.
 */
function V8Actions({ p }: { p: TeamProfile }) {
  const t = p.team;
  const a = useTeamActions(t.number);
  const flags = a.flags;
  const predictable = usePredictable(p.season);
  // The end of the action row: the phone action bar shows once it has scrolled away.
  const [rowEnd, setRowEnd] = useState<HTMLDivElement | null>(null);
  const matchHref = predictHref({ mode: "match", season: p.season, red: [t.number] });
  const tap = "max-sm:h-10";
  const trackTitle = flags.tracked ? "Tracked: on My team, first in search. Click to stop." : "Follow this team: it goes on My team and comes first in search";
  const dashboard = a.workspaceUser && flags.isMine;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2" data-hero-actions>
        <Button size="sm" variant={flags.isMine ? "secondary" : "default"} aria-pressed={flags.isMine} onClick={() => flags.setMine(!flags.isMine)} className={tap} data-hero-action>
          <Star className={cn(flags.isMine && "fill-accent text-accent")} /> {flags.isMine ? "My team" : "Mark as my team"}
        </Button>
        <Button size="sm" variant={flags.tracked ? "secondary" : "outline"} aria-pressed={flags.tracked} onClick={a.track} className={tap} title={trackTitle} data-hero-action>
          <Eye className={cn(flags.tracked && "text-accent")} /> {flags.tracked ? "Tracking" : "Track"}
        </Button>
        <Button size="sm" variant={flags.bookmarked ? "secondary" : "outline"} aria-pressed={flags.bookmarked} onClick={a.shortlist} className={tap} data-hero-action>
          {flags.bookmarked ? <BookmarkCheck className="text-accent" /> : <Bookmark />} {flags.bookmarked ? "Shortlisted" : "Shortlist"}
        </Button>
        <Button size="sm" variant="outline" asChild className={tap} data-hero-action><Link to={`/compare?teams=${t.number}`}><Scale /> Compare</Link></Button>
        {p.highlights && <Button size="sm" variant="outline" asChild className={tap} data-hero-action><Link to={`/teams/${t.number}/highlights`} data-highlights-link><Sparkles /> Highlights</Link></Button>}
        {p.recordSplit && <Button size="sm" variant="ghost" asChild className={tap} data-hero-action><Link to={`/teams/${t.number}/record-split`} data-record-split-link><Trophy /> Quals vs playoffs</Link></Button>}
        <Button size="sm" variant="ghost" onClick={() => copyLink()} className={tap} data-hero-action><Link2 /> Share</Button>
      </div>
      {/* The rare ones as quiet links under the row, as on classic (a lone More button wrapped onto a line of its own). */}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-faint" data-hero-links>
        <a href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener" className="tap-44 inline-flex items-center gap-1.5 underline decoration-current/40 underline-offset-2 hover:text-text-base">Manage this team in Control Point <ExternalLink className="size-3" aria-hidden /></a>
        {dashboard && <Link to={FOLLOWED_TEAM_PATH} className="tap-44 inline-flex items-center gap-1.5 hover:text-text-base"><Star className="size-3" aria-hidden /> My followed team dashboard</Link>}
      </p>
      <div ref={setRowEnd} aria-hidden />
      {/* Phones: once the row has scrolled away, Predict and Track stay in reach, and More holds every other action. */}
      <StickyActions after={rowEnd} label={`Actions for team ${t.number}`}>
        {predictable && <Button asChild><Link to={matchHref}><Sparkles /> <span className="truncate">Predict with {t.number}</span></Link></Button>}
        <Button variant={flags.tracked ? "secondary" : "outline"} aria-pressed={flags.tracked} onClick={a.track} className={cn(predictable && "!flex-none")}>
          <Eye className={cn(flags.tracked && "text-accent")} /> {flags.tracked ? "Tracking" : "Track"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="All actions" className="!flex-none" data-sticky-more><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="min-w-[14rem]">
            <DropdownMenuItem onSelect={() => flags.setMine(!flags.isMine)}><Star className={cn(flags.isMine && "fill-accent text-accent")} /> {flags.isMine ? "Unmark as my team" : "Mark as my team"}</DropdownMenuItem>
            <DropdownMenuItem onSelect={a.shortlist}>{flags.bookmarked ? <BookmarkCheck /> : <Bookmark />} {flags.bookmarked ? "Remove from shortlist" : "Add to shortlist"}</DropdownMenuItem>
            <DropdownMenuItem asChild><Link to={`/compare?teams=${t.number}`}><Scale /> Compare</Link></DropdownMenuItem>
            {p.highlights && <DropdownMenuItem asChild><Link to={`/teams/${t.number}/highlights`}><Sparkles /> Highlights</Link></DropdownMenuItem>}
            {p.recordSplit && <DropdownMenuItem asChild><Link to={`/teams/${t.number}/record-split`}><Trophy /> Quals vs playoffs</Link></DropdownMenuItem>}
            {predictable && <DropdownMenuItem asChild><Link to={predictHref({ mode: "advancement", season: p.season, team: t.number })}><Trophy /> Advancement odds</Link></DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => copyLink()}><Link2 /> Share</DropdownMenuItem>
            <DropdownMenuSeparator />
            {dashboard && <DropdownMenuItem asChild><Link to={FOLLOWED_TEAM_PATH}><Star /> My followed team dashboard</Link></DropdownMenuItem>}
            <DropdownMenuItem asChild><a href="https://tryctrlpoint.org" target="_blank" rel="noreferrer noopener"><ExternalLink /> Manage this team in Control Point</a></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </StickyActions>
    </>
  );
}

/** Who this is: the number and name, one muted line (school, place, rookie year, website), the season quietly
 *  beside the label, and the sponsors folded. The actions sit under the standing (V8Actions). */
function V8Header({ p, onSeason, fellBackFrom }: { p: TeamProfile; onSeason: (s: number) => void; fellBackFrom: number | null }) {
  const t = p.team;
  const loc = place(t.city, t.state, t.country);
  const line = [t.school, loc, t.rookieYear ? `Rookie year ${t.rookieYear}` : null].filter(Boolean) as string[];
  return (
    <>
      <header className="mb-5 max-sm:mb-4" data-team-hero>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-text-faint">
              <span data-eyebrow>FTC team</span>
              <V8SeasonSelect seasons={p.seasons} value={p.season} onChange={onSeason} />
            </div>
            {/* The heading is the number and name together (what people search for). */}
            <h1 className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-[2.75rem] font-semibold leading-none tracking-tight tabular-nums sm:text-[3.25rem]" data-team-number>{t.number}</span>
              {t.name && <span className="min-w-0 break-words font-sans text-xl font-semibold tracking-tight text-text-base sm:text-[1.375rem]"><span className="sr-only"> </span>{t.name}</span>}
            </h1>
            {!t.name && <p className="mt-1 text-lg text-text-muted">Name not on file</p>}
            {(line.length > 0 || t.website) && (
              <p className="mt-2 text-sm text-text-muted">
                <span data-identity-line>{line.join(" · ")}</span>
                {t.website && <>{line.length > 0 && " · "}<a href={websiteHref(t.website)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 underline-offset-2 hover:text-text-base hover:underline" data-team-website>Website <ExternalLink className="size-3" aria-hidden /></a></>}
              </p>
            )}
            {t.sponsors.length > 0 && (
              <Collapsible className="mt-1.5">
                <CollapsibleTrigger className="group inline-flex min-h-8 max-w-full items-center gap-1.5 rounded text-left text-xs text-text-faint hover:text-text-muted pointer-coarse:min-h-[44px]">
                  <span className="shrink-0 whitespace-nowrap">Sponsors ({t.sponsors.length})</span>
                  <ChevronDown className="size-3.5 shrink-0 transition-transform duration-200 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 max-w-2xl text-xs text-text-muted">{t.sponsors.join(" · ")}</CollapsibleContent>
              </Collapsible>
            )}
            {fellBackFrom != null && (
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted" data-season-fallback>
                <Info className="size-3.5 shrink-0 text-text-faint" aria-hidden />
                <span>No {seasonLabel(fellBackFrom)} results yet, so this shows {seasonLabel(p.season)}.</span>
                <button type="button" onClick={() => onSeason(fellBackFrom)} className="tap-44 -my-1 py-1 font-medium text-text-base underline-offset-2 hover:underline">See {seasonLabel(fellBackFrom)}</button>
              </p>
            )}
          </div>
        </div>
      </header>
    </>
  );
}

/** The season, quietly beside "FTC team": one small select (every season the team has, newest first). */
function V8SeasonSelect({ seasons, value, onChange }: { seasons: number[]; value: number; onChange: (s: number) => void }) {
  const meta = useMeta();
  const game = (s: number) => meta?.seasons.find((x) => x.season === s)?.game ?? "";
  const list = [...new Set([value, ...seasons])].sort((a, b) => b - a);
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" aria-label={`Season ${seasonLabel(value)}${game(value) ? ` ${game(value)}` : ""}`} data-season-select
        className="tap-44 h-7 w-auto gap-1 rounded-full border-white/[0.12] bg-transparent px-2.5 text-xs font-medium text-text-muted shadow-none hover:bg-white/[0.06] hover:text-text-base">
        <span className="tabular-nums">{seasonLabel(value)}</span>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[12rem]">
        {list.map((s) => <SelectItem key={s} value={String(s)}><span className="tabular-nums">{seasonLabel(s)}</span>{game(s) && <span className="text-text-faint"> · {game(s)}</span>}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** The standing in one compact row: the percentile as the hero figure, then OPR, rating, record (and reliability). */
function V8Standing({ p, onSeason }: { p: TeamProfile; onSeason: (s: number) => void }) {
  const s = p.stats;
  const predictable = usePredictable(p.season);
  const top = rankPct(s?.opr.np.rank, s?.opr.np.of, true);
  const cell = "min-w-0 px-4 first:pl-0 max-sm:px-3 [&_dd]:whitespace-nowrap";
  const dt = "text-xs text-text-faint";
  // The numbers in the slate-blue accent (the figure and each value), the labels grey: the page's one colour.
  const dd = "mt-0.5 text-xl font-semibold tracking-tight tabular-nums text-accent";
  return (
    <section aria-labelledby={`standing-${p.team.number}`} className="rounded-xl border border-line bg-card p-4 sm:p-5" data-standing>
      <h2 id={`standing-${p.team.number}`} className="font-sans text-xs font-normal tracking-normal text-text-faint" data-eyebrow>Standing · {seasonLabel(p.season)}</h2>
      {!s ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-text-muted">No results this season yet.</p>
          {p.seasons.filter((x) => x < p.season).slice(0, 1).map((prev) => (
            <button key={prev} type="button" onClick={() => onSeason(prev)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-line px-3 text-left transition-colors hover:bg-white/[0.03] active:scale-[0.99] motion-reduce:active:scale-100">
              <span>See how {p.team.number} did in {seasonLabel(prev)}</span><span className="text-text-muted">→</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <p className="font-display text-[2.5rem] font-semibold leading-none tabular-nums text-accent" data-hero-figure>{top ?? "Unranked"}</p>
              <p className="mt-1.5 text-xs text-text-muted">worldwide by OPR{s.opr.np.rank ? ` · #${s.opr.np.rank.toLocaleString()} of ${s.opr.np.of?.toLocaleString()}` : ""}</p>
            </div>
            {/* Beside the figure on a wide card; its own full-width row under it on a phone. */}
            <dl className={cn("grid min-w-0 flex-1 basis-[20rem] divide-x divide-line max-sm:basis-full max-sm:border-t max-sm:border-line max-sm:pt-3", s.reliability ? "grid-cols-4" : "grid-cols-3")} data-glance-stats>
              <div className={cell}><dt className={dt} title={OPR_TERM}>OPR</dt><dd className={dd}>{num(s.opr.np.value)}</dd></div>
              {predictable
                ? <div className={cell}><dt className={dt} title={RATING_TERM}>Rating</dt><dd className={dd}>{s.rating ? num(s.rating.np) : "—"}{s.rating && <span className="text-xs font-normal text-text-faint"> ±{num(s.rating.sd, 0)}</span>}</dd></div>
                : <div className={cell}><dt className={dt}>Avg score</dt><dd className={dd}>{num(s.avg.np)}</dd></div>}
              <div className={cell}><dt className={dt} title={`${OFFICIAL_RULE} ${RECORD_RULE}`}>Record</dt><dd className={dd} title={`${OFFICIAL_RULE} ${RECORD_RULE}`}>{s.record.wins}-{s.record.losses}-{s.record.ties}</dd><dd className="text-[0.6875rem] text-text-faint" data-record-scope>{OFFICIAL_ONLY}</dd></div>
              {s.reliability && <div className={cell}><dt className={dt} title="An estimate from match results: no-shows, DQs, near-zero matches, swing, penalties">Reliability</dt><dd className={dd}>{s.reliability.index}<span className="text-xs font-normal text-text-faint"> /100</span></dd></div>}
            </dl>
          </div>
          <OffSeasonLine events={p.events} />
        </>
      )}
    </section>
  );
}

/** What's next: the next match and its call, else the next or last event, and the team's standings. */
function V8Next({ p, asked }: { p: TeamProfile; asked: boolean }) {
  const t = p.team;
  const clock = Date.now();
  const next = p.events.find((e) => !eventOver(e, clock)) ?? null;
  const last = [...p.events].reverse().find((e) => eventOver(e, clock)) ?? null;
  const current = useCurrentSeason();
  const predictable = usePredictable(p.season);
  // As on the classic glance: Advancement odds beside Predict, unless the next event's own odds row already links them.
  const odds = !(next && ADVANCING.has(next.type ?? ""));
  return (
    <section aria-label="What's next" className="rounded-xl border border-line bg-card p-4 sm:p-5" data-whats-next>
      {!asked || p.season >= current ? <Upcoming p={p} next={next} last={last} title="What's next" /> : (
        <div className="space-y-2 text-sm">
          <h2 className="font-sans text-xs font-normal tracking-normal text-text-faint" data-eyebrow>{last ? "Last event" : "Events"}</h2>
          {last ? <LastEvent last={last} team={t.number} /> : <p className="text-text-muted">No events for {t.number} in {seasonLabel(p.season)}.</p>}
        </div>
      )}
      {p.league && <LeagueStanding league={p.league} season={p.season} team={t.number} />}
      {p.league?.region.toUpperCase() === CONFERENCE_REGION && <ConferenceStanding season={p.season} team={t.number} />}
      {p.region && <RegionStanding region={p.region} season={p.season} team={t.number} />}
      {predictable ? (
        <div className="mt-3 flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" asChild><Link to={predictHref({ mode: "match", season: p.season, red: [t.number] })}><Sparkles /> Predict a match with {t.number}</Link></Button>
          {odds && <Button variant="ghost" size="sm" asChild><Link to={predictHref({ mode: "advancement", season: p.season, team: t.number })} data-advancement-odds><Trophy /> Advancement odds</Link></Button>}
        </div>
      ) : <p className="mt-3 text-xs text-text-faint">{seasonLabel(p.season)} is shown for history: results and stats, no predictions (those start with 2023–24).</p>}
    </section>
  );
}

/** Strength: the best event OPR by phase in one quiet table (value, world rank, standing, a thin mint bar), the
 *  prediction rating as its last row, and how both are computed behind one disclosure. A phase's row opens its
 *  event-by-event numbers. Exported for its test. */
export function StrengthSection({ p }: { p: TeamProfile }) {
  const s = p.stats;
  const [open, setOpen] = useState<(typeof OPR_CARDS)[number][0] | null>(null);
  const predictable = usePredictable(p.season);
  const metaStatsAt = useMeta()?.statsAt;
  const current = useCurrentSeason();
  const statsAt = offlineSource(p) || p.season !== current ? null : metaStatsAt;
  const th = "px-4 font-normal";
  return (
    <Section id="opr" also={["strength"]} title="Strength" description={`Best event OPR in ${seasonLabel(p.season)}, by phase, and its world rank`}>
      <div className="overflow-x-auto rounded-xl border border-line bg-card" data-strength>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-text-faint">
            <th className={cn(th, "h-10")}>Phase</th><th className={cn(th, "text-right")}>OPR</th><th className={cn(th, "text-right max-sm:hidden")}>World rank</th><th className={cn(th, "text-right")}>Standing</th><th className={cn(th, "w-[26%] max-sm:hidden")}><span className="sr-only">Standing as a bar</span></th>
          </tr></thead>
          <tbody>
            {OPR_CARDS.map(([k, label]) => {
              const stat = s?.opr[k];
              const top = rankPct(stat?.rank, stat?.of);
              return (
                <tr key={k} className={cn("border-t border-line", open === k && "bg-white/[0.03]")} data-strength-row={k}>
                  <td className="px-4 py-1">
                    <button type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className="tap-44 inline-flex min-h-9 items-center gap-1.5 rounded text-left font-medium text-text-base hover:underline underline-offset-2">
                      {label}<ChevronDown aria-hidden className={cn("size-3.5 text-text-faint transition-transform duration-200 ease-out motion-reduce:transition-none", open === k && "rotate-180")} />
                      <span className="sr-only">. Show event by event</span>
                    </button>
                  </td>
                  <td className="px-4 text-right font-semibold tabular-nums">{num(stat?.value)}</td>
                  <td className="px-4 text-right tabular-nums text-text-muted max-sm:hidden">{stat?.rank ? `#${stat.rank.toLocaleString()} of ${stat.of?.toLocaleString()}` : "—"}</td>
                  <td className="whitespace-nowrap px-4 text-right tabular-nums text-text-muted">{top ?? "Unranked"}</td>
                  <td className="px-4 max-sm:hidden"><Meter parts={[{ pc: rankPc(stat?.rank, stat?.of), cls: "bg-accent" }]} /></td>
                </tr>
              );
            })}
            {s?.rating && (
              <tr className="border-t border-line" data-strength-row="rating">
                <td className="h-11 px-4 font-medium" title={RATING_TERM}>Prediction rating</td>
                <td className="whitespace-nowrap px-4 text-right font-semibold tabular-nums">{num(s.rating.np)}<span className="text-xs font-normal text-text-faint"> ±{num(s.rating.sd)}</span></td>
                <td className="px-4 text-right tabular-nums text-text-muted max-sm:hidden">{s.rating.rank ? `#${s.rating.rank.toLocaleString()}` : "—"}</td>
                <td className="whitespace-nowrap px-4 text-right tabular-nums text-text-muted">{s.rating.matches} matches</td>
                <td className="px-4 max-sm:hidden" />
              </tr>
            )}
          </tbody>
        </table>
        {s?.rating && <p className="border-t border-line px-4 py-2.5 text-xs text-text-muted">Rating by phase: auto {num(s.rating.auto)} · TeleOp {num(s.rating.teleop)} · endgame {num(s.rating.endgame)} · gives away ~{num(s.rating.pen)} penalty pts a match</p>}
      </div>
      {open && <OprBreakdown events={p.events} k={open} />}
      <Collapsible className="mt-2">
        <CollapsibleTrigger className="group tap-44 inline-flex min-h-9 items-center gap-1.5 rounded text-sm text-text-muted hover:text-text-base">
          <Info className="size-4" aria-hidden /> How it's computed<ChevronDown className="size-4 transition-transform duration-200 ease-out group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2 rounded-xl border border-line bg-card p-4 text-sm text-text-muted" data-strength-how>
          <p>OPR is the best event OPR this season, with its rank among teams with an OPR. Non-penalty points, computed with standard least squares{p.season >= 2024 ? "; TeleOp includes the endgame, as FIRST reports it" : ""}. <Link to="/methodology#opr" className="underline">How OPR is computed</Link>{statsAt && <span className="whitespace-nowrap"> · Stats updated {ago(statsAt)}</span>}</p>
          {s?.rating && <p>The rating is what the prediction engine expects this robot to add to its alliance <em>now</em>. Unlike OPR it updates after every match and carries over from last season, so it's what drives win odds. It's read from alliance scores: random qualification partners let a team's share show, and playoffs (fixed partners) count half. Ranked among teams rated on 3+ matches. <Link to="/methodology#rating-assumption" className="underline">How ratings work</Link></p>}
          {s && s.record.matches > 0 && <p className="text-xs">Season record {s.record.wins}-{s.record.losses}-{s.record.ties} at official events · avg alliance score {num(s.avg.score)}{!predictable ? ` (${num(s.avg.np)} without penalties)` : ""}</p>}
        </CollapsibleContent>
      </Collapsible>
    </Section>
  );
}

/** Track and shortlist with the notes that say what each did, shared by both headers. */
function useTeamActions(n: number) {
  const flags = useTeamFlags(n);
  const { state: personal } = usePersonal();
  const nav = useNavigate();
  const workspaceUser = useYoursRow().row.kind !== "followed";
  const track = () => {
    const on = !flags.tracked;
    flags.toggleTracked();
    if (!on) { toast(`Stopped tracking ${n}`, { id: TRACK_NOTE }); return; }
    toast.success(`Tracking ${n}`, {
      id: TRACK_NOTE,
      description: `It's on My team under Tracked teams, comes first in search and in Predict's quick picks.${personal.settings.notify.trackedTeams ? " While Control Scout is open in a tab, you'll get an alert before its matches." : " Turn on alerts for tracked teams in Settings › Notifications to hear before its matches (while Control Scout is open in a tab)."}`,
      action: { label: workspaceUser ? "Followed team" : "My team", onClick: () => nav(FOLLOWED_TEAM_PATH) },
    });
  };
  const shortlist = () => {
    const on = !flags.bookmarked;
    flags.toggleBookmark();
    if (!on) { toast(`Removed ${n} from your shortlist`); return; }
    toast.success(`${n} added to your shortlist`, { description: "Your shortlist compares the teams you're considering side by side.", action: { label: "Shortlist", onClick: () => nav("/shortlist") } });
  };
  return { flags, track, shortlist, workspaceUser };
}
