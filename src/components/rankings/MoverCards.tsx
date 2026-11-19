// The week in a glance, as region rankings shows it (src/pages/RegionRankingsPage.tsx) and the conference page borrows
// it (src/pages/ConferencePage.tsx): three cards, biggest climbers, biggest fallers and teams new to the table, each
// row a move arrow and number, the team, and its rank and rating. What the rank is counted in, and why there may be
// no moves, is the caller's to say.
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "../cn";

export interface MoverItem { team: number; name: string | null; rank: number; rating: number; move: number }
export interface NewItem { team: number; name: string | null; rank: number; rating: number }

function Card({ title, icon: Icon, tone, children }: { title: string; icon: typeof TrendingUp; tone: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold v8:font-medium"><Icon className={cn("size-4", tone, "v8:text-text-faint")} aria-hidden />{title}</h3>
      {children}
    </div>
  );
}

/** Climbers and fallers (top 3 each) and newcomers (the first 5, then "and N more"). `rankTitle` says what the rank
 *  beside each team is counted in ("Rank in the region · rating"). */
export function MoverCards({ season, climbers, fallers, newcomers, newTotal, rankTitle, label = "This week's moves" }: {
  season: number; climbers: MoverItem[]; fallers: MoverItem[]; newcomers: NewItem[]; newTotal: number; rankTitle: string; label?: string;
}) {
  const href = (t: number) => `/teams/${t}?season=${season}`;
  const Who = ({ r }: { r: NewItem }) => (
    <>
      <Link to={href(r.team)} className="min-w-0 flex-1 truncate hover:underline"><span className="font-mono font-semibold tabular-nums v8:font-sans">{r.team}</span> {r.name ?? ""}</Link>
      <span className="shrink-0 tabular-nums text-text-muted v8:text-text-faint" title={rankTitle}>#{r.rank} · {r.rating.toFixed(1)}</span>
    </>
  );
  const MoverList = ({ rows, up }: { rows: MoverItem[]; up: boolean }) => rows.length ? (
    <ol className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.team} className="flex items-baseline gap-2" data-mover={r.team}>
          <span className={cn("inline-flex w-12 shrink-0 items-center gap-0.5 font-semibold tabular-nums v8:font-medium", up ? "text-success" : "text-danger v8:text-text-muted")}>
            {up ? <ArrowUp className="size-3.5" strokeWidth={2.5} /> : <ArrowDown className="size-3.5" strokeWidth={2.5} />}{Math.abs(r.move)}
            <span className="sr-only"> places {up ? "up" : "down"}</span>
          </span>
          <Who r={r} />
        </li>
      ))}
    </ol>
  ) : <p className="text-sm text-text-muted">{up ? "No team moved up." : "No team moved down."}</p>;
  const NewList = ({ rows }: { rows: NewItem[] }) => rows.length ? (
    <ol className="space-y-1.5 text-sm">
      {rows.slice(0, 5).map((r) => <li key={r.team} className="flex items-baseline gap-2" data-newcomer={r.team}><Who r={r} /></li>)}
      {newTotal > 5 && <li className="text-xs text-text-muted">and {(newTotal - 5).toLocaleString()} more (sort by Move)</li>}
    </ol>
  ) : <p className="text-sm text-text-muted">No team is new to the table.</p>;
  return (
    <section aria-label={label} className="grid gap-3 sm:grid-cols-3" data-movers>
      <Card title="Biggest climbers" icon={TrendingUp} tone="text-success"><MoverList rows={climbers} up /></Card>
      <Card title="Biggest fallers" icon={TrendingDown} tone="text-danger"><MoverList rows={fallers} up={false} /></Card>
      <Card title={`New to the table${newTotal ? ` (${newTotal.toLocaleString()})` : ""}`} icon={Sparkles} tone="text-accent"><NewList rows={newcomers} /></Card>
    </section>
  );
}
