// The event page's two everyday actions, shared by the LIVE panel and the header below it so they look
// and behave the same wherever they sit: watch the event's livestream (only when it has one) and
// track / untrack the event. The page owns the tracked state and its toggle; these only draw it.
import type { ReactNode } from "react";
import { Play } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "./cn";

/** Tracking state for an event, and the page's one toggle for it. */
export interface TrackControl { on: boolean; toggle: () => void }

/** Opens the event's stream in a new tab. Renders nothing without a URL. */
export function LivestreamButton({ url, className }: { url: string | null | undefined; className?: string }) {
  if (!url) return null;
  return (
    <Button size="sm" asChild className={className}>
      <a href={url} target="_blank" rel="noopener noreferrer" data-livestream><Play /> Watch livestream</a>
    </Button>
  );
}

/**
 * The header's action row under the event's date and venue. While live (the LIVE panel is up) the stream and
 * tracking sit in the panel instead, so they're left out here and only the page's own extras (`children`) remain.
 */
export function HeaderActions({ liveMode, livestream, track, children }: { liveMode: boolean; livestream: string | null | undefined; track: TrackControl; children?: ReactNode }) {
  return (
    <div className="mt-5 max-sm:mt-4 flex flex-wrap gap-2 empty:hidden" data-header-actions>
      {!liveMode && <LivestreamButton url={livestream} />}
      {!liveMode && <TrackEventButton track={track} label={{ on: "Tracking this event", off: "Track event" }} />}
      {children}
    </div>
  );
}

/** Track event / Tracking: a toggle button (aria-pressed) over the page's tracked state. */
export function TrackEventButton({ track, label, className }: { track: TrackControl; label?: { on: string; off: string }; className?: string }) {
  return (
    <Button variant={track.on ? "secondary" : "outline"} size="sm" aria-pressed={track.on} onClick={track.toggle} className={cn(className)} data-track-event>
      {track.on ? (label?.on ?? "Tracking") : (label?.off ?? "Track event")}
    </Button>
  );
}
