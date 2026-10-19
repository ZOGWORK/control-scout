// A records table with its toolbar designed in: [Statistics] [Filters] [preset
// chips] … [Compare] [Export CSV], the Season / Region / Event type / Date
// dropdowns, a plain-English line for the active filter, server-side sorting
// and paging, and everything in the URL so a link reproduces the view.
// Used by the event Rankings and Insights tabs, /teams and /matches.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3, Download, ListFilter, Loader2, MapPin, RefreshCw, Scale, SearchX, Sparkles, X } from "lucide-react";
import { apiFetch, useApi, type ApiError } from "../../lib/api";
import type { FilterGroup } from "../../shared/filterDsl";
import { STAT_BY_KEY, statFor, type MatchRecordRow, type RecordScope, type RecordsResponse, type TeamEventRecord, type TeamSeasonRecord } from "../../shared/statCatalog";
import { countryByCode } from "../../shared/countries";
import { clampPage, clearFilters, defaultDir, hasFilters, parseTableState, recordsUrl, searchString, writeTableState, type TableState } from "../../lib/records/urlState";
import { describeFilter, formatStat, headerOf, TONE_CLASS, toneOf } from "../../lib/records/describe";
import { addPreset, hasPreset, presetGroup, presetsFor, removePreset, type ThresholdLookup } from "../../lib/records/presets";
import type { FilterPreset } from "../../config/filterPresets";
import { dateRange } from "../../lib/format";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { ErrorState } from "../states";
import { cn } from "../cn";
import { FilterBuilder } from "./FilterBuilder";
import { Panel } from "./Panel";
import { pickableStats, StatPicker } from "./StatPicker";
import { DateRangePicker, EventTypeSelect, RegionPicker, SeasonSelect } from "./Controls";
import { pageTop } from "../../lib/pageScroll";

type Row = TeamEventRecord | TeamSeasonRecord | MatchRecordRow;
type Resp = RecordsResponse<Row>;

export interface RecordsTableProps {
  scope: RecordScope;
  season: number;
  /** Whether the season has predictions (hides Control Scout's stats when not). */
  predictable: boolean;
  /** Only this event's records (event Rankings / Insights). */
  code?: string;
  defaultCols: string[];
  defaultSort?: string;
  /** Column choice is remembered per table under this name. */
  storageKey: string;
  /** "team-events", "teams", "matches". */
  noun: string;
  /** The separate dropdowns; leave out for an event's tables. */
  controls?: { onSeason?: (s: number) => void; region?: boolean; eventType?: boolean; dates?: boolean; extra?: ReactNode };
  /** Checkboxes on team rows and "Compare selected". */
  selectable?: boolean;
  highlightTeam?: number | null;
  /** Shown instead of the empty state when there are no records at all (no filter on). */
  emptyFallback?: ReactNode;
  /** Shown instead of the error when offline (records need the server; e.g. the event's downloaded ranking). */
  offlineFallback?: ReactNode;
  /** When this changes (e.g. a live event's results were checked again), the rows are fetched again. */
  refreshKey?: string;
}

const COLS_KEY = (k: string) => `cs-records-cols:${k}`;
const readCols = (k: string): string[] | null => { try { const v = JSON.parse(localStorage.getItem(COLS_KEY(k)) ?? "null"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null; } catch { return null; } };
const writeCols = (k: string, cols: string[] | null) => { try { if (cols) localStorage.setItem(COLS_KEY(k), JSON.stringify(cols)); else localStorage.removeItem(COLS_KEY(k)); } catch { /* storage blocked */ } };

// Top-% thresholds for preset chips, per season / table / stat (they don't change within a visit).
const thresholds = new Map<string, Promise<number | null>>();

export function RecordsTable(p: RecordsTableProps) {
  const { scope, season, predictable, code } = p;
  const defaultSort = p.defaultSort ?? (scope === "match" ? "highScore" : "totalPointsOpr");
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const loc = useLocation();
  const state = useMemo(() => parseTableState(sp, scope, defaultSort), [sp, scope, defaultSort]);
  const setState = useCallback((next: TableState, replace = false) => {
    navigate({ pathname: loc.pathname, search: searchString(writeTableState(sp, next, scope, defaultSort)), hash: loc.hash }, { replace });
  }, [navigate, loc.pathname, loc.hash, sp, scope, defaultSort]);

  // Columns: the URL's, else this device's choice for this table, else the defaults (a newly ticked one goes last).
  const pickable = useMemo(() => new Set(pickableStats(scope, predictable).map((s) => s.key)), [scope, predictable]);
  const [stored, setStored] = useState(() => readCols(p.storageKey));
  const cols = useMemo(() => (state.cols ?? stored ?? p.defaultCols).filter((k) => pickable.has(k)), [state.cols, stored, p.defaultCols, pickable]);
  const setCols = (next: string[] | null) => { writeCols(p.storageKey, next); setStored(next); setState({ ...state, cols: next }, true); };
  const teamScope = scope !== "match";
  const fields = useMemo(() => [...new Set([...(teamScope ? ["teamName"] : []), ...cols])], [teamScope, cols]);

  const req = { season, scope, state, fields, code };
  // An unreadable filter or unknown country asks nothing: the rows would be broader than the link says.
  const api = useApi<Resp>(state.filterError || state.countryUnknown ? null : recordsUrl(req));
  const last = useRef<Resp | undefined>(undefined);
  if (api.data) last.current = api.data;
  const data = api.data ?? (api.loading ? last.current : undefined);
  const refreshing = api.loading && !!last.current;
  // A page past the end (an old link, or fewer rows since): go to the last page that has rows.
  const pastEnd = !!api.data && api.data.total > 0 && !api.data.rows.length && state.page > 1;
  useEffect(() => {
    if (!pastEnd || !api.data) return;
    setState({ ...state, page: clampPage(state.page, api.data.total, api.data.pageSize) }, true);
  }, [pastEnd]); // eslint-disable-line react-hooks/exhaustive-deps
  // New results upstream (refreshKey moved): fetch the same rows again, bypassing the cache.
  const seenKey = useRef(p.refreshKey);
  useEffect(() => {
    if (p.refreshKey === seenKey.current) return;
    seenKey.current = p.refreshKey;
    api.reload();
  }, [p.refreshKey, api.reload]);
  // Back online after a failed (offline) load: fetch again on its own.
  const offline = !!(api.error as ApiError | undefined)?.offline;
  useEffect(() => {
    if (!offline) return;
    const fn = () => api.reload();
    window.addEventListener("online", fn);
    return () => window.removeEventListener("online", fn);
  }, [offline, api.reload]);

  const [builder, setBuilder] = useState(false);
  const [columns, setColumns] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => setSelected([]), [season, code]);

  const countFor = useCallback(async (f: FilterGroup | null) => {
    const r = await apiFetch<Resp>(recordsUrl({ season, scope, code, state: { ...state, filter: f, page: 1 }, fields: [cols[0] ?? (teamScope ? "teamNumber" : "highScore")], pageSize: 1 }));
    return r.total;
  }, [season, scope, code, state, cols, teamScope]);

  const lookup: ThresholdLookup = useCallback((key, pct, dir) => {
    const id = `${season}:${scope}:${key}:${pct}:${dir}`;
    if (!thresholds.has(id)) {
      const base = parseTableState(new URLSearchParams(teamScope ? "filter=and-qualMatchesPlayed.gte.3-" : ""), scope);
      const at = (page: number) => apiFetch<Resp>(recordsUrl({ season, scope, state: { ...base, sort: key, dir, page }, fields: [key], pageSize: 1 }));
      thresholds.set(id, at(1).then(async (r) => {
        if (!r.total) return null;
        const row = (await at(Math.max(1, Math.round((r.total * pct) / 100)))).rows[0];
        const v = row?.stats[key];
        return typeof v === "number" ? v : null;
      }).catch(() => { thresholds.delete(id); return null; }));
    }
    return thresholds.get(id)!;
  }, [season, scope, teamScope]);

  const presets = presetsFor(scope, predictable);
  // A chip whose threshold is still loading applies to the table as it is when the answer
  // arrives (other edits made meanwhile are kept), and is dropped if the table went away
  // or now shows another season or event.
  const latest = useRef({ state, setState, where: `${season}:${code ?? ""}`, mounted: true });
  latest.current = { ...latest.current, state, setState, where: `${season}:${code ?? ""}` };
  useEffect(() => { latest.current.mounted = true; return () => { latest.current.mounted = false; }; }, []);
  const [chipBusy, setChipBusy] = useState<string | null>(null);
  const toggleChip = async (preset: FilterPreset) => {
    if (hasPreset(state.filter, preset)) { setState({ ...state, filter: removePreset(state.filter!, preset), page: 1 }); return; }
    const where = `${season}:${code ?? ""}`;
    setChipBusy(preset.id);
    const g = await presetGroup(preset, season, lookup);
    const now = latest.current;
    if (!now.mounted || now.where !== where) return;
    setChipBusy((b) => (b === preset.id ? null : b));
    if (!g) { toast.error(`No ${preset.label} threshold for this season yet — not enough data.`); return; }
    if (hasPreset(now.state.filter, preset)) return; // turned on another way meanwhile
    now.setState({ ...now.state, filter: addPreset(now.state.filter, g, presets), page: 1 });
  };

  const sortBy = (key: string) => {
    if (!statFor(key, scope)) return;
    const dir = state.sort === key ? (state.dir === "asc" ? "desc" : "asc") : defaultDir(key, scope);
    setState({ ...state, sort: key, dir, page: 1 }, true);
  };
  const filtered = hasFilters(state);
  const conditions = state.filter ? countConds(state.filter) : 0;
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize ?? 50)));
  const csv = recordsUrl(req, "csv");
  const c = p.controls;
  const selectedTeams = selected.slice(0, 4);

  return (
    <div className="min-w-0 space-y-3" data-records-table={scope}>
      {c && (
        <div className="flex flex-wrap items-center gap-2">
          {c.onSeason && <SeasonSelect value={season} onChange={c.onSeason} />}
          {c.extra}
          {c.region && <RegionPicker season={season} value={state.regions} onChange={(regions) => setState({ ...state, regions, page: 1 })} />}
          {teamScope && state.country && (
            <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={() => setState({ ...state, country: null, page: 1 })}
              aria-label={`Teams from ${countryByCode(state.country)?.name ?? state.country}: show every country`}>
              <MapPin className="text-accent" /> Teams from {countryByCode(state.country)?.name ?? state.country} <X className="text-text-muted" />
            </Button>
          )}
          {c.eventType && <EventTypeSelect value={state.eventType} onChange={(eventType) => setState({ ...state, eventType, page: 1 })} />}
          {c.dates && <DateRangePicker from={state.from} to={state.to} onChange={(from, to) => setState({ ...state, from, to, page: 1 })} />}
          {filtered && (
            <Button variant="ghost" size="sm" className="text-danger hover:text-danger max-sm:h-11" onClick={() => setState(clearFilters(state))}><X /> Clear filters</Button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card p-1.5">
        <Button variant="secondary" size="sm" className="shrink-0 max-sm:h-10" onClick={() => { setBuilder(false); setColumns(!columns); }} aria-pressed={columns}>
          {/* The name is the visible text (plus words a phone hides): "Statistics 12 columns". */}
          <Columns3 className="text-sky-500" /> <span className="max-sm:sr-only">Statistics</span> <span className="rounded bg-text-base/10 px-1.5 text-[11px] tabular-nums">{cols.length}{" "}<span className="sr-only">columns</span></span>
        </Button>
        <Button variant={conditions ? "default" : "secondary"} size="sm" className="shrink-0 max-sm:h-10" onClick={() => { setColumns(false); setBuilder(!builder); }} aria-pressed={builder} aria-label={`Filters${conditions ? `: ${conditions} conditions` : ""}`}>
          <ListFilter className={conditions ? "" : "text-accent"} /> Filters{conditions > 0 && <span className="rounded bg-accent-ink/15 px-1.5 text-[11px] tabular-nums">{conditions}</span>}
        </Button>
        {presets.length > 0 && (
          <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto border-l border-line pl-2 max-sm:order-last max-sm:basis-full max-sm:border-l-0 max-sm:border-t max-sm:pl-0 max-sm:pt-1.5" aria-label="Quick filters">
            {presets.map((pr) => {
              const on = hasPreset(state.filter, pr);
              const tone = TONE_CLASS[pr.tone];
              return (
                <Tooltip key={pr.id}>
                  <TooltipTrigger asChild>
                    <button type="button" aria-pressed={on} onClick={() => void toggleChip(pr)} disabled={chipBusy === pr.id}
                      className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all max-sm:h-10", on ? cn(tone.chip, "ring-1 ring-current") : "border-line text-text-muted hover:border-text-base/25 hover:text-text-base")}>
                      {chipBusy === pr.id ? <Loader2 className="size-3 animate-spin" /> : <span className={cn("size-1.5 rounded-full", tone.bar)} />}
                      {pr.label}{on && <X className="size-3" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{pr.description}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        )}
        <div className={cn("ml-auto flex shrink-0 items-center gap-1.5", !presets.length && "ml-auto")}>
          {p.selectable && teamScope && selected.length > 0 && (
            <Button size="sm" className="max-sm:h-10" asChild>
              <Link to={`/compare?teams=${selectedTeams.join(",")}&season=${season}`}><Scale /> Compare <span className="tabular-nums">{selectedTeams.length}</span></Link>
            </Button>
          )}
          <Button variant="outline" size="sm" className="max-sm:h-10" asChild={total > 0} disabled={!total}>
            {total > 0 ? <a href={csv} download><Download /> <span className="max-sm:sr-only">Export CSV</span>{" "}<span className="sr-only">({total.toLocaleString()} rows)</span></a> : <span><Download /> <span className="max-sm:hidden">Export CSV</span></span>}
          </Button>
        </div>
      </div>

      {/* What's showing, in words */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-sm">
        <span className="text-text-muted" aria-live="polite">
          {data ? <><span className="font-semibold tabular-nums text-text-base">{total.toLocaleString()}</span> {p.noun}</> : state.filterError || state.countryUnknown ? null : "Loading…"}
          {refreshing && <Loader2 className="ml-1.5 inline size-3.5 animate-spin" />}
        </span>
        {state.filter && state.filter.children.length > 0 && (
          <button type="button" onClick={() => { setColumns(false); setBuilder(true); }} className="min-w-0 max-w-full truncate rounded-md border-l-2 border-accent max-sm:whitespace-normal max-sm:line-clamp-3 bg-accent/[0.07] px-2 py-0.5 text-left text-text-base hover:bg-accent/[0.12]" title="Edit filters">
            {describeFilter(state.filter, scope)}
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-text-muted">
          <ArrowUpDown className="size-3.5" /> Sorted by <span className="font-medium text-text-base">{STAT_BY_KEY.get(state.sort)?.label}</span> {state.dir === "asc" ? "(low → high)" : "(high → low)"}
        </span>
      </div>

      {state.filterError ? (
        <Problem title="This link's filter couldn't be read" detail={state.filterError} onClear={() => setState(clearFilters(state))} />
      ) : state.countryUnknown ? (
        <Problem title={`Unknown country ${state.countryUnknown.slice(0, 40)}`} detail="This link names a country code we don't know, so no teams are shown. Countries use two-letter codes, like US or CA."
          clearLabel="Show every country" onClear={() => setState({ ...state, countryUnknown: null, page: 1 })} />
      ) : api.error && !data ? (
        (api.error as ApiError).offline && p.offlineFallback ? (
          <div className="space-y-3">
            <div className="flex justify-end"><Button variant="outline" size="sm" onClick={api.reload}><RefreshCw /> Try again</Button></div>
            {p.offlineFallback}
          </div>
        ) : (api.error as ApiError).status === 400
          ? <Problem title="That filter doesn't work here" detail={api.error.message} onClear={() => setState(clearFilters(state))} />
          : <ErrorState error={api.error} onRetry={api.reload} />
      ) : !data || (!data.rows.length && data.total > 0 && state.page > 1) ? (
        // (rows exist, just not on this page: the effect above moves to the last page)
        <TableSkeleton />
      ) : !data.rows.length ? (
        !filtered && p.emptyFallback ? p.emptyFallback : (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-accent/15"><SearchX className="size-5 text-accent" /></span>
            <p className="font-medium">{filtered ? `No ${p.noun} match these filters` : `No ${p.noun} yet`}</p>
            <p className="mt-1 max-w-md text-sm text-text-muted">{filtered ? (state.filter ? describeFilter(state.filter, scope) : "Try another region, country, event type or date range.") : "Records appear once matches have been played and the stats have been updated."}</p>
            {filtered && <Button className="mt-4" onClick={() => setState(clearFilters(state))}><X /> Clear filters</Button>}
          </div>
        )
      ) : (
        <div className={cn("relative transition-opacity", refreshing && "opacity-60")}>
          {refreshing && <div className="absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden rounded-full bg-accent/20"><div className="h-full w-1/3 cs-progress bg-accent" /></div>}
          <Table data={data} scope={scope} cols={cols} state={state} sortBy={sortBy} code={code} highlightTeam={p.highlightTeam}
            selectable={!!p.selectable && teamScope} selected={selected} onSelect={(t) => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : s.length >= 4 ? (toast("Compare takes up to 4 teams"), s) : [...s, t]))} />
          <div className="mt-3 flex flex-wrap items-center gap-2 px-1 text-sm text-text-muted">
            <span className="tabular-nums">{((state.page - 1) * data.pageSize + 1).toLocaleString()}–{Math.min(total, state.page * data.pageSize).toLocaleString()} of {total.toLocaleString()}</span>
            {pages > 1 && (
              <div className="ml-auto flex items-center gap-1">
                <Button variant="outline" size="sm" className="max-sm:h-10" disabled={state.page <= 1} onClick={() => setState({ ...state, page: state.page - 1 })} aria-label="Previous page"><ChevronLeft /></Button>
                <span className="px-2 tabular-nums">Page {state.page} of {pages.toLocaleString()}</span>
                <Button variant="outline" size="sm" className="max-sm:h-10" disabled={state.page >= pages} onClick={() => setState({ ...state, page: state.page + 1 })} aria-label="Next page"><ChevronRight /></Button>
              </div>
            )}
          </div>
        </div>
      )}

      <FilterBuilder open={builder} onOpenChange={setBuilder} scope={scope} predictable={predictable} value={state.filter} noun={p.noun}
        onApply={(filter) => setState({ ...state, filter, filterError: null, filterRaw: null, page: 1 })} countFor={countFor} />
      <Panel open={columns} onOpenChange={setColumns}
        title={<span className="flex items-center gap-2"><Columns3 className="size-5 text-sky-500" /> Choose statistics</span>}
        description="Tick any stat to show it as a column. Your choice is remembered for this table on this device."
        footer={(
          <div className="flex items-center gap-2">
            <span className="mr-auto text-sm text-text-muted"><span className="font-semibold text-text-base">{cols.length}</span> columns</span>
            <Button variant="ghost" size="sm" onClick={() => setCols(null)}>Reset to default</Button>
            <Button size="sm" onClick={() => setColumns(false)}>Done</Button>
          </div>
        )}>
        <StatPicker scope={scope} predictable={predictable} mode="multi" selected={new Set(cols)} className="flex-1"
          onPick={(k) => setCols(cols.includes(k) ? cols.filter((x) => x !== k) : [...cols, k])} />
      </Panel>
    </div>
  );
}

const countConds = (g: FilterGroup): number => g.children.reduce((a, c) => a + (c.kind === "cond" ? 1 : countConds(c)), 0);

function Problem({ title, detail, onClear, clearLabel = "Clear filters" }: { title: string; detail: string; onClear: () => void; clearLabel?: string }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-danger/40 bg-danger/[0.05] px-6 py-10 text-center" role="alert">
      <p className="font-medium">{title}</p>
      <p className="mt-1 max-w-lg font-mono text-xs text-text-muted">{detail}</p>
      <Button className="mt-4" onClick={onClear}><X /> {clearLabel}</Button>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-1.5 rounded-xl border border-line bg-card p-3" aria-busy="true" aria-label="Loading records">
      {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton h-8 rounded-md" />)}
    </div>
  );
}

// Header cells carry their own background and draw the line under them as a shadow (the floating copy of the
// header row, FloatingHead, reuses them).
const th = "bg-card shadow-[inset_0_-2px_0_color-mix(in_srgb,var(--color-text-base)_20%,transparent)] h-12 whitespace-nowrap px-5 pb-2.5 align-bottom text-[11px] font-bold uppercase tracking-wider";
// Grid lines a step stronger than the app's hairlines: rows and columns stay easy to follow across a wide table.
const grid = "border-text-base/15";
const sticky = "sticky left-0 z-10 bg-card shadow-[1px_0_0_color-mix(in_srgb,var(--color-text-base)_22%,transparent)]";

function SortHead({ k, label, title, state, sortBy, className, tone, align = "right" }: { k: string | null; label: ReactNode; title?: string; state: TableState; sortBy: (k: string) => void; className?: string; tone?: string; align?: "left" | "right" }) {
  const on = k != null && state.sort === k;
  const Arrow = on ? (state.dir === "asc" ? ArrowUp : ArrowDown) : null;
  return (
    <th scope="col" aria-sort={on ? (state.dir === "asc" ? "ascending" : "descending") : "none"} className={cn(th, align === "right" ? "text-right" : "text-left", className)}>
      {k ? (
        <button type="button" onClick={() => sortBy(k)} title={title} className={cn("group inline-flex flex-col gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring/60", align === "right" ? "items-end" : "items-start")}>
          <span className={cn("inline-flex items-center gap-1", tone ?? "text-text-muted", "group-hover:brightness-125", align === "right" && "flex-row-reverse")}>
            {label}{Arrow ? <Arrow className="size-3.5 text-accent" strokeWidth={3} /> : <ArrowUpDown className="size-3 opacity-0 group-hover:opacity-60" />}
          </span>
        </button>
      ) : <span className="text-text-muted">{label}</span>}
    </th>
  );
}

function Table({ data, scope, cols, state, sortBy, code, highlightTeam, selectable, selected, onSelect }: {
  data: Resp; scope: RecordScope; cols: string[]; state: TableState; sortBy: (k: string) => void; code?: string;
  highlightTeam?: number | null; selectable: boolean; selected: number[]; onSelect: (t: number) => void;
}) {
  const showEvent = scope === "teamEvent" && !code;
  const { ref, more } = useMoreToTheRight();
  const tableRef = useRef<HTMLTableElement>(null);
  const headRow = (
          <tr>
            {scope === "match" ? (
              <>
                <SortHead k="eventName" label="Match" state={state} sortBy={sortBy} align="left" className={sticky} />
                <SortHead k={null} label={<span className="text-red-alliance">Red</span>} state={state} sortBy={sortBy} align="left" />
                <SortHead k={null} label={<span className="text-blue-alliance">Blue</span>} state={state} sortBy={sortBy} align="left" />
              </>
            ) : (
              <>
                <SortHead k="teamNumber" label="Team" state={state} sortBy={sortBy} align="left" className={sticky} />
                {showEvent && <SortHead k="eventName" label="Event" state={state} sortBy={sortBy} align="left" />}
              </>
            )}
            {cols.map((k) => {
              const d = STAT_BY_KEY.get(k);
              const tone = TONE_CLASS[toneOf(d)];
              return (
                <SortHead key={k} k={k} state={state} sortBy={sortBy} tone={tone.text} title={`${d?.label}${d?.description ? ` — ${d.description}` : ""}`}
                  className={cn("relative border-l border-text-base/[0.08]", state.sort === k && "bg-accent/[0.06]")}
                  label={<>{d?.category === "Control Scout Exclusives" && <Sparkles className="size-3" />}{headerOf(d, k)}<span aria-hidden className={cn("absolute inset-x-2 bottom-0 h-0.5 rounded-full", tone.bar, state.sort === k ? "opacity-100" : "opacity-50")} /></>} />
              );
            })}
          </tr>
  );
  return (
    <div className="relative">
    {/* The column labels follow you down the page: a copy of the header row pinned under the top bar
        (the table itself scrolls sideways, which a sticky <thead> can't escape). */}
    <FloatingHead table={tableRef} scroller={ref}>{headRow}</FloatingHead>
    <TopScrollbar table={tableRef} scroller={ref} />
    <div ref={ref} className={cn("custom-scrollbar overflow-x-auto overscroll-x-contain rounded-xl border bg-card", grid)}>
      <table ref={tableRef} className="w-full border-collapse text-sm">
        <thead>
{headRow}
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const team = "team" in r ? r.team : null;
            const hl = team != null && team === highlightTeam;
            const sel = team != null && selected.includes(team);
            return (
              <tr key={"key" in r ? `${r.eventCode}:${r.key}` : `${team}:${"eventCode" in r ? r.eventCode : ""}`}
                className={cn("group/row border-b last:border-b-0", grid, "still-hover:bg-text-base/[0.03]", hl && "bg-accent/[0.07]", sel && "bg-sky-500/[0.07]")}>
                {"key" in r ? (
                  <>
                    <td className={cn(sticky, "density-row px-5 py-3 row-still-hover:bg-[color-mix(in_srgb,var(--color-card)_97%,var(--color-text-base))]")}>
                      <Link to={`/events/${r.season}/${r.eventCode}?match=${encodeURIComponent(r.key)}`} className="block max-w-[13rem] still-hover:text-accent">
                        <span className="font-semibold">{r.label}</span>
                        <span className="block truncate text-xs text-text-muted">{r.eventName}</span>
                      </Link>
                    </td>
                    <td className="density-row whitespace-nowrap px-5 py-3"><Alliance teams={r.red} season={r.season} side="red" /></td>
                    <td className="density-row whitespace-nowrap px-5 py-3"><Alliance teams={r.blue} season={r.season} side="blue" /></td>
                  </>
                ) : (
                  <>
                    <td className={cn(sticky, "density-row px-5 py-3", hl && "bg-[color-mix(in_srgb,var(--color-card)_92%,var(--color-accent))]")}>
                      <div className="flex items-center gap-2.5">
                        {selectable && (
                          <input type="checkbox" checked={sel} onChange={() => onSelect(team!)} aria-label={`Select ${team} to compare`}
                            className="size-4 shrink-0 cursor-pointer accent-[var(--color-accent)] max-sm:size-5" />
                        )}
                        <Link to={`/teams/${team}?season=${r.season}`} className="flex min-w-0 items-baseline gap-2 still-hover:text-accent">
                          <span className="font-mono font-semibold tabular-nums">{team}</span>
                          <span className="max-w-[6.5rem] truncate text-text-muted sm:max-w-[13rem]">{String(r.stats.teamName ?? "")}</span>
                        </Link>
                      </div>
                    </td>
                    {showEvent && "eventCode" in r && (
                      <td className="density-row px-5 py-3">
                        <Link to={`/events/${r.season}/${r.eventCode}`} className="block max-w-[16rem] still-hover:text-accent">
                          <span className="block truncate">{r.eventName}</span>
                          <span className="block text-xs text-text-muted">{dateRange(r.eventStart)}</span>
                        </Link>
                      </td>
                    )}
                  </>
                )}
                {cols.map((k) => {
                  const d = STAT_BY_KEY.get(k);
                  const v = r.stats[k];
                  const tone = toneOf(d);
                  return (
                    <td key={k} className={cn("density-row whitespace-nowrap border-l border-text-base/[0.08] px-5 py-3 text-right tabular-nums", d?.type === "text" && "text-left", state.sort === k && "bg-accent/[0.04] font-semibold",
                      tone !== "slate" && v != null && TONE_CLASS[tone].text)}>
                      {formatStat(d, v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {/* More columns off to the right: a fade at the edge says so (gone once you've scrolled to the end). */}
    <div aria-hidden className={cn("pointer-events-none absolute inset-y-px right-px w-16 rounded-r-xl bg-gradient-to-l from-card to-transparent transition-opacity", more ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

/**
 * A copy of the header row, pinned just under the shell's sticky top bar once the real one has scrolled off it,
 * until the table itself has gone by. Its columns take the real header's measured widths, and it scrolls
 * sideways with the table. Clicking a label sorts, like the real one.
 */
function FloatingHead({ table, scroller, children }: { table: RefObject<HTMLTableElement | null>; scroller: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const clip = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState<{ widths: number[]; width: number } | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = table.current, sc = scroller.current;
    if (!t || !sc) return;
    // The page scrolls the document, under the shell's sticky top bar: its bottom edge is where labels pin.
    const measure = () => {
      const cells = [...(t.tHead?.rows[0]?.cells ?? [])];
      setCols({ widths: cells.map((c) => c.getBoundingClientRect().width), width: t.getBoundingClientRect().width });
    };
    const place = () => {
      const head = t.tHead?.getBoundingClientRect(), all = t.getBoundingClientRect();
      const top = pageTop();
      setShow(!!head && head.bottom < top && all.bottom > top + head.height * 2);
      if (clip.current) clip.current.scrollLeft = sc.scrollLeft;
    };
    measure(); place();
    // Every header cell is watched, not just the table: adding or removing a column can reflow the others
    // while a full-width table keeps its size. Cells that come and go are picked up as the row changes.
    const ro = new ResizeObserver(() => { measure(); place(); });
    const watch = () => { ro.disconnect(); ro.observe(t); for (const c of t.tHead?.rows[0]?.cells ?? []) ro.observe(c); };
    watch();
    const mo = new MutationObserver(() => { watch(); measure(); });
    if (t.tHead) mo.observe(t.tHead, { childList: true, subtree: true });
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    sc.addEventListener("scroll", place, { passive: true });
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener("scroll", place); window.removeEventListener("resize", place); sc.removeEventListener("scroll", place); };
  }, [table, scroller]);
  // The copy is for the eye and the mouse: the real header (and its sort buttons) is what keyboards and
  // screen readers use, so the copy's buttons stay out of the tab order (and it is aria-hidden).
  useEffect(() => { clip.current?.querySelectorAll("button").forEach((b) => { b.tabIndex = -1; }); });
  return (
    <div className="sticky top-(--header-h) z-30 h-0">
      <div ref={clip} aria-hidden className={cn("absolute inset-x-0 top-0 overflow-hidden rounded-t-xl border bg-card shadow-[0_8px_16px_-8px_rgb(0_0_0/0.5)] transition-opacity", grid,
        show && cols ? "opacity-100" : "invisible opacity-0")}>
        {cols && (
          <table className="border-collapse text-sm" style={{ width: cols.width, tableLayout: "fixed" }}>
            <colgroup>{cols.widths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>{children}</thead>
          </table>
        )}
      </div>
    </div>
  );
}

/** Whether a sideways-scrolling box has more to show to the right. */
function useMoreToTheRight() {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", check); ro.disconnect(); };
  }, []);
  return { ref, more };
}

function Alliance({ teams, season, side }: { teams: number[]; season: number; side: "red" | "blue" }) {
  return (
    <span className="inline-flex gap-1">
      {teams.map((t) => (
        <Link key={t} to={`/teams/${t}?season=${season}`} className={cn("rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums still-hover:brightness-125", side === "red" ? "bg-red-alliance/12 text-red-alliance" : "bg-blue-alliance/12 text-blue-alliance")}>{t}</Link>
      ))}
    </span>
  );
}

/**
 * A sideways scrollbar above a wide table, moving with the table's own (at the bottom, often a screen or
 * more away). Drawn rather than native, so it's visible on systems whose scrollbars only show while
 * scrolling: drag the thumb or click the track. Only there while the table is wider than its box. Hidden
 * from screen readers and the tab order: the table itself scrolls by keyboard, and this only mirrors it.
 */
export function TopScrollbar({ table, scroller }: { table: RefObject<HTMLTableElement | null>; scroller: RefObject<HTMLDivElement | null> }) {
  const track = useRef<HTMLDivElement>(null);
  const [m, setM] = useState<{ inner: number; outer: number; left: number; tw: number } | null>(null);
  useEffect(() => {
    const t = table.current, s = scroller.current;
    if (!t || !s) return;
    const measure = () => setM({ inner: t.scrollWidth, outer: s.clientWidth, left: s.scrollLeft, tw: track.current?.clientWidth ?? 0 });
    measure();
    s.addEventListener("scroll", measure, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(t); ro?.observe(s);
    if (track.current) ro?.observe(track.current);
    return () => { s.removeEventListener("scroll", measure); ro?.disconnect(); };
  }, [table, scroller]);
  const wide = !!m && m.inner > m.outer + 1;
  // The thumb's share of the track is the visible share of the table (at least 2.5 rem, to grab).
  const tw = m?.tw ?? 0;
  const thumb = wide ? Math.max(40, (m.outer / m.inner) * tw) : 0;
  const range = Math.max(1, m ? m.inner - m.outer : 1);
  const x = wide ? (m.left / range) * Math.max(0, tw - thumb) : 0;
  const scrollTo = (left: number) => { const s = scroller.current; if (s) s.scrollLeft = Math.max(0, Math.min(range, left)); };
  const drag = useRef<{ x: number; left: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!wide || !m) return;
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const at = e.clientX - box.left;
    // On the track beside the thumb: jump there (centred), then drag from it.
    if (at < x || at > x + thumb) scrollTo(((at - thumb / 2) / Math.max(1, tw - thumb)) * range);
    drag.current = { x: e.clientX, left: scroller.current?.scrollLeft ?? 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) scrollTo(d.left + ((e.clientX - d.x) / Math.max(1, tw - thumb)) * range);
  };
  const end = () => { drag.current = null; };
  return (
    <div ref={track} aria-hidden data-records-topbar="" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}
      className={cn("relative cursor-pointer touch-none select-none rounded-full bg-text-base/[0.07]", wide ? "mb-1.5 h-2.5" : "invisible h-0")}>
      <div data-records-thumb="" className="absolute inset-y-0 rounded-full bg-text-base/30 transition-colors hover:bg-text-base/45" style={{ width: thumb, transform: `translateX(${x}px)` }} />
    </div>
  );
}
