// The "Recording" / "Watch live" chip beside an event in a list (/weekend, /events and its On now strip): shown only
// when the event has a stream or recording on record, it opens the event page's own player (watchHref,
// components/WatchLive.tsx), never YouTube. It sits beside the row's link to the event, never inside it.
import { Link } from "react-router-dom";
import { PlayCircle } from "lucide-react";
import { cn } from "./cn";

/** "Watch live" while the event is on, else "Recording". */
export const watchChipLabel = (status: string) => (status === "live" ? "Watch live" : "Recording");

/** `pill`: the classic look (a bordered pill); otherwise v8's quiet text button. */
export function WatchChip({ href, status, name, pill, className }: { href: string; status: string; name: string; pill?: boolean; className?: string }) {
  const label = watchChipLabel(status);
  return (
    <Link to={href} aria-label={`${label}: ${name}`} data-watch-chip={status === "live" ? "live" : "recording"}
      className={cn(pill
        ? "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-medium max-sm:h-10"
        : "tap-44 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm text-text-muted transition-colors duration-150 still-hover:bg-ink/[0.06] still-hover:text-text-base",
      className)}>
      <PlayCircle className={pill ? "size-3.5" : "size-4"} aria-hidden /> {label}
    </Link>
  );
}
