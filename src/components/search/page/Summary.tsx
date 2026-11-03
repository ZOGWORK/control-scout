// The /search summary for a question's records (FTC One Search, Part B Phase 2): a timeline of the team's
// championship trips (OPR across the seasons, each season a node that jumps to its card below), a banner of stats
// computed from the same records, and the record cards themselves (a short title, badges, stat pills). For
// "how good is X": the team's season standing as blocks and a win-rate gauge. All of it reads the records search
// already returned; nothing is typed in or guessed.
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, MapPin } from "lucide-react";
import { seasonLabel } from "../../../lib/format";
import { smoothBehavior } from "../../../lib/pageScroll";
import { cn } from "../../cn";
import type { Appearance, Stat, Standing } from "./records";

const nf = new Intl.NumberFormat();

/** Scroll to a record's card and ring it for a moment (the timeline's nodes). */
export function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: smoothBehavior(), block: "center" });
  el.dataset.highlight = "on";
  el.focus({ preventScroll: true });
  window.setTimeout(() => { if (el.dataset.highlight === "on") delete el.dataset.highlight; }, 2400);
}

/** OPR across the seasons: a line through a node per season. A node is a button: hover or focus shows its season's
 *  division, rank, record and OPR; activating it jumps to that season's card. */
export function Timeline({ apps }: { apps: Appearance[] }) {
  const [on, setOn] = useState<string | null>(null);
  const pts = apps.filter((a) => a.opr != null);
  if (!apps.length) return null;
  const W = 100, lo = Math.min(...pts.map((a) => a.opr!)), hi = Math.max(...pts.map((a) => a.opr!));
  const x = (i: number) => (apps.length === 1 ? W / 2 : 6 + (i / (apps.length - 1)) * (W - 12));
  const y = (v: number) => (hi === lo ? 50 : 82 - ((v - lo) / (hi - lo)) * 64);
  const path = apps.map((a, i) => (a.opr == null ? null : `${x(i)},${y(a.opr)}`)).filter(Boolean).join(" ");
  const shown = apps.find((a) => a.id === on);
  return (
    <>
    {/* Phones: every season as a chip in one sideways line, each jumping to its card. */}
    <nav aria-label="Seasons" className="mt-3 md:hidden" data-timeline-chips>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">By season</p>
      <ol className="-mx-1 mt-1.5 flex items-center gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {apps.map((a, i) => (
          <li key={a.id} className="flex shrink-0 items-center gap-1">
            {i > 0 && <span aria-hidden className="text-muted-foreground">→</span>}
            <button type="button" onClick={() => jumpTo(a.id)} data-chip={a.season}
              className="min-h-11 rounded-full border border-accent/40 bg-accent/[0.08] px-3 text-sm font-medium tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
              {a.seasonLabel}: {a.rank != null ? `#${a.rank}` : a.opr != null ? `OPR ${a.opr.toFixed(1)}` : a.division ?? "—"}
            </button>
          </li>
        ))}
      </ol>
    </nav>
    {/* The line needs two seasons to draw. */}
    {apps.length > 1 && <figure className="mt-3 max-md:hidden" data-timeline>
      <figcaption className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">OPR by season</figcaption>
      <div className="relative mt-2 h-28">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
          <line x1="0" x2="100" y1="96" y2="96" className="stroke-border" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
          {pts.length > 1 && <polyline points={path} fill="none" className="stroke-accent" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />}
        </svg>
        {apps.map((a, i) => (
          <button key={a.id} type="button" onClick={() => jumpTo(a.id)} onMouseEnter={() => setOn(a.id)} onMouseLeave={() => setOn(null)} onFocus={() => setOn(a.id)} onBlur={() => setOn(null)}
            aria-label={`${a.seasonLabel}: ${[a.division && `${a.division} Division`, a.rank != null && `ranked #${a.rank}`, a.record, a.opr != null && `OPR ${a.opr.toFixed(1)}`].filter(Boolean).join(", ")}. Go to its card.`}
            style={{ left: `${x(i)}%`, top: `${a.opr == null ? 96 : y(a.opr)}%` }}
            className={cn("absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-card hover:bg-accent focus-visible:bg-accent", on === a.id && "bg-accent")} data-node={a.season} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground" aria-hidden>
        {apps.map((a) => <span key={a.id}>{a.seasonLabel.slice(2)}</span>)}
      </div>
      <p className="mt-1.5 min-h-5 text-xs text-foreground" aria-live="polite">
        {shown ? <>{shown.seasonLabel}: {[shown.division && `${shown.division}`, shown.rank != null && `#${shown.rank}`, shown.record, shown.opr != null && `OPR ${shown.opr.toFixed(1)}`].filter(Boolean).join(" · ")}</> : <span className="text-muted-foreground">Point at a season for its numbers; select it to jump to its card.</span>}
      </p>
    </figure>}
    </>
  );
}

export function StatBanner({ stats }: { stats: Stat[] }) {
  if (!stats.length) return null;
  return (
    // Phones: one row that scrolls sideways, three blocks to a screen; from md up a grid.
    <dl className="-mx-1 flex snap-x snap-mandatory scroll-px-1 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:p-0" data-stat-banner>
      {stats.map((s) => (
        <div key={s.label} className="w-[calc((100%-1rem)/3)] min-w-0 shrink-0 snap-start rounded-lg border border-border bg-card px-3 py-2 max-md:px-2.5 md:w-auto">
          <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
          <dd className="mt-0.5 break-words font-display text-lg font-semibold tabular-nums leading-tight text-foreground">{s.value}</dd>
          {s.note && <dd className="text-[11px] text-muted-foreground">{s.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** A ring filled to the win rate. */
function Gauge({ pct }: { pct: number }) {
  const r = 15.9, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="size-14 shrink-0 -rotate-90" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" className="stroke-muted" strokeWidth="3.2" />
      <circle cx="18" cy="18" r={r} fill="none" className="stroke-accent" strokeWidth="3.2" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} />
    </svg>
  );
}

/** "How good is X": the season's record, world OPR rank, OPR, standing tier and win rate, each once. */
export function QualityBanner({ s }: { s: Standing }) {
  const blocks: Stat[] = [];
  if (s.record) blocks.push({ label: `${seasonLabel(s.season)} record`, value: s.record });
  if (s.rank != null && s.of) blocks.push({ label: "World OPR rank", value: `#${nf.format(s.rank)}`, note: `of ${nf.format(s.of)}` });
  if (s.opr != null) blocks.push({ label: "OPR", value: s.opr.toFixed(1) });
  if (s.pct != null && s.tier) blocks.push({ label: "Global standing", value: `Top ${s.pct.toFixed(1)}%`, note: s.tier });
  if (!blocks.length) return null;
  return (
    <div className="space-y-2" data-quality-banner>
      <StatBanner stats={blocks} />
      {s.winRate != null && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2" data-win-rate>
          <Gauge pct={s.winRate} />
          <div><p className="text-[11px] text-muted-foreground">Win rate</p><p className="font-display text-lg font-semibold tabular-nums text-foreground">{s.winRate.toFixed(1)}%</p></div>
        </div>
      )}
    </div>
  );
}

const PILL = "inline-flex items-baseline gap-1 rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-[11px]";

/** One championship trip as a card: its division as the title, the event, place and season as badges, its numbers
 *  as pills. The whole card opens the event on the team; the timeline's nodes land here. */
export function AppearanceCard({ a }: { a: Appearance }) {
  const body = (
    <>
      <p className="font-medium leading-snug text-foreground group-hover:text-accent-text">{a.title}</p>
      <p className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
        {[...a.badges, a.place, a.seasonLabel].filter(Boolean).map((b) => <span key={b} className="rounded-full bg-accent/[0.1] px-2 py-0.5 font-medium text-accent-text">{b}</span>)}
      </p>
      {a.when && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5 shrink-0" aria-hidden />{a.when}{a.place && <><MapPin className="ml-1.5 size-3.5 shrink-0" aria-hidden />{a.place}</>}</p>}
      <p className="mt-2 flex flex-wrap gap-1" data-pills>
        {a.rank != null && <span className={PILL}><span className="text-muted-foreground">Rank</span><b className="tabular-nums text-foreground">#{a.rank}</b></span>}
        {a.record && <span className={PILL}><span className="text-muted-foreground">Record</span><b className="tabular-nums text-foreground">{a.record.replace(/-/g, "–")}</b></span>}
        {a.opr != null && <span className={PILL}><span className="text-muted-foreground">OPR</span><b className="tabular-nums text-foreground">{a.opr.toFixed(1)}</b></span>}
        {a.more.map((m) => <span key={m} className={cn(PILL, "font-medium text-foreground")}>{m}</span>)}
      </p>
      {a.href && <span className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-accent-text group-hover:underline max-sm:hidden" data-cta>View event<ArrowRight className="size-3.5" aria-hidden /></span>}
    </>
  );
  const cls = "lift group block scroll-mt-24 rounded-xl border border-border bg-card p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent transition-shadow data-[highlight=on]:border-accent data-[highlight=on]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_35%,transparent)]";
  return a.href
    ? <Link id={a.id} to={a.href} className={cls} data-appearance={a.season}>{body}</Link>
    : <div id={a.id} tabIndex={-1} className={cls} data-appearance={a.season}>{body}</div>;
}
