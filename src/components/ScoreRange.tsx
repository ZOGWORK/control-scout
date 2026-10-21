// A predicted score with its stated range: "118 ±14". Every prediction surface uses this, so the range reads
// the same everywhere; hovering (or a screen reader) gets the plain meaning: "80% range 104–132: about 8 in
// 10 real scores land inside". Calls logged before engine 2.2 stated no range and show the score alone.
import { cn } from "./cn";
import { plusMinus, rangeSentence } from "../shared/scoreRange";

export function ScoreRange({ mean, range, level, className, pmClassName, approx }: {
  mean: number;
  range?: [number, number] | null;
  level?: number;
  className?: string;
  /** Classes for the "±14" part (default: muted, a touch smaller). */
  pmClassName?: string;
  /** With no stated range, write the score as "~120" (an estimate, not a result). */
  approx?: boolean;
}) {
  const m = Math.round(mean);
  if (!range) return <span className={cn("tabular-nums", className)}>{approx ? "~" : ""}{m}</span>;
  const sentence = rangeSentence(range, level);
  return (
    <span className={cn("tabular-nums", className)} title={sentence}>
      {m}<span aria-hidden className={pmClassName ?? "text-[0.85em] font-normal text-muted-foreground"}> ±{plusMinus(mean, range)}</span>
      <span className="sr-only"> ({sentence})</span>
    </span>
  );
}
