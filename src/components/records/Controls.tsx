// The separate dropdowns above a records table: Season, Region, Event type and
// Date range (FTC Scout's row), each showing its current choice in words.
import { useMemo, useState } from "react";
import { CalendarRange, Check, ChevronDown, MapPin, Search, Trophy } from "lucide-react";
import { useApi } from "../../lib/api";
import { useMeta } from "../../lib/meta";
import { seasonLabel } from "../../lib/format";
import { eventTypeLabel } from "../../shared/labels";
import { regionLabel } from "../../shared/regions";
import { RECORD_EVENT_TYPES, type RecordRegion } from "../../shared/statCatalog";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/overlay";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "../ui/controls";
import { Button } from "../ui/button";
import { Input } from "../ui/basic";
import { cn } from "../cn";

const trigger = "inline-flex h-9 max-w-full items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors max-sm:h-11";
const idle = "border-line bg-card text-text-base hover:border-text-base/25";
const active = "border-accent/60 bg-accent/[0.08] text-text-base";

/** Season dropdown: every season the site has, newest first, with the game's name. */
export function SeasonSelect({ value, onChange, className }: { value: number; onChange: (s: number) => void; className?: string }) {
  const meta = useMeta();
  const seasons = meta?.seasons.length ? meta.seasons : [{ season: value, game: "" }];
  const list = seasons.some((s) => s.season === value) ? seasons : [{ season: value, game: "" }, ...seasons];
  const predictable = (s: { season: number }) => (s as { predictable?: boolean }).predictable ?? s.season >= 2023;
  const recent = list.filter(predictable), earlier = list.filter((s) => !predictable(s));
  const item = (s: { season: number; game: string }) => <SelectItem key={s.season} value={String(s.season)}><span className="font-semibold tabular-nums">{seasonLabel(s.season)}</span>{s.game && <span data-game="" className="text-text-muted"> · {s.game}</span>}</SelectItem>;
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className={cn(trigger, idle, "w-auto", className)} aria-label="Season">
        <Trophy data-season-icon="" className="size-4 text-accent" /><SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[15rem]">
        {earlier.length ? (
          <>
            <SelectGroup><SelectLabel>With predictions</SelectLabel>{recent.map(item)}</SelectGroup>
            <SelectGroup><SelectLabel>Earlier (results only)</SelectLabel>{earlier.map(item)}</SelectGroup>
          </>
        ) : list.map(item)}
      </SelectContent>
    </Select>
  );
}

/** "USCANO" → "California" (the place most of its events are in), else the code. */
export function recordRegionName(r: RecordRegion): string {
  // Two-letter codes are whole countries (AU, BR); longer ones a state or province (USTX, CAAB, USCANO).
  if (r.code.length > 2 && r.country && r.state) { const n = regionLabel(`${r.country}:${r.state}`); if (n !== r.state) return n; }
  return r.country ?? r.code;
}

/** The season's record regions by name; `label` says a code's region in words (the code itself until they load). */
export function useRecordRegions(season: number, on = true) {
  const state = useApi<{ regions: RecordRegion[] }>(on ? `/api/records/${season}/regions` : null);
  const regions = state.data?.regions;
  return useMemo(() => {
    const named = (regions ?? []).map((r) => ({ ...r, name: recordRegionName(r) }));
    // Codes sharing a name (USCANO, USCALA, USCASD → California) say which part they are.
    const dup = new Map<string, number>();
    for (const r of named) dup.set(r.name, (dup.get(r.name) ?? 0) + 1);
    const byCode = new Map(named.map((r) => [r.code, r]));
    const nameOf = (r: (typeof named)[number]) => (dup.get(r.name)! > 1 ? `${r.name} (${r.code})` : r.name);
    const label = (code: string) => { const r = byCode.get(code); return r ? nameOf(r) : code; };
    return { loading: state.loading, named, nameOf, label };
  }, [regions, state.loading]);
}

/** The region choice in a few words: "All regions", "Texas", "3 regions". */
export const regionsText = (value: string[], label: (code: string) => string) =>
  !value.length ? "All regions" : value.length === 1 ? label(value[0]) : `${value.length} regions`;

/** Region dropdown (multi-select, searchable), from the region codes the season's records use. */
export function RegionPicker({ season, value, onChange }: { season: number; value: string[]; onChange: (codes: string[]) => void }) {
  const { loading, named, nameOf: label, label: codeLabel } = useRecordRegions(season);
  const [q, setQ] = useState("");
  const f = q.trim().toLowerCase();
  const shown = named.filter((r) => !f || `${r.name} ${r.code} ${r.country ?? ""}`.toLowerCase().includes(f)).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  const text = regionsText(value, codeLabel);
  const toggle = (c: string) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c].slice(0, 30));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn(trigger, value.length ? active : idle)} aria-label={`Region: ${text}`}>
          <MapPin className="size-4 text-sky-500" /><span className="max-w-[12rem] truncate">{text}</span><ChevronDown className="size-4 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-[min(28rem,70dvh)] w-[min(92vw,20rem)] flex-col gap-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Texas, Ontario, GB…" aria-label="Search regions" className="h-9 pl-8 max-sm:h-11" autoFocus />
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto" role="listbox" aria-multiselectable aria-label="Regions">
          {loading && !named.length && <p className="px-2 py-4 text-center text-sm text-text-muted">Loading regions…</p>}
          {!loading && !shown.length && <p className="px-2 py-4 text-center text-sm text-text-muted">No region matches.</p>}
          {shown.map((r) => {
            const on = value.includes(r.code);
            return (
              <button key={r.code} type="button" role="option" aria-selected={on} onClick={() => toggle(r.code)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-text-base/[0.06] max-sm:py-2.5", on && "bg-accent/[0.08]")}>
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-ink" : "border-text-base/30")}>{on && <Check className="size-3" strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1 truncate">{label(r)}</span>
                <span className="font-mono text-[11px] text-text-muted">{r.code}</span>
              </button>
            );
          })}
        </div>
        {value.length > 0 && <Button variant="ghost" size="sm" onClick={() => onChange([])}>All regions</Button>}
      </PopoverContent>
    </Popover>
  );
}

export function EventTypeSelect({ value, onChange }: { value: string | null; onChange: (t: string | null) => void }) {
  return (
    <Select value={value ?? "All"} onValueChange={(v) => onChange(v === "All" ? null : v)}>
      <SelectTrigger className={cn(trigger, value ? active : idle, "w-auto")} aria-label="Event type">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[13rem]">
        <SelectItem value="All">All event types</SelectItem>
        {RECORD_EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{eventTypeText(t)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** A date range in a few words: "Oct 4 – Nov 2", "From Oct 4", "Any dates". */
export const dateRangeText = (from: string | null, to: string | null) =>
  from && to ? `${short(from)} – ${short(to)}` : from ? `From ${short(from)}` : to ? `Until ${short(to)}` : "Any dates";

/** "Official events only", "Qualifier"… (null: every type). */
export const eventTypeText = (t: string) => (t === "Official" ? "Official events only" : eventTypeLabel(t));

/** Date range: from / to (inclusive), applied to event dates. */
export function DateRangePicker({ from, to, onChange }: { from: string | null; to: string | null; onChange: (from: string | null, to: string | null) => void }) {
  const [a, setA] = useState(from ?? ""), [b, setB] = useState(to ?? "");
  const text = dateRangeText(from, to);
  return (
    <Popover onOpenChange={(o) => { if (o) { setA(from ?? ""); setB(to ?? ""); } }}>
      <PopoverTrigger asChild>
        <button type="button" className={cn(trigger, from || to ? active : idle)} aria-label={`Date range: ${text}`}>
          <CalendarRange className="size-4 text-emerald-500" />{text}<ChevronDown className="size-4 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,18rem)] space-y-3">
        <label className="block text-xs font-medium text-text-muted">From<Input type="date" value={a} onChange={(e) => setA(e.target.value)} className="mt-1 h-9 max-sm:h-11" /></label>
        <label className="block text-xs font-medium text-text-muted">To<Input type="date" value={b} onChange={(e) => setB(e.target.value)} min={a || undefined} className="mt-1 h-9 max-sm:h-11" /></label>
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={() => onChange(a || null, b || null)}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={() => { setA(""); setB(""); onChange(null, null); }}>Any dates</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
