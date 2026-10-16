// The Scout feed's filter bar (Task 17): text search, team, event, author (workspaces), match and kind,
// and the sort. Quick structured picks, not a query builder. The state lives in the page URL (the
// parameters of src/shared/scoutFilter.ts), so a filtered feed is a link, and Export CSV sends it on.
// Phones: the search box and a Filters button opening a bottom sheet; what's on shows as chips below.
import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input, Label } from "../ui/basic";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from "../ui/controls";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../ui/overlay";
import { activeFilterCount, MAX_QUERY, type EntryFilterParam, type EntryFilters, type EntrySort } from "../../shared/scoutFilter";
import { cn } from "../cn";

export interface FilterOptions {
  teams: number[];
  /** Event codes on the entries, with the event's name where it's known. */
  events: { code: string; name?: string }[];
  /** The entries' authors (null: Personal, where every entry is yours). */
  authors: { id: number; name: string }[] | null;
  /** Match labels on the entries, in playing order. */
  matches: string[];
}

export interface EntryFilterBarProps {
  filters: EntryFilters;
  /** The search text as typed (the URL's q). */
  query: string;
  sort: EntrySort;
  options: FilterOptions;
  shown: number;
  total: number;
  /** Set (a value) or clear (null) one filter. */
  onFilter: (param: EntryFilterParam, value: string | null) => void;
  onSort: (sort: EntrySort) => void;
  onClear: () => void;
  /** The event list was opened: names are worth fetching now. */
  onWantEvents?: () => void;
}

const ANY = "__any";
const MULTI = "__multi";
const SORT_LABELS: Record<EntrySort, string> = { newest: "Newest first", team: "Team number", match: "Match order" };

/** A list filter's value for a single-choice picker: one value, several (a shared link), or none. */
const pick = (v: (string | number)[] | undefined) => (!v?.length ? ANY : v.length > 1 ? MULTI : String(v[0]));

export function EntryFilterBar(p: EntryFilterBarProps) {
  const [sheet, setSheet] = useState(false);
  const active = activeFilterCount(p.filters);
  const chips = activeChips(p);
  return (
    <div className="mb-4 space-y-3" data-testid="entry-filters">
      <div className="flex items-center gap-2">
        <SearchBox query={p.query} onChange={(v) => p.onFilter("q", v || null)} />
        <Button variant="outline" className="sm:hidden" onClick={() => { setSheet(true); p.onWantEvents?.(); }} aria-label={active ? `Filters, ${active} on` : "Filters"}>
          <SlidersHorizontal /> Filters{active > 0 && <span className="grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-ink">{active}</span>}
        </Button>
        <div className="hidden w-44 shrink-0 sm:block"><SortPicker sort={p.sort} onSort={p.onSort} /></div>
      </div>
      <div className="hidden flex-wrap items-center gap-2 sm:flex">
        <Pickers {...p} compact />
      </div>
      {chips.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:hidden" aria-label="Filters on">
          {chips.map((c) => (
            <button key={c.param} type="button" onClick={() => p.onFilter(c.param, null)} aria-label={`Remove filter: ${c.label}`}
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-accent/50 bg-accent/10 pl-3 pr-2 text-sm text-foreground">
              {c.label}<X className="size-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <p aria-live="polite" data-testid="entry-count">{active ? `${p.shown} of ${p.total} ${p.total === 1 ? "entry" : "entries"}` : `${p.total} ${p.total === 1 ? "entry" : "entries"}`}</p>
        {p.sort !== "newest" && <span className="sm:hidden">Sorted by {SORT_LABELS[p.sort].toLowerCase()}</span>}
        {active > 0 && <Button variant="link" size="sm" className="h-auto" onClick={p.onClear}>Clear filters</Button>}
      </div>
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="gap-4 p-5 pt-6">
          <SheetHeader className="text-left">
            <SheetTitle>Filter entries</SheetTitle>
            <SheetDescription>{active ? `${p.shown} of ${p.total} entries match.` : `${p.total} entries.`}</SheetDescription>
          </SheetHeader>
          <div className="grid gap-4">
            <Pickers {...p} />
            <div className="grid gap-1.5"><Label>Sort</Label><SortPicker sort={p.sort} onSort={p.onSort} /></div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={p.onClear} disabled={!active}>Clear filters</Button>
            <Button className="flex-1" onClick={() => setSheet(false)}>Show {p.shown} {p.shown === 1 ? "entry" : "entries"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** The search box: typed text stays local (no cursor jumps), each change goes to the URL. */
function SearchBox({ query, onChange }: { query: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(query);
  const written = useRef(query);
  // Changed from outside (Clear filters, back/forward): show it.
  useEffect(() => { if (query !== written.current) { written.current = query; setText(query); } }, [query]);
  return (
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" value={text} maxLength={MAX_QUERY} placeholder="Search notes, answers, names…" aria-label="Search entries"
        onChange={(e) => { setText(e.target.value); written.current = e.target.value; onChange(e.target.value); }}
        className="h-10 pl-9 max-sm:h-11" />
    </div>
  );
}

function SortPicker({ sort, onSort }: { sort: EntrySort; onSort: (s: EntrySort) => void }) {
  return (
    <Select value={sort} onValueChange={(v) => onSort(v as EntrySort)}>
      <SelectTrigger aria-label="Sort entries" className="h-10 max-sm:h-11"><SelectValue /></SelectTrigger>
      <SelectContent>{(Object.keys(SORT_LABELS) as EntrySort[]).map((s) => <SelectItem key={s} value={s}>{SORT_LABELS[s]}</SelectItem>)}</SelectContent>
    </Select>
  );
}

/** Team, event, author, match and kind: inline on wider screens (compact), stacked with labels in the sheet. */
function Pickers({ filters: f, options: o, onFilter, onWantEvents, compact }: EntryFilterBarProps & { compact?: boolean }) {
  const field = (label: string, node: React.ReactNode) => compact ? node : <div className="grid gap-1.5"><Label>{label}</Label>{node}</div>;
  const trigger = cn("h-10 max-sm:h-11", compact && "w-auto min-w-32 max-w-56");
  const list = (param: EntryFilterParam, label: string, anyLabel: string, values: (string | number)[] | undefined,
    items: { value: string; label: string }[], onOpen?: () => void) => {
    const v = pick(values);
    // A value in the URL that no entry has (yet): still listed, so the picker shows what's applied.
    const all = v !== ANY && v !== MULTI && !items.some((i) => i.value === v) ? [{ value: v, label: v }, ...items] : items;
    return field(label, (
      <Select value={v} onValueChange={(x) => onFilter(param, x === ANY ? null : x)} onOpenChange={(open) => { if (open) onOpen?.(); }}>
        <SelectTrigger aria-label={`Filter by ${label.toLowerCase()}`} className={cn(trigger, v !== ANY && "border-accent/60 bg-accent/10")}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{anyLabel}</SelectItem>
          {v === MULTI && <SelectItem value={MULTI} disabled>{values!.length} selected</SelectItem>}
          {all.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}
        </SelectContent>
      </Select>
    ));
  };
  return (
    <>
      {list("team", "Team", "Any team", f.team, o.teams.map((t) => ({ value: String(t), label: String(t) })))}
      {list("event", "Event", "Any event", f.event, o.events.map((e) => ({ value: e.code, label: e.name ? `${e.code} · ${e.name}` : e.code })), onWantEvents)}
      {o.authors && list("author", "Author", "Anyone", f.author, o.authors.map((a) => ({ value: String(a.id), label: a.name })))}
      {list("match", "Match", "Any match", f.match, o.matches.map((m) => ({ value: m, label: m })))}
      {field("Kind", (
        <ToggleGroup type="single" value={f.kind ?? "all"} onValueChange={(v) => { if (v) onFilter("kind", v === "all" ? null : v); }} aria-label="Filter by kind" className={compact ? undefined : "w-full"}>
          {[["all", "All"], ["match", "Match"], ["pit", "Pit"]].map(([v, l]) => <ToggleGroupItem key={v} value={v} className={compact ? undefined : "flex-1"}>{l}</ToggleGroupItem>)}
        </ToggleGroup>
      ))}
    </>
  );
}

/** What's on, as removable chips (phones). */
function activeChips({ filters: f, options: o }: EntryFilterBarProps): { param: EntryFilterParam; label: string }[] {
  const many = (v: (string | number)[], one: (x: string) => string, plural: string) => (v.length === 1 ? one(String(v[0])) : `${v.length} ${plural}`);
  const out: { param: EntryFilterParam; label: string }[] = [];
  if (f.team) out.push({ param: "team", label: many(f.team, (t) => `Team ${t}`, "teams") });
  if (f.event) out.push({ param: "event", label: many(f.event, (e) => e, "events") });
  if (f.author) out.push({ param: "author", label: many(f.author, (a) => `By ${o.authors?.find((x) => String(x.id) === a)?.name ?? "a member"}`, "authors") });
  if (f.match) out.push({ param: "match", label: many(f.match, (m) => `Match ${m}`, "matches") });
  if (f.kind) out.push({ param: "kind", label: f.kind === "pit" ? "Pit" : "Match entries" });
  return out;
}
