// A comparison answer on /search (two or three teams' numbers; server/api/answers/compareBlock.ts), built to the search
// results guide's contract (.claude/search-viz-guide-2026-11-05.txt §10): the teams named once in the title, one
// headline saying the result, one context line, then a row per metric with each team's bar from zero to the row's own
// maximum (printed), the value at the bar's end and the gap once, right-aligned; one footnote line with the method
// behind an info button, one primary action. Hue means team only (--color-team-a/b/c): no phase colour, no winner
// colour (the better value is bold), gold never on data.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CompareRow, StatAnswer, StatBlock } from "../../../shared/searchStat";
import { teamFill } from "../../../lib/textTones";
import { cn } from "../../cn";
import { buttonVariants } from "../../ui/button";
import { MethodNote, TAP } from "./answerCells";

type Compare = Extract<StatBlock, { kind: "compare" }>;
type Who = { number: number; name: string | null };

/** The answer's comparison block, when it is one: two teams or more and a compare block. */
export function comparisonOf(stat: StatAnswer): Compare | null {
  if (!stat.teams || stat.teams.length < 2) return null;
  return (stat.blocks.find((b) => b.kind === "compare") as Compare | undefined) ?? null;
}

/** A bar's width, value over the row's maximum from zero: the only way a bar is drawn (the lie-factor test reads it). */
export const barPc = (v: number | null | undefined, max: number) => (v == null || !(max > 0) ? 0 : (100 * Math.max(0, v)) / max);

/** A row's maximum in its values' unit: a share (values in %) as a percentage, a count or score as itself. */
const fmtMax = (n: number, values: string[]) => (values.some((v) => /%$/.test(v)) && n <= 1 ? `${Math.round(100 * n)}%` : Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(1));

export function CompareCard({ stat, b, extra }: { stat: StatAnswer; b: Compare; extra?: ReactNode }) {
  const teams: Who[] = stat.teams ?? [];
  const h = stat.headline;
  const links = stat.blocks.find((x) => x.kind === "links") as Extract<StatBlock, { kind: "links" }> | undefined;
  const primary = links?.items.find((l) => /^Open in Predict$/.test(l.label));
  const rest = links?.items.filter((l) => l !== primary) ?? [];
  const eyebrow = [...stat.scope, b.title].join(" · ");
  const title = teams.map((t) => `${t.number}${t.name ? ` ${t.name}` : ""}`).join(" — ");
  return (
    <article aria-label={title} className="mb-5 rounded-2xl border border-border bg-card p-4 sm:p-6" data-answer-frame data-comparison data-stat-answer={stat.intent} data-family={stat.family}>
      <p className="text-xs text-muted-foreground" data-eyebrow>{eyebrow}</p>
      <h3 className="mt-1 break-words font-display text-xl font-bold leading-snug text-foreground sm:text-2xl" data-answer-title>{title}</h3>
      {h && (
        <>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 font-display text-[28px] font-semibold leading-tight tabular-nums text-foreground sm:text-4xl" data-headline>
            {h.href ? <Link to={h.href} className={cn("inline-flex items-center hover:underline", TAP)}>{h.value}</Link> : <span>{h.value}</span>}
            {h.label && <span className="text-xl font-bold sm:text-2xl">{h.label}</span>}
          </p>
          {h.sub && <p className="mt-1 text-sm tabular-nums text-muted-foreground" data-context>{h.sub}</p>}
        </>
      )}
      {stat.none && <p className="mt-3 text-sm text-foreground" data-none>— {stat.none}</p>}
      {!!b.rows.length && (
        <>
          {/* Which hue is which team: sticky on a phone, so it stays in view down the rows (under the phone search bar). */}
          <p className="sticky top-[calc(var(--header-h,0px)+var(--phone-search-h,0px))] z-10 -mx-4 mt-4 flex flex-wrap gap-x-4 gap-y-1 border-b border-border bg-card px-4 py-2 text-sm font-medium tabular-nums text-foreground sm:static sm:mx-0 sm:border-0 sm:px-0 sm:py-0" data-team-key>
            {teams.map((t, i) => <Link key={t.number} to={b.teams[i]?.href ?? `/teams/${t.number}`} className="inline-flex min-h-[44px] min-w-[44px] items-center gap-1.5 hover:underline sm:min-h-0 sm:min-w-0"><span aria-hidden className={cn("size-3 rounded-sm", teamFill(i))} />{t.number}</Link>)}
          </p>
          <div className="mt-2 space-y-5" data-block="compare">
            {b.rows.map((r) => <Metric key={r.label} r={r} teams={teams} />)}
          </div>
        </>
      )}
      {extra}
      <MethodNote lead={b.scale ? `Bars start at 0; each row's max is ${b.scale} · ` : ""} source={stat.source} definition={stat.definition}>
        {(primary || rest.length > 0) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {primary && <Link to={primary.href} className={cn(buttonVariants(), "min-h-[44px]", TAP)} data-primary-cta>{primary.label}</Link>}
            {rest.map((l) => <Link key={l.href} to={l.href} className="inline-flex min-h-[44px] items-center font-medium text-foreground underline decoration-border underline-offset-2 hover:text-accent-text">{l.label}</Link>)}
          </p>
        )}
      </MethodNote>
    </article>
  );
}

/** One metric: its label, the scale's maximum and the gap, then a bar per team (a row of values when it has no scale). */
function Metric({ r, teams }: { r: CompareRow; teams: Who[] }) {
  return (
    <div data-metric={r.label}>
      <div className="flex items-baseline gap-2 text-sm">
        <span className="font-medium text-foreground">{r.label}</span>
        {r.max != null && <span className="text-xs text-muted-foreground" data-max>max {fmtMax(r.max, r.values)}</span>}
        {r.note && <span className="text-xs text-muted-foreground" data-note>{r.note}</span>}
        <span className="ml-auto font-semibold tabular-nums text-foreground" data-gap>{r.gap ?? ""}</span>
      </div>
      <div className="mt-1.5 space-y-1">
        {teams.map((t, i) => {
          const best = r.best === i;
          const v = r.values[i];
          const missing = v == null || v === "–" || v === "—" || (r.max != null && r.nums?.[i] == null);
          return (
            <div key={t.number} className="flex items-center gap-2 text-sm tabular-nums" data-bar-row={t.number}>
              <span className="w-12 shrink-0 text-xs text-muted-foreground">{t.number}</span>
              {r.max != null ? (
                <span className="relative mr-14 h-3 flex-1" aria-hidden>
                  <span className={cn("absolute inset-y-0 left-0 rounded-sm", teamFill(i))} style={{ width: `${barPc(r.nums?.[i], r.max)}%` }}
                    data-bar data-value={r.nums?.[i] ?? ""} data-scale={r.max} />
                  <span className={cn("absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 leading-none text-foreground", best && "font-bold")} style={{ left: `${barPc(r.nums?.[i], r.max)}%` }} data-value-label>
                    {missing ? "— not on record" : v}
                  </span>
                </span>
              ) : (
                <span className={cn("text-foreground", best && "font-bold")}>{missing ? "— not on record" : v}</span>
              )}
              {r.max != null && <span className="sr-only">{t.number} {r.label}: {missing ? "not on record" : v}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
