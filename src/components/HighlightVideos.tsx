// The organiser's highlight videos of an event (event page only; server/videos/officialVideos.ts): short reels from
// the event's official channel, labelled as highlights. They play in the app's video dialog, never in the page's
// recording player and never as a match's video. A modifier or middle click follows the link to YouTube.
import { Play } from "lucide-react";
import type { EventDetail } from "../shared/api";
import { thumbnailUrl } from "../shared/stream";
import { watchUrl } from "../shared/recording";
import { playInDialog } from "../lib/streamSeek";

export function HighlightVideos({ videos }: { videos: NonNullable<EventDetail["highlightVideos"]> }) {
  if (!videos.length) return null;
  return (
    <section aria-labelledby="highlight-videos-h" className="mb-8" data-highlight-videos>
      <h2 id="highlight-videos-h" className="mb-3 font-display text-lg font-semibold text-foreground">Highlight videos</h2>
      <ul className="grid max-w-4xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map((v) => (
          <li key={v.videoId}>
            <a href={watchUrl(v.videoId)} target="_blank" rel="noreferrer noopener"
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                if (playInDialog({ videoId: v.videoId, t: 0, label: `Highlights: ${v.title}`, highlight: true })) e.preventDefault();
              }}
              className="group block overflow-hidden rounded-xl border border-border bg-card hover:bg-text-base/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              aria-label={`Play highlight video: ${v.title}`} data-highlight-video={v.videoId}>
              <span className="relative block aspect-video bg-black">
                <img src={thumbnailUrl(v.videoId)} alt="" loading="lazy" decoding="async" onError={(e) => { e.currentTarget.hidden = true; }} className="absolute inset-0 size-full object-cover opacity-85 transition-opacity group-hover:opacity-100 motion-reduce:transition-none" />
                <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">Highlights</span>
                <span className="absolute inset-0 grid place-items-center"><span className="grid size-12 place-items-center rounded-full bg-video-fill text-white shadow-lg"><Play className="size-5 translate-x-0.5 fill-current" aria-hidden /></span></span>
              </span>
              <span className="block px-3 py-2"><span className="line-clamp-2 text-sm font-medium leading-snug text-foreground" title={v.title}>{v.title}</span></span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
