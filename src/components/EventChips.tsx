// An event's status and type as labels, not buttons: filled tinted chips with no border, so nothing in an
// event header that only describes the event looks like something to tap. The same tones as the Events cards
// (src/lib/textTones.ts), so a League Meet reads sky blue and Upcoming reads blue wherever it shows.
import { Radio } from "lucide-react";
import type { EventSummary } from "../shared/api";
import { EVENT_STATUS_TONE, EVENT_TYPE_CHIP_FILL, EVENT_TYPE_TONE } from "../lib/textTones";
import { cn } from "./cn";

const CHIP = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold leading-none whitespace-nowrap";
// v8 (docs/design/v8-revamp-brief.md §5 Status): quiet outlined pills with no fill or colour; live alone is red, with its dot.
const V8_CHIP = "v8:gap-1.5 v8:bg-transparent v8:font-medium v8:text-text-muted v8:ring-1 v8:ring-inset v8:ring-ink/[0.12]";

export function EventStatusChip({ status, className }: { status: EventSummary["status"]; className?: string }) {
  if (status === "live") return (
    <span className={cn(CHIP, "font-bold", EVENT_STATUS_TONE.live, V8_CHIP, "v8:text-live v8:ring-live/35", className)} data-event-chip="status">
      <Radio className="size-3 v8:hidden" /><LiveDot className="hidden v8:inline-flex" /> Live
    </span>
  );
  return <span className={cn(CHIP, EVENT_STATUS_TONE[status === "upcoming" ? "upcoming" : "finished"], V8_CHIP, className)} data-event-chip="status">{status === "upcoming" ? "Upcoming" : "Finished"}</span>;
}

/** The one "on now" dot: red, with a ping ring that motion-reduce turns off. Sized by `className` (default size-2). */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-2 shrink-0", className)} data-live-dot>
      {/* v8: the live red and a slow ring every 2 s (brief §4.2), the one constant animation; none under reduced motion. */}
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60 motion-reduce:hidden v8:animate-[ping_2s_cubic-bezier(0.23,1,0.32,1)_infinite] v8:bg-live" data-live-ring />
      <span className="relative inline-flex size-full rounded-full bg-destructive v8:bg-live" />
    </span>
  );
}

export function EventTypeChip({ type, label, className }: { type: string | null; label: string; className?: string }) {
  const text = EVENT_TYPE_TONE[type ?? ""]?.text ?? "text-muted-foreground";
  return <span className={cn(CHIP, EVENT_TYPE_CHIP_FILL, text, V8_CHIP, className)} data-event-chip="type">{label}</span>;
}
