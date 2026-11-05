// An answer's video on /search (SearchAnswer.video, server/api/answers/video.ts): the one match or event the answer is
// about, in its card, and a small play button on each listed match that has a clip. The card's player is the event
// page's click-to-play facade (components/WatchLive.tsx): a thumbnail and a play button, the youtube-nocookie player
// loaded only by a click, so the page costs one image and nothing plays on its own. A row's button plays in the app's
// video dialog (components/VideoDialog.tsx, lib/streamSeek.ts), never away from search. No video: nothing is drawn.
// Never wider than the results column (680px, the search display spec); a phone gets the card's full width at 16:9.
import { createContext, useContext, useState, type ReactNode } from "react";
import { ExternalLink, Play, PlayCircle } from "lucide-react";
import type { SearchVideo, SearchVideoItem } from "../../../shared/api";
import { embedUrl, thumbnailUrl } from "../../../shared/stream";
import { clipTime, watchUrl } from "../../../shared/recording";
import { playMatchVideo } from "../../../lib/streamSeek";
import { cn } from "../../cn";

const Video = createContext<SearchVideo | undefined>(undefined);

/** The answer's video, for the card's player and the rows' buttons under it. */
export function AnswerVideoProvider({ video, children }: { video: SearchVideo | undefined; children: ReactNode }) {
  return <Video.Provider value={video}>{children}</Video.Provider>;
}

/** What the video is, in words: the match once, or the event's stream (the card's title already names the event). */
export function videoCaption(v: SearchVideoItem): string {
  if (v.kind === "match") return `${v.match}: official match video`;
  if (v.kind === "recording") return `${v.match} in the event's ${v.live ? "live stream" : "recording"}, from ${clipTime(v.t)}`;
  return v.live ? "The event's live stream" : "The event's recording";
}

/** The card's player: 16:9, the card's full width on a phone, loaded on a click. */
export function AnswerVideo({ className }: { className?: string }) {
  const v = useContext(Video)?.main;
  // Another answer's video starts at its picture again.
  return v ? <Player key={`${v.videoId}:${v.t}`} v={v} className={className} /> : null;
}

function Player({ v, className }: { v: SearchVideoItem; className?: string }) {
  const [on, setOn] = useState(false);
  const caption = videoCaption(v);
  const src = `${embedUrl(v.videoId)}?${new URLSearchParams({ autoplay: "1", rel: "0", ...(v.t ? { start: String(v.t) } : {}) })}`;
  return (
    <figure className={cn("my-4 max-sm:-mx-4 sm:max-w-[680px]", className)} data-answer-video={v.kind}>
      <div className="relative aspect-video w-full overflow-hidden border-y border-border bg-black sm:rounded-xl sm:border">
        {on ? (
          // Loaded by the viewer's click, so autoplay here is their own choice.
          <iframe className="absolute inset-0 size-full" src={src} title={caption} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" onClick={() => setOn(true)} className="group absolute inset-0 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60" aria-label={`Play: ${caption}`} data-video-facade>
            <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} className="absolute inset-0 size-full object-cover opacity-80 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
            <span className="relative grid size-16 place-items-center rounded-full bg-video-fill text-white shadow-lg"><Play className="size-7 translate-x-0.5 fill-current" aria-hidden /></span>
          </button>
        )}
      </div>
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground max-sm:px-4">
        <span data-video-caption>{caption}</span>
        <a href={watchUrl(v.videoId, v.t)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-foreground max-md:min-h-11 pointer-coarse:min-h-11">
          Open on YouTube <ExternalLink className="size-3" aria-hidden />
        </a>
      </figcaption>
    </figure>
  );
}

/** Whether any of these rows has a clip (a table then gives its buttons a column). */
export function useRowPlays(hrefs: (string | undefined)[]): boolean {
  const rows = useContext(Video)?.rows;
  return !!rows && hrefs.some((h) => h && rows[h]);
}

/** A listed match's play button, when it has a clip: it plays in the app's video dialog. `label` names the match in it. */
export function RowPlay({ href, label, className }: { href: string; label: string; className?: string }) {
  const v = useContext(Video)?.rows?.[href];
  if (!v) return null;
  return (
    <button type="button" onClick={() => playMatchVideo({ videoId: v.videoId, t: v.t, label })}
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-text-base/[0.06] hover:text-foreground max-md:size-11 pointer-coarse:size-11", className)}
      aria-label={`Play ${label}: ${v.kind === "match" ? "official match video" : `the event's recording from ${clipTime(v.t)}`}`} title={videoCaption(v)} data-row-play={v.kind}>
      <PlayCircle className="size-5" aria-hidden />
    </button>
  );
}
