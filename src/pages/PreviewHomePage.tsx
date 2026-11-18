// The v8 sample Home, third round: a scouting dashboard in the new look (the shutdown page's: server/gatePageNext.ts),
// on its own path so the real Home stays as it is until the owner switches it. Drawn without the site's chrome
// (src/shared/routes.ts isBareRoute), so nothing yellow from the old nav shows around it.
//   - Search is the centre of the page: the biggest thing on it, with three fixed examples under it.
//   - Below it, three cards of the same weight: Events live now, Top teams, Your teams (every one, usually one).
//   - No top bar (the places come back with search results later): the inbox and your profile picture (a guest one
//     when signed out) float top-right, the white mark sits small above the search, and Report a bug is a quiet
//     circle in the bottom corner. Near-black, with a dusky purple-grey wash and a fine grain across the top.
//   - One accent, mint, scoped to this page (data-theme-next): the primary button, the live dot and progress, the
//     search focus, the #1 rank, links on hover. Numbers and names are white, labels grey; red and blue stay alliances.
// No headline of any kind (no H1), no slogan, no globe. Every number comes from the same APIs the live Home uses.
import { useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Radio, Search, Star, Trophy, UserRound } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { matchTime, oddsPct, place, seasonLabel } from "../lib/format";
import type { EventListItem, MatchView, SearchHit, TeamSummary } from "../shared/api";
import type { RecordsResponse, TeamSeasonRecord } from "../shared/statCatalog";
import { HOME_ABOUT } from "../shared/boot";
import { HOME_SUGGESTIONS, suggestionLabel, type HomeSuggestion } from "../shared/homeSuggestions";
import { TIER_WORD } from "../shared/tierWords";
import { SEARCH_HINT, usePageSearch, useSearch } from "../components/layout/Search";
import { SearchBox, hitHref, searchPagePick } from "../components/search/SearchBox";
import { addRecentSearch } from "../components/search/discover";
import { nextMatch } from "../components/home/HomeSections";
import { myTeamsOf } from "../lib/myTeams";
import { BugReportButton } from "../components/layout/BugReport";
import { InboxBell } from "../components/layout/InboxBell";
import { UserAvatar } from "../components/UserAvatar";
import { cn } from "../components/cn";

/** How many example searches show under the field. */
export const EXAMPLE_COUNT = 3;
/** The most live events the first card lists: Home is not the events list. */
export const LIVE_MAX = 4;
/** How many teams the Top teams card lists. */
export const TOP_MAX = 5;

/** The accent for the new look, scoped to this page: mint, from the wash's green middle. */
export const MINT = { accent: "#7fd1ae", hover: "#95dcbd", ink: "#062b1d" } as const;
const THEME_NEXT = {
  "--color-accent": MINT.accent, "--color-accent-hover": MINT.hover, "--color-accent-ink": MINT.ink,
  "--color-accent-text": MINT.accent, "--color-accent-soft": "rgb(127 209 174 / 0.10)", "--color-ring": MINT.accent,
} as CSSProperties;

/** The fixed examples: the first query of each kind in the shared pool, in pool order, none of them a team's own
 *  (the pool holds no team numbers, src/shared/homeSuggestions.ts). The same on every visit: no clock picks them. */
export function fixedExamples(pool: readonly HomeSuggestion[] = HOME_SUGGESTIONS, count = EXAMPLE_COUNT): HomeSuggestion[] {
  const seen = new Set<string>();
  const out: HomeSuggestion[] = [];
  for (const s of pool) {
    if (s.mine || seen.has(s.kind)) continue;
    seen.add(s.kind);
    out.push(s);
    if (out.length === count) break;
  }
  return out;
}

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

export default function PreviewHomePage() {
  useTitle("Sample home");
  const { state, user } = usePersonal();
  const season = useCurrentSeason();
  const search = useSearch();
  const nav = useNavigate();
  // Home's search is the page's search, as on the live Home.
  const searchRef = usePageSearch();
  const [sp] = useSearchParams();
  const query = sp.get("q")?.trim().slice(0, 100) || undefined;
  const teams = yourTeams(myTeamsOf(user).teams.map((t) => t.teamNumber), state.myTeam ?? null, state.tracked?.teams ?? []);
  return (
    <div data-sample-home data-theme-next style={THEME_NEXT} className="relative min-h-dvh overflow-x-clip bg-[#0a0a0b] text-text-base">
      {/* No top bar: on the dashboard, search is the way around (the places come back with search results later). */}
      <Wash />
      <Corner />
      <div className="relative z-10 mx-auto flex max-w-[72rem] flex-col px-5 pb-24 sm:px-8">
        {/* Search, alone in the middle: the biggest thing on the page, the white mark small above it. */}
        <section aria-label="Search" className="mx-auto mt-[15vh] flex w-full max-w-[44rem] flex-col items-center max-sm:mt-[11vh]">
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
            {fixedExamples().map((s) => (
              <Link
                key={s.q} data-example-chip to={hitHref(searchPagePick(s.q))} onClick={() => addRecentSearch(s.q)}
                className="tap-44 inline-flex h-8 items-center rounded-full border border-white/15 bg-white/[0.03] px-3 text-sm text-text-base transition-colors hover:border-white/30 hover:bg-white/[0.07]"
              >{suggestionLabel(s)}</Link>
            ))}
          </div>
        </section>

        {/* Three cards of the same weight. On a phone, your teams come first when you have any. */}
        <div className="mt-20 grid gap-4 max-sm:mt-12 lg:grid-cols-3">
          <LiveCard season={season} />
          <TopTeamsCard season={season} />
          {teams.length ? <TeamsCard teams={teams} season={season} /> : <PickTeamCard onPick={search.open} />}
        </div>

        <p className="mt-10 text-center text-[12px] text-text-muted">{HOME_ABOUT}</p>
      </div>
      {/* Reporting a bug is occasional: a quiet circle in the page's bottom corner (below the cards on a phone). */}
      <BugReportButton corner />
    </div>
  );
}

/** Top-right, on the wash with no bar behind it: the inbox, then you. Signed in, your profile picture (your initial
 *  without one); signed out, a guest picture. Either way it opens the account settings, where a guest signs in. */
function Corner() {
  const { user } = usePersonal();
  const name = user?.displayName || user?.email || null;
  return (
    <div data-corner-tools className="absolute right-4 top-4 z-20 flex items-center gap-2 sm:right-6 sm:top-5">
      <InboxBell />
      <Link to="/settings#account" data-profile aria-label={user ? `Account: ${name ?? "you"}` : "Sign in"} title={user ? (name ?? "Account") : "Sign in"}
        className="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        {user ? (
          <UserAvatar url={user.avatarUrl} name={name} className="size-9 bg-white/10 text-text-base ring-1 ring-white/15" />
        ) : (
          <span data-guest className="flex size-9 items-center justify-center rounded-full bg-white/[0.08] text-text-muted ring-1 ring-white/15"><UserRound className="size-5" aria-hidden /></span>
        )}
      </Link>
    </div>
  );
}

/** The dashboard's wash, across the top: a dusky, muted tint (slate blue into soft mauve, close in tone and low in
 *  colour, Sushil's reference), smooth glows with a fine grain over them, fading out by about a third of the way down,
 *  above the cards. Quieter than the shutdown page's: a working page, so the colour only sets the tone. */
function Wash() {
  const fade = "linear-gradient(to bottom,#000 0%,rgb(0 0 0/.6) 45%,transparent 100%)";
  return (
    <div aria-hidden data-wash className="pointer-events-none absolute inset-x-0 top-0 h-[34vh] min-h-[220px] max-h-[380px] overflow-hidden" style={{ maskImage: fade, WebkitMaskImage: fade }}>
      <div className="absolute -inset-x-[10%] -top-1/2 bottom-0 blur-2xl bg-[radial-gradient(55%_95%_at_12%_0%,#35415b_0%,transparent_72%),radial-gradient(50%_90%_at_52%_0%,#3c3a52_0%,transparent_72%),radial-gradient(55%_95%_at_90%_0%,#4c3f57_0%,transparent_72%)]" />
      <svg data-grain className="absolute inset-0 size-full opacity-[0.12] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id="sample-grain"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
        <rect width="100%" height="100%" filter="url(#sample-grain)" />
      </svg>
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
    <section data-card="live" aria-labelledby="sample-live" className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="sample-live" className={cardTitle}>
          <span data-live-dot className={cn("size-2 rounded-full", count ? "bg-accent" : "bg-white/25")} aria-hidden /> Events live now
        </h2>
        {res.data && count > 0 && <span className="text-[12px] tabular-nums text-text-muted">{count} live</span>}
      </div>
      {res.error && !res.data ? <Failed what="Live events" retry={res.reload} /> : !res.data ? <Loading rows={3} /> : !live.length ? (
        <div data-live-empty className="flex flex-col gap-3 text-sm">
          <p className="text-text-muted">Nothing live right now.</p>
          {next && (
            <Link to={`/events/${next.season}/${encodeURIComponent(next.code)}`} className={rowLink}>
              <span className="w-14 shrink-0 rounded-md border border-white/10 py-0.5 text-center text-[12px] font-medium tabular-nums">{shortDate(next.start)}</span>
              <span className="min-w-0 flex-1"><span className="block text-[12px] text-text-muted">Next up</span><span className="block truncate font-medium group-hover:underline">{next.name}</span></span>
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
        <Radio className="size-4 shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium group-hover:underline" title={e.name}>{e.name}</span>
          {e.matchesTotal > 0 && e.matchesPlayed > 0 ? (
            <span className="mt-1.5 flex items-center gap-2">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <span data-progress className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
              </span>
              <span className="shrink-0 text-[12px] tabular-nums text-text-muted">{e.matchesPlayed}/{e.matchesTotal} played</span>
            </span>
          ) : (
            <span className="block truncate text-[12px] text-text-muted">{where || "Location TBA"}</span>
          )}
        </span>
        {!(e.matchesTotal > 0 && e.matchesPlayed > 0) && (
          <span data-no-results className="shrink-0 rounded-md border border-white/10 px-1.5 py-0.5 text-[11px] text-text-muted">No results yet</span>
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
    <section data-card="top" aria-labelledby="sample-top" className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="sample-top" className={cardTitle}><Trophy className="size-4 text-text-muted" aria-hidden /> Top teams</h2>
        <span data-top-season className="text-[12px] text-text-muted">{empty ? "Last season, " : ""}{seasonLabel(shown)} · by OPR</span>
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
          {w != null && l != null && <span className="block text-[12px] tabular-nums text-text-muted">{w}-{l}-{t ?? 0}</span>}
        </span>
        {opr != null && (
          <span className="shrink-0 text-right">
            <span className="block font-display text-base font-semibold tabular-nums">{opr.toFixed(1)}</span>
            <span className="block text-[11px] text-text-muted">OPR</span>
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
    <section data-card="team" aria-labelledby="sample-team" className={cn(card, "max-lg:order-first")}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="sample-team" className={cardTitle}><Star className="size-4 fill-text-base text-text-base" aria-hidden /> {one ? "Your team" : "Your teams"}</h2>
        {!one && <span className="text-[12px] tabular-nums text-text-muted">{teams.length}</span>}
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
      <Link to={`/teams/${team}`} className="group -mt-1 flex items-baseline gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
        <span className="font-display text-4xl font-semibold tabular-nums">{team}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium group-hover:underline">{t?.name ?? (loaded ? `Team ${team}` : " ")}</span>
          {t?.place && <span className="block truncate text-[12px] text-text-muted">{t.place}</span>}
        </span>
      </Link>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm">
        {next ? (
          <Link to={matchHref(next)} className="group flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <span className="min-w-0">
              <span className="block text-[12px] text-text-muted">Next match</span>
              <span className="block font-medium group-hover:underline">{next.label} · {eventName}</span>
              <span className="block text-[12px] text-text-muted">{matchTime(next.time)}</span>
            </span>
            {pWin != null && next.prediction && (
              <span data-team-call className="text-right">
                <span className="block font-display text-2xl font-semibold tabular-nums">{oddsPct(pWin)}</span>
                <span className="block text-[12px] text-text-muted">to win · {TIER_WORD[next.prediction.tier].toLowerCase()}</span>
              </span>
            )}
          </Link>
        ) : !sched.data ? (
          <span className="text-text-muted">{sched.error ? "The schedule couldn’t load." : "Checking the schedule…"}</span>
        ) : (
          <span className="text-text-muted">No match schedule published yet.{t?.nextEvent ? ` Next event: ${t.nextEvent.name}.` : ""}</span>
        )}
      </div>
    </>
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
          <span data-team-next className="block truncate text-[12px] text-text-muted">
            {next ? `Next: ${next.label} · ${matchTime(next.time)}` : !sched.data ? "Checking the schedule…" : t?.nextEvent ? `Next event: ${t.nextEvent.name}` : "No schedule yet"}
          </span>
        </span>
        {pWin != null && next?.prediction && (
          <span data-team-call className="shrink-0 text-right">
            <span className="block font-display text-base font-semibold tabular-nums">{oddsPct(pWin)}</span>
            <span className="block text-[11px] text-text-muted">to win</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** No team yet: the same card, one line on what picking does, and the page's one solid button. */
function PickTeamCard({ onPick }: { onPick: () => void }) {
  return (
    <section data-card="team" aria-labelledby="sample-team" className={card}>
      <h2 id="sample-team" className={cardTitle}><Star className="size-4 text-text-muted" aria-hidden /> Your teams</h2>
      <p className="text-sm text-text-muted">Pick your team to see its next match and its chance to win, right here. It stays on this device; no account needed.</p>
      <button type="button" data-primary-action onClick={onPick} className={primary}><Search className="size-4" aria-hidden /> Pick your team</button>
    </section>
  );
}

/** The page's one solid accent element (only while no team is picked): mint, dark text, no glow. */
const primary = "mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
