// The Pick list view of a workspace's scout space (?view=picklist; Task 11): one ordered list of teams
// per season that every member sees and edits, live. Built from the Shortlist's own rows (PickRows,
// useReorder, TeamDetail, NoteField): drag or arrow keys to rank, inline OPR and world rank, a panel that
// opens in place, and a shared note on each pick with who wrote it and when.
import { useCallback, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Copy, GripVertical, LayoutGrid, List, ListOrdered, Loader2, Plus, Scale } from "lucide-react";
import { useApi, qs } from "../../lib/api";
import { compareHref, moveItem, readView, saveView, type ShortlistView } from "../../lib/shortlist";
import { displayOrder, usePickList } from "../../lib/sharedPicklist";
import type { LiveMode } from "../../lib/scoutLive";
import { agoShort } from "../../lib/format";
import { useNow } from "../../lib/useNow";
import { lookupTeamName, TeamInput } from "../TeamInput";
import { teamError } from "../../lib/teamCheck";
import { MAX_PICK_NOTE, MAX_PICKS, moveOpFor, type Pick, type PickPerson } from "../../shared/picklist";
import type { ShortlistTeam } from "../../shared/api";
import { useReorder } from "../shortlist/useReorder";
import { NoteField } from "../shortlist/NoteField";
import { TeamDetail } from "../shortlist/TeamDetail";
import { GridCard, ListHeader, ListRow, MAX_COMPARE } from "../shortlist/PickRows";
import { Section, EmptyState } from "../page";
import { ErrorState, LoadingBlock } from "../states";
import { Button } from "../ui/button";
import { ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { toast } from "../ui/sonner";
import { cn } from "../cn";

const isPhone = () => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 639px)").matches;
const who = (p: PickPerson | null, me: PickPerson) => (!p ? "" : p.accountId != null && p.accountId === me.accountId ? "you" : p.name || "a member");

/** The shared note, and who added the team and last wrote the note. */
function SharedNote({ pick, me, onSave, unsaved, saved }: {
  pick: Pick; me: PickPerson; onSave: (text: string) => void;
  /** This member's note the server didn't take, and the note the server has: the field keeps the first, marked unsaved. */
  unsaved?: string; saved?: string;
}) {
  const now = useNow();
  const noteBy = pick.note && pick.noteBy && pick.noteUpdatedAt != null ? `note by ${who(pick.noteBy, me)} · ${agoShort(pick.noteUpdatedAt, now)}` : null;
  return (
    <div className="min-w-0">
      <NoteField team={pick.team} value={unsaved ?? pick.note} stored={unsaved !== undefined ? saved ?? "" : pick.note} onSave={onSave}
        failedText="Not saved. Your text is still here: press Enter to try again, or Escape to put back the saved note." label={`Shared note on team ${pick.team}, seen by the whole workspace`} placeholder="Add a note for the team…" maxLength={MAX_PICK_NOTE} />
      <p className="truncate px-1.5 text-[11px] text-text-muted" title={new Date(pick.addedAt).toLocaleString()}>
        Added by {who(pick.addedBy, me)}{noteBy ? ` · ${noteBy}` : ""}
      </p>
    </div>
  );
}

export function SharedPicklist({ workspaceId, workspaceName, season, live, me, shortlist }: {
  workspaceId: string; workspaceName: string; season: number; live: LiveMode;
  /** This member (attributes their own changes until the server confirms them). */
  me: PickPerson;
  /** This member's personal shortlist (for "Copy from my shortlist"); never changed here. */
  shortlist: number[];
}) {
  const refused = useCallback((m: string) => { toast.error(m); }, []);
  const pl = usePickList(workspaceId, season, live, me, refused);
  const picks = pl.list?.picks ?? [];
  const teams = useMemo(() => picks.map((p) => p.team), [picks]);
  const byPick = new Map(picks.map((p) => [p.team, p]));

  // Stats for the rows (the Shortlist's own request). Reordering doesn't refetch: only a team not yet fetched does.
  const fetched = useRef<{ season: number; set: Set<number>; key: string } | null>(null);
  if (!fetched.current || fetched.current.season !== season || teams.some((t) => !fetched.current!.set.has(t))) {
    fetched.current = { season, set: new Set(teams), key: [...teams].sort((a, b) => a - b).join(",") };
  }
  const data = useApi<{ season: number; teams: ShortlistTeam[] }>(teams.length ? `/api/shortlist${qs({ teams: fetched.current.key, season })}` : null);
  // Every row's stats fetched so far this season: a team added by someone else fetches its own without
  // taking the rows already shown off screen (a note being typed there keeps its focus).
  const stats = useRef<{ season: number; map: Map<number, ShortlistTeam> }>({ season, map: new Map() });
  if (stats.current.season !== season) stats.current = { season, map: new Map() };
  if (data.data?.season === season) for (const t of data.data.teams) stats.current.map.set(t.team, t);
  const byTeam = stats.current.map;

  const [view, setViewState] = useState<ShortlistView>(() => readView(isPhone()));
  const setView = (v: ShortlistView) => { setViewState(v); saveView(v); };
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (t: number) => setOpen((s) => { const n = new Set(s); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const [picked, setPicked] = useState<number[]>([]);
  const selected = teams.filter((t) => picked.includes(t));
  const pick = (t: number, on: boolean) => setPicked((p) => {
    const live = p.filter((x) => teams.includes(x));
    return on ? (live.includes(t) || live.length >= MAX_COMPARE ? live : [...live, t]) : live.filter((x) => x !== t);
  });

  const describe = useCallback((t: number) => { const n = byTeam.get(t)?.name; return n ? `${t} ${n}` : `Team ${t}`; }, [byTeam]);
  const change = pl.change;
  // Only picks with a row on screen take part in a drag (one whose stats are still loading has no row to measure).
  // Moves name teams, so a pick left out keeps its place relative to the others.
  const shown = useMemo(() => teams.filter((t) => byTeam.has(t)), [teams, byTeam, data.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const reorder = useReorder({ items: shown, describe, onCommit: useCallback((order: number[], moved: number, to: number, from: number) => change(moveOpFor(moveItem(order, to, from), order, moved)), [change]) });

  const remove = (t: number) => {
    const i = teams.indexOf(t);
    const before = i >= 0 ? teams[i + 1] ?? null : null;
    change({ op: "remove", team: t });
    setPicked((p) => p.filter((x) => x !== t));
    toast(`Removed ${describe(t)} from the pick list`, { action: { label: "Undo", onClick: () => change({ op: "add", team: t, beforeTeam: before, restore: true }) } });
  };

  // Add a team.
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    const err = await teamError(adding, lookupTeamName).finally(() => setChecking(false));
    if (err) { setAddError(err); return; }
    const n = Number(adding.trim());
    if (teams.includes(n)) { setAddError(`${n} is already pick ${teams.indexOf(n) + 1}.`); return; }
    if (teams.length >= MAX_PICKS) { setAddError(`The pick list holds ${MAX_PICKS} teams. Remove one first.`); return; }
    change({ op: "add", team: n });
    setAdding(""); setAddError(null);
  };
  const copyable = shortlist.filter((t) => !teams.includes(t));
  const copy = () => {
    change({ op: "import", teams: copyable.slice(0, MAX_PICKS) });
    toast(`Copying ${copyable.length} team${copyable.length === 1 ? "" : "s"} from your shortlist`);
  };

  const compareTeams = selected.length >= 2 ? selected : teams.slice(0, MAX_COMPARE);
  const rows = reorder.order.map((t) => byTeam.get(t)).filter(Boolean) as ShortlistTeam[];
  const missing = teams.filter((t) => !byTeam.has(t));
  // Pick numbers and moves go by the whole list, picks still loading included: the rows shown take their
  // slots in it, in the order a drag in progress would leave them.
  const fullOrder = displayOrder(teams, (t) => byTeam.has(t), reorder.rankOf);
  const rankFor = (t: number) => fullOrder.indexOf(t) + 1;
  /** One place up or down, or to the top or bottom, of the whole list. */
  const moveFull = (team: number, d: number | "top" | "bottom") => {
    const from = teams.indexOf(team);
    if (from < 0) return;
    const to = d === "top" ? 0 : d === "bottom" ? teams.length - 1 : Math.max(0, Math.min(teams.length - 1, from + d));
    if (to !== from) change(moveOpFor(teams, moveItem(teams, from, to), team));
  };
  // All rows on screen: the drag hook's own moves (they animate). Some still loading: by the whole list.
  const move = (team: number, d: number | "top" | "bottom") => (missing.length ? moveFull(team, d) : reorder.moveBy(team, d));
  const KEYS: Record<string, number | "top" | "bottom"> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, Home: "top", End: "bottom" };
  const handleFor = (team: number) => {
    const h = reorder.handleProps(team);
    if (!missing.length) return h;
    return { ...h, onKeyDown: (e: KeyboardEvent<HTMLElement>) => { const d = KEYS[e.key]; if (d === undefined) return; e.preventDefault(); moveFull(team, d); } };
  };
  const common = (t: ShortlistTeam, rank: number) => {
    const p = byPick.get(t.team)!;
    return {
      t, rank, season, open: open.has(t.team), dragging: reorder.dragging === t.team, idPrefix: "picklist",
      note: <SharedNote pick={p} me={me} unsaved={pl.unsavedNote(t.team)} saved={pl.savedNote(t.team)} onSave={(text) => change({ op: "note", team: t.team, note: text })} />,
      selected: selected.includes(t.team), selectDisabled: !selected.includes(t.team) && selected.length >= MAX_COMPARE, onSelect: (on: boolean) => pick(t.team, on),
      onToggle: () => toggle(t.team), onRemove: () => remove(t.team), handle: handleFor(t.team),
      compareLink: compareHref([t.team, ...teams.filter((x) => x !== t.team).slice(0, MAX_COMPARE - 1)], season),
      detail: <TeamDetail t={t} season={season} rank={rank} total={teams.length} topPicks={teams.slice(0, MAX_COMPARE)} onMove={(d) => move(t.team, d)} onRemove={() => remove(t.team)} />,
    };
  };

  const addForm = (
    <form onSubmit={add} className="flex min-w-0 items-start gap-2" aria-label="Add a team to the pick list">
      <div className="w-36 min-w-0 sm:w-40"><TeamInput value={adding} onChange={(v) => { setAdding(v); setAddError(null); }} label="Team number to add" error={addError} /></div>
      <Button type="submit" className="h-11" disabled={!adding || checking}>{checking ? <Loader2 className="animate-spin" /> : <Plus />} Add</Button>
    </form>
  );

  return (
    <Section title={`Pick list (${teams.length})`}
      description={`Shared with everyone in ${workspaceName} for the ${season} season. Anyone can add, remove and reorder; every change shows up for the others as it happens.`}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{reorder.message}</p>
      <div className="mb-3 flex flex-wrap items-start gap-2">
        {addForm}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {copyable.length > 0 && (
            <Button variant="secondary" className="h-11" onClick={copy} disabled={teams.length >= MAX_PICKS}><Copy /> Copy from my shortlist ({copyable.length})</Button>
          )}
          {teams.length >= 2 && <Button variant="secondary" className="h-11" asChild><Link to={compareHref(compareTeams, season)}><Scale /> {selected.length >= 2 ? `Compare (${selected.length})` : `Compare top ${Math.min(MAX_COMPARE, teams.length)}`}</Link></Button>}
          {teams.length > 0 && (
            <ToggleGroup type="single" aria-label="View" value={view} onValueChange={(v) => { if (v) setView(v as ShortlistView); }}>
              <ToggleGroupItem value="list" aria-label="List view"><List /> <span className="max-sm:sr-only">List</span></ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view"><LayoutGrid /> <span className="max-sm:sr-only">Grid</span></ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </div>
      {pl.loading ? <LoadingBlock rows={4} label="Loading the pick list" />
        : pl.error ? <ErrorState error={pl.error} onRetry={pl.reload} />
        : !teams.length ? (
          <EmptyState icon={ListOrdered} title="No picks yet"
            description={shortlist.length ? "Add a team above, or copy your own shortlist in to start the workspace's list." : "Add a team above to start the workspace's list. Everyone in the workspace sees it and can change it."} />
        ) : !byTeam.size && !data.error ? <LoadingBlock rows={Math.min(teams.length, 6)} label="Loading team stats" />
        : data.error && !byTeam.size ? <ErrorState error={data.error} onRetry={data.reload} />
        : (
          <>
            <p className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
              <span><GripVertical className="inline size-3.5 align-[-3px] text-accent" /> Drag the grip (or focus it and use the arrow keys) to rank the picks.</span>
              {pl.saving && <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Saving</span>}
              {live === "live" && <span className="inline-flex items-center gap-1 text-success"><span aria-hidden className="size-1.5 rounded-full bg-success" />Live</span>}
            </p>
            {/* Picks whose stats haven't arrived (one just added by someone): never hidden without saying so. */}
            {missing.length > 0 && (data.error ? (
              <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">Couldn't load {missing.length === 1 ? `team ${missing[0]}` : `${missing.length} picks (${missing.join(", ")})`}: {data.error.message}</span>
                <Button variant="outline" size="sm" onClick={data.reload}>Retry</Button>
              </div>
            ) : (
              <p role="status" className="mb-3 flex items-center gap-1.5 text-xs text-text-muted">
                {data.loading ? <><Loader2 className="size-3 animate-spin" /> Loading {missing.length === 1 ? `team ${missing[0]}` : `${missing.length} picks`}…</>
                  : <>No numbers yet for {missing.join(", ")}.</>}
              </p>
            ))}
            {view === "list" ? (
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <ListHeader />
                <ol ref={reorder.container as RefObject<HTMLOListElement>} className="relative" aria-label="Shared pick list">
                  {rows.map((t) => <ListRow key={t.team} {...common(t, rankFor(t.team))} />)}
                </ol>
              </div>
            ) : (
              <ol ref={reorder.container as RefObject<HTMLOListElement>} className={cn("relative grid gap-3 sm:grid-cols-2 xl:grid-cols-3")} aria-label="Shared pick list">
                {rows.map((t) => <GridCard key={t.team} {...common(t, rankFor(t.team))} />)}
              </ol>
            )}
          </>
        )}
    </Section>
  );
}
