// The rows of a pick list, shared by the personal Shortlist (src/pages/ShortlistPage.tsx) and a
// workspace's shared pick list (src/components/scout/SharedPicklist.tsx): a list row and a grid card, each
// with the drag grip (useReorder), the pick number, the compare tick, inline OPR / world rank / record, the
// OPR trend line, a note slot, and the panel that opens in place (TeamDetail).
import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ExternalLink, GripVertical, MapPin, Scale, Trash2 } from "lucide-react";
import type { ShortlistTeam } from "../../shared/api";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/controls";
import { cn } from "../cn";
import { num } from "../../lib/format";
import type { useReorder } from "./useReorder";
import { OprSpark } from "./charts";

/** How many teams Compare takes. */
export const MAX_COMPARE = 4;

/** Pick number badge: gold, blue, green for the first three, then neutral. */
export function RankBadge({ rank, className }: { rank: number; className?: string }) {
  const tone = rank === 1 ? "bg-accent text-accent-ink shadow-[0_2px_10px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]"
    : rank === 2 ? "bg-info/20 text-info ring-1 ring-info/40"
    : rank === 3 ? "bg-success/20 text-success ring-1 ring-success/40"
    : "bg-muted text-text-base/80 ring-1 ring-border";
  return <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold tabular-nums", tone, className)} aria-label={`Pick ${rank}`}>{rank}</span>;
}

/** Clicks on these don't toggle the row. */
export const interactive = (e: MouseEvent) => !!(e.target as HTMLElement).closest("a, button, input, label, [role=checkbox], [data-reorder-handle]");

// Fixed widths (not auto), so every row's grid lines up with the header's.
export const LIST_COLS = "grid items-center gap-x-2 grid-cols-[2.5rem_1.75rem_minmax(0,1fr)_3.5rem_2rem] sm:gap-x-3 sm:grid-cols-[2rem_1.75rem_1rem_minmax(0,1fr)_4rem_4.5rem_4rem_4.25rem] md:grid-cols-[2rem_1.75rem_1rem_minmax(0,1fr)_7rem_4rem_4.5rem_4rem_4.25rem] lg:grid-cols-[2rem_1.75rem_1rem_minmax(0,1fr)_8rem_4rem_4.5rem_5rem_4.5rem_4.25rem]";

/** The list view's column headings (aligned with ListRow's grid). */
export function ListHeader() {
  return (
    <div aria-hidden className={cn(LIST_COLS, "border-b border-border bg-muted/40 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-text-muted sm:px-3")}>
      <span /><span>Pick</span><span className="max-sm:hidden" /><span>Team</span><span className="max-md:hidden">Trend</span>
      <span className="text-right">OPR</span><span className="text-right max-sm:hidden">World</span><span className="text-right max-lg:hidden">Rating</span><span className="text-right max-sm:hidden">W-L-T</span><span />
    </div>
  );
}

export interface RowProps {
  t: ShortlistTeam; rank: number; season: number; open: boolean; dragging: boolean;
  /** The note field under the team's name (a private NoteField on the shortlist, the shared note on a workspace's pick list). */
  note: ReactNode;
  selected: boolean; selectDisabled: boolean; onSelect: (on: boolean) => void;
  onToggle: () => void; onRemove: () => void;
  /** This team next to the top picks. */
  compareLink: string;
  handle: ReturnType<ReturnType<typeof useReorder>["handleProps"]>;
  detail: ReactNode;
  /** For the opened panel's id (two lists on one page must not share ids). Default "shortlist". */
  idPrefix?: string;
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

/** The compare tick with its words, the whole label tappable (a 16 px box alone is too small a target on a phone). */
function SelectLabel({ text, className, ...p }: Pick<RowProps, "t" | "selected" | "selectDisabled" | "onSelect"> & { text: string; className?: string }) {
  return (
    <label className={cn("inline-flex min-h-8 cursor-pointer items-center gap-2 rounded-lg px-2 text-xs text-text-muted hover:text-text-base max-sm:min-h-11", p.selectDisabled && !p.selected && "cursor-not-allowed opacity-60", className)}>
      <SelectBox {...p} /><span>{text}</span>
    </label>
  );
}

export function ListRow(p: RowProps) {
  const { t, rank, open, dragging } = p;
  const detailsId = `${p.idPrefix ?? "shortlist"}-${t.team}`;
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
          <div className="-ml-1.5 mt-0.5 max-w-md">{p.note}</div>
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
      {open && <div id={detailsId}>
        {/* Phones have no room for the tick column: picking for Compare lives in the opened row. */}
        <div className="border-t border-border px-2 pt-1 sm:hidden"><SelectLabel {...p} text={p.selected ? "Selected to compare" : "Select to compare"} /></div>
        {p.detail}
      </div>}
    </li>
  );
}

export function GridCard(p: RowProps) {
  const { t, rank, open, dragging } = p;
  const detailsId = `${p.idPrefix ?? "shortlist"}-${t.team}`;
  return (
    <li data-reorder-key={t.team} className={cn("relative min-w-0 overflow-hidden rounded-2xl border border-border bg-card transition-shadow", open && "sm:col-span-2 xl:col-span-3", rank === 1 && "border-accent/40", dragging && "z-20 shadow-2xl ring-2 ring-accent/70")}>
      {rank === 1 && <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-accent/10 blur-2xl" />}
      <div className="relative p-3.5">
        <div className="flex items-center gap-2">
          <RankBadge rank={rank} className="size-8 text-sm" />
          <Grip t={t} rank={rank} handle={p.handle} />
          <SelectLabel {...p} text="Compare" className="-mr-2 ml-auto" />
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
        <div className="-mx-1.5 mt-2">{p.note}</div>
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
