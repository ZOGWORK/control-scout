// A search answer's list of teams as one table (src/shared/teamTable.ts): a row per team with its season OPR (a bar
// under it, scaled to the best OPR listed), the OPR's phases with a stacked bar of them, the penalties it gives away
// and its record. The OPR, phase and record headers re-sort the rows already sent; nothing is fetched or worked out.
// On a phone the rank, team, OPR and record stay in the row, and the phases open under it on a tap.
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { firstDir, hasPhases, phaseNote, sortTeamRows, teamColumns, type TeamSortKey, type TeamTable as Table, type TeamTableRow } from "../../shared/teamTable";
import { cn } from "../cn";

const oneDp = (v: number | null) => (v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));
const record = (r: TeamTableRow) => `${r.wins}-${r.losses}-${r.ties}`;

/** The phases, in the order every row stacks them, with their colours (the team page's: auto sky, TeleOp emerald,
 *  endgame violet). Penalties are points given away, so they stand apart at the end of the bar. `withEndgame`: the
 *  season's TeleOp includes the endgame, so it's named TeleOp and the bar leaves the endgame out (never drawn twice). */
export function phaseSegments(withEndgame = false) {
  return [
    { key: "auto", label: "Auto", tone: "bg-chart-2", drawn: true },
    { key: "dc", label: withEndgame ? "TeleOp" : "DC", tone: "bg-chart-3", drawn: true },
    { key: "endgame", label: "Endgame", tone: "bg-chart-4", drawn: !withEndgame },
    { key: "pen", label: "Pen (given away)", tone: "bg-danger/70", drawn: true },
  ] as const;
}

type Sort = { key: TeamSortKey; dir: "asc" | "desc" };

export function TeamTable({ table, label }: { table: Table; label: string }) {
  const [sort, setSort] = useState<Sort>({ key: table.by, dir: firstDir(table.by) });
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const id = useId();
  const rows = useMemo(() => sortTeamRows(table.rows, sort.key, sort.dir), [table.rows, sort]);
  const phases = hasPhases(table.rows);
  const withEndgame = !!table.teleopWithEndgame;
  const columns = teamColumns(withEndgame);
  const def = (k: TeamSortKey) => columns.find((c) => c.key === k)?.def;
  const segments = phaseSegments(withEndgame);
  const drawn = segments.filter((p) => p.drawn);
  // The OPR bars scale to the best OPR listed; the phase bars to the biggest drawn phase total listed (never the OPR).
  const oprMax = Math.max(1e-9, ...table.rows.map((r) => r.opr ?? 0));
  const pos = (v: number | null) => Math.max(0, v ?? 0);
  const phaseMax = Math.max(1e-9, ...table.rows.map((r) => drawn.reduce((t, p) => t + pos(r[p.key]), 0)));
  const onSort = (key: TeamSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) }));
  const toggle = (team: number) => setOpen((o) => { const n = new Set(o); if (n.has(team)) n.delete(team); else n.add(team); return n; });

  const th = "px-2 py-1.5 font-medium whitespace-nowrap max-md:px-1.5";
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
  // A negative OPR (a fit below zero) gets no segment, and the bar's label says so rather than reading it as zero.
  const bar = (r: TeamTableRow, wide?: boolean) => (
    <span role="img" aria-label={drawn.map((p) => `${p.label} ${oneDp(r[p.key])}${(r[p.key] ?? 0) < 0 ? " (below zero, not drawn)" : ""}`).join(", ")} className={cn("flex h-2 items-center gap-px", wide ? "w-full" : "w-28")} data-phase-bar>
      {drawn.map((p) => (
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
              {table.asked && sortTh("asked", table.asked.label, "max-md:whitespace-normal max-md:leading-tight", table.asked.label)}
              {sortTh("opr", "OPR", "md:w-28")}
              {phases && <>
                {sortTh("auto", "Auto", "max-md:hidden")}
                {sortTh("dc", withEndgame ? "TeleOp" : "DC", "max-md:hidden")}
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
                    <td className="px-2 py-1.5 max-md:w-full max-md:max-w-0 max-md:px-1.5">
                      <Link to={r.href} className="line-clamp-2 break-words font-medium text-foreground hover:text-accent-text hover:underline md:block md:truncate"><span className="tabular-nums">{r.team}</span>{r.name && ` ${r.name}`}</Link>
                      {r.location && <span className="block truncate text-[11px] text-muted-foreground">{r.location}</span>}
                    </td>
                    {table.asked && <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums text-foreground" data-asked>{r.asked?.display ?? "–"}</td>}
                    <td className="relative px-2 py-1.5 text-right font-semibold tabular-nums text-foreground" data-opr>
                      {r.opr != null && r.opr > 0 && <span aria-hidden className="absolute bottom-1 left-1 h-1 rounded-full bg-accent/70" style={{ width: `calc(${(r.opr / oprMax) * 100}% - 0.5rem)` }} data-opr-bar />}
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
                          {segments.map((p) => (
                            <div key={p.key}>
                              <dt className="flex items-center gap-1 text-muted-foreground"><span className={cn("size-2 rounded-sm", p.drawn ? p.tone : "bg-muted-foreground/40")} aria-hidden />{p.key === "pen" ? "Pen" : p.label}</dt>
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
            {drawn.map((p) => <span key={p.key} className="inline-flex items-center gap-1"><span className={cn("size-2 rounded-sm", p.tone)} aria-hidden />{p.label}</span>)}
          </span>
          <span className="block" data-phase-note>{phaseNote(withEndgame)}</span>
        </figcaption>
      )}
      <details className="mt-1 text-[11px] text-muted-foreground" data-column-defs>
        <summary className="cursor-pointer select-none hover:text-foreground">What the columns mean</summary>
        <dl className="mt-1 space-y-0.5">
          {columns.filter((c) => phases || !["auto", "dc", "endgame", "pen"].includes(c.key)).map((c) => (
            <div key={c.key} className="flex gap-1.5"><dt className="w-14 shrink-0 font-medium text-foreground">{c.label}</dt><dd>{c.def}</dd></div>
          ))}
        </dl>
      </details>
    </figure>
  );
}
