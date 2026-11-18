// The v8 sample Home, third round: a scouting dashboard in the new look (the shutdown page's: server/gatePageNext.ts),
// on its own path so the real Home stays as it is until the owner switches it. Drawn without the site's chrome
// (src/shared/routes.ts isBareRoute), so nothing yellow from the old nav shows around it.
//   - Search is the centre of the page: the biggest thing on it, with three fixed examples under it.
//   - Below it, three cards of the same weight: Events live now, Top teams, Your team.
//   - A top bar (mark, the main places, the app's own tools), then near-black with a short, smooth tint under it
//     (navy, blue-teal, soft indigo; the faintest grain). The mark is white.
//   - One accent, mint, scoped to this page (data-theme-next): the primary button, the live dot and progress, the
//     search focus, the #1 rank, links on hover. Numbers and names are white, labels grey; red and blue stay alliances.
// No headline of any kind (no H1), no slogan, no globe. Every number comes from the same APIs the live Home uses.
import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Radio, Search, Sparkles, Star, Trophy } from "lucide-react";
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
import { ClockWeather } from "../components/layout/TopBarExtras";
import { BugReportButton } from "../components/layout/BugReport";
import { ThemeToggle } from "../components/layout/ThemeToggle";
import { InboxBell } from "../components/layout/InboxBell";
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
  // The account's Control Point team first, then this device's My team (the live Home's homeTeamOf, src/pages/Home.tsx).
  const team = myTeamsOf(user).teams[0]?.teamNumber ?? state.myTeam ?? null;
  return (
    <div data-sample-home data-theme-next style={THEME_NEXT} className="relative min-h-dvh overflow-x-clip bg-[#0a0a0b] text-text-base">
      <TopNav />
      <div className="relative">
      <Wash />
      <div className="relative z-10 mx-auto flex max-w-[72rem] flex-col px-5 pb-16 sm:px-8">
        {/* Search, alone in the middle: the biggest thing on the page. */}
        <section aria-label="Search" className="mx-auto mt-[11vh] w-full max-w-[44rem] max-sm:mt-[7vh]">
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

        {/* Three cards of the same weight. On a phone, your team comes first when one is set. */}
        <div className="mt-20 grid gap-4 max-sm:mt-12 lg:grid-cols-3">
          <LiveCard season={season} />
          <TopTeamsCard season={season} />
          {team ? <TeamCard team={team} season={season} /> : <PickTeamCard onPick={search.open} />}
        </div>

        <p className="mt-10 text-center text-[12px] text-text-muted">{HOME_ABOUT}</p>
      </div>
      </div>
    </div>
  );
}

/** The main places, in the bar. Home is this page. */
export const NAV = [
  { to: "/", label: "Home" },
  { to: "/events", label: "Events" },
  { to: "/teams", label: "Teams" },
  { to: "/scout", label: "Scout" },
  { to: "/predict", label: "Predict" },
] as const;

/** The top bar: an opaque near-black strip with a hairline under it. The mark and name left; the main places; then
 *  the app's own tools (clock · weather, Report a bug, light/dark, the inbox), the same components the app's top bar
 *  uses. On a phone the places drop to a second row that scrolls sideways. */
function TopNav() {
  return (
    <header data-top-nav className="relative z-20 border-b border-white/[0.07] bg-[#0a0a0b]">
      <div className="mx-auto flex max-w-[72rem] flex-wrap items-center gap-x-6 px-5 sm:px-8">
        <Link to="/" aria-label="Control Scout home" className="flex h-14 shrink-0 items-center gap-2.5 font-display text-[1.0625rem] font-semibold tracking-tight">
          <img src="/mark-white.webp" alt="" width={28} height={28} className="size-7" /> Control Scout
        </Link>
        <nav aria-label="Main" className="flex gap-6 max-md:order-last max-md:-mx-5 max-md:w-[calc(100%+2.5rem)] max-md:overflow-x-auto max-md:border-t max-md:border-white/[0.06] max-md:px-5 md:ml-auto">
          {NAV.map((n) => {
            const here = n.to === "/";
            return (
              <Link
                key={n.to} to={n.to} aria-current={here ? "page" : undefined}
                className={cn("flex h-11 shrink-0 items-center text-sm font-semibold transition-colors md:h-14", here ? "text-text-base" : "text-text-muted hover:text-text-base")}
              >{n.label}</Link>
            );
          })}
        </nav>
        <div data-top-tools className="ml-auto flex shrink-0 items-center gap-1 md:ml-0 md:gap-2">
          <span className="max-lg:hidden"><ClockWeather /></span>
          <BugReportButton />
          <ThemeToggle />
          <InboxBell />
        </div>
      </div>
    </header>
  );
}

/** The dashboard's wash, under the top bar: quieter than the shutdown page's. Short (gone about a fifth of the way
 *  down, above the search), three neighbouring hues (navy, blue-teal, soft indigo) blended as soft overlapping glows so
 *  it reads as one tint rather than bands, and only the faintest fine grain. A working page should feel calm; the
 *  colour only sets the tone. */
function Wash() {
  const fade = "linear-gradient(to bottom,#000 0%,rgb(0 0 0/.6) 45%,transparent 100%)";
  return (
    <div aria-hidden data-wash className="pointer-events-none absolute inset-x-0 top-0 h-[22vh] min-h-[150px] max-h-[240px] overflow-hidden" style={{ maskImage: fade, WebkitMaskImage: fade }}>
      <div className="absolute -inset-x-[10%] -top-1/2 bottom-0 opacity-90 blur-2xl bg-[radial-gradient(45%_90%_at_15%_0%,#33558c_0%,transparent_70%),radial-gradient(40%_85%_at_50%_0%,#2a6070_0%,transparent_70%),radial-gradient(45%_90%_at_85%_0%,#47488c_0%,transparent_70%)]" />
      <svg data-grain className="absolute inset-0 size-full opacity-[0.07] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id="sample-grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
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

// --- Your team -------------------------------------------------------------------------------------------------------

const matchHref = (m: MatchView) => `/events/${m.season}/${encodeURIComponent(m.code)}/match/${encodeURIComponent(m.key)}`;

/** Your team: number and name big, its next match, the call for it (win chance + tier word), and one mint button. */
function TeamCard({ team, season }: { team: number; season: number }) {
  const sched = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  const info = useApi<{ teams: TeamSummary[] }>(`/api/teams-summary${qs({ season, teams: String(team) })}`);
  const t = info.data?.teams[0];
  const next = sched.data ? nextMatch(sched.data.matches) : undefined;
  const side = next ? (next.red.teams.some((x) => x.number === team) ? "red" : "blue") : null;
  const pWin = next?.prediction ? (side === "red" ? next.prediction.pRed : 1 - next.prediction.pRed) : null;
  const eventName = next && t?.nextEvent?.code === next.code ? t.nextEvent.name : next?.code;
  return (
    <section data-card="team" aria-labelledby="sample-team" className={cn(card, "max-lg:order-first")}>
      <h2 id="sample-team" className={cardTitle}><Star className="size-4 fill-text-base text-text-base" aria-hidden /> Your team</h2>
      <Link to="/my-team" className="group -mt-1 flex items-baseline gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
        <span className="font-display text-4xl font-semibold tabular-nums">{team}</span>
        <span className="min-w-0">
          <span className="block truncate font-medium group-hover:underline">{t?.name ?? (info.data ? `Team ${team}` : " ")}</span>
          {t?.place && <span className="block truncate text-[12px] text-text-muted">{t.place}</span>}
        </span>
      </Link>
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 text-sm">
        {next ? (
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <span className="min-w-0">
              <span className="block text-[12px] text-text-muted">Next match</span>
              <span className="block font-medium">{next.label} · {eventName}</span>
              <span className="block text-[12px] text-text-muted">{matchTime(next.time)}</span>
            </span>
            {pWin != null && next.prediction && (
              <span data-team-call className="text-right">
                <span className="block font-display text-2xl font-semibold tabular-nums">{oddsPct(pWin)}</span>
                <span className="block text-[12px] text-text-muted">to win · {TIER_WORD[next.prediction.tier].toLowerCase()}</span>
              </span>
            )}
          </div>
        ) : !sched.data ? (
          <span className="text-text-muted">{sched.error ? "The schedule couldn’t load." : "Checking the schedule…"}</span>
        ) : (
          <span className="text-text-muted">No match schedule published yet.{t?.nextEvent ? ` Next event: ${t.nextEvent.name}.` : ""}</span>
        )}
      </div>
      <PrimaryLink to={next ? matchHref(next) : "/predict"}>{next ? "Predict this match" : "Predict a match"}</PrimaryLink>
    </section>
  );
}

/** No team yet: the same card, one line on what picking does, and the button. */
function PickTeamCard({ onPick }: { onPick: () => void }) {
  return (
    <section data-card="team" aria-labelledby="sample-team" className={card}>
      <h2 id="sample-team" className={cardTitle}><Star className="size-4 text-text-muted" aria-hidden /> Your team</h2>
      <p className="text-sm text-text-muted">Pick your team to see its next match and its chance to win, right here. It stays on this device; no account needed.</p>
      <button type="button" data-primary-action onClick={onPick} className={primary}><Search className="size-4" aria-hidden /> Pick your team</button>
    </section>
  );
}

/** The page's one solid accent element: mint, dark text, no glow. */
const primary = "mt-auto inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function PrimaryLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} data-primary-action className={primary}><Sparkles className="size-4" aria-hidden /> {children}</Link>;
}
