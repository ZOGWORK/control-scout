// v8's first screen on Event day (docs/design/v8-revamp-brief.md §7.7): the scout's job is "record the next
// thing, fast", so the next match comes first as a big label with one big Scout button, then the next pit team as
// a plain row. What the scout watches sits under the label with a Change that opens the strip; the progress so
// far is a quiet line of three counts. Every number is the one EventDay works out (src/shared/scoutProgress.ts),
// so this and the queues below always agree. Only drawn in v8; the classic look keeps its strip and tiles.
import { useId, useState } from "react";
import { ArrowRight, Check, PenLine } from "lucide-react";
import { teamsWatched, type ScheduleMatch, type Watching } from "../../../shared/scoutMatch";
import { Button } from "../../ui/button";
import { Skeleton } from "../../states";
import { cn } from "../../cn";
import { WatchStrip } from "./WatchStrip";

/** "Red 1", "Blue alliance", "All 4 teams": what the scout watches, in words. */
export function watchingWords(w: Watching): string {
  if (w.kind === "all") return "All 4 teams";
  if (w.kind === "alliance") return w.side === "red" ? "Red alliance" : "Blue alliance";
  return `${w.slot.startsWith("red") ? "Red" : "Blue"} ${w.slot.slice(-1)}`;
}

export interface NextUpProps {
  /** The schedule's state (useEventSchedule's). */
  status: "loading" | "ready" | "none" | "error";
  /** The next match to scout, or null (none left, or no schedule). */
  match: ScheduleMatch | null;
  /** Its time as the queue shows it ("10:42 AM"), or "". */
  time: string;
  watching: Watching;
  onWatching: (w: Watching) => void;
  readOnly: boolean;
  onMatch: (label: string) => void;
  onManualMatch: () => void;
  /** The next pit team to visit (null: none, or no team list). */
  pit: { team: number; name?: string | null } | null;
  onPit: (team: number) => void;
  progress: { matches: { done: number; total: number }; pit: { done: number; total: number }; today: number };
}

const pct = (p: { done: number; total: number }) => (p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : 0);

export function NextUp(p: NextUpProps) {
  const [changing, setChanging] = useState(false);
  const stripId = useId();
  const teams = p.match ? teamsWatched(p.match, p.watching) : [];
  const allDone = p.status === "ready" && !p.match && p.progress.matches.total > 0;
  return (
    <div className="grid gap-3" data-next-up>
      <section aria-label="Next to scout" className="rounded-xl border border-line bg-card p-5 max-sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <p className="text-xs text-text-faint">
              {p.match ? <>Next up{p.time && <> · <span className="tabular-nums">~{p.time}</span></>}</> : allDone ? "All caught up" : "Next match"}
            </p>
            {p.status === "loading" ? <Skeleton className="mt-1.5 h-10 w-28 rounded-md" />
              : p.match ? <p className="mt-1 font-display text-[2.5rem] font-semibold leading-none tracking-tight tabular-nums text-text-base" data-next-label>{p.match.label}</p>
              : <p className="mt-1 text-[1.0625rem] font-semibold text-text-base">
                  {allDone ? "Every match you watch is scouted" : p.status === "error" ? "Couldn't load the schedule" : "No schedule yet"}
                </p>}
            {/* What's watched, and the teams it means in this match, with the one way to change it. */}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
              <span>Watching {watchingWords(p.watching)}</span>
              {teams.length > 0 && teams.length < 4 && <span className="inline-flex gap-2" aria-label={`Teams: ${teams.map((t) => t.team).join(", ")}`}>
                {teams.map((t) => <span key={t.team} className={cn("font-mono font-semibold tabular-nums", t.side === "red" ? "text-red-alliance-text" : "text-blue-alliance-text")}>{t.team}</span>)}
              </span>}
              {!p.readOnly && <button type="button" aria-expanded={changing} aria-controls={stripId} onClick={() => setChanging((c) => !c)}
                className="tap-44 rounded-md px-1 font-medium text-text-base underline-offset-4 transition-colors duration-150 still-hover:underline">{changing ? "Done" : "Change"}</button>}
            </p>
          </div>
          {!p.readOnly && (p.match ? (
            <Button size="lg" onClick={() => p.onMatch(p.match!.label)} className="h-12 max-sm:w-full" data-scout-next>Scout {p.match.label} <ArrowRight /></Button>
          ) : p.status !== "loading" && (
            <Button size="lg" variant={allDone ? "outline" : "default"} onClick={p.onManualMatch} className="h-12 max-sm:w-full"><PenLine /> Type a match in</Button>
          ))}
        </div>
        {changing && !p.readOnly && <div id={stripId} className="mt-4 border-t border-line pt-4"><WatchStrip watching={p.watching} onChange={p.onWatching} /></div>}
        {/* The next pit team: a plain row under a hairline, one tap from its form. */}
        {p.pit && (
          <div className="mt-4 flex items-center gap-3 border-t border-line pt-4">
            <span className="min-w-0 flex-1 truncate text-sm">
              <span className="text-text-faint">Next pit </span>
              <span className="font-mono font-semibold tabular-nums text-text-base">{p.pit.team}</span>
              {p.pit.name && <span className="text-text-muted"> {p.pit.name}</span>}
            </span>
            {!p.readOnly && <Button variant="outline" onClick={() => p.onPit(p.pit!.team)} className="h-11 shrink-0">Scout pit <ArrowRight /></Button>}
          </div>
        )}
      </section>
      <dl className="grid grid-cols-3 gap-2" aria-label="Your progress here">
        <Count label="Matches" value={p.progress.matches.total ? <>{p.progress.matches.done}<span className="text-text-faint"> / {p.progress.matches.total}</span></> : "—"} bar={pct(p.progress.matches)} />
        <Count label="Pits" value={p.progress.pit.total ? <>{p.progress.pit.done}<span className="text-text-faint"> / {p.progress.pit.total}</span></> : p.progress.pit.done || "—"} bar={pct(p.progress.pit)} />
        <Count label="Today" value={p.progress.today} />
      </dl>
    </div>
  );
}

function Count({ label, value, bar }: { label: string; value: React.ReactNode; bar?: number }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-card px-3 py-2.5">
      <dt className="flex items-center gap-1 truncate text-xs text-text-faint">{label}{bar === 100 && <Check className="size-3 text-text-muted" aria-label="all done" />}</dt>
      <dd className="mt-0.5 text-lg font-semibold leading-tight tabular-nums text-text-base">{value}</dd>
      {bar != null && <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(${bar / 100})` }} /></div>}
    </div>
  );
}
