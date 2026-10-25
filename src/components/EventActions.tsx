// The event page's two everyday actions, shared by the LIVE panel and the header below it so they look
// and behave the same wherever they sit: watch the event (its player on the page, else its stream link) and
// track / untrack the event. The page owns the tracked state and its toggle; these only draw it.
import type { ReactNode } from "react";
import { Play } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "./cn";
import { WATCH_ID } from "./WatchLive";
import { scrollToElement, smoothBehavior } from "../lib/pageScroll";

/** Tracking state for an event, and the page's one toggle for it. */
export interface TrackControl { on: boolean; toggle: () => void }

/** Where the event can be watched: its player on this page (`stream`, the Watch section), or only a link elsewhere. */
export interface WatchTarget { url: string | null | undefined; stream: boolean; finished: boolean }

/**
 * The event's one watch button. With a player on the page it scrolls there and plays nothing by itself:
 * "Watch livestream" while the event runs, "Watch the stream" once it's over. Without one (a Twitch link, a
 * channel page) it opens the link in a new tab. Renders nothing with neither.
 */
export function LivestreamButton({ watch, className }: { watch: WatchTarget; className?: string }) {
  if (watch.stream) {
    const go = () => { const el = document.getElementById(WATCH_ID); if (el) scrollToElement(el, smoothBehavior()); };
    return <Button size="sm" onClick={go} className={className} data-watch-button><Play /> {watch.finished ? "Watch the stream" : "Watch livestream"}</Button>;
  }
  if (!watch.url) return null;
  return (
    <Button size="sm" asChild className={className}>
      <a href={watch.url} target="_blank" rel="noopener noreferrer" data-livestream><Play /> Watch livestream</a>
    </Button>
  );
}

/**
 * The header's action row under the event's date and venue. While live (the LIVE panel is up) the stream and
 * tracking sit in the panel instead, so they're left out here and only the page's own extras (`children`) remain.
 */
export function HeaderActions({ liveMode, watch, track, children }: { liveMode: boolean; watch: WatchTarget; track: TrackControl; children?: ReactNode }) {
  return (
    <div className="mt-5 max-sm:mt-4 flex flex-wrap gap-2 empty:hidden" data-header-actions>
      {!liveMode && <LivestreamButton watch={watch} />}
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
