// Shortlist: the pick list for alliance selection. Teams in pick order (drag,
// or arrow keys on the grip, to reorder), each with a private note, an OPR
// trend line, and a panel that opens in place with the OPR split, event by
// event chart, prediction snapshot and last five matches. List or grid view.
// Order and notes live in personal state (this device, synced when signed in).
import { useCallback, useRef, useState, type RefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, Bookmark, CalendarDays, Download, GripVertical, LayoutGrid, List, Scale, Search } from "lucide-react";
import { useSearch } from "../components/layout/Search";
import { useApi, qs } from "../lib/api";
import { useCurrentSeason, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import type { ShortlistTeam } from "../shared/api";
import { PageHeader, EmptyState } from "../components/page";
import { Async } from "../components/states";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/controls";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "../components/ui/overlay";
import { toast } from "../components/ui/sonner";
import { SeasonToggle } from "../components/SeasonToggle";
import { cn } from "../components/cn";
import { downloadCsv } from "../lib/csv";
import { applyOrder, compareHref, readView, saveView, setNote, shortlistCsvRows, type ShortlistView } from "../lib/shortlist";
import { useReorder } from "../components/shortlist/useReorder";
import { GridCard, ListHeader, ListRow, MAX_COMPARE } from "../components/shortlist/PickRows";
import { NoteField } from "../components/shortlist/NoteField";
import { TeamDetail } from "../components/shortlist/TeamDetail";

const MAX_SHOWN = 100;
const isPhone = () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 639px)").matches;

export default function ShortlistPage() {
  useTitle("Shortlist");
  const search = useSearch();
  const { state, update, stored, user } = usePersonal();
  const current = useCurrentSeason();
  const [sp, setSp] = useSearchParams();
  const season = Number(sp.get("season")) || current;
  const list = state.bookmarks;
  const shown = list.slice(0, MAX_SHOWN);
  const notes = state.shortlistNotes;
  // What this device actually stored: a note that differs was refused (storage full) and says so.
  // Unreadable storage is unknown, not empty: the fields then go by each write's result (and Escape never writes "").
  const storedNotes = stored("shortlistNotes");

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
    note: <NoteField team={t.team} value={notes[String(t.team)] ?? ""} stored={storedNotes === undefined ? undefined : (storedNotes?.[String(t.team)] ?? "")} onSave={(text: string) => update("shortlistNotes", (n) => setNote(n, t.team, text))} />,
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
                <span className={cn(view === "list" && "max-sm:hidden")}>Tick up to {MAX_COMPARE} to compare.</span>
                {view === "list" && <span className="sm:hidden">Open a pick to tick it for Compare (up to {MAX_COMPARE}).</span>}
                {list.length > MAX_SHOWN && <span className="text-warning">Showing the first {MAX_SHOWN} of {list.length}.</span>}
              </p>
              {view === "list" ? (
                <div className="overflow-hidden rounded-2xl border border-border bg-card">
                  <ListHeader />
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
