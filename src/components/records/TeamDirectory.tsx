// /teams?view=listed: the team directory. Every team registered for the season,
// results or not, optionally from one country (the home page's atlas links here
// with "All listed teams"). A listing is a registration, not activity: the page
// says so, and marks the teams with results instead of hiding the rest. The
// statistical tables keep their own denominator (teams with results only).
// A search (DirectorySearch, ?q=) narrows the rows inside the season and country; the totals stay
// the whole selection's, and the page says how many of them match.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowUp, ChevronLeft, ChevronRight, Hourglass, Info, MapPin, Star, Trophy, Users, X } from "lucide-react";
import { useApi, type ApiError } from "../../lib/api";
import { place, seasonLabel } from "../../lib/format";
import { useTeamFlags } from "../../lib/personal";
import { COUNTRIES, countryByCode } from "../../shared/countries";
import { isDirectoryPage, type DirectoryPage, type DirectorySort, type DirectoryTeam } from "../../shared/directory";
import type { SeasonReadiness } from "../../shared/home";
import { directoryDefaultDir, directorySearchIssue, directoryUrl, parseDirectoryState, writeDirectoryState, type DirectoryState } from "../../lib/records/directoryState";
import { clampPage, searchString } from "../../lib/records/urlState";
import { Badge } from "../ui/basic";
import { Button } from "../ui/button";
import { ErrorState, LoadingBlock } from "../states";
import { DataStatus } from "../DataStatus";
import { SeasonSelect } from "./Controls";
import { CompactFilters, FilterSection, useCompactFilters, type FilterChip } from "../CompactFilters";
import { DirectorySearch } from "./DirectorySearch";
import { cn } from "../cn";

const fmt = (n: number) => n.toLocaleString();
const BY_NAME = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
const SORTS: { key: DirectorySort; label: string }[] = [
  { key: "team", label: "Team number" }, { key: "name", label: "Name" }, { key: "location", label: "Location" },
  { key: "rookie", label: "Rookie year" }, { key: "results", label: "Results first" },
];
const field = "h-9 rounded-lg border border-line bg-card px-3 text-sm font-medium text-text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-sm:h-11";

export function TeamDirectory({ season, onSeason }: { season: number; onSeason: (s: number) => void }) {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const loc = useLocation();
  const state = useMemo(() => parseDirectoryState(sp), [sp]);
  const setState = (next: DirectoryState, replace = false) =>
    navigate({ pathname: loc.pathname, search: searchString(writeDirectoryState(sp, next)), hash: loc.hash }, { replace });

  // Answers are cached and read by their own URL (useApi), so an older search's answer arriving late can
  // never stand in for the current one: only the current URL's answer is ever api.data.
  const api = useApi<DirectoryPage>(directoryUrl(season, state), isDirectoryPage);
  // Keep the last page on screen while the next one loads (no flash of an empty table), but only for the
  // same season and country: another selection's totals must never sit under the new one's labels. A kept page
  // from an earlier search says which search it answers (data.q), so its count is never shown as the new one's.
  const last = useRef<DirectoryPage | undefined>(undefined);
  if (api.data) last.current = api.data;
  const kept = last.current && last.current.season === season && last.current.country === state.country ? last.current : undefined;
  const data = api.data ?? (api.loading ? kept : undefined);
  // An old link past the last page: go to the last page that has rows.
  const matchedOf = (d: DirectoryPage) => d.matched ?? d.total;
  const pastEnd = !!api.data && matchedOf(api.data) > 0 && !api.data.rows.length && state.page > 1;
  useEffect(() => {
    if (pastEnd && api.data) setState({ ...state, page: clampPage(state.page, matchedOf(api.data), api.data.pageSize) }, true);
  }, [pastEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const country = state.country ? countryByCode(state.country) : null;
  const where = country ? country.name : "every country";
  const sortBy = (key: DirectorySort) => setState({ ...state, sort: key, dir: state.sort === key ? (state.dir === "asc" ? "desc" : "asc") : directoryDefaultDir(key), page: 1 });
  const matched = data ? matchedOf(data) : 0;
  const pages = data ? Math.max(1, Math.ceil(matched / data.pageSize)) : 1;
  const searchIssue = directorySearchIssue(state);
  const search = (q: string | null, replace = false) => setState({ ...state, q, page: 1 }, replace);
  const resultsHref = `/teams?${new URLSearchParams({ view: "season", ...(sp.get("season") ? { season: sp.get("season")! } : {}), ...(state.country ? { country: state.country } : {}) })}`;

  // Phones: one row (season, the country chip, Filters) and a sheet with the country and the sort.
  const compact = useCompactFilters();
  // The search box differs per layout; text typed just before the layout changes (a phone turned) carries over.
  const searchDraft = useRef<string | null>(null);
  const countryPicker = (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">Country</span>
      <MapPin className="size-4 text-accent" aria-hidden />
      <select value={state.country ?? ""} onChange={(e) => setState({ ...state, country: e.target.value || null, countryUnknown: null, page: 1 })} className={field} aria-label="Country">
        <option value="">All countries</option>
        {BY_NAME.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
    </label>
  );
  const sortPicker = (
    <label className="inline-flex items-center gap-2 sm:ml-auto">
      <span className="text-sm text-text-muted">Sort</span>
      <select value={state.sort} onChange={(e) => { const sort = e.target.value as DirectorySort; setState({ ...state, sort, dir: directoryDefaultDir(sort), page: 1 }); }} className={field}>
        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </label>
  );
  const sortLabel = SORTS.find((s) => s.key === state.sort)?.label ?? "Team number";
  const chips: FilterChip[] = country ? [{ id: "country", label: <><MapPin className="inline size-3.5 text-accent" aria-hidden /> {country.name}</>, name: `Country: ${country.name}`, onRemove: () => setState({ ...state, country: null, countryUnknown: null, page: 1 }) }] : [];
  // A sort other than the default shows as a chip too (removing it goes back to team number); the default
  // shows in the Team column's header.
  const defaultOrder = state.sort === "team" && state.dir === directoryDefaultDir("team");
  if (!defaultOrder) {
    const dirWords = state.dir === "asc" ? "low → high" : "high → low";
    chips.push({ id: "sort", label: <>{state.dir === "asc" ? <ArrowUp className="inline size-3.5 text-accent" aria-hidden /> : <ArrowDown className="inline size-3.5 text-accent" aria-hidden />} {sortLabel}</>,
      name: `Sorted by ${sortLabel.toLowerCase()}, ${dirWords}`, onRemove: () => setState({ ...state, sort: "team", dir: directoryDefaultDir("team"), page: 1 }) });
  }

  return (
    <section aria-label={`Team directory, ${where}, ${seasonLabel(season)}`}>
      {compact ? (
        <CompactFilters lead={<SeasonSelect value={season} onChange={onSeason} />} chips={chips}
          // The search box stays out of the sheet, under the row: searching is the page's main way in.
          search={<DirectorySearch value={state.q} onSearch={search} where={where} draft={searchDraft} className="w-full" />}
          summary={data ? (data.q ? `${fmt(matched)} of ${fmt(data.total)} listed teams from ${where}` : `${fmt(data.total)} listed teams from ${where}`) : undefined}
          doneLabel={data ? `Show ${fmt(matched)} teams` : "Done"}
          // Clears what the chips show: the country and a non-default sort (the search has its own ×).
          onClearAll={() => setState({ ...state, country: null, countryUnknown: null, sort: "team", dir: directoryDefaultDir("team"), page: 1 })}>
          <FilterSection label="Country">{countryPicker}</FilterSection>
          <FilterSection label="Order">{sortPicker}</FilterSection>
        </CompactFilters>
      ) : (
      <div className="flex flex-wrap items-center gap-2">
        <SeasonSelect value={season} onChange={onSeason} />
        {countryPicker}
        <DirectorySearch value={state.q} onSearch={search} where={where} draft={searchDraft} className="w-full sm:w-64" />
        {sortPicker}
      </div>
      )}

      {/* An unknown ?country= as the records tables show it (urlState.ts): a problem, not every country. */}
      {state.countryUnknown ? (
        <div className="mt-4 flex flex-col items-center rounded-xl border border-danger/40 bg-danger/[0.05] px-6 max-sm:px-4 py-10 max-sm:py-6 text-center" role="alert">
          <p className="font-medium">Unknown country {state.countryUnknown.slice(0, 40)}</p>
          <p className="mt-1 max-w-lg text-xs text-text-muted">This link names a country code we don't know, so no teams are shown. Countries use two-letter codes, like US or CA.</p>
          <Button className="mt-4" onClick={() => setState({ ...state, countryUnknown: null, page: 1 })}><X /> Show every country</Button>
        </div>
      ) : compact
        ? <CompactSummary data={data} season={season} where={where} resultsHref={resultsHref} onRetry={api.reload} />
        : <Summary data={data} season={season} where={where} resultsHref={resultsHref} onRetry={api.reload} />}

      {state.countryUnknown ? null : searchIssue ? (
        <div className="mt-4 flex flex-col items-center rounded-xl border border-danger/40 bg-danger/[0.05] px-6 max-sm:px-4 py-10 max-sm:py-6 text-center" role="alert">
          <p className="font-medium">This search can’t be run</p>
          <p className="mt-1 max-w-lg text-xs text-text-muted">{searchIssue}. Search by a team number, or a few words of a team’s name or town.</p>
          <Button variant="outline" className="mt-4" onClick={() => search(null)}><X /> Clear search</Button>
        </div>
      ) : api.error && !data ? (
        <ErrorState className="mt-4" error={api.error as ApiError} onRetry={api.reload} />
      ) : !data ? (
        <div className="mt-4"><LoadingBlock rows={8} label="Loading the team directory" /></div>
      ) : !data.rows.length && data.total === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-line p-6 max-sm:p-4 text-center text-sm text-text-muted">
          No team from {where} is listed for {seasonLabel(season)}.
        </div>
      ) : data.q && matched === 0 ? (
        <div className={cn("mt-4 flex flex-col items-center rounded-xl border border-dashed border-line px-6 max-sm:px-4 py-10 max-sm:py-6 text-center", api.loading && "opacity-70")} aria-busy={api.loading}>
          <p className="font-medium" role="status">No listed team from {where} matches “{data.q}”</p>
          <p className="mt-1 max-w-lg text-xs text-text-muted">
            Searched the {fmt(data.total)} {data.total === 1 ? "team" : "teams"} registered for {seasonLabel(season)}, by number and by the words of their name, city and state.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => search(null)}><X /> Clear search</Button>
        </div>
      ) : (
        <>
          {data.q && (
            <p className="mt-4 text-sm text-text-muted max-md:mt-2" role="status">
              <span className="font-semibold tabular-nums text-text-base">{fmt(matched)}</span> of {fmt(data.total)} {data.total === 1 ? "team" : "teams"} match “<span className="font-medium text-text-base">{data.q}</span>”
            </p>
          )}
          <div className={cn("overflow-hidden rounded-xl border border-line", data.q ? "mt-2" : "mt-4 max-md:mt-2", api.loading && "opacity-70")} aria-busy={api.loading}>
            <table className="w-full text-sm">
              <caption className="sr-only">Teams listed for {seasonLabel(season)} from {where}{data.q ? `, matching “${data.q}”` : ""}, sorted by {SORTS.find((s) => s.key === state.sort)?.label.toLowerCase()}</caption>
              <thead className="bg-text-base/[0.03] text-left text-xs uppercase tracking-wide text-text-muted">
                <tr>
                  <SortHead label="Team" k="team" also="name" state={state} onSort={sortBy} />
                  <SortHead label="Location" k="location" state={state} onSort={sortBy} className="max-md:hidden" />
                  <SortHead label="Rookie" k="rookie" state={state} onSort={sortBy} className="max-sm:hidden" />
                  <SortHead label="This season" k="results" state={state} onSort={sortBy} />
                  <th scope="col" className="w-12 px-2"><span className="sr-only">Track</span></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((t) => <Row key={t.team} t={t} readiness={data.readiness} season={sp.get("season") ? data.season : null} />)}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-text-muted">
            <span className="tabular-nums">{fmt((data.page - 1) * data.pageSize + 1)}–{fmt(Math.min(matched, data.page * data.pageSize))} of {fmt(matched)}</span>
            {pages > 1 && (
              <span className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="max-sm:h-11 max-sm:w-11" disabled={state.page <= 1} onClick={() => setState({ ...state, page: state.page - 1 })} aria-label="Previous page"><ChevronLeft /></Button>
                <span className="px-2 tabular-nums">Page {fmt(state.page)} of {fmt(pages)}</span>
                <Button variant="outline" size="sm" className="max-sm:h-11 max-sm:w-11" disabled={state.page >= pages} onClick={() => setState({ ...state, page: state.page + 1 })} aria-label="Next page"><ChevronRight /></Button>
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** The country's totals, what a listing means, and where teams without a country are. */
function Summary({ data, season, where, resultsHref, onRetry }: { data: DirectoryPage | undefined; season: number; where: string; resultsHref: string; onRetry: () => void }) {
  const ready = data?.readiness.state === "ready";
  const preparing = data?.readiness.state === "preparing";
  return (
    <div className="mt-4 rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/[0.08] via-transparent to-success/[0.06] p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted"><Users className="size-3.5 text-accent" aria-hidden /> Listed</p>
          <p className="font-display text-3xl font-semibold tabular-nums text-accent-text">{data ? fmt(data.total) : "—"}</p>
          <p className="text-xs text-text-muted">registered for {seasonLabel(season)} · {where}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-text-muted"><Trophy className="size-3.5 text-success" aria-hidden /> With results</p>
          {preparing ? (
            <p className="flex items-center gap-2 py-1.5 text-sm font-semibold text-warning"><Hourglass className="size-4" aria-hidden /> Being prepared</p>
          ) : (
            <p className="font-display text-3xl font-semibold tabular-nums text-success">{data ? fmt(data.withResults) : "—"}</p>
          )}
          <p className="text-xs text-text-muted">{preparing ? "counted once statistics are ready" : ready ? "played scored qualification matches" : "from the last statistics"}</p>
        </div>
        {data && data.withResults > 0 && !preparing && (
          <Link to={resultsHref} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-success hover:underline">
            Their statistics <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      <p className="mt-3 max-w-prose text-sm text-text-muted">
        A listing means a team registered for the season. It doesn’t mean the team is active or has competed yet;
        “Has results” marks the teams that have played.
      </p>
      {data && data.unplaced > 0 && (
        <p className="mt-2 max-w-prose text-xs text-text-muted">
          {fmt(data.unplaced)} {data.unplaced === 1 ? "listing reports" : "listings report"} no country, or one we can’t place (such as “Independent”).
          {" "}They’re under All countries, not in any one country’s count.
        </p>
      )}
      {data && !ready && <DataStatus className="mt-3" readiness={data.readiness} onRetry={onRetry} />}
    </div>
  );
}

/**
 * Phones: the totals on one line (with results links to their statistics); what a listing means opens on
 * request (the same words as the wide layout's panel). The sort is a chip in the row above unless it's the
 * default, which the Team column's header shows.
 */
function CompactSummary({ data, season, where, resultsHref, onRetry }: { data: DirectoryPage | undefined; season: number; where: string; resultsHref: string; onRetry: () => void }) {
  const ready = data?.readiness.state === "ready";
  const preparing = data?.readiness.state === "preparing";
  const [about, setAbout] = useState(false);
  const id = useId();
  const withResults = <span><Trophy className="mr-1 inline size-3.5 text-success" aria-hidden /><span className="font-semibold tabular-nums text-success">{data ? fmt(data.withResults) : "—"}</span> with results</span>;
  return (
    <div className="mt-1">
      <div className="flex items-start gap-2 px-1 text-sm text-text-muted">
      <div className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-3" aria-live="polite">
        <span><Users className="mr-1 inline size-3.5 text-accent" aria-hidden /><span className="font-semibold tabular-nums text-accent-text">{data ? fmt(data.total) : "—"}</span> listed<span className="sr-only"> for {seasonLabel(season)} from {where}</span></span>
        {preparing ? (
          <span><Trophy className="mr-1 inline size-3.5 text-success" aria-hidden /><span className="font-semibold text-warning">Being prepared</span></span>
        ) : data && data.withResults > 0 ? (
          <Link to={resultsHref} className="inline-flex min-h-11 items-center hover:underline">
            {withResults}<span className="sr-only">: their statistics</span><ArrowRight className="ml-1 size-4 text-success" aria-hidden />
          </Link>
        ) : withResults}
      </div>
        <button type="button" onClick={() => setAbout(!about)} aria-expanded={about} aria-controls={id} aria-label="What a listing means" title="What a listing means"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-accent outline-none hover:bg-text-base/[0.06] focus-visible:ring-2 focus-visible:ring-accent/60">
          <Info className="size-4" aria-hidden />
        </button>
      </div>
      <div id={id} hidden={!about} className="space-y-1 px-1 pb-1 text-sm text-text-muted">
        <p className="max-w-prose">
          A listing means a team registered for the season. It doesn’t mean the team is active or has competed yet;
          “Has results” marks the teams that have played{preparing ? " (counted once statistics are ready)" : ready ? " scored qualification matches" : ", from the last statistics"}.
        </p>
        {data && data.unplaced > 0 && (
          <p className="max-w-prose text-xs">
            {fmt(data.unplaced)} {data.unplaced === 1 ? "listing reports" : "listings report"} no country, or one we can’t place (such as “Independent”).
            {" "}They’re under All countries, not in any one country’s count.
          </p>
        )}
      </div>
      {data && !ready && <DataStatus className="mt-1" readiness={data.readiness} onRetry={onRetry} />}
    </div>
  );
}

function SortHead({ label, k, also, state, onSort, className }: { label: string; k: DirectorySort; also?: DirectorySort; state: DirectoryState; onSort: (k: DirectorySort) => void; className?: string }) {
  const on = state.sort === k || state.sort === also;
  const Icon = state.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th scope="col" aria-sort={on ? (state.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2 font-semibold", className)}>
      <button type="button" onClick={() => onSort(on ? state.sort : k)} className={cn("inline-flex min-h-8 items-center gap-1 rounded-md uppercase hover:text-text-base focus-visible:outline-2 focus-visible:outline-accent", on && "text-accent-text")}>
        {label}{on && <Icon className="size-3.5" aria-hidden />}
      </button>
    </th>
  );
}

function Row({ t, readiness, season }: { t: DirectoryTeam; readiness: SeasonReadiness; season: number | null }) {
  const flags = useTeamFlags(t.team);
  const where = place(t.city, t.state, t.country);
  return (
    <tr className="border-t border-line hover:bg-text-base/[0.03]">
      <td className="px-3 py-2">
        <Link to={season == null ? `/teams/${t.team}` : `/teams/${t.team}?season=${season}`} className="group inline-flex min-h-9 flex-col justify-center">
          <span><span className="font-semibold tabular-nums text-accent-text">{t.team}</span> <span className="font-medium group-hover:underline">{t.name ?? `Team ${t.team}`}</span></span>
          {where && <span className="text-xs text-text-muted md:hidden">{where}</span>}
        </Link>
      </td>
      <td className="px-3 py-2 text-text-muted max-md:hidden">{where || <span className="italic">Not reported</span>}</td>
      <td className="px-3 py-2 tabular-nums text-text-muted max-sm:hidden">{t.rookieYear ?? "—"}</td>
      <td className="px-3 py-2">
        {t.hasResults ? <Badge variant="success"><Trophy /> Has results</Badge>
          : readiness.state === "ready" ? <Badge variant="outline">No results yet</Badge>
          : <Badge variant="outline" className="border-warning/40 text-warning"><Hourglass /> {readiness.state === "preparing" ? "Being prepared" : "None counted yet"}</Badge>}
      </td>
      <td className="px-2 py-1 text-right">
        <button type="button" onClick={flags.toggleTracked} aria-pressed={flags.tracked} aria-label={flags.tracked ? `Stop tracking ${t.team}` : `Track ${t.team}`} title={flags.tracked ? "Tracked" : "Track this team"}
          className="inline-flex size-9 items-center justify-center rounded-lg text-text-muted hover:bg-text-base/[0.06] hover:text-text-base focus-visible:outline-2 focus-visible:outline-accent max-sm:size-11">
          <Star className={cn("size-4", flags.tracked && "fill-accent text-accent")} aria-hidden />
        </button>
      </td>
    </tr>
  );
}
