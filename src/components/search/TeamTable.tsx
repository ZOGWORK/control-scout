// A search answer's list of teams as one table (src/shared/teamTable.ts): a row per team with its season OPR (a thin
// neutral bar under it, from zero to the best OPR listed), each of the OPR's phases, the penalties it gives away and
// its record; no hue on any of it (the search results guide: hue means team only). The OPR, phase and record headers re-sort the rows already sent; nothing is fetched or worked out.
// On a phone the rank, team, OPR and record stay in the row, and the phases open under it on a tap.
import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import { firstDir, hasPhases, phaseNote, sortTeamRows, teamColumns, type TeamSortKey, type TeamTable as Table, type TeamTableRow } from "../../shared/teamTable";
import { cn } from "../cn";
import { INK_BAR, RecordText, TAP } from "./page/answerCells";
import { PODIUM_CHIP } from "../../lib/textTones";
import { TONE, V8_PODIUM } from "./page/v8tone";

// Each phase column in search's palette colour for it, header and numbers (the same colours as every other card).
const P = TONE;

/** The top three's rank badges: bordered and bold, no hue. */
const TOP3: Record<number, string> = { 1: `${PODIUM_CHIP[1]} ${V8_PODIUM[1]}`, 2: `${PODIUM_CHIP[2]} ${V8_PODIUM[2]}`, 3: `${PODIUM_CHIP[3]} ${V8_PODIUM[3]}` };
/** v8: the phase headers read like every other header (faint, sentence case); the numbers are the data. */
const V8_HEAD = "v8:font-medium v8:text-text-faint";
/** v8: the table sits straight on its card (no box in a box): a rule under the header, a hairline between rows that
 *  shows on near-black, 44px+ rows with a hover fill, numbers on the right. */
export const V8_TABLE = {
  frame: "v8:rounded-none v8:border-0 v8:bg-transparent",
  head: "v8:[&_tr]:border-b v8:[&_tr]:border-white/[0.12]",
  row: "v8:h-12 v8:border-white/[0.07] v8:first:border-t-0 v8:hover:bg-white/[0.03]",
  cell: "v8:px-2.5 v8:max-md:px-1.5 v8:py-2 v8:first:pl-1 v8:last:pr-1",
} as const;

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

/** `limit`: draw only the first rows of the sorted list (v8's short ranking; the rest a tap away beside it). */
export function TeamTable({ table, label, limit }: { table: Table; label: string; limit?: number }) {
  const opening = (): Sort => ({ key: table.by, dir: table.dir ?? firstDir(table.by) });
  const [sort, setSort] = useState<Sort>(opening);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  // A new answer in the same place (the page keeps the last one up while the next loads) opens in its own order.
  const [shown, setShown] = useState(table);
  if (shown !== table) { setShown(table); setSort(opening()); setOpen(new Set()); }
  const id = useId();
  const rows = useMemo(() => { const r = sortTeamRows(table.rows, sort.key, sort.dir); return limit != null ? r.slice(0, limit) : r; }, [table.rows, sort, limit]);
  const phases = hasPhases(table.rows);
  const withEndgame = !!table.teleopWithEndgame;
  const columns = teamColumns(withEndgame);
  const def = (k: TeamSortKey) => columns.find((c) => c.key === k)?.def;
  const segments = phaseSegments(withEndgame);
  // The OPR's thin bar scales to the best OPR listed.
  const oprMax = Math.max(1e-9, ...table.rows.map((r) => r.opr ?? 0));
  const onSort = (key: TeamSortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: firstDir(key) }));
  const toggle = (team: number) => setOpen((o) => { const n = new Set(o); if (n.has(team)) n.delete(team); else n.add(team); return n; });

  const th = cn("px-2 py-1.5 font-medium whitespace-nowrap max-md:px-1.5", V8_TABLE.cell, "v8:h-9 v8:py-0");
  // A plain call, not a component: a component made here would be new each render, and its button would lose focus.
  const sortTh = (k: TeamSortKey, children: ReactNode, className?: string, title?: string) => {
    const on = sort.key === k;
    return (
      <th key={k} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn(th, "text-right", className)}>
        <button type="button" onClick={() => onSort(k)} title={title ?? def(k)} data-sort={k} className={cn("inline-flex flex-row-reverse items-center justify-center gap-0.5 rounded hover:text-foreground", TAP, on && "text-foreground")}>
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
  // A list ranked by a number of its own (the asked column) keeps a phone's row to that number and the OPR: the record
  // moves into the row's phases, so the team's name has the room to be read (never cut to a few letters).
  const recordAside = !!table.asked && phases;

  return (
    <figure data-team-table data-sort-key={sort.key} data-sort-dir={sort.dir}>
      <div className={cn("overflow-x-auto rounded-lg border border-border bg-card", V8_TABLE.frame)}>
        <table className="w-full text-sm" aria-label={label}>
          <thead className={cn("bg-muted/50 text-left text-[11px] text-muted-foreground v8:bg-transparent v8:text-[0.75rem] v8:text-text-faint", V8_TABLE.head)}>
            <tr>
              <th scope="col" aria-sort={sort.key === "rank" ? "ascending" : "none"} className={cn(th, "w-8 text-right")}>
                <button type="button" onClick={() => setSort({ key: "rank", dir: "asc" })} title="The list's own order" data-sort="rank" className={cn("rounded hover:text-foreground", TAP, sort.key === "rank" && "text-foreground")}>#</button>
              </th>
              <th scope="col" className={th}>Team</th>
              {table.asked && sortTh("asked", table.asked.label, "max-md:whitespace-normal max-md:leading-tight", table.asked.label)}
              {sortTh("opr", "OPR", cn("md:w-28 v8:md:w-auto", byPhase && "max-md:hidden"))}
              {phases && <>
                {sortTh("auto", "Auto", cn(onPhone("auto"), "font-semibold", P.auto.text, V8_HEAD))}
                {sortTh("dc", withEndgame ? "TeleOp" : "DC", cn(onPhone("dc"), "font-semibold", P.teleop.text, V8_HEAD))}
                {sortTh("endgame", "Endgame", cn(onPhone("endgame"), "font-semibold", P.endgame.text, V8_HEAD))}
                {sortTh("pen", "Pen", cn("max-md:hidden font-semibold", P.pen.text, V8_HEAD))}
              </>}
              {sortTh("record", "W-L-T", recordAside ? "max-md:hidden" : undefined)}
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
                  <tr className={cn("border-t border-border", V8_TABLE.row)} data-team-row={r.team}>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", V8_TABLE.cell)}>
                      {r.rank <= 3
                        ? <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs font-bold", TOP3[r.rank])} data-rank-badge>{r.rank}</span>
                        : <span className="text-xs text-muted-foreground">{r.rank}</span>}
                    </td>
                    <td className={cn("px-2 py-1.5 max-md:w-full max-md:max-w-0 max-md:px-1.5", V8_TABLE.cell, "v8:md:w-full v8:md:min-w-[12rem] v8:md:max-w-0")}>
                      {/* The clamp on the text, not the link: the link's tap padding would show a third line over the town. */}
                      <Link to={r.href} className="block font-medium text-foreground hover:text-accent-text v8:hover:text-foreground hover:underline max-md:min-w-[44px] pointer-coarse:min-w-[44px] max-md:-my-[13px] max-md:py-[13px] pointer-coarse:-my-[13px] pointer-coarse:py-[13px]"><span className="line-clamp-2 break-words v8:md:block v8:md:truncate" title={name}><span className="tabular-nums v8:text-accent">{r.team}</span>{r.name && ` ${r.name}`}</span></Link>
                      {r.location && <span className="block break-words text-[11px] text-muted-foreground v8:text-[0.75rem] v8:text-text-faint v8:md:truncate">{r.location}</span>}
                    </td>
                    {table.asked && <td className={cn("whitespace-nowrap px-2 py-1.5 text-right font-medium tabular-nums text-foreground v8:text-accent", V8_TABLE.cell)} data-asked>{r.asked?.display ?? "–"}</td>}
                    <td className={cn("relative px-2 py-1.5 text-right font-semibold tabular-nums text-foreground v8:text-violet-300", V8_TABLE.cell, byPhase && "max-md:hidden")} data-opr>
                      {/* The bar inset in its own track, so its length is exactly OPR / max of the track. */}
                      {r.opr != null && r.opr > 0 && <span aria-hidden className="absolute inset-x-1 bottom-1 h-1 v8:hidden"><span className={cn("block h-full rounded-full", INK_BAR)} style={{ width: `${(r.opr / oprMax) * 100}%` }} data-opr-bar data-bar data-value={r.opr} data-scale={oprMax} /></span>}
                      <span className="relative">{oneDp(r.opr)}</span>
                    </td>
                    {phases && <>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", V8_TABLE.cell, P.auto.text, onPhone("auto"))} data-phase="auto">{oneDp(r.auto)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", V8_TABLE.cell, P.teleop.text, onPhone("dc"))} data-phase="teleop">{oneDp(r.dc)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums", V8_TABLE.cell, P.endgame.text, onPhone("endgame"))} data-phase="endgame">{oneDp(r.endgame)}</td>
                      <td className={cn("px-2 py-1.5 text-right font-medium tabular-nums max-md:hidden", V8_TABLE.cell, P.pen.text)} data-phase="pen">{oneDp(r.pen)}</td>
                    </>}
                    <td className={cn("whitespace-nowrap px-2 py-1.5 text-right tabular-nums", V8_TABLE.cell, recordAside && "max-md:hidden")}><RecordText text={record(r)} /></td>
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
                        <dl className={cn("grid gap-1 text-[11px] v8:text-[0.75rem]", recordAside ? "grid-cols-5" : "grid-cols-4")}>
                          {segments.map((p) => (
                            <div key={p.key}>
                              <dt className="text-muted-foreground">{p.key === "pen" ? "Pen" : p.label}</dt>
                              <dd className="font-medium tabular-nums text-foreground">{oneDp(r[p.key])}</dd>
                            </div>
                          ))}
                          {recordAside && (
                            <div data-phone-record>
                              <dt className="text-muted-foreground">W-L-T</dt>
                              <dd className="font-medium tabular-nums text-foreground"><RecordText text={record(r)} /></dd>
                            </div>
                          )}
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
        <figcaption className="mt-1.5 space-y-1 text-[11px] text-muted-foreground v8:hidden" data-legend>
          <span className="block" data-phase-note>{phaseNote(withEndgame)}</span>
        </figcaption>
      )}
      <details className="mt-1 text-[11px] text-muted-foreground v8:mt-2 v8:text-[0.75rem] v8:text-text-faint" data-column-defs>
        <summary className="cursor-pointer select-none hover:text-foreground max-md:min-h-[44px] max-md:py-[13px] pointer-coarse:min-h-[44px] pointer-coarse:py-[13px]">What the columns mean</summary>
        {/* v8: the phases' note waits in here with the columns, not under every table. */}
        {phases && <p className="mt-1 hidden v8:block" data-phase-note-v8>{phaseNote(withEndgame)}</p>}
        <dl className="mt-1 space-y-0.5">
          {columns.filter((c) => phases || !["auto", "dc", "endgame", "pen"].includes(c.key)).map((c) => (
            <div key={c.key} className="flex gap-1.5"><dt className="w-14 shrink-0 font-medium text-foreground">{c.label}</dt><dd>{c.def}</dd></div>
          ))}
        </dl>
      </details>
    </figure>
  );
}
