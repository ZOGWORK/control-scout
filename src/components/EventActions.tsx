// The event page's two everyday actions, shared by the LIVE panel and the header below it so they look
// and behave the same wherever they sit: watch the event (its player on the page, else its stream link) and
// track / untrack the event. The page owns the tracked state and its toggle; these only draw it.
import type { ReactNode } from "react";
import { Play, WifiOff } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "./cn";
import { WATCH_ID } from "./WatchLive";
import { scrollToElement } from "../lib/pageScroll";
import { shownOffline, useConnection } from "../lib/connection";
import { useIsV8 } from "../lib/v8";
import type { EventDetail } from "../shared/api";

/** Tracking state for an event, and the page's one toggle for it. */
export interface TrackControl { on: boolean; toggle: () => void }

/** Where the event can be watched: its player on this page (`stream`, the Watch section), or only a link elsewhere. */
export interface WatchTarget { url: string | null | undefined; stream: boolean; finished: boolean }

/**
 * The event's one watch button. With a player on the page it scrolls there and plays nothing by itself:
 * "Watch livestream" while the event runs, "Watch the stream" once it's over. Without one (a Twitch link, a
 * channel page) it opens the link in a new tab. Renders nothing with neither.
 */
export function LivestreamButton({ watch, className, offline }: { watch: WatchTarget; className?: string; offline?: boolean }) {
  const noSignal = useNoVideoSignal(offline);
  // v8 (brief §7 Event header): the stream link is a plain button, so the page keeps at most one primary.
  const variant = useIsV8() ? "ghost" : "default";
  // No connection: the stream plays from the internet, so instead of a player that can't load or a tab that opens
  // on an error, the button says so.
  if (noSignal && (watch.stream || watch.url)) {
    return (
      <Button size="sm" variant="outline" disabled className={cn(className, "max-sm:h-[44px]")} title="The livestream plays from the internet: it needs a connection" data-livestream-offline>
        <WifiOff /> Livestream needs a connection
      </Button>
    );
  }
  if (watch.stream) {
    const go = () => { const el = document.getElementById(WATCH_ID); if (el) scrollToElement(el); };
    return <Button size="sm" variant={variant} onClick={go} className={className} data-watch-button><Play /> {watch.finished ? "Watch the stream" : "Watch livestream"}</Button>;
  }
  if (!watch.url) return null;
  return (
    <Button size="sm" variant={variant} asChild className={className}>
      <a href={watch.url} target="_blank" rel="noopener noreferrer" data-livestream><Play /> Watch livestream</a>
    </Button>
  );
}

/** No connection for video: the page's data came from what's saved on this device (`offline`), or the connection check
 *  finds no internet (lib/connection.ts). Videos and streams play from YouTube and are never saved for offline. */
export function useNoVideoSignal(offline?: boolean): boolean {
  const conn = useConnection();
  return !!offline || shownOffline(conn);
}

/** Does the event have anything to watch: its stream, a livestream link, or a match with a clip or FIRST's video. */
export function hasEventVideo(d: Pick<EventDetail, "event" | "matches">): boolean {
  const e = d.event;
  return !!e.stream || !!e.livestream || !!e.recordingUnavailable?.length || d.matches.some((m) => !!m.clip || !!m.video);
}

/** With no connection, an event that has video says once, plainly, why its videos can't play: a saved season doesn't
 *  know each match's clip, so its rows have no Watch button to say it. The numbers on the page still work. */
export function OfflineVideoNote({ d, offline }: { d: Pick<EventDetail, "event" | "matches">; offline?: boolean }) {
  const noSignal = useNoVideoSignal(offline);
  if (!noSignal || !hasEventVideo(d)) return null;
  return (
    <p className="mt-3 flex items-center gap-1.5 text-sm text-text-muted" data-offline-video-note>
      <WifiOff className="size-4 shrink-0" aria-hidden />Video needs a connection. Scores, stats and calls here work offline.
    </p>
  );
}

/**
 * The header's action row under the event's date and venue. While live (the LIVE panel is up) the stream and
 * tracking sit in the panel instead, so they're left out here and only the page's own extras (`children`) remain.
 */
export function HeaderActions({ liveMode, watch, track, clips, clipsFirst, offline, children }: { liveMode: boolean; watch: WatchTarget; track: TrackControl; clips?: ReactNode; clipsFirst?: boolean; offline?: boolean; children?: ReactNode }) {
  // "Watch Clips" (match videos, docs/contributors.md): first once the event is over, beside the stream while it runs.
  return (
    <div className="mt-5 max-sm:mt-4 flex flex-wrap gap-2 empty:hidden" data-header-actions>
      {clipsFirst && clips}
      {!liveMode && <LivestreamButton watch={watch} offline={offline} />}
      {!clipsFirst && clips}
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
