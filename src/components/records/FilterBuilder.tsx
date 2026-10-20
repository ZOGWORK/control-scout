// "Edit filters": FTC Scout's builder mechanics (All/Any groups, + Add
// condition, + Add group, nesting, ×) plus what it lacks: a plain-English
// preview of the filter, a live count of matching rows while editing, inline
// validation per condition, a searchable stat picker with descriptions, and
// saved filters (this device, no login).
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bookmark, CornerDownRight, ListFilter, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { OP_LABELS, parseFilter, serializeFilter, type FilterGroup, type FilterOp } from "../../shared/filterDsl";
import { STAT_BY_KEY, statFor, type RecordScope } from "../../shared/statCatalog";
import { addChild, depthOf, emptyCond, emptyGroup, findCond, fromBuilder, opsFor, removeNode, toBuilder, updateNode, type BCond, type BGroup } from "../../lib/records/builder";
import { describeFilter, TONE_CLASS, toneOf } from "../../lib/records/describe";
import { deleteSaved, kindOf, loadSaved, renameSaved, saveFilter, SAVED_KEY, type SavedFilter } from "../../lib/records/savedFilters";
import { FILTER_LIMITS } from "../../shared/filterDsl";
import { Button } from "../ui/button";
import { Input } from "../ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/controls";
import { toast } from "../ui/sonner";
import { cn } from "../cn";
import { Panel } from "./Panel";
import { StatPicker } from "./StatPicker";

const OP_WORDS: Record<FilterOp, string> = { eq: "equals", ne: "is not", gt: "more than", gte: "at least", lt: "less than", lte: "at most", contains: "contains" };
const DEPTH_BORDER = ["border-accent/60", "border-violet-500/60", "border-sky-400/60", "border-emerald-400/60", "border-orange-400/60", "border-pink-400/60"];

export interface FilterBuilderProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  scope: RecordScope;
  predictable: boolean;
  value: FilterGroup | null;
  onApply: (f: FilterGroup | null) => void;
  /** Rows a filter would match (live count while editing). */
  countFor: (f: FilterGroup | null) => Promise<number>;
  /** "team-events", "teams", "matches". */
  noun: string;
  /** Which side opens: the builder (default) or the saved filters. */
  initialView?: "build" | "saved";
  /** Changes on every request for `initialView`: asked again while open, the builder turns to that side (edits kept). */
  viewRequest?: number;
}

/** Saved filters of a kind, kept in step with other tabs / tables. */
export function useSavedFilters(scope: RecordScope): SavedFilter[] {
  const [list, setList] = useState(() => loadSaved());
  useEffect(() => {
    const fn = () => setList(loadSaved());
    window.addEventListener(SAVED_KEY, fn);
    window.addEventListener("storage", fn);
    return () => { window.removeEventListener(SAVED_KEY, fn); window.removeEventListener("storage", fn); };
  }, []);
  const kind = kindOf(scope);
  return useMemo(() => list.filter((s) => s.kind === kind), [list, kind]);
}

export function FilterBuilder({ open, onOpenChange, scope, predictable, value, onApply, countFor, noun, initialView = "build", viewRequest }: FilterBuilderProps) {
  const [root, setRoot] = useState<BGroup>(() => toBuilder(value));
  const [view, setView] = useState<"build" | "saved">(initialView);
  // Fresh from the table's filter every time the builder opens.
  useEffect(() => { if (open) { setRoot(toBuilder(value)); setView(initialView); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // A side asked for while the builder is already open (the phone sheet's Saved filters / Add a condition).
  const seenRequest = useRef(viewRequest);
  useEffect(() => {
    if (viewRequest === seenRequest.current) return;
    seenRequest.current = viewRequest;
    if (open) setView(initialView);
  }, [viewRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  const { filter, errors } = useMemo(() => fromBuilder(root, scope), [root, scope]);
  const conds = useMemo(() => { let n = 0; const walk = (g: BGroup) => g.children.forEach((c) => (c.kind === "cond" ? n++ : walk(c))); walk(root); return n; }, [root]);
  const key = filter ? serializeFilter(filter) : "";
  const [count, setCount] = useState<{ key: string; n: number | null; loading: boolean }>({ key: "", n: null, loading: false });
  useEffect(() => {
    if (!open || errors.has(root.id)) return;
    setCount((c) => ({ ...c, loading: true }));
    let live = true;
    const t = setTimeout(() => {
      countFor(filter).then((n) => { if (live) setCount({ key, n, loading: false }); }, () => { if (live) setCount({ key, n: null, loading: false }); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
    // countFor changes with the page's own filters (season, region, type, dates), which stay editable while
    // the panel is open: the count follows them too.
  }, [open, key, countFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const saved = useSavedFilters(scope);
  const incomplete = [...errors.keys()].filter((k) => k !== root.id).length;
  const rootError = errors.get(root.id);
  const sentence = describeFilter(filter, scope);
  const apply = () => { onApply(filter); onOpenChange(false); };
  const countText = count.n == null ? "—" : count.n.toLocaleString();

  // The condition whose stat is being chosen: the picker takes over the panel (room to search and read on a phone).
  const [picking, setPicking] = useState<string | null>(null);
  useEffect(() => { if (!open) setPicking(null); }, [open]);
  const pickingCond = picking ? findCond(root, picking) : null;
  const ops: Ops = {
    setType: (id, type) => setRoot((r) => updateNode(r, id, (n) => ({ ...(n as BGroup), type }))),
    addCond: (id) => { const c = emptyCond(); setRoot((r) => addChild(r, id, c)); setPicking(c.id); },
    addGroup: (id) => {
      const c = emptyCond();
      setRoot((r) => addChild(r, id, { ...emptyGroup(r.type === "and" ? "or" : "and"), children: [c] }));
      setPicking(c.id);
    },
    remove: (id) => setRoot((r) => removeNode(r, id)),
    patch: (id, p) => setRoot((r) => updateNode(r, id, (n) => ({ ...(n as BCond), ...p }))),
    pick: (id) => setPicking(id),
  };
  const choose = (key: string) => {
    if (!pickingCond) return;
    const d = STAT_BY_KEY.get(key);
    ops.patch(pickingCond.id, { key, op: opsFor(d).includes(pickingCond.op) ? pickingCond.op : d?.type === "text" ? "contains" : "gte" });
    const id = pickingCond.id;
    setPicking(null);
    setTimeout(() => document.getElementById(`cond-value-${id}`)?.focus(), 60);
  };

  return (
    <Panel
      open={open} onOpenChange={onOpenChange}
      title={<span className="flex items-center gap-2"><ListFilter className="size-5 text-accent" /> Edit filters</span>}
      description="Combine conditions with All (every one must hold) or Any (at least one). Groups can nest."
      footer={(
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto flex items-center gap-1.5 text-sm text-text-muted" aria-live="polite">
            {count.loading ? <Loader2 className="size-4 animate-spin" /> : <span className="size-2 rounded-full bg-accent" />}
            <span><span className="font-semibold tabular-nums text-text-base">{countText}</span> {noun} match</span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setRoot(emptyGroup())} disabled={!conds}>Clear all</Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={apply} disabled={!!rootError}>
            {incomplete ? `Apply (skip ${incomplete} unfinished)` : count.n != null && count.key === key ? `Show ${countText} ${noun}` : "Apply"}
          </Button>
        </div>
      )}
    >
      <div className={cn("mb-3 flex shrink-0 gap-1 rounded-lg bg-muted p-0.5", pickingCond && "hidden")} role="tablist" aria-label="Filter builder">
        {(["build", "saved"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium max-sm:h-10", view === v ? "bg-background text-text-base shadow-sm" : "text-text-muted hover:text-text-base")}>
            {v === "build" ? <><ListFilter className="size-4" /> Build</> : <><Bookmark className="size-4" /> Saved filters{saved.length ? ` (${saved.length})` : ""}</>}
          </button>
        ))}
      </div>
      {pickingCond ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="max-sm:h-10" onClick={() => setPicking(null)}><ArrowLeft /> Back</Button>
            <p className="text-sm font-medium">{pickingCond.key ? "Change the statistic" : "Choose a statistic for the new condition"}</p>
          </div>
          <StatPicker scope={scope} predictable={predictable} mode="single" selected={new Set(pickingCond.key ? [pickingCond.key] : [])} onPick={choose} autoFocus className="flex-1" />
        </div>
      ) : view === "build" ? (
        <div className="custom-scrollbar -mr-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
          <div className="rounded-xl border border-accent/30 border-l-4 border-l-accent bg-accent/[0.06] px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent-text">In plain English</p>
            <p className="mt-0.5 text-sm leading-snug" data-testid="filter-sentence">{sentence}</p>
            {incomplete > 0 && <p className="mt-1 text-xs text-warning">{incomplete} unfinished condition{incomplete === 1 ? " isn't" : "s aren't"} counted yet.</p>}
            {rootError && <p className="mt-1 text-xs text-danger">{rootError}</p>}
          </div>
          <GroupEditor g={root} depth={0} scope={scope} predictable={predictable} errors={errors} ops={ops} maxed={depthOf(root) >= FILTER_LIMITS.maxDepth} tooMany={conds >= FILTER_LIMITS.maxConditions} />
        </div>
      ) : (
        <SavedList scope={scope} saved={saved} current={filter} onApply={(f) => { setRoot(toBuilder(f)); setView("build"); }} />
      )}
    </Panel>
  );
}

interface Ops {
  setType: (id: string, t: "and" | "or") => void;
  addCond: (id: string) => void;
  addGroup: (id: string) => void;
  remove: (id: string) => void;
  patch: (id: string, p: Partial<BCond>) => void;
  pick: (id: string) => void;
}

function GroupEditor({ g, depth, scope, predictable, errors, ops, maxed, tooMany }: { g: BGroup; depth: number; scope: RecordScope; predictable: boolean; errors: Map<string, string>; ops: Ops; maxed: boolean; tooMany: boolean }) {
  return (
    <div className={cn(depth > 0 && cn("rounded-xl border border-line border-l-4 bg-text-base/[0.02] p-2.5 sm:p-3", DEPTH_BORDER[(depth - 1) % DEPTH_BORDER.length]))} role="group" aria-label={depth ? `Group, ${g.type === "and" ? "all" : "any"} of` : "Filter"}>
      <div className="flex items-center gap-2">
        {depth > 0 && <CornerDownRight className="size-4 shrink-0 text-text-muted" />}
        <span className="text-sm text-text-muted">{depth ? "Where" : "Show rows where"}</span>
        <Select value={g.type} onValueChange={(v) => ops.setType(g.id, v as "and" | "or")}>
          <SelectTrigger className={cn("h-8 w-auto gap-1.5 font-semibold max-sm:h-10", g.type === "and" ? "border-accent/50 text-accent-text" : "border-violet-500/50 text-violet-600 dark:text-violet-400")} aria-label="Combine conditions with"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="and">All (AND)</SelectItem>
            <SelectItem value="or">Any (OR)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-text-muted">of these hold</span>
        {depth > 0 && (
          <Button variant="ghost" size="icon-sm" className="ml-auto max-sm:size-10" onClick={() => ops.remove(g.id)} aria-label="Remove group"><X /></Button>
        )}
      </div>
      <div className="mt-2.5 space-y-2">
        {!g.children.length && <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-sm text-text-muted">{depth ? "Empty group — add a condition." : "No conditions yet: every row shows. Add one below."}</p>}
        {g.children.map((c) => c.kind === "cond"
          ? <ConditionRow key={c.id} c={c} scope={scope} predictable={predictable} error={errors.get(c.id)} ops={ops} />
          : <GroupEditor key={c.id} g={c} depth={depth + 1} scope={scope} predictable={predictable} errors={errors} ops={ops} maxed={maxed} tooMany={tooMany} />)}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={() => ops.addCond(g.id)} disabled={tooMany}><Plus /> Add condition</Button>
        <Button variant="outline" size="sm" className="max-sm:h-10" onClick={() => ops.addGroup(g.id)} disabled={maxed || tooMany} title={maxed ? `Groups nest at most ${FILTER_LIMITS.maxDepth} deep` : undefined}><Plus /> Add group</Button>
      </div>
    </div>
  );
}

function ConditionRow({ c, scope, predictable, error, ops }: { c: BCond; scope: RecordScope; predictable: boolean; error?: string; ops: Ops }) {
  const def = c.key ? statFor(c.key, scope) ?? STAT_BY_KEY.get(c.key) : undefined;
  const tone = TONE_CLASS[toneOf(def)];
  const allowed = opsFor(def);
  // Only a value that's been typed and is wrong is flagged; empty rows count as "unfinished" in the preview.
  const shown = !!error && !!c.key && c.value.trim() !== "";
  return (
    <div className={cn("rounded-lg border bg-card p-2", shown ? "border-danger/50" : "border-line")} data-condition>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 @min-[27rem]:grid-cols-[minmax(0,1fr)_8.5rem_9rem_auto]">
        <button type="button" onClick={() => ops.pick(c.id)} className={cn("flex h-9 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-left text-sm max-sm:h-11", def ? "border-line hover:border-text-base/30" : "border-dashed border-accent/60 text-accent-text")} aria-label={def ? `Statistic: ${def.label}. Change` : "Choose a statistic"}>
          {def ? <span className={cn("size-2 shrink-0 rounded-full", tone.bar)} /> : <Plus className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1 truncate font-medium">{def?.label ?? "Choose a statistic"}</span>
          <Pencil className="size-3.5 shrink-0 text-text-muted" />
        </button>
        <Button variant="ghost" size="icon" className="@min-[27rem]:order-last" onClick={() => ops.remove(c.id)} aria-label="Remove condition"><X /></Button>
        <div className="col-span-2 grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 @min-[27rem]:col-span-2 @min-[27rem]:contents">
          <Select value={c.op} onValueChange={(v) => ops.patch(c.id, { op: v as FilterOp })} disabled={!def}>
            <SelectTrigger className="h-9 max-sm:h-11" aria-label="Comparison"><SelectValue /></SelectTrigger>
            <SelectContent>
              {allowed.map((o) => <SelectItem key={o} value={o}><span className="inline-block w-5 font-semibold">{OP_LABELS[o].length <= 2 ? OP_LABELS[o] : ""}</span>{OP_WORDS[o]}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative">
            <Input
              id={`cond-value-${c.id}`} value={c.value} onChange={(e) => ops.patch(c.id, { value: e.target.value })} disabled={!def}
              inputMode={def?.type === "text" ? "text" : "decimal"} placeholder={def?.type === "text" ? "text" : "number"} aria-label="Value" aria-invalid={!!error && shown}
              className={cn("h-9 max-sm:h-11", def?.percent && "pr-7")}
            />
            {def?.percent && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-text-muted">%</span>}
          </div>
        </div>
      </div>
      {def?.category === "Control Scout Exclusives" && !predictable && <p className="mt-1 text-xs text-warning">This season has no predictions, so nothing matches this.</p>}
      {error && shown && c.key && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
    </div>
  );
}

function SavedList({ scope, saved, current, onApply }: { scope: RecordScope; saved: SavedFilter[]; current: FilterGroup | null; onApply: (f: FilterGroup) => void }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const save = () => {
    if (!current) return;
    try { saveFilter(name, kindOf(scope), serializeFilter(current)); setName(""); toast.success(`Saved “${name.trim()}”`); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div className="custom-scrollbar -mr-2 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
      <form className="rounded-xl border border-line p-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <p className="text-sm font-medium">Save the current filter</p>
        <p className="mt-0.5 text-xs text-text-muted">{current ? describeFilter(current, scope) : "Build a filter first, then name it here."}</p>
        <div className="mt-2 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Alliance picks" aria-label="Filter name" maxLength={60} disabled={!current} className="h-9 max-sm:h-11" />
          <Button type="submit" size="sm" className="h-9 max-sm:h-11" disabled={!current || !name.trim()}><Save /> Save</Button>
        </div>
        <p className="mt-2 text-[11px] text-text-muted">Kept on this device — no account needed.</p>
      </form>
      {!saved.length ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-8 max-sm:py-5 text-center text-sm text-text-muted">No saved filters yet.</p>
      ) : (
        <ul className="space-y-2" aria-label="Saved filters">
          {saved.map((s) => {
            let parsed: FilterGroup | null = null, why = "";
            try { parsed = parseFilter(s.filter, scope); } catch (e) { why = (e as Error).message.replace(/^filter: /, ""); }
            return (
              <li key={s.id} className="rounded-xl border border-line bg-card p-3">
                {editing?.id === s.id ? (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); try { renameSaved(s.id, editing.name); setEditing(null); } catch (err) { toast.error((err as Error).message); } }}>
                    <Input value={editing.name} onChange={(e) => setEditing({ id: s.id, name: e.target.value })} autoFocus aria-label="New name" maxLength={60} className="h-9 max-sm:h-11" />
                    <Button type="submit" size="sm" className="h-9 max-sm:h-11">Rename</Button>
                    <Button type="button" variant="ghost" size="sm" className="h-9 max-sm:h-11" onClick={() => setEditing(null)}>Cancel</Button>
                  </form>
                ) : (
                  <div className="flex items-start gap-2">
                    <Bookmark className="mt-0.5 size-4 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{s.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-text-muted">{parsed ? describeFilter(parsed, scope) : `Can't be used in this table: ${why}`}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" className="max-sm:h-10" disabled={!parsed} onClick={() => parsed && onApply(parsed)}>Use</Button>
                      <Button variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label={`Rename ${s.name}`} onClick={() => setEditing({ id: s.id, name: s.name })}><Pencil /></Button>
                      <Button variant="ghost" size="icon-sm" className="max-sm:size-10" aria-label={`Delete ${s.name}`} onClick={() => {
                        try { deleteSaved(s.id); } catch (err) { toast.error((err as Error).message); return; }
                        toast(`Deleted “${s.name}”`, { action: { label: "Undo", onClick: () => { try { saveFilter(s.name, s.kind, s.filter); } catch (err) { toast.error((err as Error).message); } } } });
                      }}><Trash2 /></Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
