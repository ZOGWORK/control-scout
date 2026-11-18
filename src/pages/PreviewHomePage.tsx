// The v8 sample Home (Step 0 of the UI rework, second round), on its own path so the real Home stays as it is until
// the owner switches it. No headline of any kind (no H1, not even a hidden one), no slogan, no globe, nothing on a clock.
// One job per block, and each block looks like its job: every block is a card, size is the order of importance
// (search, then your team, then the actions; everything below the fold smaller and quieter), and yellow is used once
// on the first screen, for the primary action. Links and chips are white or grey, never yellow text.
// Every number comes from the same APIs and shared rules the live Home uses; nothing here invents one.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CalendarDays, Search, Sparkles, Star } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { ago, matchTime, oddsPct, pct, seasonLabel } from "../lib/format";
import type { MatchView, SearchHit, TeamSummary, TrackRecord } from "../shared/api";
import type { HomeOverview } from "../shared/home";
import { HOME_ABOUT } from "../shared/boot";
import { HOME_SUGGESTIONS, suggestionLabel, type HomeSuggestion } from "../shared/homeSuggestions";
import { liveProgress } from "../shared/ledger";
import { TIER_WORD } from "../shared/tierWords";
import { viewerToday, type WeekendAnswer, type WeekendEvent } from "../shared/weekend";
import { SEARCH_HINT, usePageSearch, useSearch } from "../components/layout/Search";
import { SearchBox, hitHref, searchPagePick } from "../components/search/SearchBox";
import { addRecentSearch } from "../components/search/discover";
import { nextMatch } from "../components/home/HomeSections";
import { homeReplays } from "../components/home/homeModel";
import { CURRENT_ENGINE, CURRENT_ENGINE_ROWS } from "../components/howitworks/currentEngine";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/basic";
import { cn } from "../components/cn";

/** How many example searches the sample shows. */
export const EXAMPLE_COUNT = 3;
/** The most events the This weekend card lists: Home is not the events list. */
export const WEEKEND_MAX = 3;

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

/** An event's days as a date chip, read in UTC like the calendar's dates: "Sat 22" for one day, "Fri 20–21" for an
 *  event that spans days (so a Friday start under a Saturday–Sunday heading reads as what it is), "Fri 30–Sat 1"
 *  across a month's end. Null without a start date. */
export function dayChip(start: string | null, end: string | null = null): string | null {
  const at = (s: string | null) => { const d = s ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  const a = at(start);
  if (!a) return null;
  const wd = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const first = `${wd(a)} ${a.getUTCDate()}`;
  const b = at(end);
  if (!b || b.getTime() <= a.getTime()) return first;
  return b.getUTCMonth() === a.getUTCMonth() ? `${first}–${b.getUTCDate()}` : `${first}–${wd(b)} ${b.getUTCDate()}`;
}

const fmt = (n: number) => n.toLocaleString("en-US");
/** A quiet text link: white, underlined on hover. Never yellow. */
const quietLink = "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-text-base hover:underline";
/** A below-the-fold card's title: smaller than anything on the first screen. */
const cardTitle = "text-sm font-semibold text-text-base";

export default function PreviewHomePage() {
  useTitle("Sample home");
  const { state } = usePersonal();
  const season = useCurrentSeason();
  const search = useSearch();
  const nav = useNavigate();
  // Home's search is the page's search: the top-bar field steps aside, as on the live Home.
  const searchRef = usePageSearch();
  const [sp] = useSearchParams();
  const query = sp.get("q")?.trim().slice(0, 100) || undefined;
  return (
    <div data-sample-home className="mx-auto flex max-w-[46rem] flex-col gap-5 pt-2 max-sm:gap-4">
      {/* 1. Search, alone: the biggest thing on the page. 48px, a still placeholder, no glow, a grey magnifier. */}
      <section aria-label="Search">
        <SearchBox
          inputRef={searchRef} onEscape={search.restoreFocus} hint={SEARCH_HINT} initialQuery={query} discover
          label="Search teams, events and matches"
          placeholder="Search teams, events, matches…"
          onPick={(h: SearchHit) => nav(hitHref(h))}
          className="w-full"
          fieldClassName="h-12 rounded-2xl border-text-base/30 bg-card px-4 text-lg max-sm:text-base focus-within:border-text-base/60 focus-within:shadow-none [&_[data-search-submit]_svg]:text-text-muted [&_[data-search-submit]:hover]:bg-text-base/[0.08]"
        />
        {/* 2. Three fixed examples, as chips: bordered pills that read as tappable, not as body text. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-muted">Try:</span>
          {fixedExamples().map((s) => (
            <Link
              key={s.q} data-example-chip to={hitHref(searchPagePick(s.q))} onClick={() => addRecentSearch(s.q)}
              className="tap-44 inline-flex h-8 items-center rounded-full border border-text-base/20 bg-card px-3 text-sm text-text-base transition-colors hover:border-text-base/40 hover:bg-text-base/[0.06]"
            >{suggestionLabel(s)}</Link>
          ))}
        </div>
      </section>

      {/* 3. Your team: the second-biggest block. */}
      {state.myTeam ? <TeamCard team={state.myTeam} season={season} /> : <PickTeamCard onPick={search.open} />}

      {/* 4. The actions, as buttons. Predict is the one yellow thing on the first screen. */}
      <nav aria-label="Next steps" className="grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        <Button size="lg" asChild data-primary-action className="shadow-none"><Link to="/predict"><Sparkles /> Predict a match</Link></Button>
        <Button size="lg" variant="secondary" asChild><Link to="/events"><Search /> Find an event</Link></Button>
        <Button size="lg" variant="secondary" asChild><Link to="/weekend"><CalendarDays /> This weekend</Link></Button>
      </nav>

      {/* 5. The free note: small and quiet. */}
      <p className="text-[12px] text-text-muted">{HOME_ABOUT}</p>

      {/* Below the fold: smaller, quieter cards. */}
      <div className="mt-8 flex flex-col gap-4 max-sm:mt-6">
        <WeekendCard />
        <SeasonCard season={season} />
        <RecordCard />
      </div>
    </div>
  );
}

// --- Your team -----------------------------------------------------------------------------------------------------

/** Your team: number and name big, then its next match and the call for it (win chance + tier word) when there is one. */
function TeamCard({ team, season }: { team: number; season: number }) {
  const sched = useApi<{ matches: MatchView[] }>(`/api/teams/${team}/matches${qs({ season })}`);
  const info = useApi<{ teams: TeamSummary[] }>(`/api/teams-summary${qs({ season, teams: String(team) })}`);
  const t = info.data?.teams[0];
  const next = sched.data ? nextMatch(sched.data.matches) : undefined;
  const side = next ? (next.red.teams.some((x) => x.number === team) ? "red" : "blue") : null;
  const pWin = next?.prediction ? (side === "red" ? next.prediction.pRed : 1 - next.prediction.pRed) : null;
  const eventName = next && t?.nextEvent?.code === next.code ? t.nextEvent.name : next?.code;
  return (
    <Card data-team-card aria-label="Your team" role="region" className="gap-5 rounded-2xl border-text-base/15 p-8 max-sm:p-5">
      <Link to="/my-team" className="group flex items-center gap-4 rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
        <Star className="size-6 shrink-0 fill-text-base text-text-base" aria-hidden />
        <span className="font-display text-4xl font-semibold tabular-nums max-sm:text-3xl">{team}</span>
        <span className="min-w-0">
          <span className="block truncate font-display text-xl font-semibold group-hover:underline">{t?.name ?? (info.data ? `Team ${team}` : " ")}</span>
          <span className="block truncate text-sm text-text-muted">Your team{t?.place ? ` · ${t.place}` : ""}</span>
        </span>
        <ArrowRight className="ml-auto size-5 shrink-0 text-text-muted group-hover:text-text-base" aria-hidden />
      </Link>
      <div className="rounded-xl border border-line bg-text-base/[0.03] px-4 py-3 text-sm">
        {next ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <span className="min-w-0">
              <span className="block text-text-muted">Next match</span>
              <span className="block font-medium text-text-base">{next.label} · {eventName} · {matchTime(next.time)}</span>
            </span>
            {pWin != null && next.prediction && (
              <span data-team-call className="text-right">
                <span className="block font-display text-2xl font-semibold tabular-nums text-text-base">{oddsPct(pWin)}</span>
                <span className="block text-[12px] text-text-muted">to win · {TIER_WORD[next.prediction.tier].toLowerCase()}</span>
              </span>
            )}
          </div>
        ) : (
          // Every state keeps the same two lines as a scheduled match, so the card never shrinks below the cards under it.
          <span data-team-next className="block min-w-0">
            <span className="block text-text-muted">Next match</span>
            <span className="block font-medium text-text-base">
              {!sched.data ? (sched.error ? "The schedule couldn’t load." : "Checking the schedule…")
                : `No match schedule published yet${t?.nextEvent ? ` · next event: ${t.nextEvent.name}` : ""}`}
            </span>
          </span>
        )}
      </div>
    </Card>
  );
}

/** No team yet: the same card, with a real button and one line saying what picking does. */
function PickTeamCard({ onPick }: { onPick: () => void }) {
  return (
    <Card data-team-card aria-label="Your team" role="region" className="gap-5 rounded-2xl border-text-base/15 p-8 max-sm:p-5">
      <div className="flex items-center gap-4">
        <Star className="size-7 shrink-0 text-text-muted" aria-hidden />
        <span className="font-display text-2xl font-semibold">Your team</span>
      </div>
      <p className="text-sm text-text-muted">Pick your team to see its next match and win chance here. It stays on this device; no account needed.</p>
      <Button size="lg" variant="secondary" onClick={onPick} className="self-start max-sm:w-full"><Search /> Pick your team</Button>
    </Card>
  );
}

// --- Below the fold ------------------------------------------------------------------------------------------------

/** This weekend: at most three events, one line each, then one link. */
function WeekendCard() {
  const [today] = useState(() => viewerToday());
  const res = useApi<WeekendAnswer>(`/api/weekend${qs({ today })}`);
  const evs = res.data?.events.slice(0, WEEKEND_MAX) ?? [];
  return (
    <Card aria-labelledby="sample-weekend" role="region" className="gap-1.5 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="sample-weekend" className={cardTitle}>This weekend{res.data && <span className="font-normal text-text-muted"> · {res.data.window.label}</span>}</h2>
        <Link to="/weekend" className={cn(quietLink, "min-h-0 pointer-coarse:min-h-11")}>All events <ArrowRight className="size-4" aria-hidden /></Link>
      </div>
      {res.error && !res.data ? (
        <p className="text-sm text-text-muted">This weekend’s events couldn’t load. <button type="button" onClick={res.reload} className="font-medium text-text-base underline">Try again</button></p>
      ) : !res.data ? (
        <ul aria-busy="true" className="space-y-2">{[0, 1, 2].map((i) => <li key={i} className="h-9 rounded-lg bg-text-base/[0.04]" />)}</ul>
      ) : !evs.length ? (
        <p className="text-sm text-text-muted">No events this weekend.</p>
      ) : (
        <ul className="divide-y divide-line">
          {evs.map((e) => <WeekendRow key={`${e.season}-${e.code}`} e={e} />)}
        </ul>
      )}
    </Card>
  );
}

function WeekendRow({ e }: { e: WeekendEvent }) {
  const day = dayChip(e.start, e.end);
  return (
    <li data-weekend-event>
      <Link to={e.href} className="group flex min-h-8 items-center gap-3 py-0.5 text-sm pointer-coarse:min-h-11">
        <span className="min-w-14 shrink-0 whitespace-nowrap rounded-md border border-line bg-text-base/[0.04] px-1.5 py-0.5 text-center text-[12px] font-medium tabular-nums text-text-base">{day ?? "TBA"}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-text-base group-hover:underline" title={e.name}>{e.name}</span>
        {e.place && <span className="max-w-[40%] shrink-0 truncate text-text-muted max-sm:hidden">{e.place}</span>}
      </Link>
    </li>
  );
}

/** This season as three numbers, each a link, labels under them; season and last sync on one small line. */
function SeasonCard({ season }: { season: number }) {
  const state = useApi<HomeOverview>(`/api/home/overview${qs({ season })}`);
  const o = state.data;
  const stats = o ? [
    { n: o.coverage.teamListings, label: "team listings", to: "/teams" },
    { n: o.coverage.events, label: "events", to: "/events" },
    { n: o.coverage.matchScores, label: "match scores", to: "/matches" },
  ] : [];
  const r = o?.readiness?.state;
  return (
    <Card aria-labelledby="sample-season" role="region" className="gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="sample-season" className={cardTitle}>This season</h2>
        {o && <span className="text-[12px] text-text-muted">{seasonLabel(o.season)}{o.dataAsOf ? ` · updated ${ago(o.dataAsOf)}` : ""}</span>}
      </div>
      {state.error && !o ? (
        <p className="text-sm text-text-muted">This season’s totals couldn’t load. <button type="button" onClick={state.reload} className="font-medium text-text-base underline">Try again</button></p>
      ) : !o ? (
        <div aria-busy="true" className="h-14" />
      ) : (
        <dl className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="min-w-0">
              <dt className="sr-only">{s.label}</dt>
              <dd>
                <Link to={s.to} aria-label={`${fmt(s.n)} ${s.label}`} className="group block rounded-lg">
                  <span className="block font-display text-2xl font-semibold tabular-nums text-text-base group-hover:underline max-sm:text-xl">{fmt(s.n)}</span>
                  <span aria-hidden className="block text-[12px] text-text-muted">{s.label}</span>
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {r === "catching-up" && <p className="text-[12px] text-text-muted">Statistics are catching up with the latest results.</p>}
      {r === "preparing" && <p className="text-[12px] text-text-muted">Statistics are being prepared.</p>}
    </Card>
  );
}

/** The track record: the replay figure always; live calls beside it only once some are decided, never an empty dash. */
function RecordCard() {
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  const t = state.data;
  const body = (() => {
    if (state.error && !t) return <p className="text-sm text-text-muted">The track record couldn’t load. <button type="button" onClick={state.reload} className="font-medium text-text-base underline">Try again</button></p>;
    if (!t) return <div aria-busy="true" className="h-20" />;
    const last = homeReplays(t).replay;
    const eng = last && !last.noneDecided ? CURRENT_ENGINE_ROWS.find((r) => r.seasonYear === last.season) : undefined;
    const replay = eng && last
      ? { label: `Replay · ${last.seasonLabel}`, value: pct(eng.accuracy, 1), detail: `${fmt(eng.correct)} of ${fmt(eng.matches)} winners called right. Engine ${CURRENT_ENGINE.version}, month by month; not calls made in advance.` }
      : last?.split
        ? { label: `Replay · ${last.seasonLabel}`, value: pct(last.block.accuracy, 1), detail: `${fmt(last.split.correct)} of ${fmt(last.split.decided)} decisive calls; not calls made in advance.` }
        : null;
    const p = liveProgress(t);
    const live = p ? t.seasons.find((s) => s.season === p.season)?.live : undefined;
    const liveFig = p && live && live.decided > 0
      ? { label: `Live calls · ${p.label} so far`, value: pct(live.accuracy, 1), detail: `Of ${fmt(live.decided)} decided calls made before each match.${live.n < t.liveThreshold ? " Early season: still moving." : ""}` }
      : null;
    const figures = [replay, liveFig].filter((f): f is NonNullable<typeof f> => !!f);
    if (!figures.length) return <p className="text-sm text-text-muted">No replayed season or decided live call is on record yet.</p>;
    return (
      <>
        <dl className={cn("grid gap-6 max-sm:gap-4", figures.length > 1 && "grid-cols-2")}>
          {figures.map((f) => (
            <div key={f.label} data-record-figure className="min-w-0">
              <dt className="text-[12px] text-text-muted">{f.label}</dt>
              <dd className="mt-1">
                <span className="block font-display text-3xl font-semibold tabular-nums text-text-base max-sm:text-2xl">{f.value}</span>
                <span className="mt-1 block text-[12px] leading-relaxed text-text-muted">{f.detail}</span>
              </dd>
            </div>
          ))}
        </dl>
        {!liveFig && <p className="text-[12px] text-text-muted">Live calls this season: none decided yet.</p>}
      </>
    );
  })();
  return (
    <Card aria-labelledby="sample-record" role="region" className="gap-3 p-4 sm:p-5">
      <h2 id="sample-record" className={cardTitle}>Prediction record</h2>
      {body}
      <Link to="/methodology#accuracy" className={quietLink}>Every call, including the misses <ArrowRight className="size-4" aria-hidden /></Link>
    </Card>
  );
}
