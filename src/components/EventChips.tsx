// An event's status and type as labels, not buttons: filled tinted chips with no border, so nothing in an
// event header that only describes the event looks like something to tap. The same tones as the Events cards
// (src/lib/textTones.ts), so a League Meet reads sky blue and Upcoming reads blue wherever it shows.
import { Radio } from "lucide-react";
import type { EventSummary } from "../shared/api";
import { EVENT_STATUS_TONE, EVENT_TYPE_CHIP_FILL, EVENT_TYPE_TONE } from "../lib/textTones";
import { cn } from "./cn";

const CHIP = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold leading-none whitespace-nowrap";

export function EventStatusChip({ status, className }: { status: EventSummary["status"]; className?: string }) {
  if (status === "live") return <span className={cn(CHIP, "font-bold", EVENT_STATUS_TONE.live, className)} data-event-chip="status"><Radio className="size-3" /> Live</span>;
  return <span className={cn(CHIP, EVENT_STATUS_TONE[status === "upcoming" ? "upcoming" : "finished"], className)} data-event-chip="status">{status === "upcoming" ? "Upcoming" : "Finished"}</span>;
}

/** The one "on now" dot: red, with a ping ring that motion-reduce turns off. Sized by `className` (default size-2). */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-2 shrink-0", className)} data-live-dot>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-full rounded-full bg-destructive" />
    </span>
  );
}

export function EventTypeChip({ type, label, className }: { type: string | null; label: string; className?: string }) {
  const text = EVENT_TYPE_TONE[type ?? ""]?.text ?? "text-muted-foreground";
  return <span className={cn(CHIP, EVENT_TYPE_CHIP_FILL, text, className)} data-event-chip="type">{label}</span>;
}
