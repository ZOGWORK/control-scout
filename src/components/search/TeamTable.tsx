// A search answer's list of teams as one table (src/shared/teamTable.ts): a row per team with its season OPR (a thin
// neutral bar under it, from zero to the best OPR listed), each of the OPR's phases, the penalties it gives away and
// its record; no hue on any of it (the search results guide: hue means team only). The OPR, phase and record headers re-sort the rows already sent; nothing is fetched or worked out.
// On a phone the rank, team, OPR and record stay in the row, and the phases open under it on a tap.
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { firstDir, hasPhases, phaseNote, sortTeamRows, teamColumns, type TeamSortKey, type TeamTable as Table, type TeamTableRow } from "../../shared/teamTable";
import { cn } from "../cn";
import { INK_BAR, RecordText } from "./page/answerCells";
import { PODIUM_CHIP, SEARCH_PALETTE } from "../../lib/textTones";

// Each phase column in search's palette colour for it, header and numbers (the same colours as every other card).
const P = SEARCH_PALETTE;

/** The top three's rank badges: bordered and bold, no hue. */
const TOP3: Record<number, string> = PODIUM_CHIP;

const oneDp = (v: number | null) => (v == null ? "–" : (Math.round(v * 10) / 10).toFixed(1));
const record = (r: TeamTableRow) => `${r.wins}-${r.losses}-${r.ties}`;

/** The phases, in the order every row lists them. Penalties are points given away, so they stand apart at the end.
 *  `withEndgame`: the
 *  season's TeleOp includes the endgame, so it's named TeleOp and the bar leaves the endgame out (never drawn twice). */
export function phaseSegments(withEndgame = false) {
  return [
    { key: "auto", label: "Auto", drawn: true },
    { key: "dc", label: withEndgame ? "TeleOp" : "DC", drawn: true },
    { key: "endgame", label: "Endgame", drawn: !withEndgame },
    { key: "pen", label: "Pen (given away)", drawn: true },
  ] as const;
}

type Sort = { key: TeamSortKey; dir: "asc" | "desc" };

export function TeamTable({ table, label }: { table: Table; label: string }) {
  const opening = (): Sort => ({ key: table.by, dir: table.dir ?? firstDir(table.by) });
  const [sort, setSort] = useState<Sort>(opening);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  // A new answer in the same place (the page keeps the last one up while the next loads) opens in its own order.
  const [shown, setShown] = useState(table);
  if (shown !== table) { setShown(table); setSort(opening()); setOpen(new Set()); }
  const id = useId();
  const rows = useMemo(() => sortTeamRows(table.rows, sort.key, sort.dir), [table.rows, sort]);
  const phases = hasPhases(table.rows);
  const withEndgame = !!table.teleopWithEndgame;
  const columns = teamColumns(withEndgame);
  const def = (k: TeamSortKey) => columns.find((c) => c.key === k)?.def;
  const segments = phaseSegments(withEndgame);
  // The OPR's thin bar scales to the best OPR listed.
  const oprMax = Math.max(1e-9, ...table.rows.map((r) => r.opr ?? 0));
  const onSort = (key: TeamSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) }));
  const toggle = (team: number) => setOpen((o) => { const n = new Set(o); if (n.has(team)) n.delete(team); else n.add(team); return n; });

  const th = "px-2 py-1.5 font-medium whitespace-nowrap max-md:px-1.5";
  // A plain call, not a component: a component made here would be new each render, and its button would lose focus.
  const sortTh = (k: TeamSortKey, children: ReactNode, className?: string, title?: string) => {
    const on = sort.key === k;
    return (
      <th key={k} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn(th, "text-right", className)}>
        <button type="button" onClick={() => onSort(k)} title={title ?? def(k)} data-sort={k} className={cn("inline-flex flex-row-reverse items-center gap-0.5 rounded hover:text-foreground max-md:min-h-[44px] pointer-coarse:min-h-[44px]", on && "text-foreground")}>
          {children}{on ? (sort.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />) : <span className="size-3" aria-hidden />}
        </button>
      </th>
    );
  };
  // Every column: rank, team, (asked), OPR, (four phases), record, (the phone's toggle). No stacked phase bar: each
  // phase is its own column.
  const cols = 4 + (table.asked ? 1 : 0) + (phases ? 5 : 0);
  // A list ranked by a phase ("best auto"): on a phone that phase's column is the number shown, not the OPR (§8).
  const byPhase = phases && (table.by === "auto" || table.by === "dc" || table.by === "endgame");
  const onPhone = (k: TeamSortKey) => (byPhase && k === table.by ? "" : "max-md:hidden");

  return (
    <figure data-team-table data-sort-key={sort.key} data-sort-dir={sort.dir}>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm" aria-label={label}>
          <thead className="bg-muted/50 text-left text-[11px] text-muted-foreground">
            <tr>
              <th scope="col" aria-sort={sort.key === "rank" ? "ascending" : "none"} className={cn(th, "w-8 text-right")}>
                <button type="button" onClick={() => setSort({ key: "rank", dir: "asc" })} title="The list's own order" data-sort="rank" className={cn("rounded hover:text-foreground max-md:min-h-[44px] max-md:min-w-[24px] pointer-coarse:min-h-[44px]", sort.key === "rank" && "text-foreground")}>#</button>
              </th>
              <th scope="col" className={th}>Team</th>
              {table.asked && sortTh("asked", table.asked.label, "max-md:whitespace-normal max-md:leading-tight", table.asked.label)}
              {sortTh("opr", "OPR", cn("md:w-28", byPhase && "max-md:hidden"))}
              {phases && <>
                {sortTh("auto", "Auto", cn(onPhone("auto"), "font-semibold", P.auto.text))}
                {sortTh("dc", withEndgame ? "TeleOp" : "DC", cn(onPhone("dc"), "font-semibold", P.teleop.text))}
                {sortTh("endgame", "Endgame", cn(onPhone("endgame"), "font-semibold", P.endgame.text))}
                {sortTh("pen", "Pen", cn("max-md:hidden font-semibold", P.pen.text))}
              </>}
              {sortTh("record", "W-L-T")}
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
                        ? <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs font-bold", TOP3[r.rank])} data-rank-badge>{r.rank}</span>
                        : <span className="text-xs text-muted-foreground">{r.rank}</span>}
                    </td>
                    <td className="px-2 py-1.5 max-md:w-full max-md:max-w-0 max-md:px-1.5">
                      <Link to={r.href} className="line-clamp-2 break-words font-medium text-foreground hover:text-accent-text hover:underline max-md:-my-[13px] max-md:py-[13px] md:block pointer-coarse:-my-[13px] pointer-coarse:py-[13px]"><span className="tabular-nums">{r.team}</span>{r.name && ` ${r.name}`}</Link>
                      {r.location && <span className="block break-words text-[11px] text-muted-foreground">{r.location}</span>}
                    </td>
                    {table.asked && <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums text-foreground" data-asked>{r.asked?.display ?? "–"}</td>}
                    <td className={cn("relative px-2 py-1.5 text-right font-semibold tabular-nums text-foreground", byPhase && "max-md:hidden")} data-opr>
                      {/* The bar inset in its own track, so its length is exactly OPR / max of the track. */}
                      {r.opr != null && r.opr > 0 && <span aria-hidden className="absolute inset-x-1 bottom-1 h-1"><span className={cn("block h-full rounded-full", INK_BAR)} style={{ width: `${(r.opr / oprMax) * 100}%` }} data-opr-bar data-bar data-value={r.opr} data-scale={oprMax} /></span>}
                      <span className="relative">{oneDp(r.opr)}</span>
                    </td>
                    {phases && <>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", P.auto.text, onPhone("auto"))} data-phase="auto">{oneDp(r.auto)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", P.teleop.text, onPhone("dc"))} data-phase="teleop">{oneDp(r.dc)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", P.endgame.text, onPhone("endgame"))} data-phase="endgame">{oneDp(r.endgame)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums max-md:hidden", P.pen.text)} data-phase="pen">{oneDp(r.pen)}</td>
                    </>}
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"><RecordText text={record(r)} /></td>
                    {phases && (
                      <td className="py-1 pr-1 md:hidden">
                        <button type="button" onClick={() => toggle(r.team)} aria-expanded={isOpen} aria-controls={more} aria-label={`${isOpen ? "Hide" : "Show"} phases for ${name}`} data-expand={r.team}
                          className="inline-flex size-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
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
                              <dt className="text-muted-foreground">{p.key === "pen" ? "Pen" : p.label}</dt>
                              <dd className="font-medium tabular-nums text-foreground">{oneDp(r[p.key])}</dd>
                            </div>
                          ))}
                        </dl>
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
          <span className="block" data-phase-note>{phaseNote(withEndgame)}</span>
        </figcaption>
      )}
      <details className="mt-1 text-[11px] text-muted-foreground" data-column-defs>
        <summary className="cursor-pointer select-none hover:text-foreground max-md:min-h-[44px] max-md:py-[13px] pointer-coarse:min-h-[44px] pointer-coarse:py-[13px]">What the columns mean</summary>
        <dl className="mt-1 space-y-0.5">
          {columns.filter((c) => phases || !["auto", "dc", "endgame", "pen"].includes(c.key)).map((c) => (
            <div key={c.key} className="flex gap-1.5"><dt className="w-14 shrink-0 font-medium text-foreground">{c.label}</dt><dd>{c.def}</dd></div>
          ))}
        </dl>
      </details>
    </figure>
  );
}
