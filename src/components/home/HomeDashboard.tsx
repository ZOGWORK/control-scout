// The v8 Home dashboard (docs/design/v8-revamp-brief.md §8 wave 1): search in the middle, the mark small above it and
// four examples under it, a fresh set each visit; then three cards of the same weight: Events live now, Top teams,
// Your teams (or Pick your team). The real Home draws it under v8 (src/pages/Home.tsx), inside the v8 shell; the sample
// home (/preview/home, src/pages/PreviewHomePage.tsx) draws it with its own sidebar, corner and wash.
// No headline of any kind (no H1), no slogan, no globe. Every number comes from the same APIs the live Home uses.
//   - One accent, mint: the live progress, the search focus, the #1 rank, links on hover. Live is red, with the slow
//     ring (index.css live-ring). Numbers and names are white, labels grey; red and blue stay alliances.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Radio, Search, Star, Trophy } from "lucide-react";
import { useApi, qs } from "../../lib/api";
import { useCurrentSeason } from "../../lib/meta";
import { usePersonal } from "../../lib/personal";
import { matchTime, oddsPct, place, seasonLabel } from "../../lib/format";
import type { EventListItem, MatchView, SearchHit, TeamSummary } from "../../shared/api";
import type { RecordsResponse, TeamSeasonRecord } from "../../shared/statCatalog";
import { HOME_ABOUT } from "../../shared/boot";
import { SUGGESTION_HOUR_MS, suggestionLabel, suggestionsAt, type HomeSuggestion } from "../../shared/homeSuggestions";
import { TIER_WORD } from "../../shared/tierWords";
import { SEARCH_HINT, usePageSearch, useSearch } from "../layout/Search";
import { SearchBox, hitHref, searchPagePick } from "../search/SearchBox";
import { addRecentSearch } from "../search/discover";
import { nextMatch } from "./HomeSections";
import { myTeamsOf } from "../../lib/myTeams";
import { cn } from "../cn";

/** How many example searches show under the field. */
export const EXAMPLE_COUNT = 4;
/** The most live events the first card lists: Home is not the events list. */
export const LIVE_MAX = 4;
/** How many teams the Top teams card lists. */
export const TOP_MAX = 5;

/** The examples under the field, a fresh set each visit: one hour's set from the live Home's own rotation
 *  (suggestionsAt: a leaderboard query and other families, never two of a family or two of one place, sized to fit a
 *  desktop), the leaderboard first, then the next ones. None is a team's own. `hour` picks the set; a visit draws one. */
export function rotatedExamples(hour: number, count = EXAMPLE_COUNT): HomeSuggestion[] {
  const six = suggestionsAt(hour * SUGGESTION_HOUR_MS);
  return [...six.filter((s) => s.kind === "leaderboard"), ...six.filter((s) => s.kind !== "leaderboard")].slice(0, count);
}
/** A visit's set: any of a long run of hours, so reloading shows another. */
const visitHour = () => Math.floor(Math.random() * 1_000_000);

/** Live first (most matches played first), then nothing else: the card is for what's on now. */
export function liveNow(events: readonly EventListItem[], max = LIVE_MAX): EventListItem[] {
  return events.filter((e) => e.status === "live")
    .sort((a, b) => b.matchesPlayed - a.matchesPlayed || a.name.localeCompare(b.name))
    .slice(0, max);
}

/** The soonest event still to come, for the card's empty state. */
export function nextUp(events: readonly EventListItem[]): EventListItem | undefined {
  return events.filter((e) => e.status === "upcoming" && e.start)
    .sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name))[0];
}

/** An event's first day ("Sat 22"), read in UTC like the calendar's dates. */
function shortDate(start: string | null): string {
  if (!start) return "TBA";
  const d = new Date(`${start.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "TBA" : `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.getUTCDate()}`;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The new look's surfaces, written once. */
const card = "flex min-w-0 flex-col gap-4 rounded-2xl border border-white/[0.08] bg-[#121214] p-5 sm:p-6";
const cardTitle = "flex items-center gap-2 text-sm font-semibold text-text-base";
/** A card's way on: white, mint on hover. */
const cardLink = "mt-auto inline-flex min-h-11 items-center gap-1 self-start text-sm font-medium text-text-base transition-colors hover:text-accent";
const rowLink = "group flex min-h-11 items-center gap-3 rounded-lg -mx-2 px-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-ring";

/** Your teams, in the app's own order: the teams the account is on (Control Point), this device's My team, then the
 *  teams you follow; each once. Usually just one. */
export function yourTeams(cp: readonly number[], mine: number | null, followed: readonly number[]): number[] {
  const out: number[] = [];
  for (const n of [...cp, ...(mine != null ? [mine] : []), ...followed]) if (Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  return out;
}
/** The most teams the card lists; the rest are one link away. */
export const TEAMS_MAX = 4;


/** The dashboard. `framed`: the sample home draws it on a bare page, so it brings its own side gutters and drops
 *  further down; inside the app's shell (the real Home) the page frame gives the gutters and the top bar sits above. */
export function HomeDashboard({ framed = false }: { framed?: boolean }) {
  const { state, user } = usePersonal();
  const season = useCurrentSeason();
  const search = useSearch();
  const nav = useNavigate();
  // Home's search is the page's search: the top bar's field steps aside while this one is on screen.
  const searchRef = usePageSearch();
  // A search from outside (/?q=…, the site search named in the home page's structured data).
  const [sp] = useSearchParams();
  const query = sp.get("q")?.trim().slice(0, 100) || undefined;
  const [examples] = useState(() => rotatedExamples(visitHour()));
  const teams = yourTeams(myTeamsOf(user).teams.map((t) => t.teamNumber), state.myTeam ?? null, state.tracked?.teams ?? []);
  return (
    <div data-home-dashboard className={cn("relative z-10 mx-auto flex w-full max-w-[72rem] flex-col", framed && "px-5 pb-24 sm:px-8")}>
      {/* Search, alone in the middle: the biggest thing on the page, the white mark small above it. */}
      <section aria-label="Search" className={cn("mx-auto flex w-full max-w-[44rem] flex-col items-center", framed ? "mt-[15vh] max-sm:mt-[11vh]" : "mt-[9vh] max-sm:mt-[5vh]")}>
        <img data-mark src="/mark-white.webp" alt="Control Scout" width={40} height={40} className="mb-7 size-10" />
        <SearchBox
          inputRef={searchRef} onEscape={search.restoreFocus} hint={SEARCH_HINT} initialQuery={query} discover size="lg"
          label="Search teams, events and matches"
          placeholder="Search teams, events, matches…"
          onPick={(h: SearchHit) => nav(hitHref(h))}
          className="w-full"
          fieldClassName="h-14 rounded-2xl border-white/15 bg-[#121214]/85 px-5 text-lg shadow-none backdrop-blur max-sm:text-base focus-within:border-accent focus-within:shadow-[0_0_0_3px_rgb(127_209_174/0.18)] [&_[data-search-submit]_svg]:text-text-muted [&_[data-search-submit]:hover]:bg-white/[0.08]"
        />
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <span className="text-sm text-text-muted">Try:</span>
          {examples.map((s) => (
            <Link
              key={s.q} data-example-chip to={hitHref(searchPagePick(s.q))} onClick={() => addRecentSearch(s.q)}
              className="tap-44 inline-flex h-8 items-center rounded-full border border-white/15 bg-white/[0.03] px-3 text-sm text-text-base transition-colors hover:border-white/30 hover:bg-white/[0.07] active:scale-[0.97] motion-reduce:active:scale-100"
            >{suggestionLabel(s)}</Link>
          ))}
        </div>
      </section>

      {/* Three cards of the same weight. On a phone, your teams come first when you have any. */}
      <div className={cn("grid gap-4 lg:grid-cols-3", framed ? "mt-20 max-sm:mt-12" : "mt-16 max-sm:mt-10")}>
        <LiveCard season={season} />
        <TopTeamsCard season={season} />
        {teams.length ? <TeamsCard teams={teams} season={season} /> : <PickTeamCard onPick={search.open} />}
      </div>

      <p className="mt-10 text-center text-xs text-text-muted">{HOME_ABOUT}</p>
    </div>
  );
}

function Loading({ rows }: { rows: number }) {
  return <ul aria-busy="true" className="flex flex-col gap-2">{Array.from({ length: rows }, (_, i) => <li key={i} className="h-11 rounded-lg bg-white/[0.04]" />)}</ul>;
}

function Failed({ what, retry }: { what: string; retry: () => void }) {
  return <p className="text-sm text-text-muted">{what} couldn’t load. <button type="button" onClick={retry} className="font-medium text-text-base underline">Try again</button></p>;
}

// --- Events live now ---------------------------------------------------------------------------------------------

function LiveCard({ season }: { season: number }) {
  // From yesterday (a multi-day event that's on still counts) to a week out (the next event, when nothing is live).
  const [win] = useState(() => { const now = Date.now(); return { from: iso(new Date(now - 864e5)), to: iso(new Date(now + 7 * 864e5)) }; });
  const res = useApi<{ events: EventListItem[] }>(`/api/events${qs({ season, from: win.from, to: win.to })}`);
  const all = res.data?.events ?? [];
  const live = liveNow(all);
  const count = all.filter((e) => e.status === "live").length;
  const next = nextUp(all);
  return (
    <section data-card="live" aria-labelledby="home-live" className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-live" className={cardTitle}>
          {/* Live is red, the one place it is (the universal on-air colour), with the slow ring (index.css live-ring) while something is on; still for anyone who turns motion off. */}
          <span data-live-dot className="relative flex size-2" aria-hidden>
            {count > 0 && <span data-live-pulse className="absolute inset-0 animate-[live-ring_2s_cubic-bezier(0.23,1,0.32,1)_infinite] rounded-full bg-live motion-reduce:hidden" />}
            <span className={cn("relative size-2 rounded-full", count ? "bg-live" : "bg-white/25")} />
          </span> Events live now
        </h2>
        {res.data && count > 0 && <span className="text-xs tabular-nums text-text-muted">{count} live</span>}
      </div>
      {res.error && !res.data ? <Failed what="Live events" retry={res.reload} /> : !res.data ? <Loading rows={3} /> : !live.length ? (
        <div data-live-empty className="flex flex-col gap-3 text-sm">
          <p className="text-text-muted">Nothing live right now.</p>
          {next && (
            <Link to={`/events/${next.season}/${encodeURIComponent(next.code)}`} className={rowLink}>
              <span className="w-14 shrink-0 rounded-md border border-white/10 py-0.5 text-center text-xs font-medium tabular-nums">{shortDate(next.start)}</span>
              <span className="min-w-0 flex-1"><span className="block text-xs text-text-muted">Next up</span><span className="block truncate font-medium group-hover:underline">{next.name}</span></span>
            </Link>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {live.map((e) => <LiveRow key={`${e.season}-${e.code}`} e={e} />)}
        </ul>
      )}
      <Link to="/weekend" className={cardLink}>This weekend <ArrowRight className="size-4" aria-hidden /></Link>
    </section>
  );
}

function LiveRow({ e }: { e: EventListItem }) {
  const share = e.matchesTotal > 0 ? Math.min(1, e.matchesPlayed / e.matchesTotal) : 0;
  const where = place(e.city, e.state, e.country);
  return (
    <li data-live-event>
      <Link to={`/events/${e.season}/${encodeURIComponent(e.code)}`} className={cn(rowLink, "py-2")}>
        <Radio className="size-4 shrink-0 text-live" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:underline" title={e.name}>{e.name}</span>
          {e.matchesTotal > 0 && e.matchesPlayed > 0 ? (
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <span data-progress className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-muted">{e.matchesPlayed}/{e.matchesTotal} played</span>
            </span>
          ) : (
            <span className="block truncate text-xs text-text-muted">{where || "Location TBA"}</span>
          )}
        </span>
        {!(e.matchesTotal > 0 && e.matchesPlayed > 0) && (
          <span data-no-results className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[0.6875rem] text-text-muted">No results yet</span>
        )}
      </Link>
    </li>
  );
}

// --- Top teams -----------------------------------------------------------------------------------------------------

const TOP_FIELDS = "teamName,homeRegion,wins,losses,ties,totalPointsOpr";

const topPath = (season: number) => `/api/records/${season}/teams${qs({ scope: "season", sort: "totalPointsOpr", dir: "desc", pageSize: TOP_MAX, fields: TOP_FIELDS })}`;

/** The season's leaders by OPR. Early in a season, before any team has a record, last season's leaders, labelled as
 *  such, rather than an empty card. */
function TopTeamsCard({ season }: { season: number }) {
  const now = useApi<RecordsResponse<TeamSeasonRecord>>(topPath(season));
  const empty = !!now.data && now.data.rows.length === 0;
  const last = useApi<RecordsResponse<TeamSeasonRecord>>(empty ? topPath(season - 1) : null);
  const res = empty ? last : now;
  const shown = empty ? season - 1 : season;
  const rows = res.data?.rows.slice(0, TOP_MAX) ?? [];
  return (
    <section data-card="top" aria-labelledby="home-top" className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-top" className={cardTitle}><Trophy className="size-4 text-text-muted" aria-hidden /> Top teams</h2>
        <span data-top-season className="text-xs text-text-muted">{empty ? "Last season, " : ""}{seasonLabel(shown)} · by OPR</span>
      </div>
      {res.error && !res.data ? <Failed what="Top teams" retry={res.reload} /> : !res.data ? <Loading rows={TOP_MAX} /> : !rows.length ? (
        <p className="text-sm text-text-muted">No team records yet.</p>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {rows.map((r, i) => <TopRow key={r.team} r={r} rank={i + 1} />)}
        </ol>
      )}
      <Link to="/teams" className={cardLink}>Full rankings <ArrowRight className="size-4" aria-hidden /></Link>
    </section>
  );
}

function TopRow({ r, rank }: { r: TeamSeasonRecord; rank: number }) {
  const s = r.stats;
  const name = typeof s.teamName === "string" ? s.teamName : `Team ${r.team}`;
  const w = num(s.wins), l = num(s.losses), t = num(s.ties), opr = num(s.totalPointsOpr);
  return (
    <li data-top-team>
      <Link to={`/teams/${r.team}`} className={rowLink}>
        <span data-rank className={cn("w-4 shrink-0 text-right font-display text-sm font-semibold tabular-nums", rank === 1 ? "text-accent" : "text-text-muted")}>{rank}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:underline"><span className="tabular-nums">{r.team}</span> <span className="text-text-muted">·</span> {name}</span>
          {w != null && l != null && <span className="block text-xs tabular-nums text-text-muted">{w}-{l}-{t ?? 0}</span>}
        </span>
        {opr != null && (
          <span className="shrink-0 text-right">
            <span className="block font-display text-base font-semibold tabular-nums">{opr.toFixed(1)}</span>
            <span className="block text-[0.6875rem] text-text-muted">OPR</span>
          </span>
        )}
      </Link>
    </li>
  );
}

// --- Your teams ------------------------------------------------------------------------------------------------------

/** One match's call for a team: its side's chance to win, or null without a prediction. */
function callFor(m: MatchView, team: number): number | null {
  if (!m.prediction) return null;
  return m.red.teams.some((x) => x.number === team) ? m.prediction.pRed : 1 - m.prediction.pRed;
}

const matchHref = (m: MatchView) => `/events/${m.season}/${encodeURIComponent(m.code)}/match/${encodeURIComponent(m.key)}`;

/** Your teams: one team big (number, name, next match and its call); several as compact rows, each with its next match.
 *  The card ends like the other two, with a quiet link: no button competing with search. */
function TeamsCard({ teams, season }: { teams: number[]; season: number }) {
  const shown = teams.slice(0, TEAMS_MAX);
  const info = useApi<{ teams: TeamSummary[] }>(`/api/teams-summary${qs({ season, teams: shown.join(",") })}`);
  const byTeam = new Map((info.data?.teams ?? []).map((t) => [t.team, t]));
  const one = teams.length === 1;
  return (
    <section data-card="team" aria-labelledby="home-team" className={cn(card, "max-lg:order-first")}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-team" className={cardTitle}><Star className="size-4 fill-text-base text-text-base" aria-hidden /> {one ? "Your team" : "Your teams"}</h2>
        {!one && <span className="text-xs tabular-nums text-text-muted">{teams.length}</span>}
      </div>
      {one ? <OneTeam team={teams[0]} season={season} t={byTeam.get(teams[0])} loaded={!!info.data} /> : (
        <ul className="flex flex-col gap-0.5">
          {shown.map((n) => <TeamRow key={n} team={n} season={season} t={byTeam.get(n)} loaded={!!info.data} />)}
        </ul>
      )}
      <Link to={one ? "/my-team" : "/my-teams"} className={cardLink}>
        {one ? "Your team page" : teams.length > shown.length ? `All ${teams.length} teams` : "All your teams"} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}

/** One team: the number big, its name, and the next match with its call. */
function OneTeam({ team, season, t, loaded }: { team: number; season: number; t: TeamSummary | undefined; loaded: boolean }) {
  const sched = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  const next = sched.data ? nextMatch(sched.data.matches) : undefined;
  const pWin = next ? callFor(next, team) : null;
  const eventName = next && t?.nextEvent?.code === next.code ? t.nextEvent.name : next?.code;
  return (
    <>
      <Link to={`/teams/${team}`} className="group -mt-1 flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
        {/* The name and place sit centred on the big number, not hung from its baseline. */}
        <span className="font-display text-4xl leading-none font-semibold tabular-nums">{team}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium group-hover:underline">{t?.name ?? (loaded ? `Team ${team}` : " ")}</span>
          {t?.place && <span className="block truncate text-xs text-text-muted">{t.place}</span>}
        </span>
      </Link>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm">
        {next ? (
          <Link to={matchHref(next)} className="group flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <span className="min-w-0">
              <span className="block text-xs text-text-muted">Next match</span>
              <span className="block font-medium group-hover:underline">{next.label} · {eventName}</span>
              <span className="block text-xs text-text-muted">{matchTime(next.time)}</span>
            </span>
            {pWin != null && next.prediction && (
              <span data-team-call className="text-right">
                <span className="block font-display text-2xl font-semibold tabular-nums">{oddsPct(pWin)}</span>
                <span className="block text-xs text-text-muted">to win · {TIER_WORD[next.prediction.tier].toLowerCase()}</span>
              </span>
            )}
          </Link>
        ) : !sched.data ? (
          <span className="text-text-muted">{sched.error ? "The schedule couldn’t load." : "Checking the schedule…"}</span>
        ) : (
          <LastEvent team={team} season={season} t={t} loaded={loaded} />
        )}
      </div>
    </>
  );
}

const ordinal = (n: number) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`; };
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** No schedule posted yet: the team's most recent event and how it went (rank, record, OPR), from the summary the
 *  card already has; last season's when it hasn't played yet this season. Then the next event, when one is known. */
function LastEvent({ team, season, t, loaded }: { team: number; season: number; t: TeamSummary | undefined; loaded: boolean }) {
  const before = useApi<{ teams: TeamSummary[] }>(loaded && t && !t.lastEvent ? `/api/teams-summary${qs({ season: season - 1, teams: String(team) })}` : null);
  const prev = before.data?.teams.find((x) => x.team === team);
  const src = t?.lastEvent ? t : prev?.lastEvent ? prev : null;
  const evSeason = src === t ? season : season - 1;
  if (!src?.lastEvent) {
    return <span className="text-text-muted">{!loaded || (t && !t.lastEvent && !before.data && !before.error) ? "Checking recent events…" : `No events played yet.${t?.nextEvent ? ` Next event: ${t.nextEvent.name}.` : ""}`}</span>;
  }
  const ev = src.lastEvent;
  const day = ev.end ?? ev.start;
  return (
    <div data-last-event>
      <Link to={`/events/${evSeason}/${encodeURIComponent(ev.code)}`} className="group block min-w-0">
        <span className="block text-xs text-text-muted">{src === t ? "Last event" : `Last season's last event`}{day ? ` · ${shortDay(day)}` : ""}</span>
        <span className="block truncate font-medium group-hover:underline">{ev.name}</span>
      </Link>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <Stat label="Rank" value={ev.rank != null ? ordinal(ev.rank) : null} />
        <Stat label="Record" value={ev.record} />
        <Stat label="OPR" value={src.opr != null ? src.opr.toFixed(1) : null} sub={src.oprRank != null && src.of ? `#${src.oprRank} of ${src.of}` : undefined} />
      </dl>
      {t?.nextEvent && <p className="mt-3 truncate text-xs text-text-muted">Next event: {t.nextEvent.name}</p>}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | null; sub?: string }) {
  return (
    <div data-stat={label} className="min-w-0">
      <dt className="text-[0.6875rem] text-text-muted">{label}</dt>
      <dd className="font-display text-xl font-semibold tabular-nums">{value ?? "–"}</dd>
      {sub && <dd className="truncate text-[0.6875rem] text-text-muted">{sub}</dd>}
    </div>
  );
}

/** One of several teams: number and name, then its next match on one quiet line, and its call. */
function TeamRow({ team, season, t, loaded }: { team: number; season: number; t: TeamSummary | undefined; loaded: boolean }) {
  const sched = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  const next = sched.data ? nextMatch(sched.data.matches) : undefined;
  const pWin = next ? callFor(next, team) : null;
  return (
    <li data-your-team>
      <Link to={`/teams/${team}`} className={cn(rowLink, "py-1.5")}>
        <span className="w-14 shrink-0 font-display text-base font-semibold tabular-nums">{team}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:underline">{t?.name ?? (loaded ? `Team ${team}` : " ")}</span>
          <span data-team-next className="block truncate text-xs text-text-muted">
            {next ? `Next: ${next.label} · ${matchTime(next.time)}` : !sched.data ? "Checking the schedule…" : t?.lastEvent ? `Last: ${t.lastEvent.name}${t.lastEvent.rank != null ? ` · ${ordinal(t.lastEvent.rank)}` : ""}${t.lastEvent.record ? ` · ${t.lastEvent.record}` : ""}` : t?.nextEvent ? `Next event: ${t.nextEvent.name}` : "No schedule yet"}
          </span>
        </span>
        {pWin != null && next?.prediction && (
          <span data-team-call className="shrink-0 text-right">
            <span className="block font-display text-base font-semibold tabular-nums">{oddsPct(pWin)}</span>
            <span className="block text-[0.6875rem] text-text-muted">to win</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** No team yet: the same card, one line on what picking does, and a plain button to pick one. */
function PickTeamCard({ onPick }: { onPick: () => void }) {
  return (
    <section data-card="team" aria-labelledby="home-team" className={card}>
      <h2 id="home-team" className={cardTitle}><Star className="size-4 text-text-muted" aria-hidden /> Your teams</h2>
      <p className="text-sm text-text-muted">Pick your team to see its next match and its chance to win, right here. It stays on this device; no account needed.</p>
      <button type="button" data-pick-team onClick={onPick} className={pickTeam}><Search className="size-4" aria-hidden /> Pick your team</button>
    </section>
  );
}

/** Picking a team: a plain icon-and-label button like the sidebar's rows (no colour, no fill, no border; a faint
 *  wash on hover), where the other cards' links sit. */
const pickTeam = "mt-auto -ml-2.5 inline-flex h-10 items-center gap-2.5 self-start rounded-lg px-2.5 text-sm font-medium text-text-base transition-colors hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
