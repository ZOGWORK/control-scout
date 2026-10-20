// "Choose statistics": every stat a records table has, searchable, grouped by
// category with a line on what each one means. Score stats are a grid (part ×
// TOT/AVG/OPR/MIN/MAX/DEV; for matches part × Red/Blue) so any combination is
// one tap. Used to pick a filter condition's stat (single) and as the
// Statistics column toggle (multi, with checkboxes).
import { useMemo, useState, type ReactNode } from "react";
import { Check, Search, Sparkles } from "lucide-react";
import { AGGREGATES, AGGREGATE_LABELS, SCORE_STATS, STAT_CATEGORIES, statsFor, type RecordScope, type StatCategory, type StatDef } from "../../shared/statCatalog";
import { TONE_CLASS, toneOf } from "../../lib/records/describe";
import { cn } from "../cn";

const CATEGORY_HINT: Partial<Record<StatCategory, string>> = {
  "Team": "Who the team is: number, name, region, rookie year and school.",
  "Event Performance": "Official rankings at the event.",
  "Score Stats": "Alliance scores over the team's qualification matches.",
  "Match Scores": "Each alliance's score in the match.",
  "Control Scout Exclusives": "From Control Scout predictions.",
};

/** Stats a table can show/filter: the scope's catalog, minus prediction stats in seasons without predictions. */
export function pickableStats(scope: RecordScope, predictable: boolean): StatDef[] {
  return statsFor(scope).filter((s) => predictable || s.category !== "Control Scout Exclusives");
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (hay: string, ws: string[]) => ws.every((w) => hay.includes(w));

interface Props {
  scope: RecordScope;
  predictable: boolean;
  mode: "single" | "multi";
  selected: ReadonlySet<string>;
  onPick: (key: string) => void;
  autoFocus?: boolean;
  className?: string;
}

export function StatPicker({ scope, predictable, mode, selected, onPick, autoFocus, className }: Props) {
  const [q, setQ] = useState("");
  const ws = words(q);
  const stats = useMemo(() => pickableStats(scope, predictable), [scope, predictable]);
  const cats = STAT_CATEGORIES.filter((c) => stats.some((s) => s.category === c));
  let shown = 0;
  const sections = cats.map((cat) => {
    const defs = stats.filter((s) => s.category === cat);
    let body: ReactNode = null;
    if (cat === "Score Stats") {
      const rows = SCORE_STATS.map((part) => {
        const cells = AGGREGATES.map((a) => defs.find((d) => d.base === part.base && d.aggregate === a)).filter((d): d is StatDef => !!d);
        const hits = cells.filter((d) => matches(`${part.label} ${AGGREGATE_LABELS[d.aggregate!]} ${d.key} ${cat}`.toLowerCase(), ws));
        return hits.length ? { part, cells, hits: new Set(hits.map((h) => h.key)) } : null;
      }).filter((r) => r != null);
      shown += rows.length;
      if (rows.length) body = <Grid cols={AGGREGATES.map((a) => AGGREGATE_LABELS[a])} rows={rows.map((r) => ({ id: r.part.base, label: r.part.label, description: r.part.description, cells: r.cells.map((d) => (r.hits.has(d.key) ? d : null)) }))} mode={mode} selected={selected} onPick={onPick} />;
    } else if (cat === "Match Scores") {
      const sided = SCORE_STATS.filter((p) => p.base !== "penaltyPointsByOpp").map((part) => {
        const cells = (["red", "blue"] as const).map((side) => defs.find((d) => d.key === `${side}${part.base[0].toUpperCase()}${part.base.slice(1)}`)).filter((d): d is StatDef => !!d);
        const hits = cells.filter((d) => matches(`${d.label} ${d.key} ${cat}`.toLowerCase(), ws));
        return hits.length ? { part, cells, hits: new Set(hits.map((h) => h.key)) } : null;
      }).filter((r) => r != null);
      const rest = defs.filter((d) => !/^(red|blue)[A-Z]/.test(d.key) && matches(`${d.label} ${d.short} ${d.key} ${cat} ${d.description ?? ""}`.toLowerCase(), ws));
      shown += sided.length + rest.length;
      if (sided.length || rest.length) body = (
        <>
          {sided.length > 0 && <Grid cols={["Red", "Blue"]} tones={["redAlliance", "blueAlliance"]} rows={sided.map((r) => ({ id: r.part.base, label: r.part.label, description: r.part.description, cells: r.cells.map((d) => (r.hits.has(d.key) ? d : null)) }))} mode={mode} selected={selected} onPick={onPick} />}
          {rest.map((d) => <Row key={d.key} d={d} mode={mode} on={selected.has(d.key)} onPick={onPick} />)}
        </>
      );
    } else {
      const hits = defs.filter((d) => matches(`${d.label} ${d.short} ${d.key} ${cat} ${d.description ?? ""}`.toLowerCase(), ws));
      shown += hits.length;
      if (hits.length) body = hits.map((d) => <Row key={d.key} d={d} mode={mode} on={selected.has(d.key)} onPick={onPick} />);
    }
    if (!body) return null;
    const exclusive = cat === "Control Scout Exclusives";
    return (
      <section key={cat} aria-label={cat} className={cn("rounded-xl border p-2", exclusive ? "border-accent/40 bg-accent/[0.05]" : "border-line")}>
        <header className="mb-1 flex items-baseline gap-2 px-1.5">
          <h3 className={cn("text-[11px] font-bold uppercase tracking-[0.12em]", exclusive ? "text-accent-text" : "text-text-base")}>
            {exclusive && <Sparkles className="mr-1 inline size-3.5 -translate-y-px" />}{cat}
          </h3>
          {CATEGORY_HINT[cat] && <p className="min-w-0 truncate text-[11px] text-text-muted">{CATEGORY_HINT[cat]}</p>}
        </header>
        {body}
      </section>
    );
  });
  return (
    <div className={cn("flex min-h-0 flex-col gap-2", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} placeholder="Search stats: auto avg, penalties, win %…" aria-label="Search statistics"
          className="h-10 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:h-11"
        />
      </div>
      <div className="custom-scrollbar -mr-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {sections}
        {!shown && <p className="px-2 py-6 max-sm:py-4 text-center text-sm text-text-muted">No stat matches “{q}”.</p>}
      </div>
    </div>
  );
}

function Mark({ on, mode }: { on: boolean; mode: "single" | "multi" }) {
  if (mode === "single") return on ? <Check className="size-4 text-accent" /> : null;
  return (
    <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-accent bg-accent text-accent-ink" : "border-text-base/30")}>
      {on && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

function Row({ d, mode, on, onPick }: { d: StatDef; mode: "single" | "multi"; on: boolean; onPick: (k: string) => void }) {
  const tone = TONE_CLASS[toneOf(d)];
  return (
    <button
      type="button" onClick={() => onPick(d.key)} role={mode === "multi" ? "checkbox" : "option"} aria-checked={mode === "multi" ? on : undefined} aria-selected={mode === "single" ? on : undefined}
      className={cn("flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-text-base/[0.06] max-sm:py-2.5", on && "bg-accent/[0.08]")}
    >
      <span className="mt-0.5"><Mark on={on} mode={mode} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium"><span className={cn("size-2 shrink-0 rounded-full", tone.bar)} />{d.label}{d.type === "text" && <span className="rounded border border-line px-1 text-[10px] font-normal text-text-muted">text</span>}</span>
        {d.description && <span className="mt-0.5 block text-xs leading-snug text-text-muted">{d.description}</span>}
      </span>
    </button>
  );
}

function Grid({ cols, tones, rows, mode, selected, onPick }: {
  cols: string[];
  tones?: ("redAlliance" | "blueAlliance")[];
  rows: { id: string; label: string; description: string; cells: (StatDef | null)[] }[];
  mode: "single" | "multi";
  selected: ReadonlySet<string>;
  onPick: (k: string) => void;
}) {
  // Each stat: its name, then its aggregates as one row of buttons across the full width (fits the narrow
  // side panel: nothing scrolls off). Every button keeps its label, ticked or not.
  return (
    <div className="space-y-2" role="group">
      {rows.map((r) => {
        const tone = TONE_CLASS[toneOf(r.cells.find((c) => c) ?? undefined)];
        return (
          <div key={r.id} className="rounded-lg px-2 py-1.5">
            <p className="flex items-center gap-2 text-sm font-medium" title={r.description}>
              <span className={cn("size-2 shrink-0 rounded-full", tones ? "bg-text-base/40" : tone.bar)} />{r.label}
            </p>
            <p className="truncate pl-4 text-[11px] text-text-muted">{r.description}</p>
            <div className="mt-1.5 grid gap-1 pl-4" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
              {r.cells.map((d, i) => d ? (
                <button
                  key={i} type="button" onClick={() => onPick(d.key)} title={`${d.label}${d.description ? ` — ${d.description}` : ""}`} aria-label={d.label}
                  role={mode === "multi" ? "checkbox" : "option"} aria-checked={mode === "multi" ? selected.has(d.key) : undefined} aria-selected={mode === "single" ? selected.has(d.key) : undefined}
                  className={cn(
                    "inline-flex h-8 min-w-0 items-center justify-center gap-0.5 rounded-md border text-[11px] font-semibold tabular-nums transition-colors max-sm:h-10",
                    selected.has(d.key) ? "border-accent bg-accent text-accent-ink" : cn("border-line hover:border-text-base/30 hover:bg-text-base/[0.06]", tones ? TONE_CLASS[tones[i]].text : "text-text-muted"),
                  )}
                >
                  {selected.has(d.key) && mode === "multi" && <Check className="size-3 shrink-0" strokeWidth={3} />}{cols[i]}
                </button>
              ) : <span key={i} className="grid place-items-center text-text-muted/40">·</span>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
