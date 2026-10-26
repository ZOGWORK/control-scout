// The top half of the match screen in the Scout redesign (docs/mockups/scout-redesign.html, step 2): the match
// label with ‹ › (or a swipe) to step, its status, a strip of every match coloured by progress, and the two
// alliances with the teams this scout watches picked out. Built from the app's own pieces: the alliance boxes and
// team highlight are MatchRow's (components/predict.tsx), the states are EmptyState / Skeleton / OfflineNote's look. ScheduleState is the line or card the page shows
// instead while the schedule loads, isn't published, or can't be fetched.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CalendarX, ChevronLeft, ChevronRight, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "../../ui/button";
import { EmptyState } from "../../page";
import { Skeleton } from "../../states";
import { cn } from "../../cn";
import { teamsWatched, type AllianceSide, type MatchProgress, type ScheduleMatch, type Watching } from "../../../shared/scoutMatch";

/** How a chip in the strip reads. skipped: not scouted, but a later match was (it sits before the next one). */
export type ChipState = "current" | "done" | "partial" | "skipped" | "upcoming";

export function chipState(i: number, index: number, progress: MatchProgress, nextIndex: number): ChipState {
  if (i === index) return "current";
  if (progress === "done") return "done";
  if (progress === "partial") return "partial";
  return nextIndex >= 0 && i < nextIndex ? "skipped" : "upcoming";
}

/** FIRST's event-local time ("2025-11-08T10:42:00", no zone) as h:mm, read off the string so no zone shifts it. Null: no time. */
export function clockTime(t: string | null | undefined): string | null {
  const m = /T(\d{1,2}):(\d{2})/.exec(t ?? "");
  if (!m) return null;
  const h = Number(m[1]) % 12 || 12;
  return `${h}:${m[2]}`;
}

const STATE_WORDS: Record<ChipState, string> = { current: "current", done: "done", partial: "partly scouted", skipped: "skipped", upcoming: "" };
// The same tints as MatchRow's status chips (Right / Upset) and its highlighted team (accent ring).
const CHIP: Record<ChipState, string> = {
  current: "border-transparent bg-accent/15 font-semibold text-accent-text ring-1 ring-accent/60",
  done: "border-transparent bg-success/12 text-success",
  partial: "border-transparent bg-warning/12 text-warning",
  skipped: "border-transparent bg-warning/12 text-warning",
  upcoming: "border-border text-text-muted still-hover:bg-text-base/[0.06]",
};

/** A horizontal swipe this far (px), and clearly more sideways than up or down, steps a match. */
const SWIPE_PX = 48;

export interface MatchHeaderProps {
  schedule: readonly ScheduleMatch[];
  index: number;
  watching: Watching;
  progress: (i: number) => MatchProgress;
  onIndex: (i: number) => void;
  /** Where the scout should be next (nextMatchIndex); -1: none. */
  nextIndex: number;
  className?: string;
}

export function MatchHeader({ schedule, index, watching, progress, onIndex, nextIndex, className }: MatchHeaderProps) {
  const m = schedule[index];
  const stripRef = useRef<HTMLOListElement>(null);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  // Which way the label slides in: the way the scout moved.
  const [dir, setDir] = useState<1 | -1>(1);
  const prev = useRef(index);
  useEffect(() => { if (index !== prev.current) setDir(index > prev.current ? 1 : -1); prev.current = index; }, [index]);

  // Keep the current chip in view (centred when the strip can scroll that far).
  useEffect(() => {
    const strip = stripRef.current, cur = strip?.querySelector<HTMLElement>("[aria-current]");
    if (!strip || !cur) return;
    const left = cur.offsetLeft - (strip.clientWidth - cur.offsetWidth) / 2;
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (typeof strip.scrollTo === "function") strip.scrollTo({ left: Math.max(0, left), behavior: reduce ? "auto" : "smooth" });
    else strip.scrollLeft = Math.max(0, left);
  }, [index, schedule.length]);

  if (!m) return null;
  const go = (i: number) => { if (i >= 0 && i < schedule.length && i !== index) onIndex(i); };
  const label = (i: number) => schedule[i]?.label ?? "";
  const done = progress(index) === "done";
  const time = clockTime(m.time);
  const watched = new Set(teamsWatched(m, watching).map((t) => `${t.side}:${t.station}`));

  const down = (e: React.PointerEvent) => { swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }; };
  const up = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  };

  // MatchRow's AllianceBox: a tinted box with the alliance's edge, blue mirrored; a watched team is marked the
  // way MatchRow marks the team you're looking at (accent ring), the others in muted text.
  const col = (side: AllianceSide) => (
    <div className={cn("grid min-w-0 auto-cols-fr grid-flow-col gap-x-1 rounded-lg px-2 py-1.5",
      side === "red" ? "border-l-[3px] border-red-alliance bg-red-alliance/[0.06]" : "border-r-[3px] border-blue-alliance bg-blue-alliance/[0.06]")}>
      {m[side].map((team, i) => {
        const mine = watched.has(`${side}:${i + 1}`), where = `${side === "red" ? "Red" : "Blue"} ${i + 1}`;
        return (
          <div key={`${side}${i}`} data-watched={mine || undefined}
            className={cn("flex min-w-0 flex-col rounded-md px-1.5 py-0.5 leading-tight", side === "blue" && "items-end text-right", mine && "bg-accent/15 ring-1 ring-accent/60")}>
            <span className={cn("tabular font-mono text-[0.8125rem]", mine ? "font-bold text-accent-text" : "text-text-muted")}>{team}</span>
            <span className={cn("text-[11px]", mine ? "text-text-base" : "text-text-muted")}>{where}{mine && <span className="sr-only">, watching</span>}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <section aria-label="Match" className={cn("grid gap-2.5", className)}>
      <div className="grid touch-pan-y select-none grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2" onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipe.current = null; }}>
        <Button variant="outline" size="icon" className="size-[44px]" aria-label={index > 0 ? `Previous match, ${label(index - 1)}` : "Previous match"}
          disabled={index <= 0} onClick={() => go(index - 1)}><ChevronLeft className="size-5" /></Button>
        <div className="min-w-0 overflow-hidden text-center" aria-live="polite">
          <h2 key={m.key} className={cn("truncate font-display text-3xl font-semibold tabular-nums leading-none tracking-tight motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
            dir > 0 ? "motion-safe:slide-in-from-right-4" : "motion-safe:slide-in-from-left-4")}>{m.label}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {done ? <><span className="font-semibold text-success">Saved</span> · tap to edit</>
              : index === nextIndex ? <><span className="font-semibold text-success">Next up</span>{time && <> · ~{time}</>}</>
                : time ? `~${time}` : m.played ? "Played" : "No time yet"}
          </p>
        </div>
        <Button variant="outline" size="icon" className="size-[44px]" aria-label={index < schedule.length - 1 ? `Next match, ${label(index + 1)}` : "Next match"}
          disabled={index >= schedule.length - 1} onClick={() => go(index + 1)}><ChevronRight className="size-5" /></Button>
      </div>

      <ol ref={stripRef} aria-label="Matches" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {schedule.map((s, i) => {
          const st = chipState(i, index, progress(i), nextIndex);
          // The current chip still says how far it's scouted.
          const p = progress(i), extra = st === "current" ? (p === "done" ? ", done" : p === "partial" ? ", partly scouted" : "") : "";
          return (
            <li key={s.key} className="shrink-0">
              <button type="button" data-state={st} aria-current={st === "current" ? "true" : undefined}
                aria-label={`${s.label}${STATE_WORDS[st] ? `, ${STATE_WORDS[st]}` : ""}${extra}`}
                onClick={() => go(i)}
                className={cn("relative h-[32px] min-w-[44px] rounded-md border px-2 font-mono text-xs tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                  // A 44px tap area around the 32px chip.
                  "before:absolute before:inset-x-0 before:-inset-y-[6px] before:content-['']", CHIP[st])}>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-2 gap-1.5" data-alliances role="group" aria-label={`Teams in ${m.label}`}>{col("red")}{col("blue")}</div>
    </section>
  );
}

export interface ScheduleStateProps {
  status: "loading" | "ready" | "none" | "error";
  fromDevice?: boolean;
  error?: string;
  onManual?: () => void;
  onRetry?: () => void;
  className?: string;
}

/** What the match screen shows in place of the header while there's no schedule to step through, or the note that it's the copy kept on this phone. Ready and fresh: nothing. */
export function ScheduleState({ status, fromDevice, error, onManual, onRetry, className }: ScheduleStateProps) {
  if (status === "ready") {
    return fromDevice ? (
      // OfflineNote's look: the same note wherever data comes from this device instead of the server.
      <p role="status" className={cn("flex items-start gap-2 rounded-lg border border-info/30 bg-info/[0.06] px-3 py-2 text-xs", className)}>
        <WifiOff className="mt-px size-3.5 shrink-0 text-info" />
        <span>Showing the schedule saved on this phone</span>
      </p>
    ) : null;
  }
  if (status === "loading") {
    // The header's own shape, so nothing jumps when the schedule arrives.
    return (
      <div role="status" aria-label="Loading the schedule" className={cn("grid gap-2.5", className)}>
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2"><Skeleton className="size-[44px] rounded-xl" /><Skeleton className="mx-auto h-8 w-20" /><Skeleton className="size-[44px] rounded-xl" /></div>
        <Skeleton className="h-8 rounded-md" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
    );
  }
  const manual = onManual && <Button variant={status === "none" ? "default" : "outline"} className="min-h-[44px]" onClick={onManual}>Type the match in</Button>;
  if (status === "none") {
    return <EmptyState className={className} icon={CalendarX} title="FIRST hasn't published this event's schedule yet" description="Type each match in as it's called." action={manual} />;
  }
  // ErrorState's look, plus the way to keep scouting without a schedule.
  return (
    <div role="alert" className={className}>
      <EmptyState icon={AlertTriangle} title="Couldn't load the schedule" description={error}
        action={<div className="flex flex-wrap justify-center gap-2">{onRetry && <Button variant="secondary" className="min-h-[44px]" onClick={onRetry}><RefreshCw /> Try again</Button>}{manual}</div>} />
    </div>
  );
}
