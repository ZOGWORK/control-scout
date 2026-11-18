// The v8 sample Home (Step 0 of the UI rework), on its own path so the real Home stays as it is until the owner
// switches it. One job: "what do I do next?" in under five seconds. No headline of any kind (no H1, not even a hidden
// one), no slogan, no lead line, no globe, nothing that moves on a clock. It starts with the search field.
// Above the fold: search, fixed example searches, your team (or the invitation to pick one), one row of plain links,
// the free note. Below: the calendar, the season in one line, the track record's two figures side by side.
// Every piece reads the same APIs and shared rules the live Home uses; nothing here invents a number.
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { ago, pct, seasonLabel } from "../lib/format";
import type { SearchHit, TrackRecord } from "../shared/api";
import type { HomeOverview } from "../shared/home";
import { HOME_ABOUT } from "../shared/boot";
import { HOME_SUGGESTIONS, suggestionLabel, type HomeSuggestion } from "../shared/homeSuggestions";
import { liveProgress } from "../shared/ledger";
import { SEARCH_HINT, usePageSearch, useSearch } from "../components/layout/Search";
import { SearchBox, hitHref, searchPagePick } from "../components/search/SearchBox";
import { addRecentSearch } from "../components/search/discover";
import { FindYourTeam, OnTheCalendar, YourTeam } from "../components/home/HomeSections";
import { homeReplays } from "../components/home/homeModel";
import { CURRENT_ENGINE, CURRENT_ENGINE_ROWS } from "../components/howitworks/currentEngine";
import { ErrorState } from "../components/states";

/** How many example searches the sample shows. */
export const EXAMPLE_COUNT = 5;

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

const fmt = (n: number) => n.toLocaleString("en-US");
const linkCls = "inline-flex min-h-11 items-center font-medium text-accent-text hover:underline";

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
  const examples = fixedExamples();
  const run = (q: string) => addRecentSearch(q);
  return (
    <div data-sample-home className="mx-auto max-w-[44rem]">
      {/* 1. Search, alone: one field, 48px, a still placeholder, no glow. */}
      <section aria-label="Search" className="pt-2">
        <SearchBox
          inputRef={searchRef} onEscape={search.restoreFocus} hint={SEARCH_HINT} initialQuery={query} discover
          label="Search teams, events and matches"
          placeholder="Search teams, events, matches…"
          onPick={(h: SearchHit) => nav(hitHref(h))}
          className="w-full"
          fieldClassName="h-12 px-4 text-base focus-within:border-accent focus-within:shadow-none"
        />
        {/* 2. Examples: links, the same every visit. */}
        <p className="mt-3 flex flex-wrap items-center gap-x-4 text-sm text-text-muted">
          <span>Try:</span>
          {examples.map((s) => (
            <Link key={s.q} to={hitHref(searchPagePick(s.q))} onClick={() => run(s.q)} className={linkCls}>{suggestionLabel(s)}</Link>
          ))}
        </p>
      </section>

      {/* 3. Your team, or the invitation to pick one. */}
      <div className="mt-5">{state.myTeam ? <YourTeam team={state.myTeam} season={season} /> : <FindYourTeam onSearch={search.open} />}</div>

      {/* 4. One row of plain links. */}
      <nav aria-label="Next steps" className="mt-4 flex flex-wrap items-center gap-x-3 text-sm">
        <Link to="/predict" className={linkCls}>Predict a match</Link>
        <span aria-hidden className="text-text-muted">·</span>
        <Link to="/events" className={linkCls}>Find an event</Link>
        <span aria-hidden className="text-text-muted">·</span>
        <Link to="/weekend" className={linkCls}>This weekend</Link>
      </nav>

      {/* 5. The free note, plain text. */}
      <p className="mt-3 text-sm text-text-base">{HOME_ABOUT}</p>

      {/* Below the fold. */}
      <div className="mt-12 space-y-10 max-sm:mt-10 max-sm:space-y-8">
        <OnTheCalendar season={season} />
        <SeasonLine season={season} />
        <RecordFigures />
      </div>
    </div>
  );
}

/** This season in one line, each count a link, with its season and when the data last synced. */
function SeasonLine({ season }: { season: number }) {
  const state = useApi<HomeOverview>(`/api/home/overview${qs({ season })}`);
  const o = state.data;
  if (state.error && !o) return <p className="text-sm text-text-muted">This season’s totals couldn’t load. <button type="button" onClick={state.reload} className="font-medium text-accent-text underline">Try again</button></p>;
  if (!o) return <p aria-busy="true" className="h-6" />;
  const r = o.readiness?.state;
  return (
    <section aria-label="This season" className="text-sm text-text-muted">
      <p className="tabular-nums">
        <Link to="/teams" className="font-medium text-text-base hover:underline">{fmt(o.coverage.teamListings)} team listings</Link>
        {" · "}<Link to="/events" className="font-medium text-text-base hover:underline">{fmt(o.coverage.events)} events</Link>
        {" · "}<Link to="/matches" className="font-medium text-text-base hover:underline">{fmt(o.coverage.matchScores)} match scores</Link>
        {` — ${seasonLabel(o.season)}`}{o.dataAsOf ? `, updated ${ago(o.dataAsOf)}` : ""}
      </p>
      {r === "catching-up" && <p className="mt-1">Statistics are catching up with the latest results.</p>}
      {r === "preparing" && <p className="mt-1">This season’s statistics are being prepared.</p>}
    </section>
  );
}

/** The two figures the live Home shows, side by side, the same size, each with its label: the replay headline and
 *  live calls this season. Never blended, never the accent colour (it isn't a data colour). */
function RecordFigures() {
  const state = useApi<TrackRecord>("/api/predict/accuracy");
  const t = state.data;
  if (state.error && !t) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!t) return <div aria-busy="true" className="h-28" />;
  const last = homeReplays(t).replay;
  const eng = last && !last.noneDecided ? CURRENT_ENGINE_ROWS.find((r) => r.seasonYear === last.season) : undefined;
  const p = liveProgress(t);
  const live = p ? t.seasons.find((s) => s.season === p.season)?.live : undefined;
  const figures: { label: string; value: string | null; detail: string }[] = [
    eng && last
      ? { label: `Replay · ${last.seasonLabel}`, value: pct(eng.accuracy, 1), detail: `Engine ${CURRENT_ENGINE.version}, month by month: ${fmt(eng.correct)} of ${fmt(eng.matches)} winners called right. Not calls made in advance.` }
      : last && last.split
        ? { label: `Replay · ${last.seasonLabel}`, value: pct(last.block.accuracy, 1), detail: `${fmt(last.split.correct)} of ${fmt(last.split.decided)} decisive calls. Not calls made in advance.` }
        : { label: "Replay", value: null, detail: "No replayed season is on record yet." },
    p && live && live.decided > 0
      ? { label: `Live calls · ${p.label} so far`, value: pct(live.accuracy, 1), detail: `Of ${fmt(live.decided)} decided calls made before each match.${live.n < t.liveThreshold ? " Early season: still moving." : ""}` }
      : { label: "Live calls this season", value: null, detail: p ? `${fmt(p.n)} scored, none decided yet.` : "No live call has been scored yet." },
  ];
  return (
    <section aria-labelledby="sample-record" className="border-t border-line pt-6">
      <h2 id="sample-record" className="font-display text-xl font-semibold">Prediction record</h2>
      <dl className="mt-4 grid grid-cols-2 gap-6 max-sm:gap-4">
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-sm text-text-muted">{f.label}</dt>
            <dd className="mt-1">
              <span className="block font-display text-3xl font-semibold tabular-nums text-text-base">{f.value ?? "—"}</span>
              <span className="mt-1 block text-[12px] leading-relaxed text-text-muted">{f.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
      <Link to="/methodology#accuracy" className="mt-4 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent-text hover:underline">Every call, including the misses <ArrowUpRight className="size-4" aria-hidden /></Link>
    </section>
  );
}
