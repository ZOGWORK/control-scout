// One video in the Videos tab's feed (pages/VideosPage.tsx): its picture first, the youtube-nocookie player only once
// it's tapped (in the card, with YouTube's message channel on: lib/ytBridge.ts), so a watch can be reported at 5 s
// in, at half way and at the end (lib/videoHistory.ts). A video that can't play on other sites opens on YouTube
// (lib/streamSeek.ts playInDialog). "Not interested" takes it out of the feed.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { EyeOff, Play, Radio } from "lucide-react";
import { clipParams, playInDialog, YOUTUBE_ONLY_NOTE } from "../lib/streamSeek";
import { bridgedSrc, readProgress, YT_ORIGIN, type VideoProgress } from "../lib/ytBridge";
import { reportWatch } from "../lib/videoHistory";
import { embedUrl } from "../shared/stream";
import { clipTime } from "../shared/recording";
import { watchKindOf, type FeedItem, type FeedSource, type WatchReport } from "../shared/videosFeed";
import { ClipImage } from "./search/page/ClipImage";
import { cn } from "./cn";

/** Each pool its own hue, the same everywhere (the reason chip and the card's edge). */
export const SOURCE_TONE: Record<FeedSource, string> = {
  team: "bg-accent/15 text-accent-text border-accent/40",
  weekend: "bg-live/15 text-live border-live/40",
  creator: "bg-team-d/15 text-team-d border-team-d/40",
  behindTheBot: "bg-team-b/15 text-team-b-text border-team-b/40",
  record: "bg-warning/15 text-warning-text border-warning/40",
  close: "bg-info/15 text-info-text border-info/40",
  upset: "bg-danger/15 text-danger-text border-danger/40",
  popular: "bg-success/15 text-success-text border-success/40",
};

/** The card's left edge in its pool's hue. */
const EDGE: Record<FeedSource, string> = {
  team: "border-l-accent", weekend: "border-l-live", creator: "border-l-team-d", behindTheBot: "border-l-team-b",
  record: "border-l-warning", close: "border-l-info", upset: "border-l-danger", popular: "border-l-success",
};

const shortDate = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

/** The milestones a watch reports at, from where the player is: 5 s in, half way, the end. Pure, for tests. */
export function milestones(item: Pick<FeedItem, "t" | "end" | "duration">, p: VideoProgress): { watchedS: number; five: boolean; half: boolean; done: boolean } {
  const watchedS = Math.max(0, p.t - item.t);
  const length = item.end != null && item.end > item.t ? item.end - item.t : p.duration ? p.duration - item.t : item.duration ?? null;
  const done = p.ended || (length != null && length > 0 && watchedS >= length - 1);
  return { watchedS: Math.round(watchedS), five: watchedS >= 5, half: length != null && length > 0 && watchedS >= length / 2, done };
}

export function FeedCard({ item, signedIn, onHide }: { item: FeedItem; signedIn: boolean; onHide: (key: string) => void }) {
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const sent = useRef({ five: false, half: false, done: false });
  const kind = watchKindOf(item);
  const report = (w: Omit<WatchReport, "key" | "kind">) => { void reportWatch({ key: item.key, kind, ...w }, signedIn); };

  useEffect(() => {
    const f = frame.current;
    if (!playing || !f) return;
    let prev: VideoProgress | null = null;
    let live = false;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== YT_ORIGIN || e.source !== f.contentWindow) return;
      const p = readProgress(e.data, prev);
      if (!p) return;
      live = true;
      prev = p;
      const m = milestones(item, p);
      const s = sent.current;
      if (m.done && !s.done) { s.done = s.half = s.five = true; report({ watchedS: m.watchedS, completed: true }); }
      else if (m.half && !s.half) { s.half = s.five = true; report({ watchedS: m.watchedS }); }
      else if (m.five && !s.five) { s.five = true; report({ watchedS: m.watchedS }); }
    };
    window.addEventListener("message", onMessage);
    const hello = () => { if (!live) f.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN); };
    f.addEventListener("load", hello);
    const timer = setInterval(hello, 1000);
    return () => { window.removeEventListener("message", onMessage); f.removeEventListener("load", hello); clearInterval(timer); };
    // The item is fixed for the card's life (its key is the list's key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const play = () => {
    if (item.youtubeOnly) {
      playInDialog({ videoId: item.videoId, t: item.t, end: item.end, label: item.title, youtubeOnly: true });
      report({ watchedS: 5 });
      return;
    }
    setPlaying(true);
  };
  const when = shortDate(item.published);
  const meta = [item.event?.name ?? item.channel ?? null, when].filter(Boolean).join(" · ");
  return (
    <article className={cn("group/card flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card border-l-4", EDGE[item.source])} data-feed-card={item.key}>
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        {playing ? (
          <iframe ref={frame} className="absolute inset-0 size-full" title={`${item.title} video`}
            src={bridgedSrc(embedUrl(item.videoId), { autoplay: 1, rel: 0, playsinline: 1, ...clipParams(item) })}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
        ) : (
          <button type="button" onClick={play} className="absolute inset-0 size-full cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60" aria-label={`Play ${item.title}${item.youtubeOnly ? ` (${YOUTUBE_ONLY_NOTE.toLowerCase()})` : ""}`}>
            <ClipImage v={item} />
            <span className="absolute inset-0 grid place-items-center bg-black/10 transition-colors group-hover/card:bg-black/25">
              <span className="grid size-12 place-items-center rounded-full bg-video-fill text-white shadow-lg"><Play className="size-5 fill-current" aria-hidden /></span>
            </span>
            {item.live && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-live px-1.5 py-0.5 text-xs font-semibold text-white"><Radio className="size-3" aria-hidden />Live</span>}
            {item.end != null && item.end > item.t && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs tabular-nums text-white">{clipTime(item.end - item.t)}</span>}
            {item.end == null && item.duration != null && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs tabular-nums text-white">{clipTime(item.duration)}</span>}
            {item.youtubeOnly && <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-xs text-white">{YOUTUBE_ONLY_NOTE}</span>}
          </button>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
        <span className={cn("self-start rounded-md border px-2 py-0.5 text-xs font-semibold", SOURCE_TONE[item.source])} data-feed-reason>{item.reason}</span>
        {item.href ? <Link to={item.href} className="line-clamp-2 text-sm font-semibold leading-5 text-text-base hover:underline">{item.title}</Link>
          : <p className="line-clamp-2 text-sm font-semibold leading-5 text-text-base">{item.title}</p>}
        <div className="mt-auto flex items-center gap-2">
          {meta && (item.event ? <Link to={item.event.href} className="min-w-0 flex-1 truncate text-xs text-text-muted hover:text-text-base">{meta}</Link> : <p className="min-w-0 flex-1 truncate text-xs text-text-muted">{meta}</p>)}
          <button type="button" onClick={() => { report({ watchedS: 0, hidden: true }); onHide(item.key); }}
            className="-mr-1 ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-text-faint hover:bg-ink/[0.06] hover:text-text-base" aria-label={`Not interested in ${item.title}`} title="Not interested">
            <EyeOff className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}
