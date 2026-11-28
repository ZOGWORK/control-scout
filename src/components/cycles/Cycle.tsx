// One Cycle (src/pages/CyclesPage.tsx): a short video filling the stage, its rail (like, react, save, share) and who made
// it. Only the Cycle on screen holds a player (youtube-nocookie, its message channel on: lib/ytBridge.ts); the rest are
// their picture. Tap to pause, double-tap to like. Its watch is reported when it leaves the screen: how far it got, if it
// finished, and how many times it played through again (a replay is the strongest "yes" short of a like), as the
// recommendation engine learns from (server/videos/recommend.ts).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Heart, Play, Send, SmilePlus, Volume2, VolumeX } from "lucide-react";
import { bridgedSrc, readProgress, YT_ORIGIN, type VideoProgress } from "../../lib/ytBridge";
import { reportWatch } from "../../lib/videoHistory";
import { setInList } from "../../lib/videoLibrary";
import { countShare, feedItemOf, likeVideo, reactionCount, reactToVideo, shortCount, withLike, withReaction } from "../../lib/cycles";
import { embedUrl } from "../../shared/stream";
import { cycleHref, REACTIONS, type CycleItem, type Engagement, type Reaction } from "../../shared/cycles";
import { seriesLabel } from "../../shared/creatorVideos";
import { useItemState } from "../videos/WatchLibrary";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/overlay";
import { toast } from "../ui/sonner";
import { cn } from "../cn";

const EASE = "ease-[cubic-bezier(0.23,1,0.32,1)]";
/** The liked heart: violet, never red (no red or orange anywhere in the video UI). */
const LIKED = "fill-[#a78bfa] text-[#a78bfa]";

/** What a Cycle's watch says when it leaves the screen. Pure, for tests: seen this far of that long, played through
 *  this many more times. */
export function watchOf(maxT: number, duration: number | null, loops: number): { watchedS: number; completed: boolean } {
  const len = duration && duration > 0 ? duration : null;
  const completed = loops > 0 || (len != null && maxT >= len - 1.5);
  return { watchedS: Math.round(completed && len ? Math.max(maxT, len) : maxT), completed };
}

/** Whether the player went round again: it was near the end, and now it's near the start. Pure, for tests. */
export const looped = (prev: VideoProgress | null, next: VideoProgress) =>
  !!prev && !!next.duration && prev.t >= next.duration * 0.8 && next.t < Math.min(2, next.duration * 0.2);

function RailButton({ label, count, onClick, children, pressed, ...rest }: { label: string; count?: string; onClick?: () => void; children: ReactNode; pressed?: boolean } & Record<`data-${string}`, string>) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed} {...rest}
      className={cn("group flex flex-col items-center gap-1 text-white outline-none transition-transform duration-150 active:scale-[0.9] motion-reduce:transition-none motion-reduce:active:scale-100", EASE)}>
      <span className="grid size-11 place-items-center rounded-full bg-black/35 backdrop-blur-sm transition-colors duration-150 group-hover:bg-black/50 group-focus-visible:ring-2 group-focus-visible:ring-white/70 md:bg-ink/[0.08] md:text-text-base md:group-hover:bg-ink/[0.14]">
        {children}
      </span>
      {count != null && <span className="text-xs font-semibold tabular-nums drop-shadow md:text-text-muted md:drop-shadow-none">{count}</span>}
    </button>
  );
}

export function Cycle({ item, index, active, near, muted, signedIn, ready, onMute, onSignIn }: {
  item: CycleItem; index: number; active: boolean; near: boolean; muted: boolean; signedIn: boolean; ready: boolean;
  onMute: () => void; onSignIn: (what: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [eng, setEng] = useState<Engagement>(item.engagement);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [burst, setBurst] = useState<{ x: number; y: number; n: number } | null>(null);
  const [picker, setPicker] = useState(false);
  const feedItem = useRef(feedItemOf(item)).current;
  const lib = useItemState(feedItem, signedIn, ready);
  const saved = !!lib?.lists.includes("saved");

  // The player's clock, while on screen; the watch, reported when it leaves.
  const watch = useRef<{ maxT: number; duration: number | null; loops: number; sentLoops: number; sentDone: boolean }>({ maxT: 0, duration: item.duration, loops: 0, sentLoops: 0, sentDone: false });
  useEffect(() => {
    if (!active) return;
    const w: typeof watch.current = { maxT: 0, duration: item.duration, loops: 0, sentLoops: 0, sentDone: false };
    watch.current = w;
    setProgress(null); setPlaying(false); setPaused(false);
    let prev: VideoProgress | null = null;
    let live = false;
    const onMessage = (e: MessageEvent) => {
      const f = frame.current;
      if (!f || e.origin !== YT_ORIGIN || e.source !== f.contentWindow) return;
      const p = readProgress(e.data, prev);
      if (!p) return;
      live = true;
      if (looped(prev, p)) w.loops++;
      prev = p;
      w.maxT = Math.max(w.maxT, p.t);
      if (p.duration) w.duration = p.duration;
      setProgress(p);
      // playerState 1 is playing (readProgress keeps only "ended"; the raw message says the rest).
      try { const st = (JSON.parse(String(e.data)) as { info?: { playerState?: number } }).info?.playerState; if (st === 1) setPlaying(true); else if (st === 2) setPlaying(false); } catch { /* not ours */ }
      // Finished once: said at once (a replay or leaving adds to it).
      if (!w.sentDone && watchOf(w.maxT, w.duration, w.loops).completed) {
        w.sentDone = true;
        void reportWatch({ key: item.key, kind: item.series === "behind-the-bot" ? "behindTheBot" : "creator", watchedS: Math.round(w.maxT), completed: true }, signedIn);
      }
    };
    window.addEventListener("message", onMessage);
    const hello = () => { if (!live) frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), YT_ORIGIN); };
    const timer = setInterval(hello, 700);
    return () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
      const r = watchOf(w.maxT, w.duration, w.loops);
      const loops = w.loops - w.sentLoops;
      // A Cycle left in under a second without the player ever answering says nothing: it may never have loaded.
      if (!live && w.maxT === 0) return;
      void reportWatch({ key: item.key, kind: item.series === "behind-the-bot" ? "behindTheBot" : "creator", watchedS: r.watchedS, completed: r.completed, ...(loops > 0 ? { loops } : {}) }, signedIn);
    };
  }, [active, item.key, item.duration, item.series, signedIn]);

  const command = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), YT_ORIGIN);
  // Mute follows the page's switch, on the player already loaded.
  useEffect(() => { if (active) command(muted ? "mute" : "unMute"); }, [muted, active]);

  const like = async (on: boolean) => {
    if (!signedIn) { onSignIn("like videos"); return; }
    const before = eng;
    setEng((e) => withLike(e, on));
    try { setEng(await likeVideo(item.key, on)); } catch { setEng(before); toast("Couldn't save your like. Try again."); }
  };
  const react = async (emoji: Reaction | null) => {
    setPicker(false);
    if (!signedIn) { onSignIn("react to videos"); return; }
    const before = eng;
    setEng((e) => withReaction(e, emoji));
    try { setEng(await reactToVideo(item.key, emoji)); } catch { setEng(before); toast("Couldn't save your reaction. Try again."); }
  };
  const save = () => {
    const on = !saved;
    void setInList(signedIn, "saved", feedItem, on).then(
      () => toast(on ? "Saved" : "Removed from Saved", on ? { action: { label: "Undo", onClick: () => { void setInList(signedIn, "saved", feedItem, false); } } } : undefined),
      () => toast("Couldn't save that. Try again."));
  };
  const share = async () => {
    const url = `${location.origin}${cycleHref(item.videoId)}`;
    try {
      if (typeof navigator.share === "function") await navigator.share({ title: item.title, url });
      else { await navigator.clipboard.writeText(url); toast("Link copied"); }
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      toast("Couldn't share that. Try again.");
      return;
    }
    countShare(item.key).then(setEng, () => {});
  };

  // Tap pauses or plays; two taps like, with a heart where the finger was.
  const tap = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null }>({ at: 0, timer: null });
  const onTap = (e: React.PointerEvent<HTMLButtonElement>) => {
    const now = performance.now();
    const t = tap.current;
    if (now - t.at < 280) {
      if (t.timer) clearTimeout(t.timer);
      t.timer = null; t.at = 0;
      const r = e.currentTarget.getBoundingClientRect();
      setBurst({ x: e.clientX - r.left, y: e.clientY - r.top, n: (burst?.n ?? 0) + 1 });
      if (!eng.mine?.liked) void like(true);
      return;
    }
    t.at = now;
    t.timer = setTimeout(() => {
      t.timer = null;
      if (playing) { command("pauseVideo"); setPaused(true); } else { command("playVideo"); setPaused(false); }
    }, 280);
  };

  const reacted = eng.mine?.reaction ?? null;
  const reactions = reactionCount(eng);
  const top = (Object.entries(eng.reactions) as [Reaction, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r);
  const pct = progress?.duration ? Math.min(100, (progress.t / progress.duration) * 100) : 0;
  const kind = seriesLabel(item.series);

  return (
    <section data-cycle={item.videoId} data-cycle-index={index} aria-label={item.title} aria-roledescription="Cycle"
      className="relative flex h-full w-full shrink-0 snap-start snap-always items-center justify-center md:gap-4 md:py-4">
      <div className="relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:h-full md:w-auto md:max-w-full md:rounded-2xl md:shadow-[0_8px_40px_-12px_rgb(0_0_0/0.45)]">
        {/* The picture, under the player and in its place off screen. A Short's thumbnail has its tall frame in the middle:
            covering the tall stage crops to just that; the blurred copy fills behind while it loads. */}
        <img src={`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-2xl" />
        <img src={`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt="" loading={near ? "eager" : "lazy"} className="absolute inset-0 size-full object-cover" />
        {active && (
          // Taller than the stage by 64px each end: the player's own title bar and logo fall outside it, and the video
          // (fitted by its width) stays where it is. Shown once it says where it is, so loading is the picture, not black.
          <iframe ref={frame} key={item.videoId} title={`${item.title} video`} data-cycle-player
            className={cn("absolute inset-x-0 -top-16 h-[calc(100%+8rem)] w-full transition-opacity duration-200 ease-out motion-reduce:transition-none", progress ? "opacity-100" : "opacity-0")}
            src={bridgedSrc(embedUrl(item.videoId), { autoplay: 1, mute: muted ? 1 : 0, playsinline: 1, loop: 1, playlist: item.videoId, controls: 0, rel: 0, fs: 0, iv_load_policy: 3, disablekb: 1 })}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" />
        )}
        {/* Taps land here, not in the player: pause, play, double-tap to like. */}
        <button type="button" aria-label={paused ? "Play" : "Pause"} onPointerUp={onTap} className="absolute inset-0 z-10 cursor-pointer outline-none [-webkit-tap-highlight-color:transparent]" data-cycle-tap />
        {active && (paused || (progress && !playing && !progress.ended && progress.t < 0.5)) && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play className="size-7 translate-x-0.5 fill-white" aria-hidden />
          </span>
        )}
        {burst && (
          <Heart key={burst.n} aria-hidden onAnimationEnd={() => setBurst(null)}
            className={cn("cycle-burst pointer-events-none absolute z-20 size-24 -translate-x-1/2 -translate-y-1/2 drop-shadow-lg", LIKED)} style={{ left: burst.x, top: burst.y }} />
        )}

        {/* Who made it, what it is, the teams in it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-5 pt-24 text-white max-md:pr-20">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className="grid size-7 place-items-center rounded-full bg-white/15 text-xs" aria-hidden>{(item.creator.name ?? "?").slice(0, 1)}</span>
            {item.creator.name ?? "Creator"}
            {kind && <span className="rounded-full bg-white/15 px-2 py-0.5 text-[0.6875rem] font-medium">{kind}</span>}
          </p>
          <h2 className="mt-2 line-clamp-2 text-[0.9375rem] font-medium leading-snug">{item.title}</h2>
          {item.teams.length > 0 && (
            <ul className="pointer-events-auto mt-2 flex flex-wrap gap-1.5">
              {item.teams.slice(0, 4).map((t) => (
                <li key={t.number}>
                  <Link to={`/teams/${t.number}`} className="inline-flex items-center rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium backdrop-blur-sm transition-colors duration-150 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70">
                    {t.number}{t.name ? ` ${t.name}` : ""}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {item.reason !== kind && <p className="mt-2 text-xs text-white/70" data-cycle-reason>{item.reason}</p>}
        </div>
        {/* How far it is. */}
        <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-white/15" aria-hidden>
          <div className="h-full bg-white/80" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* The rail: over the video on a phone, beside it on a wide screen. */}
      <div className="absolute bottom-24 right-2 z-30 flex flex-col items-center gap-4 md:static md:self-end md:pb-8" data-cycle-rail>
        <RailButton label={eng.mine?.liked ? "Unlike" : "Like"} pressed={!!eng.mine?.liked} count={eng.likes ? shortCount(eng.likes) : "Like"} onClick={() => void like(!eng.mine?.liked)} data-cycle-action="like">
          <Heart className={cn("size-6 transition-transform duration-200", EASE, eng.mine?.liked && cn(LIKED, "scale-110"))} aria-hidden />
        </RailButton>
        <Popover open={picker} onOpenChange={(o) => { if (o && !signedIn) { onSignIn("react to videos"); return; } setPicker(o); }}>
          <PopoverTrigger asChild>
            <button type="button" aria-label={reacted ? `Your reaction: ${reacted}. Change it` : "React"} data-cycle-action="react"
              className={cn("group flex flex-col items-center gap-1 text-white outline-none transition-transform duration-150 active:scale-[0.9] motion-reduce:transition-none motion-reduce:active:scale-100", EASE)}>
              <span className="grid size-11 place-items-center rounded-full bg-black/35 text-xl backdrop-blur-sm transition-colors duration-150 group-hover:bg-black/50 group-focus-visible:ring-2 group-focus-visible:ring-white/70 md:bg-ink/[0.08] md:text-text-base md:group-hover:bg-ink/[0.14]">
                {reacted ?? <SmilePlus className="size-6" aria-hidden />}
              </span>
              <span className="flex items-center text-xs font-semibold tabular-nums drop-shadow md:text-text-muted md:drop-shadow-none">
                {top.length > 0 && <span className="mr-0.5 -space-x-1 text-[0.8125rem]" aria-hidden>{top.join("")}</span>}
                {reactions ? shortCount(reactions) : "React"}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="left" align="center" className="flex w-auto gap-1 rounded-full p-1.5" data-cycle-reactions>
            {REACTIONS.map((r) => (
              <button key={r} type="button" onClick={() => void react(reacted === r ? null : r)} aria-label={reacted === r ? `Take back ${r}` : `React ${r}`} aria-pressed={reacted === r}
                className={cn("grid size-10 place-items-center rounded-full text-[1.375rem] transition-transform duration-150 hover:scale-[1.18] active:scale-[0.9] motion-reduce:transition-none motion-reduce:hover:scale-100", EASE, reacted === r && "bg-ink/[0.1]")}>
                {r}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        <RailButton label={saved ? "Remove from Saved" : "Save"} pressed={saved} count={saved ? "Saved" : "Save"} onClick={save} data-cycle-action="save">
          <Bookmark className={cn("size-6", saved && "fill-current")} aria-hidden />
        </RailButton>
        <RailButton label="Share" count={eng.shares ? shortCount(eng.shares) : "Share"} onClick={() => void share()} data-cycle-action="share">
          <Send className="size-6" aria-hidden />
        </RailButton>
        <RailButton label={muted ? "Turn sound on" : "Mute"} onClick={onMute} data-cycle-action="mute">
          {muted ? <VolumeX className="size-6" aria-hidden /> : <Volume2 className="size-6" aria-hidden />}
        </RailButton>
      </div>
    </section>
  );
}
