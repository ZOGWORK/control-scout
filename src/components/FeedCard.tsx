// One video in the Videos tab's feed (pages/VideosPage.tsx): its picture, and a tap opens the watch page
// (pages/WatchPage.tsx: the video big, more to watch beside it), which reports the watch (lib/useWatchReports.ts). A
// video that can't play on other sites opens on YouTube (lib/streamSeek.ts playInDialog). "Not interested" takes it
// out of the feed.
import { Link } from "react-router-dom";
import { EyeOff, Play, Radio } from "lucide-react";
import { playInDialog, YOUTUBE_ONLY_NOTE } from "../lib/streamSeek";
import { reportWatch } from "../lib/videoHistory";
import { clipTime } from "../shared/recording";
import { watchHref } from "../shared/watch";
import { watchKindOf, type FeedItem, type FeedSource } from "../shared/videosFeed";
import { ClipImage } from "./search/page/ClipImage";
import { cn } from "./cn";

/** Each pool its own hue, the same everywhere (the reason chip), none red or orange; a reason that is the person's
 *  own team ("You follow 4215") is always the team's green, whatever pool it came from. */
export const SOURCE_TONE: Record<FeedSource, string> = {
  team: "bg-team-c/15 text-team-c-text border-team-c/40",
  weekend: "bg-info/15 text-info-text border-info/40",
  creator: "bg-violet-400/15 text-violet-400 border-violet-400/40",
  behindTheBot: "bg-accent/15 text-accent-text border-accent/40",
  record: "bg-team-a/15 text-team-a border-team-a/40",
  close: "bg-purple-400/15 text-purple-400 border-purple-400/40",
  upset: "bg-indigo-400/15 text-indigo-400 border-indigo-400/40",
  popular: "bg-success/15 text-success-text border-success/40",
  recent: "bg-ink/[0.06] text-text-muted border-ink/[0.14]",
}

const shortDate = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

/** What the watch page gets with the link: the item itself, so its title, clip and key are there at once. */
export interface WatchState { item: FeedItem; filter?: string }

export function FeedCard({ item, signedIn, filter, onHide }: { item: FeedItem; signedIn: boolean; filter?: string; onHide: (key: string) => void }) {
  const kind = watchKindOf(item);
  const when = shortDate(item.published);
  const meta = [item.event?.name ?? item.channel ?? null, when].filter(Boolean).join(" · ");
  const length = item.end != null && item.end > item.t ? item.end - item.t : item.end == null ? item.duration ?? null : null;
  const picture = (
    <>
      <ClipImage v={item} />
      <span className="absolute inset-0 grid place-items-center bg-black/0 transition-colors duration-150 group-hover/card:bg-black/25 motion-reduce:transition-none">
        <span className="grid size-12 scale-90 place-items-center rounded-full bg-black/70 text-white opacity-0 ring-1 ring-white/20 shadow-lg transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover/card:scale-100 group-hover/card:opacity-100 group-focus-visible/play:scale-100 group-focus-visible/play:opacity-100 pointer-coarse:scale-100 pointer-coarse:opacity-100 motion-reduce:transition-none"><Play className="size-5 translate-x-px fill-current" aria-hidden /></span>
      </span>
      {item.live && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-info px-1.5 py-0.5 text-xs font-semibold text-black"><Radio className="size-3" aria-hidden />Live</span>}
      {length != null && <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs tabular-nums text-white">{clipTime(length)}</span>}
      {item.youtubeOnly && <span className="absolute bottom-2 left-2 rounded bg-black/75 px-1.5 py-0.5 text-xs text-white">{YOUTUBE_ONLY_NOTE}</span>}
    </>
  );
  const box = "group/play relative block aspect-video w-full overflow-hidden rounded-xl bg-black outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  return (
    <article className="group/card flex min-w-0 flex-col" data-feed-card={item.key}>
      {item.youtubeOnly ? (
        <button type="button" className={cn(box, "cursor-pointer")} aria-label={`Play ${item.title} (${YOUTUBE_ONLY_NOTE.toLowerCase()})`}
          onClick={() => { playInDialog({ videoId: item.videoId, t: item.t, end: item.end, label: item.title, youtubeOnly: true }); void reportWatch({ key: item.key, kind, watchedS: 5 }, signedIn); }}>
          {picture}
        </button>
      ) : (
        <Link to={watchHref(item.videoId, { t: item.t, end: item.end })} state={{ item, filter } satisfies WatchState} className={box} aria-label={`Watch ${item.title}`} data-feed-watch>
          {picture}
        </Link>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2 px-1 pt-3">
        <span className={cn("self-start rounded-md border px-2 py-0.5 text-xs font-semibold", SOURCE_TONE[item.personal ? "team" : item.source])} data-feed-reason>{item.reason}</span>
        {item.href ? <Link to={item.href} className="line-clamp-2 text-[0.9375rem] font-semibold leading-5 text-text-base hover:underline">{item.title}</Link>
          : <p className="line-clamp-2 text-[0.9375rem] font-semibold leading-5 text-text-base">{item.title}</p>}
        <div className="mt-auto flex items-center gap-2">
          {meta && (item.event ? <Link to={item.event.href} className="min-w-0 flex-1 truncate text-xs text-text-muted hover:text-text-base">{meta}</Link> : <p className="min-w-0 flex-1 truncate text-xs text-text-muted">{meta}</p>)}
          <button type="button" onClick={() => { void reportWatch({ key: item.key, kind, watchedS: 0, hidden: true }, signedIn); onHide(item.key); }}
            className="-mr-1 ml-auto inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-text-faint hover:bg-ink/[0.06] hover:text-text-base" aria-label={`Not interested in ${item.title}`} title="Not interested">
            <EyeOff className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </article>
  );
}
