// A match's video links: its second in the event's recording (MatchView.clip, server/videos/recordings.ts) and
// FIRST's own video of it (MatchView.video). A click plays it in the app (lib/streamSeek.ts: the event page's
// player, else the video dialog); a modifier or middle click is a plain link to YouTube.
import type { MouseEvent, ReactNode } from "react";
import { MonitorPlay, PlayCircle, WifiOff } from "lucide-react";
import { useOnline } from "../lib/offline/online";
import type { MatchClip } from "../shared/api";
import { clipTime, linkStart } from "../shared/recording";
import { youtubeId } from "../shared/personal";
import { playMatchVideo, type MatchPlay } from "../lib/streamSeek";
import { cn } from "./cn";

export { linkStart };

/** A click that plays in the app; anything else (new tab, middle click) is left to the link. */
const inApp = (p: MatchPlay) => (e: MouseEvent<HTMLAnchorElement>) => {
  e.stopPropagation(); // a row that opens on a click stays as it is
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  if (playMatchVideo(p)) e.preventDefault();
};

/** No connection: videos stream from YouTube and are never downloaded, so instead of a link that can't play, the
 *  button says so (the match's numbers on the page still work from the saved pack). */
function NeedsConnection({ label, kind, className, children }: { label: string; kind: "clip" | "video"; className?: string; children?: ReactNode }) {
  return (
    <span role="link" aria-disabled="true" className={cn("inline-flex cursor-not-allowed items-center gap-1 opacity-60", className)}
      title="Needs a connection: match videos play from YouTube, they aren't saved for offline" data-needs-connection={kind}>
      <WifiOff className="size-3.5 shrink-0" aria-hidden />{children}
      <span className="sr-only">{`${kind === "clip" ? "Recording" : "Official video"} of ${label}: needs a connection`}</span>
    </span>
  );
}

/** `offline`: the page's data came from the saved pack (no connection, whatever the browser says). */
export function ClipLink({ clip, label = "this match", matchKey, className, children, offline }: { clip: MatchClip; label?: string; matchKey?: string; className?: string; children?: ReactNode; offline?: boolean }) {
  const online = useOnline();
  if (offline || !online) return <NeedsConnection label={label} kind="clip" className={className}>{children}</NeedsConnection>;
  return (
    <a href={clip.url} target="_blank" rel="noreferrer noopener" onClick={inApp({ videoId: clip.videoId, t: clip.t, end: clip.end, label, matchKey })} className={cn("inline-flex items-center gap-1", className)}
      aria-label={`Watch ${label} in the recording, from ${clipTime(clip.t)}`} title={`Watch in the recording from ${clipTime(clip.t)}`} data-clip={clip.t}>
      <MonitorPlay className="size-3.5 shrink-0" aria-hidden />{children}
    </a>
  );
}

/** FIRST's own video of a match, from the second its link names. A link that isn't a YouTube video stays a plain link out. */
export function MatchVideoLink({ url, label, matchKey, className, children, offline }: { url: string; label: string; matchKey?: string; className?: string; children?: ReactNode; offline?: boolean }) {
  const online = useOnline();
  const videoId = youtubeId(url);
  if (offline || !online) return <NeedsConnection label={label} kind="video" className={className}>{children}</NeedsConnection>;
  return (
    <a href={url} target="_blank" rel="noreferrer noopener" onClick={videoId ? inApp({ videoId, t: linkStart(url), label, matchKey }) : (e) => e.stopPropagation()}
      className={cn("inline-flex items-center gap-1", className)} aria-label={`Official video of ${label}`} title="Official match video" data-match-video={videoId ?? undefined}>
      <PlayCircle className="size-3.5 shrink-0" aria-hidden />{children}
    </a>
  );
}
