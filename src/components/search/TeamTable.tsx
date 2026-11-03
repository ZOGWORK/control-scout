// A search answer's list of teams as one table (src/shared/teamTable.ts): a row per team with its season OPR (a bar
// behind it, scaled to the best OPR listed), the OPR's phases with a stacked bar of them, the penalties it gives away
// and its record. The OPR, phase and record headers re-sort the rows already sent; nothing is fetched or worked out.
// On a phone the rank, team, OPR and record stay in the row, and the phases open under it on a tap.
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { PHASE_NOTE, TEAM_COLUMNS, firstDir, hasPhases, sortTeamRows, type TeamSortKey, type TeamTable as Table, type TeamTableRow } from "../../shared/teamTable";
import { cn } from "../cn";

const oneDp = (v: number | null) => (v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));
const record = (r: TeamTableRow) => `${r.wins}-${r.losses}-${r.ties}`;
const def = (k: TeamSortKey) => TEAM_COLUMNS.find((c) => c.key === k)?.def;

/** The phases, in the order every row stacks them, with their colours (the team page's: auto sky, TeleOp emerald,
 *  endgame violet). Penalties are points given away, so they stand apart at the end of the bar. */
export const PHASE_SEGMENTS = [
  { key: "auto", label: "Auto", tone: "bg-chart-2" },
  { key: "dc", label: "DC", tone: "bg-chart-3" },
  { key: "endgame", label: "Endgame", tone: "bg-chart-4" },
  { key: "pen", label: "Pen (given away)", tone: "bg-danger/70" },
] as const;

type Sort = { key: TeamSortKey; dir: "asc" | "desc" };

export function TeamTable({ table, label }: { table: Table; label: string }) {
  const [sort, setSort] = useState<Sort>({ key: table.by, dir: firstDir(table.by) });
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const id = useId();
  const rows = useMemo(() => sortTeamRows(table.rows, sort.key, sort.dir), [table.rows, sort]);
  const phases = hasPhases(table.rows);
  // The OPR bars scale to the best OPR listed; the phase bars to the biggest phase total listed (never the OPR).
  const oprMax = Math.max(1e-9, ...table.rows.map((r) => r.opr ?? 0));
  const pos = (v: number | null) => Math.max(0, v ?? 0);
  const phaseMax = Math.max(1e-9, ...table.rows.map((r) => pos(r.auto) + pos(r.dc) + pos(r.endgame) + pos(r.pen)));
  const onSort = (key: TeamSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) }));
  const toggle = (team: number) => setOpen((o) => { const n = new Set(o); if (n.has(team)) n.delete(team); else n.add(team); return n; });

  const th = "px-2 py-1.5 font-medium whitespace-nowrap";
  // A plain call, not a component: a component made here would be new each render, and its button would lose focus.
  const sortTh = (k: TeamSortKey, children: ReactNode, className?: string, title?: string) => {
    const on = sort.key === k;
    return (
      <th key={k} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn(th, "text-right", className)}>
        <button type="button" onClick={() => onSort(k)} title={title ?? def(k)} data-sort={k} className={cn("inline-flex flex-row-reverse items-center gap-0.5 rounded hover:text-foreground", on && "text-foreground")}>
          {children}{on ? (sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />) : <span className="size-3" aria-hidden />}
        </button>
      </th>
    );
  };
  const bar = (r: TeamTableRow, wide?: boolean) => (
    <span role="img" aria-label={PHASE_SEGMENTS.map((p) => `${p.label} ${oneDp(r[p.key])}`).join(", ")} className={cn("flex h-2 items-center gap-px", wide ? "w-full" : "w-28")} data-phase-bar>
      {PHASE_SEGMENTS.map((p) => (
        <span key={p.key} className={cn("h-full first:rounded-l-sm last:rounded-r-sm", p.tone, p.key === "pen" && pos(r.pen) > 0 && "ml-1 rounded-sm")} style={{ width: `${(pos(r[p.key]) / phaseMax) * 100}%` }} />
      ))}
    </span>
  );
  // Every column: rank, team, (asked), OPR, (four phases), record, (the phase bar and the phone's toggle).
  const cols = 4 + (table.asked ? 1 : 0) + (phases ? 6 : 0);

  return (
    <figure data-team-table data-sort-key={sort.key} data-sort-dir={sort.dir}>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm" aria-label={label}>
          <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" aria-sort={sort.key === "rank" ? "ascending" : "none"} className={cn(th, "w-8 text-right")}>
                <button type="button" onClick={() => setSort({ key: "rank", dir: "asc" })} title="The list's own order" data-sort="rank" className={cn("rounded hover:text-foreground", sort.key === "rank" && "text-foreground")}>#</button>
              </th>
              <th scope="col" className={th}>Team</th>
              {table.asked && sortTh("asked", table.asked.label, undefined, table.asked.label)}
              {sortTh("opr", "OPR", "w-24")}
              {phases && <>
                {sortTh("auto", "Auto", "max-md:hidden")}
                {sortTh("dc", "DC", "max-md:hidden")}
                {sortTh("endgame", "Endgame", "max-md:hidden")}
                {sortTh("pen", "Pen", "max-md:hidden")}
              </>}
              {sortTh("record", "W-L-T")}
              {phases && <th scope="col" className={cn(th, "max-md:hidden")}><span className="sr-only">Phases, scaled to the biggest total listed</span></th>}
              {phases && <th scope="col" className="w-8 md:hidden"><span className="sr-only">Phases</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open.has(r.team);
              const more = `${id}-${r.team}`;
              const name = `${r.team}${r.name ? ` ${r.name}` : ""}`;
              return (
                <Fragment key={r.team}>
                  <tr className="border-t border-border" data-team-row={r.team}>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.rank <= 3
                        ? <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent-text" data-rank-badge>{r.rank}</span>
                        : <span className="text-xs text-muted-foreground">{r.rank}</span>}
                    </td>
                    <td className="max-w-0 px-2 py-1.5 md:max-w-none">
                      <Link to={r.href} className="block truncate font-medium text-foreground hover:text-accent-text hover:underline"><span className="tabular-nums">{r.team}</span>{r.name && ` ${r.name}`}</Link>
                      {r.location && <span className="block truncate text-[11px] text-muted-foreground">{r.location}</span>}
                    </td>
                    {table.asked && <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums text-foreground" data-asked>{r.asked?.display ?? "–"}</td>}
                    <td className="relative px-2 py-1.5 text-right font-semibold tabular-nums text-foreground" data-opr>
                      {r.opr != null && r.opr > 0 && <span aria-hidden className="absolute inset-y-1 left-1 rounded-sm bg-accent/20" style={{ width: `calc(${(r.opr / oprMax) * 100}% - 0.5rem)` }} data-opr-bar />}
                      <span className="relative">{oneDp(r.opr)}</span>
                    </td>
                    {phases && <>
                      <td className="px-2 py-1.5 text-right tabular-nums max-md:hidden">{oneDp(r.auto)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums max-md:hidden">{oneDp(r.dc)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums max-md:hidden">{oneDp(r.endgame)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground max-md:hidden">{oneDp(r.pen)}</td>
                    </>}
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{record(r)}</td>
                    {phases && <td className="px-2 py-1.5 max-md:hidden">{bar(r)}</td>}
                    {phases && (
                      <td className="py-1 pr-1 md:hidden">
                        <button type="button" onClick={() => toggle(r.team)} aria-expanded={isOpen} aria-controls={more} aria-label={`${isOpen ? "Hide" : "Show"} phases for ${name}`} data-expand={r.team}
                          className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                          <ChevronDown className={cn("size-4 transition-transform", isOpen && "rotate-180")} aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                  {phases && (
                    <tr id={more} hidden={!isOpen} className="md:hidden" data-phases-row={r.team}>
                      <td colSpan={cols} className="px-3 pb-2.5 pt-0.5">
                        <dl className="grid grid-cols-4 gap-1 text-[11px]">
                          {PHASE_SEGMENTS.map((p) => (
                            <div key={p.key}>
                              <dt className="flex items-center gap-1 text-muted-foreground"><span className={cn("size-2 rounded-sm", p.tone)} aria-hidden />{p.key === "pen" ? "Pen" : p.label}</dt>
                              <dd className="font-medium tabular-nums text-foreground">{oneDp(r[p.key])}</dd>
                            </div>
                          ))}
                        </dl>
                        <div className="mt-1.5">{bar(r, true)}</div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {phases && (
        <figcaption className="mt-1.5 space-y-1 text-[11px] text-muted-foreground" data-legend>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {PHASE_SEGMENTS.map((p) => <span key={p.key} className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-sm", p.tone)} aria-hidden />{p.label}</span>)}
          </span>
          <span className="block" data-phase-note>{PHASE_NOTE}</span>
        </figcaption>
      )}
      <details className="mt-1 text-[11px] text-muted-foreground" data-column-defs>
        <summary className="cursor-pointer select-none hover:text-foreground">What the columns mean</summary>
        <dl className="mt-1 space-y-0.5">
          {TEAM_COLUMNS.filter((c) => phases || !["auto", "dc", "endgame", "pen"].includes(c.key)).map((c) => (
            <div key={c.key} className="flex gap-1.5"><dt className="w-14 shrink-0 font-medium text-foreground">{c.label}</dt><dd>{c.def}</dd></div>
          ))}
        </dl>
      </details>
    </figure>
  );
}
