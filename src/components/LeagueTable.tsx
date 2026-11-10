// A league's standings table (src/shared/leagues.ts): FIRST's league rank, the team, its ranking score (FIRST's first
// sort key), record, matches and meets played. One team's row can be marked (the asked team, the team page's own) and,
// in a capped box (`maxRows`), is scrolled into view. Phones get numbers only: the team as its number, a tap for the name.
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { cn } from "./cn";
import { TeamNumber } from "./records/RecordsTable";
import { leagueRecord, rankingScore, type LeagueStandingRow } from "../shared/leagues";

const TH = "h-9 whitespace-nowrap px-2.5 text-[10px] font-bold uppercase tracking-wider text-text-muted max-sm:px-1.5";
const TD = "whitespace-nowrap px-2.5 py-1.5 max-sm:px-1.5";

export function LeagueTable({ rows, season, team, maxRows }: { rows: LeagueStandingRow[]; season: number; team?: number | null; maxRows?: number }) {
  const box = useRef<HTMLDivElement>(null);
  // The marked row in view inside the box (never the page: that stays where the reader is).
  useEffect(() => {
    const b = box.current, tr = b?.querySelector<HTMLElement>("tr[data-marked]");
    if (!b || !tr || b.scrollHeight <= b.clientHeight) return;
    b.scrollTop += tr.getBoundingClientRect().top - b.getBoundingClientRect().top - b.clientHeight / 2 + tr.offsetHeight / 2;
  }, [rows, team]);
  const capped = maxRows != null && rows.length > maxRows;
  return (
    <div ref={box} data-league-table className={cn("custom-scrollbar overflow-auto rounded-xl border border-border bg-card", capped && "max-h-[23rem]")}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="border-b border-border">
            <th scope="col" className={cn(TH, "text-right")}>Rank</th>
            <th scope="col" className={cn(TH, "text-left")}>Team</th>
            <th scope="col" className={cn(TH, "text-right")} title="Ranking score: FIRST's first sort key, average ranking points per match over the league's meets">RS</th>
            <th scope="col" className={cn(TH, "text-right")}>W-L-T</th>
            <th scope="col" className={cn(TH, "text-right")} title="Qualification matches played across the league's meets">Matches</th>
            <th scope="col" className={cn(TH, "text-right")} title="League meets played">Meets</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const marked = r.team === team;
            const href = `/teams/${r.team}?season=${season}`;
            return (
              <tr key={r.team} data-marked={marked ? "" : undefined} aria-current={marked ? "true" : undefined}
                className={cn("border-b border-border last:border-b-0", marked && "bg-muted font-semibold shadow-[inset_3px_0_0_var(--color-text-base)]")}>
                <td className={cn(TD, "text-right tabular-nums")}>{r.rank}</td>
                <td className={cn(TD, "max-w-[16rem] truncate")}>
                  <span className="sm:hidden"><TeamNumber team={r.team} name={r.name ?? ""} href={href} /></span>
                  <Link to={href} className="hover:underline max-sm:hidden"><span className="font-mono font-medium tabular-nums">{r.team}</span> <span className={cn(!marked && "text-muted-foreground")}>{r.name}</span></Link>
                </td>
                <td className={cn(TD, "text-right tabular-nums")}>{rankingScore(r.rs) ?? "—"}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{leagueRecord(r) ?? "—"}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{r.played ?? "—"}</td>
                <td className={cn(TD, "text-right tabular-nums")}>{r.meets}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
