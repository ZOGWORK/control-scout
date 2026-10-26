// The top half of the match screen in the Scout redesign (docs/mockups/scout-redesign.html, step 2): the match
// label with ‹ › (or a swipe) to step, its status, a strip of every match coloured by progress, and the two
// alliances with the teams this scout watches picked out. ScheduleState is the line or card the page shows
// instead while the schedule loads, isn't published, or can't be fetched.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "../../ui/button";
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
const CHIP: Record<ChipState, string> = {
  current: "border-accent bg-accent-soft text-text-base",
  done: "border-transparent bg-success/15 text-success-text",
  partial: "border-transparent bg-warning/15 text-warning-text",
  skipped: "border-transparent bg-warning/15 text-warning-text",
  upcoming: "border-line text-text-muted",
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

  const col = (side: AllianceSide) => (
    <div className={cn("flex gap-1.5 rounded-xl p-2", side === "red" ? "bg-red-alliance/12" : "bg-blue-alliance/12")}>
      {m[side].map((team, i) => {
        const mine = watched.has(`${side}:${i + 1}`), where = `${side === "red" ? "Red" : "Blue"} ${i + 1}`;
        return (
          <div key={`${side}${i}`} data-watched={mine || undefined}
            className={cn("min-w-0 flex-1 rounded-lg border-[1.5px] px-1 py-1.5 text-center",
              mine ? cn("bg-card", side === "red" ? "border-red-alliance" : "border-blue-alliance") : "border-transparent opacity-55")}>
            <div className="truncate font-mono text-[0.95rem] font-bold tabular-nums">{team}</div>
            <div className="text-[0.7rem] text-text-muted">{where}{mine && <span className="sr-only">, watching</span>}</div>
          </div>
        );
      })}
    </div>
  );

  return (
    <section aria-label="Match" className={cn("grid gap-2.5", className)}>
      <div className="grid touch-pan-y select-none grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2" onPointerDown={down} onPointerUp={up} onPointerCancel={() => { swipe.current = null; }}>
        <Button variant="outline" size="icon" className="size-11 rounded-xl" aria-label={index > 0 ? `Previous match, ${label(index - 1)}` : "Previous match"}
          disabled={index <= 0} onClick={() => go(index - 1)}><ChevronLeft className="size-5" /></Button>
        <div className="min-w-0 overflow-hidden text-center" aria-live="polite">
          <h2 key={m.key} className={cn("truncate font-display text-3xl leading-none font-bold motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200",
            dir > 0 ? "motion-safe:slide-in-from-right-4" : "motion-safe:slide-in-from-left-4")}>{m.label}</h2>
          <p className="mt-1 text-xs text-text-muted">
            {done ? <><span className="font-semibold text-success-text">Saved</span> · tap to edit</>
              : index === nextIndex ? <><span className="font-semibold text-success-text">Next up</span>{time && <> · ~{time}</>}</>
                : time ? `~${time}` : m.played ? "Played" : "No time yet"}
          </p>
        </div>
        <Button variant="outline" size="icon" className="size-11 rounded-xl" aria-label={index < schedule.length - 1 ? `Next match, ${label(index + 1)}` : "Next match"}
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
                className={cn("relative h-8 min-w-11 rounded-lg border px-2 font-mono text-xs tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  // A 44px tap area around the 32px chip.
                  "before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']", CHIP[st])}>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label={`Teams in ${m.label}`}>{col("red")}{col("blue")}</div>
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
    return fromDevice ? <p role="status" className={cn("text-center text-xs text-text-muted", className)}>Showing the schedule saved on this phone</p> : null;
  }
  if (status === "loading") {
    return (
      <div role="status" aria-busy="true" className={cn("grid gap-2.5", className)}>
        <span className="sr-only">Loading the schedule</span>
        <div className="mx-auto h-8 w-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-8 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="h-14 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      </div>
    );
  }
  const none = status === "none";
  return (
    <div role={none ? "status" : "alert"} className={cn("grid justify-items-center gap-3 rounded-xl border border-line bg-card p-4 text-center", className)}>
      <p className="text-sm">{none ? "FIRST hasn't published this event's schedule yet" : "Couldn't load the schedule"}</p>
      {!none && error && <p className="text-xs text-text-muted">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {!none && onRetry && <Button variant="secondary" className="min-h-11" onClick={onRetry}>Try again</Button>}
        {onManual && <Button variant={none ? "default" : "outline"} className="min-h-11" onClick={onManual}>Type the match in</Button>}
      </div>
    </div>
  );
}
