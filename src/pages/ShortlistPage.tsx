// Shortlist: the pick list for alliance selection. Teams in pick order (drag,
// or arrow keys on the grip, to reorder), each with a private note, an OPR
// trend line, and a panel that opens in place with the OPR split, event by
// event chart, prediction snapshot and last five matches. List or grid view.
// Order and notes live in personal state (this device, synced when signed in).
import { useCallback, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, Bookmark, CalendarDays, ChevronDown, Download, ExternalLink, GripVertical, LayoutGrid, List, MapPin, Scale, Search, Trash2 } from "lucide-react";
import { useSearch } from "../components/layout/Search";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { ShortlistTeam } from "../shared/api";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { Checkbox, ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../components/ui/overlay";
import { toast } from "../components/ui/sonner";
import { SeasonToggle } from "../components/SeasonToggle";
import { cn } from "../components/cn";
import { num } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { applyOrder, compareHref, readView, saveView, setNote, shortlistCsvRows, type ShortlistView } from "../lib/shortlist";
import { useReorder } from "../components/shortlist/useReorder";
import { OprSpark } from "../components/shortlist/charts";
import { NoteField } from "../components/shortlist/NoteField";
import { TeamDetail } from "../components/shortlist/TeamDetail";

const MAX_SHOWN = 100;
const MAX_COMPARE = 4;
const isPhone = () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 639px)").matches;

/** Pick number badge: gold, blue, green for the first three, then neutral. */
function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const tone = rank === 1 ? "bg-accent text-accent-ink shadow-[0_2px_10px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
    : rank === 2 ? "bg-info/20 text-info ring-1 ring-info/40"
    : rank === 3 ? "bg-success/20 text-success ring-1 ring-success/40"
    : "bg-muted text-text-base/80 ring-1 ring-border";
  return <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold tabular-nums", tone, className)} aria-label={`Pick ${rank}`}>{rank}</span>;
}

/** Clicks on these don't toggle the row. */
const interactive = (e: MouseEvent) => !!(e.target as HTMLElement).closest("a, button, input, label, [role=checkbox], [data-reorder-handle]");

export default function ShortlistPage() {
  useTitle("Shortlist");
  const search = useSearch();
  const { state, update, user } = usePersonal();
  const current = useCurrentSeason();
  const [sp, setSp] = useSearchParams();
  const season = Number(sp.get("season")) || current;
  const list = state.bookmarks;
  const shown = list.slice(0, MAX_SHOWN);
  const notes = state.shortlistNotes;

  // Reordering or removing doesn't refetch: the request covers a set of teams, refreshed only when one is missing.
  const fetched = useRef<{ season: number; set: Set<number>; key: string } | null>(null);
  if (!fetched.current || fetched.current.season !== season || shown.some((t) => !fetched.current!.set.has(t))) {
    fetched.current = { season, set: new Set(shown), key: [...shown].sort((a, b) => a - b).join(",") };
  }
  const data = useApi<{ season: number; teams: ShortlistTeam[] }>(shown.length ? `/api/shortlist${qs({ teams: fetched.current.key, season })}` : null);
  const byTeam = new Map((data.data?.teams ?? []).map((t) => [t.team, t]));

  const [view, setViewState] = useState<ShortlistView>(() => readView(isPhone()));
  const setView = (v: ShortlistView) => { setViewState(v); saveView(v); };
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (t: number) => setOpen((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const [picked, setPicked] = useState<number[]>([]);
  const selected = shown.filter((t) => picked.includes(t)); // pick order, and only teams still listed
  // Only teams still listed count toward the limit (one removed elsewhere frees its slot).
  const pick = (t: number, on: boolean) => setPicked((p) => {
    const live = p.filter((x) => shown.includes(x));
    return on ? (live.includes(t) || live.length >= MAX_COMPARE ? live : [...live, t]) : live.filter((x) => x !== t);
  });

  const describe = useCallback((t: number) => { const n = byTeam.get(t)?.name; return n ? `${t} ${n}` : `Team ${t}`; }, [byTeam]);
  const reorder = useReorder({ items: shown, describe, onCommit: (order) => update("bookmarks", (b) => applyOrder(b, order)) });

  const remove = (t: number) => {
    const at = list.indexOf(t), note = notes[String(t)];
    update("bookmarks", (b) => b.filter((x) => x !== t));
    if (note) update("shortlistNotes", (n) => setNote(n, t, ""));
    setPicked((p) => p.filter((x) => x !== t));
    toast(`Removed ${describe(t)} from your shortlist`, {
      action: { label: "Undo", onClick: () => {
        update("bookmarks", (b) => (b.includes(t) ? b : [...b.slice(0, at), t, ...b.slice(at)]));
        if (note) update("shortlistNotes", (n) => setNote(n, t, note));
      } },
    });
  };
  const sortBy = (label: string, score: (r: ShortlistTeam) => number | null, asc = false) => {
    const before = [...list];
    const rows = shown.map((t) => byTeam.get(t)).filter(Boolean) as ShortlistTeam[];
    const sorted = [...rows].sort((a, b) => { const x = score(a), y = score(b); if (x == null) return y == null ? 0 : 1; if (y == null) return -1; return asc ? x - y : y - x; }).map((r) => r.team);
    update("bookmarks", (b) => applyOrder(b, sorted));
    toast(`Picks ordered by ${label}`, { action: { label: "Undo", onClick: () => update("bookmarks", (b) => applyOrder(b, before)) } });
  };

  const compareTeams = selected.length >= 2 ? selected : shown.slice(0, MAX_COMPARE);
  const compareLabel = selected.length >= 2 ? `Compare selected (${selected.length})` : `Compare top ${Math.min(MAX_COMPARE, shown.length)}`;
  const rowsFor = (d: { teams: ShortlistTeam[] }) => reorder.order.map((t) => d.teams.find((x) => x.team === t)).filter(Boolean) as ShortlistTeam[];

  const common = (t: ShortlistTeam, rank: number) => ({
    t, rank, season, open: open.has(t.team), dragging: reorder.dragging === t.team,
    note: notes[String(t.team)] ?? "", onNote: (text: string) => update("shortlistNotes", (n) => setNote(n, t.team, text)),
    selected: selected.includes(t.team), selectDisabled: !selected.includes(t.team) && selected.length >= MAX_COMPARE, onSelect: (on: boolean) => pick(t.team, on),
    onToggle: () => toggle(t.team), onRemove: () => remove(t.team), handle: reorder.handleProps(t.team),
    compareLink: compareHref([t.team, ...shown.filter((x) => x !== t.team).slice(0, MAX_COMPARE - 1)], season),
    detail: <TeamDetail t={t} season={season} rank={rank} total={shown.length} topPicks={shown.slice(0, MAX_COMPARE)} onMove={(d) => reorder.moveBy(t.team, d)} onRemove={() => remove(t.team)} />,
  });

  return (
    <div>
      <PageHeader title="Shortlist"
        description={<>Your pick list for alliance selection: drag to rank it, open a team for its numbers, keep private notes. {user ? "Synced to your account." : <>Saved on this device; <Link to="/settings?section=profile" className="underline">sign in</Link> to sync.</>}</>}
        actions={shown.length >= 2 ? <Button variant="secondary" asChild><Link to={compareHref(compareTeams, season)}><Scale /> {compareLabel}</Link></Button> : undefined}>
        {list.length > 0 && (
          <div className="flex flex-wrap items-center gap-2" data-print-hide>
            <SeasonToggle predictOnly value={season} onChange={(s) => setSp((x) => { x.set("season", String(s)); return x; }, { replace: true })} />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="secondary" size="sm" disabled={!data.data}><ArrowDownWideNarrow /> Order picks</Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Reorder the whole list by</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => sortBy("OPR", (r) => r.opr)}>OPR (highest first)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => sortBy("rating", (r) => r.rating)}>Rating (highest first)</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => sortBy("auto OPR", (r) => r.breakdown.auto)}>Auto OPR</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => sortBy("endgame OPR", (r) => r.breakdown.endgame)}>Endgame OPR</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="secondary" size="sm" disabled={!data.data} onClick={() => data.data && downloadCsv(`shortlist-${season}`, shortlistCsvRows(rowsFor(data.data), notes))}><Download /> CSV</Button>
              <ToggleGroup type="single" aria-label="View" value={view} onValueChange={(v) => { if (v) setView(v as ShortlistView); }}>
                <ToggleGroupItem value="list" aria-label="List view"><List /> <span className="max-sm:sr-only">List</span></ToggleGroupItem>
                <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid /> <span className="max-sm:sr-only">Grid</span></ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        )}
      </PageHeader>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{reorder.message}</p>
      {!list.length ? <EmptyState icon={Bookmark} title="Your shortlist is empty" description="Press Shortlist on any team page to add it here. Building a pick list? An event's Rankings tab is the place to start." action={<div className="flex flex-wrap justify-center gap-2"><Button variant="secondary" onClick={search.open}><Search /> Find a team</Button><Button variant="outline" asChild><Link to="/events"><CalendarDays /> Browse events</Link></Button></div>} /> : (
        <Async state={data}>{(d) => {
          const rows = rowsFor(d);
          return (
            <>
              <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                <span><GripVertical className="inline size-3.5 align-[-3px] text-accent" /> Drag the grip (or focus it and use the arrow keys) to rank your picks.</span>
                <span>Tick up to {MAX_COMPARE} to compare.</span>
                {list.length > MAX_SHOWN && <span className="text-warning">Showing the first {MAX_SHOWN} of {list.length}.</span>}
              </p>
              {view === "list" ? (
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  <div aria-hidden className={cn(LIST_COLS, "border-b border-border bg-muted/40 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-text-muted sm:px-3")}>
                    <span /><span>Pick</span><span className="max-sm:hidden" /><span>Team</span><span className="max-md:hidden">Trend</span>
                    <span className="text-right">OPR</span><span className="text-right max-sm:hidden">World</span><span className="text-right max-lg:hidden">Rating</span><span className="text-right max-sm:hidden">W-L-T</span><span />
                  </div>
                  <ol ref={reorder.container as RefObject<HTMLOListElement>} className="relative" aria-label="Pick list">
                    {rows.map((t) => <ListRow key={t.team} {...common(t, reorder.rankOf(t.team))} />)}
                  </ol>
                </div>
              ) : (
                <ol ref={reorder.container as RefObject<HTMLOListElement>} className="relative grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Pick list">
                  {rows.map((t) => <GridCard key={t.team} {...common(t, reorder.rankOf(t.team))} />)}
                </ol>
              )}
            </>
          );
        }}</Async>
      )}
    </div>
  );
}

// Fixed widths (not auto), so every row's grid lines up with the header's.
const LIST_COLS = "grid items-center gap-x-2 grid-cols-[2.5rem_1.75rem_minmax(0,1fr)_3.5rem_2rem] sm:gap-x-3 sm:grid-cols-[2rem_1.75rem_1rem_minmax(0,1fr)_4rem_4.5rem_4rem_4.25rem] md:grid-cols-[2rem_1.75rem_1rem_minmax(0,1fr)_7rem_4rem_4.5rem_4rem_4.25rem] lg:grid-cols-[2rem_1.75rem_1rem_minmax(0,1fr)_8rem_4rem_4.5rem_5rem_4.5rem_4.25rem]";

interface RowProps {
  t: ShortlistTeam; rank: number; season: number; open: boolean; dragging: boolean;
  note: string; onNote: (text: string) => void;
  selected: boolean; selectDisabled: boolean; onSelect: (on: boolean) => void;
  onToggle: () => void; onRemove: () => void;
  /** This team next to the top picks. */
  compareLink: string;
  handle: ReturnType<ReturnType<typeof useReorder>["handleProps"]>;
  detail: ReactNode;
}

function Grip({ t, rank, handle, className }: { t: ShortlistTeam; rank: number; handle: RowProps["handle"]; className?: string }) {
  return (
    <button type="button" {...handle} aria-label={`Reorder ${t.team}${t.name ? ` ${t.name}` : ""}, pick ${rank}. Arrow keys move it; or drag.`}
      aria-roledescription="sortable handle"
      className={cn("flex size-8 cursor-grab touch-none items-center justify-center rounded-lg text-text-muted outline-none transition-colors hover:bg-accent/10 hover:text-accent active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring/60 max-sm:size-10", className)}>
      <GripVertical className="size-4" />
    </button>
  );
}

function SelectBox({ t, selected, selectDisabled, onSelect }: Pick<RowProps, "t" | "selected" | "selectDisabled" | "onSelect">) {
  return <Checkbox checked={selected} disabled={selectDisabled} onCheckedChange={(v) => onSelect(v === true)} aria-label={`Select ${t.team} to compare`} title={selectDisabled ? `Compare takes up to ${MAX_COMPARE} teams` : undefined} />;
}

function ListRow(p: RowProps) {
  const { t, rank, open, dragging } = p;
  const detailsId = `shortlist-${t.team}`;
  return (
    <li data-reorder-key={t.team} className={cn("relative border-b border-border bg-card last:border-b-0", dragging && "z-20 rounded-xl border-transparent shadow-2xl ring-2 ring-accent/70")}>
      <div className={cn(LIST_COLS, "density-row cursor-pointer px-2 py-2 transition-colors hover:bg-accent/[0.06] sm:px-3", open && "bg-accent/[0.05]")}
        onClick={(e) => { if (!interactive(e)) p.onToggle(); }}>
        <Grip t={t} rank={rank} handle={p.handle} />
        <RankBadge rank={rank} />
        <span className="max-sm:hidden"><SelectBox {...p} /></span>
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <Link to={`/teams/${t.team}?season=${p.season}`} className="font-mono text-sm font-semibold hover:text-accent-text hover:underline">{t.team}</Link>
            <span className="truncate text-sm">{t.name ?? "Unknown team"}</span>
            {t.place && <span className="hidden truncate text-xs text-text-muted xl:inline">{t.place}</span>}
          </div>
          <NoteField team={t.team} value={p.note} onSave={p.onNote} className="-ml-1.5 mt-0.5 max-w-md" />
        </div>
        <OprSpark events={t.events} className="max-md:hidden" />
        <span className="text-right font-display text-base font-semibold tabular-nums text-accent-text">{num(t.opr)}</span>
        <span className="text-right text-sm tabular-nums text-info max-sm:hidden">{t.oprRank ? `#${t.oprRank.toLocaleString()}` : "—"}</span>
        <span className="text-right text-sm tabular-nums max-lg:hidden">{t.rating ? <>{num(t.rating)}<span className="text-[11px] text-text-muted"> ±{num(t.ratingSd, 0)}</span></> : "—"}</span>
        <span className="text-right text-sm tabular-nums text-success max-sm:hidden">{t.record ?? "—"}</span>
        <div className="flex items-center justify-end gap-0.5">
          <Button variant="ghost" size="icon-sm" onClick={p.onRemove} aria-label={`Remove ${t.team}`} className="max-sm:hidden hover:text-destructive"><Trash2 /></Button>
          <Button variant="ghost" size="icon-sm" onClick={p.onToggle} aria-expanded={open} aria-controls={detailsId} aria-label={`${open ? "Hide" : "Show"} details for ${t.team}`} className={cn(open && "text-accent-text")}>
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </div>
      </div>
      {open && <div id={detailsId}>{p.detail}</div>}
    </li>
  );
}

function GridCard(p: RowProps) {
  const { t, rank, open, dragging } = p;
  const detailsId = `shortlist-${t.team}`;
  return (
    <li data-reorder-key={t.team} className={cn("relative min-w-0 overflow-hidden rounded-2xl border border-border bg-card transition-shadow", open && "sm:col-span-2 xl:col-span-3", rank === 1 && "border-accent/40", dragging && "z-20 shadow-2xl ring-2 ring-accent/70")}>
      {rank === 1 && <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-accent/10 blur-2xl" />}
      <div className="relative p-3.5">
        <div className="flex items-center gap-2">
          <RankBadge rank={rank} className="size-8 text-sm" />
          <Grip t={t} rank={rank} handle={p.handle} />
          <div className="ml-auto flex items-center gap-2 text-xs text-text-muted"><SelectBox {...p} /><span className="max-sm:sr-only">Compare</span></div>
        </div>
        <div className="mt-2.5 min-w-0">
          <Link to={`/teams/${t.team}?season=${p.season}`} className="group/name flex min-w-0 items-baseline">
            <span className="font-mono text-xl font-bold tabular-nums text-text-base group-hover/name:text-accent-text">{t.team}</span>
            <span className="ml-2 min-w-0 truncate text-sm font-medium group-hover/name:underline">{t.name ?? "Unknown team"}</span>
          </Link>
          {t.place && <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-text-muted"><MapPin className="size-3 shrink-0" />{t.place}</p>}
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-accent/10 px-2.5 py-1.5"><dt className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">OPR</dt><dd className="whitespace-nowrap font-display text-base font-semibold tabular-nums text-accent-text sm:text-lg">{num(t.opr)}</dd></div>
          <div className="rounded-lg bg-info/10 px-2.5 py-1.5"><dt className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">World</dt><dd className="whitespace-nowrap font-display text-base font-semibold tabular-nums text-info sm:text-lg">{t.oprRank ? `#${t.oprRank.toLocaleString()}` : "—"}</dd></div>
          <div className="rounded-lg bg-success/10 px-2.5 py-1.5"><dt className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">W-L-T</dt><dd className="whitespace-nowrap font-display text-base font-semibold tabular-nums text-success sm:text-lg">{t.record ?? "—"}</dd></div>
        </dl>
        <OprSpark events={t.events} interactive width={320} height={44} className="mt-3 min-h-9" />
        <NoteField team={t.team} value={p.note} onSave={p.onNote} className="-mx-1.5 mt-2" />
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
          <Button variant={open ? "default" : "secondary"} size="sm" onClick={p.onToggle} aria-expanded={open} aria-controls={detailsId}>
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} /> {open ? "Less" : "Details"}
          </Button>
          <Button variant="ghost" size="sm" asChild><Link to={p.compareLink} aria-label={`Compare ${t.team} with your top picks`}><Scale /> Compare</Link></Button>
          <Button variant="ghost" size="sm" asChild><Link to={`/teams/${t.team}?season=${p.season}`} aria-label={`Open team ${t.team}`}><ExternalLink /> Team</Link></Button>
          <Button variant="ghost" size="icon-sm" onClick={p.onRemove} aria-label={`Remove ${t.team}`} className="ml-auto hover:text-destructive"><Trash2 /></Button>
        </div>
      </div>
      {open && <div id={detailsId}>{p.detail}</div>}
    </li>
  );
}
