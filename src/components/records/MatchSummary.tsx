// /matches on a phone: one card per match instead of a table wider than the screen. Each card says
// which match it is, both alliances (every team its own link), the score or that it isn't played yet,
// who won, how that compares with the prediction (with the confidence tier it was recorded with), and opens the match report. The chosen columns sit
// behind "More stats", and "Detailed table" brings the full table back (RecordsTable).
import { useCallback, useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, FileText, LayoutList, Sparkles, Table2, Trophy } from "lucide-react";
import { STAT_BY_KEY, statFor, type MatchRecordRow } from "../../shared/statCatalog";
import { formatStat, headerOf, TONE_CLASS, toneOf } from "../../lib/records/describe";
import { matchOutcome, PREDICTION_FIELD, VERDICT_LABEL, type Side } from "../../lib/records/matchOutcome";
import type { TableState } from "../../lib/records/urlState";
import { entryKey } from "../../lib/pageScroll";
import { matchTime } from "../../lib/format";
import { Button } from "../ui/button";
import { TierMark } from "../predict";
import { cn } from "../cn";
import { PredictionValue } from "./PredictionValue";

/** Phones (below Tailwind's sm): where the summary replaces the table. */
export const PHONE_QUERY = "(max-width: 639px)";

/** Whether the window is phone-sized, following it as it changes (a phone turned, a narrowed window). */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(PHONE_QUERY).matches);
  useEffect(() => {
    const m = window.matchMedia?.(PHONE_QUERY);
    if (!m) return;
    const on = () => setPhone(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, []);
  return phone;
}

export type Layout = "summary" | "table";
const LAYOUT_KEY = (k: string) => `cs-records-layout:${k}`;

/** The phone layout chosen for a table on this device: the summary unless "Detailed table" was picked. */
export function useLayout(storageKey: string): [Layout, (l: Layout) => void] {
  const [layout, setLayout] = useState<Layout>(() => {
    try { return localStorage.getItem(LAYOUT_KEY(storageKey)) === "table" ? "table" : "summary"; } catch { return "summary"; }
  });
  const set = useCallback((l: Layout) => {
    setLayout(l);
    try { if (l === "table") localStorage.setItem(LAYOUT_KEY(storageKey), l); else localStorage.removeItem(LAYOUT_KEY(storageKey)); } catch { /* storage blocked: this visit only */ }
  }, [storageKey]);
  return [layout, set];
}

/** Summary or detailed table: two pressed-state buttons, each 44px tall. */
export function LayoutToggle({ layout, onChange }: { layout: Layout; onChange: (l: Layout) => void }) {
  const item = (l: Layout, label: string, Icon: typeof Table2, tone: string) => (
    <button type="button" aria-pressed={layout === l} onClick={() => onChange(l)}
      className={cn("inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60",
        layout === l ? "bg-accent text-accent-ink shadow-[0_4px_16px_color-mix(in_srgb,var(--color-accent)_25%,transparent)]" : "text-text-muted hover:bg-text-base/[0.06] hover:text-text-base")}>
      <Icon className={cn("size-4 shrink-0 max-[359px]:hidden", layout === l ? "" : tone)} aria-hidden />{label}
    </button>
  );
  return (
    <div role="group" aria-label="Layout" className="flex gap-1 rounded-xl border border-line bg-card p-1" data-records-layout="">
      {item("summary", "Summary", LayoutList, "text-violet-500")}
      {item("table", "Detailed table", Table2, "text-sky-500")}
    </div>
  );
}

/** Sorting for the summary (the table sorts from its column headers): a stat and a direction. */
export function SummarySort({ state, options, onSort }: { state: TableState; options: { key: string; label: string }[]; onSort: (sort: string, dir: "asc" | "desc") => void }) {
  const id = useId();
  const asc = state.dir === "asc";
  const list = options.some((o) => o.key === state.sort) ? options : [{ key: state.sort, label: STAT_BY_KEY.get(state.sort)?.label ?? state.sort }, ...options];
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="shrink-0 text-sm text-text-muted">Sort by</label>
      <select id={id} value={state.sort} onChange={(e) => onSort(e.target.value, state.dir)}
        className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-card px-2 text-sm font-medium text-text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
        {list.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      <Button variant="secondary" className="h-11 shrink-0 px-3" onClick={() => onSort(state.sort, asc ? "desc" : "asc")}
        aria-label={`Sort direction: ${asc ? "low to high" : "high to low"}. Switch`}>
        {asc ? <ArrowUpNarrowWide className="text-accent" /> : <ArrowDownWideNarrow className="text-accent" />}
        <span aria-hidden className="max-[359px]:hidden">{asc ? "Low → high" : "High → low"}</span>
      </Button>
    </div>
  );
}

const OPEN_KEY = (entry: string) => `cs-records-open:${entry}`;

/**
 * The rows opened with "More stats", kept with the history entry for the tab's session: back from a
 * match report, the same cards are open again (and the page's restored scroll lands where it was).
 */
function useOpenRows() {
  const loc = useLocation();
  const key = OPEN_KEY(entryKey(loc));
  const read = (k: string): string[] => {
    try { const v = JSON.parse(sessionStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
  };
  const [open, setOpen] = useState<{ key: string; rows: string[] }>(() => ({ key, rows: read(key) }));
  // Another entry (a new page of rows, a new sort): its own set.
  const rows = open.key === key ? open.rows : read(key);
  const toggle = (row: string) => {
    const next = rows.includes(row) ? rows.filter((r) => r !== row) : [...rows, row];
    setOpen({ key, rows: next });
    try { if (next.length) sessionStorage.setItem(key, JSON.stringify(next)); else sessionStorage.removeItem(key); } catch { /* storage blocked */ }
  };
  return { rows, toggle };
}

const rowKey = (r: MatchRecordRow) => `${r.eventCode}:${r.key}`;
const NAME: Record<Side, string> = { red: "Red", blue: "Blue" };

/**
 * The red alliance's text colour on these cards (this component's own token; the shared alliance colour
 * stays as it is for fills and bars). On dark, #f43f5e on its own 15% tint is 4.43:1, under WCAG AA's 4.5:1
 * for the 12px verdict and 14px team numbers, so dark text takes the lighter #fb7185 (6.05:1). Light
 * (#be123c, 4.82:1 on the tint) passes as it is. Blue reads at 4.7:1 or more in both themes.
 */
export const RED_INK_TOKEN = "[--summary-red-ink:var(--color-red-alliance)] dark:[--summary-red-ink:#fb7185]";
const RED_INK = "text-[var(--summary-red-ink)]";

export function MatchSummaryList({ rows, cols }: { rows: MatchRecordRow[]; cols: string[] }) {
  const { rows: open, toggle } = useOpenRows();
  return (
    <ul className={cn("space-y-2.5", RED_INK_TOKEN)} aria-label="Matches" data-records-summary="">
      {rows.map((r) => (
        <li key={rowKey(r)}>
          <MatchCard r={r} cols={cols} open={open.includes(rowKey(r))} onToggle={() => toggle(rowKey(r))} />
        </li>
      ))}
    </ul>
  );
}

function MatchCard({ r, cols, open, onToggle }: { r: MatchRecordRow; cols: string[]; open: boolean; onToggle: () => void }) {
  const id = useId();
  const o = matchOutcome(r);
  const report = `/events/${r.season}/${r.eventCode}/match/${encodeURIComponent(r.key)}`;
  const when = o.played ? "" : matchTime(r.time);
  const details = cols.filter((k) => statFor(k, "match"));
  const p = o.prediction;
  return (
    <article aria-labelledby={`${id}-t`} className={cn("overflow-hidden rounded-xl border border-line bg-card",
      o.winner === "red" ? "shadow-[inset_3px_0_0_var(--color-red-alliance)]" : o.winner === "blue" ? "shadow-[inset_3px_0_0_var(--color-blue-alliance)]" : "")}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 pt-3">
        <div className="min-w-0 flex-1">
          <h3 id={`${id}-t`} className="font-semibold leading-tight">
            {r.label}<span className="sr-only">, {r.eventName}</span>
          </h3>
          <p aria-hidden className="line-clamp-2 text-xs text-text-muted">{r.eventName}</p>
        </div>
        <p className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-bold",
          o.winner === "red" ? cn("bg-red-alliance/15", RED_INK) : o.winner === "blue" ? "bg-blue-alliance/15 text-blue-alliance" : o.played ? "bg-violet-500/15 text-violet-600 dark:text-violet-400" : "bg-text-base/[0.07] text-text-muted")}>
          {o.headline}{when && <span className="font-medium">, {when}</span>}
        </p>
      </header>

      <div className="mt-2 space-y-1.5 px-3">
        <AllianceLine side="red" teams={r.red} season={r.season} score={o.red} won={o.winner === "red"} played={o.played} />
        <AllianceLine side="blue" teams={r.blue} season={r.season} score={o.blue} won={o.winner === "blue"} played={o.played} />
      </div>

      {p && (
        <p className="mx-3 mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" title="Predicted using only the matches before it (replayed afterward; not a live call)">
          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold",
            p.verdict === "called" ? "bg-success/15 text-success" : p.verdict === "upset" ? "bg-warning/15 text-warning" : "bg-accent/15 text-accent-text")}>
            <Sparkles className="size-3" aria-hidden />{VERDICT_LABEL[p.verdict]}
          </span>
          <span className="text-text-base"><span className="sr-only">Result versus prediction: </span>{p.text}</span>
          {p.tier && <TierMark tier={p.tier} chip />}
          <span className="text-text-muted">(replayed call)</span>
        </p>
      )}

      <div className="mt-3 flex gap-2 border-t border-line px-3 py-2.5">
        <Button asChild className="h-11 flex-1">
          <Link to={report}><FileText /> Report<span className="sr-only">: {r.label}, {r.eventName}</span></Link>
        </Button>
        <Button variant="secondary" className="h-11 flex-1" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-d`}>
          <ChevronDown className={cn("transition-transform", open && "rotate-180")} /> {open ? "Fewer stats" : "More stats"}
          <span className="sr-only"> for {r.label}</span>
        </Button>
      </div>
      <div id={`${id}-d`} hidden={!open}>
        {open && (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line bg-text-base/[0.02] px-3 py-3 text-sm">
            {details.map((k) => {
              const d = STAT_BY_KEY.get(k);
              const v = r.stats[k];
              const tone = toneOf(d);
              return (
                <div key={k} className="min-w-0">
                  <dt className={cn("truncate text-[11px] font-bold uppercase tracking-wider", TONE_CLASS[tone].text)} title={d?.label}>{headerOf(d, k)}</dt>
                  <dd className="font-semibold tabular-nums">{k === PREDICTION_FIELD ? <PredictionValue text={formatStat(d, v)} tier={r.predictionTier} /> : formatStat(d, v)}</dd>
                </div>
              );
            })}
            <div className="col-span-2">
              <Link to={`/events/${r.season}/${r.eventCode}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent-text underline-offset-4 still-hover:underline">
                Open {r.eventName}
              </Link>
            </div>
          </dl>
        )}
      </div>
    </article>
  );
}

function AllianceLine({ side, teams, season, score, won, played }: { side: Side; teams: number[]; season: number; score: number | null; won: boolean; played: boolean }) {
  const red = side === "red";
  return (
    <div className={cn("flex items-center gap-2 rounded-lg border-l-4 py-0.5 pl-2 pr-2.5",
      red ? "border-red-alliance" : "border-blue-alliance",
      won ? (red ? "bg-red-alliance/15" : "bg-blue-alliance/15") : (red ? "bg-red-alliance/[0.06]" : "bg-blue-alliance/[0.06]"))}>
      <ul aria-label={`${NAME[side]} alliance`} className="flex min-w-0 flex-wrap gap-0.5">
        {teams.map((t) => (
          <li key={t}>
            <Link to={`/teams/${t}?season=${season}`} aria-label={`Team ${t}`}
              className={cn("inline-flex h-11 min-w-11 items-center justify-center rounded-md px-1.5 font-mono text-sm font-semibold tabular-nums outline-none still-hover:underline focus-visible:ring-2 focus-visible:ring-ring/60",
                red ? RED_INK : "text-blue-alliance")}>{t}</Link>
          </li>
        ))}
      </ul>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {won && <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-bold uppercase", red ? RED_INK : "text-blue-alliance")}><Trophy className="size-3.5" aria-hidden />Won</span>}
        <span className={cn("text-xl tabular-nums", won ? "font-extrabold text-text-base" : "font-semibold text-text-muted")}>
          {played ? score : "–"}
          <span className="sr-only"> points, {NAME[side]}</span>
        </span>
      </span>
    </div>
  );
}
