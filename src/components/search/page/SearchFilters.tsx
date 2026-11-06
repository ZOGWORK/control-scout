// The /search page's own filters: time (upcoming / past / all), season and event type, offered only from what the
// results hold. They narrow the results on this page (never send you to the Events tab), live in the address so a
// refresh, Back or a shared link keeps them, and Clear goes back to exactly the unfiltered results.
import { X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/controls";
import { seasonLabel } from "../../../lib/format";
import { cn } from "../../cn";
import { anyFilter, type PageFilters, type When } from "./results";

const WHEN: { v: When; label: string }[] = [{ v: "all", label: "All" }, { v: "upcoming", label: "Upcoming" }, { v: "past", label: "Past" }];

/** `counts`: how many events each time tab would show, beside its name ("Past 0"), so an empty tab is plain before it's picked.
 *  `asked`: the query's own time tab ("upcoming meets": Upcoming), where Clear goes back to. */
export function SearchFilters({ f, seasons, types, counts, asked = "all", onChange }: { f: PageFilters; seasons: number[]; types: { value: string; label: string }[]; counts?: Record<When, number>; asked?: When; onChange: (f: PageFilters) => void }) {
  return (
    <div role="group" aria-label="Filter results" className="flex flex-wrap items-center gap-2" data-search-filters>
      <div role="radiogroup" aria-label="Time" className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {WHEN.map((w) => (
          <button key={w.v} type="button" role="radio" aria-checked={f.when === w.v} aria-label={counts ? `${w.label}, ${counts[w.v]} ${counts[w.v] === 1 ? "event" : "events"}` : undefined} onClick={() => onChange({ ...f, when: w.v })}
            className={cn("rounded-md px-3 py-1 text-xs font-medium max-md:min-h-[44px] pointer-coarse:min-h-[44px]", f.when === w.v ? "bg-accent text-accent-ink" : "text-muted-foreground hover:text-foreground")}>
            {w.label}{counts && <span className={cn("ml-1.5 tabular-nums", f.when === w.v ? "opacity-80" : counts[w.v] === 0 && "opacity-60")} aria-hidden data-count>{counts[w.v]}</span>}
          </button>
        ))}
      </div>
      {(seasons.length > 1 || f.season != null) && (
        <Select value={f.season != null ? String(f.season) : "all"} onValueChange={(v) => onChange({ ...f, season: v === "all" ? null : Number(v) })}>
          <SelectTrigger size="sm" aria-label="Season" className="w-auto min-w-28 max-md:min-h-[44px] pointer-coarse:min-h-[44px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All seasons</SelectItem>
            {[...new Set([...seasons, ...(f.season != null ? [f.season] : [])])].sort((a, b) => b - a).map((s) => <SelectItem key={s} value={String(s)}>{seasonLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {(types.length > 1 || f.type != null) && (
        <Select value={f.type ?? "all"} onValueChange={(v) => onChange({ ...f, type: v === "all" ? null : v })}>
          <SelectTrigger size="sm" aria-label="Event type" className="w-auto min-w-32 max-md:min-h-[44px] pointer-coarse:min-h-[44px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            {f.type && !types.some((t) => t.value === f.type) && <SelectItem value={f.type}>{f.type}</SelectItem>}
          </SelectContent>
        </Select>
      )}
      {anyFilter(f, asked) && (
        <button type="button" onClick={() => onChange({ when: asked, season: null, type: null })} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-foreground hover:underline max-md:min-h-[44px] pointer-coarse:min-h-[44px]">
          <X className="size-3.5" aria-hidden />Clear filters
        </button>
      )}
    </div>
  );
}
