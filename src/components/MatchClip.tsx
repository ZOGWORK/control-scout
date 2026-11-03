// A match's video links: its second in the event's recording (MatchView.clip, server/videos/recordings.ts) and
// FIRST's own video of it (MatchView.video). A click plays it in the app (lib/streamSeek.ts: the event page's
// player, else the video dialog); a modifier or middle click is a plain link to YouTube.
import type { MouseEvent, ReactNode } from "react";
import { MonitorPlay, PlayCircle } from "lucide-react";
import type { MatchClip } from "../shared/api";
import { clipTime } from "../shared/recording";
import { youtubeId } from "../shared/personal";
import { playMatchVideo, type MatchPlay } from "../lib/streamSeek";
import { cn } from "./cn";

/** A click that plays in the app; anything else (new tab, middle click) is left to the link. */
const inApp = (p: MatchPlay) => (e: MouseEvent<HTMLAnchorElement>) => {
  e.stopPropagation(); // a row that opens on a click stays as it is
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  if (playMatchVideo(p)) e.preventDefault();
};

export function ClipLink({ clip, label = "this match", matchKey, className, children }: { clip: MatchClip; label?: string; matchKey?: string; className?: string; children?: ReactNode }) {
  return (
    <a href={clip.url} target="_blank" rel="noreferrer noopener" onClick={inApp({ videoId: clip.videoId, t: clip.t, label, matchKey })} className={cn("inline-flex items-center gap-1", className)}
      aria-label={`Watch ${label} in the recording, from ${clipTime(clip.t)}`} title={`Watch in the recording from ${clipTime(clip.t)}`} data-clip={clip.t}>
      <MonitorPlay className="size-3.5 shrink-0" aria-hidden />{children}
    </a>
  );
}

/** FIRST's own video of a match. A link that isn't a YouTube video stays a plain link out. */
export function MatchVideoLink({ url, label, matchKey, className, children }: { url: string; label: string; matchKey?: string; className?: string; children?: ReactNode }) {
  const videoId = youtubeId(url);
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" onClick={videoId ? inApp({ videoId, t: 0, label, matchKey }) : (e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-1", className)} aria-label={`Official video of ${label}`} title="Official match video" data-match-video={videoId ?? undefined}>
      <PlayCircle className="size-3.5 shrink-0" aria-hidden />{children}
    </a>
  );
}
