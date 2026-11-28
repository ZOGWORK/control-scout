// One clip (src/pages/CyclesPage.tsx, Clips): a short video filling the stage, its buttons (like, react, save, share,
// sound) and who made it. Only the clip on screen holds a player (youtube-nocookie, its message channel on:
// lib/ytBridge.ts); the rest are their picture. Tap to pause, double-tap to like. Its watch is reported when it leaves the
// screen: how far it got, if it finished, and how many times it played through again (a replay is the strongest "yes"
// short of a like), as the recommendation engine learns from (server/videos/recommend.ts).
//
// A phone: the video fills the stage, its words and buttons over it, as short-video apps have them. A wide screen: three
// columns, the video as tall as the stage allows in the middle; the words to its left (from lg up, over the video below
// that), the buttons to its right.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Bookmark, Heart, Pause, Play, Send, SmilePlus, Volume2, VolumeX } from "lucide-react";
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

/** What a clip's watch says when it leaves the screen. Pure, for tests: seen this far of that long, played through
 *  this many more times. */
export function watchOf(maxT: number, duration: number | null, loops: number): { watchedS: number; completed: boolean } {
  const len = duration && duration > 0 ? duration : null;
  const completed = loops > 0 || (len != null && maxT >= len - 1.5);
  return { watchedS: Math.round(completed && len ? Math.max(maxT, len) : maxT), completed };
}

/** Whether the player went round again: it was near the end, and now it's near the start. Pure, for tests. */
export const looped = (prev: VideoProgress | null, next: VideoProgress) =>
  !!prev && !!next.duration && prev.t >= next.duration * 0.8 && next.t < Math.min(2, next.duration * 0.2);

const RAIL_BUTTON = cn("group flex flex-col items-center gap-0.5 text-white outline-none transition-transform duration-150 active:scale-[0.9] motion-reduce:transition-none motion-reduce:active:scale-100 md:gap-1", EASE);
/** A phone: the icon alone with a shadow, a slim column over the video; a wide screen: a soft round button beside it. */
const RAIL_FACE = "grid size-10 place-items-center rounded-full drop-shadow-[0_1px_3px_rgb(0_0_0/0.6)] transition-colors duration-150 group-focus-visible:ring-2 group-focus-visible:ring-white/70 md:size-11 md:bg-ink/[0.08] md:text-text-base md:drop-shadow-none md:group-hover:bg-ink/[0.14] md:group-focus-visible:ring-ring/60";
const RAIL_COUNT = "text-[0.6875rem] font-semibold tabular-nums drop-shadow-[0_1px_2px_rgb(0_0_0/0.7)] md:text-xs md:text-text-muted md:drop-shadow-none";
const RAIL_ICON = "size-7 md:size-6";

function RailButton({ label, count, onClick, children, pressed, ...rest }: { label: string; count?: string; onClick?: () => void; children: ReactNode; pressed?: boolean } & Record<`data-${string}`, string>) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed} {...rest} className={RAIL_BUTTON}>
      <span className={RAIL_FACE}>{children}</span>
      {count != null && <span className={RAIL_COUNT}>{count}</span>}
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
  // A tap that set it playing again: a Play that fades (a counter, so two in a row both show).
  const [flash, setFlash] = useState(0);
  const feedItem = useRef(feedItemOf(item)).current;
  // Whether it's saved: asked for the clips near the screen only (each asks again on every library change, and a long
  // scroll holds many clips).
  const lib = useItemState(near ? feedItem : null, signedIn, ready);
  const saved = !!lib?.lists.includes("saved");

  const command = (func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), YT_ORIGIN);

  // The player's clock, while on screen; the watch, reported when it leaves.
  const watch = useRef<{ maxT: number; duration: number | null; loops: number; sentLoops: number; sentDone: boolean }>({ maxT: 0, duration: item.duration, loops: 0, sentLoops: 0, sentDone: false });
  useEffect(() => {
    if (!active) return;
    const w: typeof watch.current = { maxT: 0, duration: item.duration, loops: 0, sentLoops: 0, sentDone: false };
    watch.current = w;
    setProgress(null); setPlaying(false); setPaused(false); setFlash(0);
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
      // playerState 1 is playing, 2 paused, 0 the end (readProgress keeps only "ended"; the raw message says the rest).
      // At the end it goes round again from the start: the player has no playlist to loop (see the iframe).
      try {
        const st = (JSON.parse(String(e.data)) as { info?: { playerState?: number } }).info?.playerState;
        if (st === 1) { setPlaying(true); setPaused(false); }
        else if (st === 2) setPlaying(false);
        else if (st === 0) { command("seekTo", [0, true]); command("playVideo"); }
      } catch { /* not ours */ }
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
      // A clip left in under a second without the player ever answering says nothing: it may never have loaded.
      if (!live && w.maxT === 0) return;
      void reportWatch({ key: item.key, kind: item.series === "behind-the-bot" ? "behindTheBot" : "creator", watchedS: r.watchedS, completed: r.completed, ...(loops > 0 ? { loops } : {}) }, signedIn);
    };
  }, [active, item.key, item.duration, item.series, signedIn]);

  // The player starts muted or not as the page's switch was when the clip came on screen; a change after that is a
  // command to the loaded player. (In its address, a change would load the player again: back to 0, and deaf to it.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startMuted = useMemo(() => muted, [active, item.videoId]);
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

  // Stopped: by a tap, or not yet started (an autoplay the browser held back).
  const stopped = active && (paused || (!!progress && !playing && !progress.ended && progress.t < 0.5));
  // Pause or play (a tap, or Enter / Space on the focused video).
  const toggle = () => {
    if (stopped) { command("playVideo"); setPaused(false); setFlash((n) => n + 1); }
    else { command("pauseVideo"); setPaused(true); setPlaying(false); }
  };

  // Tap pauses or plays; two taps like, with a heart where the finger was.
  const tap = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null }>({ at: -Infinity, timer: null });
  const onTap = (e: React.PointerEvent<HTMLButtonElement>) => {
    const now = performance.now();
    const t = tap.current;
    if (now - t.at < 280) {
      if (t.timer) clearTimeout(t.timer);
      t.timer = null; t.at = -Infinity;
      const r = e.currentTarget.getBoundingClientRect();
      setBurst({ x: e.clientX - r.left, y: e.clientY - r.top, n: (burst?.n ?? 0) + 1 });
      if (!eng.mine?.liked) void like(true);
      return;
    }
    t.at = now;
    t.timer = setTimeout(() => { t.timer = null; toggle(); }, 280);
  };

  const reacted = eng.mine?.reaction ?? null;
  const reactions = reactionCount(eng);
  const top = (Object.entries(eng.reactions) as [Reaction, number][]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r]) => r);
  const pct = progress?.duration ? Math.min(100, (progress.t / progress.duration) * 100) : 0;
  const kind = seriesLabel(item.series);

  return (
    // Wide screen: the outer columns are one width (1fr each), so the video sits in the middle of the stage, with the
    // same room above it as below (--clips-pad, CyclesPage).
    <section data-cycle={item.videoId} data-cycle-index={index} aria-label={item.title} aria-roledescription="Clip"
      className="relative h-full w-full shrink-0 snap-start snap-always md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end md:gap-6 md:px-6 md:py-(--clips-pad)">
      <div className="hidden min-w-0 md:flex md:h-full md:flex-col md:items-end md:justify-end" data-cycle-side>
        <Details item={item} kind={kind} place="side" />
      </div>
      <div className="group/video relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:h-[calc(var(--clips-h)-2*var(--clips-pad))] md:w-auto md:rounded-2xl md:shadow-[0_8px_40px_-12px_rgb(0_0_0/0.45)]" data-cycle-video>
        {/* The picture, under the player and in its place off screen. A Short's thumbnail has its tall frame in the middle:
            covering the tall stage crops to just that; the blurred copy fills behind while it loads. */}
        <img src={`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-60 blur-2xl" />
        <img src={`https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`} alt="" loading={near ? "eager" : "lazy"} className="absolute inset-0 size-full object-cover" />
        {active && (
          // Taller than the stage by 64px each end: the player's own title bar and logo fall outside it, and the video
          // (fitted by its width) stays where it is. Shown once it says where it is, so loading is the picture, not black.
          // No playlist: YouTube's loop needs one, and a playlist draws its own back and next buttons over a paused clip.
          <iframe ref={frame} key={item.videoId} title={`${item.title} video`} data-cycle-player
            className={cn("absolute inset-x-0 -top-16 h-[calc(100%+8rem)] w-full transition-opacity duration-200 ease-out motion-reduce:transition-none", progress ? "opacity-100" : "opacity-0")}
            src={bridgedSrc(embedUrl(item.videoId), { autoplay: 1, mute: startMuted ? 1 : 0, playsinline: 1, controls: 0, rel: 0, fs: 0, iv_load_policy: 3, disablekb: 1 })}
            allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" />
        )}
        {/* Taps land here, not in the player: pause, play, double-tap to like. */}
        <button type="button" aria-label={stopped ? "Play" : "Pause"} onPointerUp={onTap}
          // A click with no pointer behind it (Enter or Space on the focused video, a screen reader's activate): pause or play.
          onClick={(e) => { if (e.detail === 0) toggle(); }}
          className="absolute inset-0 z-10 cursor-pointer outline-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70" data-cycle-tap />
        {/* In the middle of the video: Play while it's stopped; while it plays, Pause under a pointer that hovers (a
            mouse), and a Play that fades when a tap starts it again. */}
        {active && (
          <span aria-hidden data-cycle-state={stopped ? "paused" : "playing"}
            className={cn("pointer-events-none absolute left-1/2 top-1/2 z-10 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-opacity duration-150 ease-out motion-reduce:transition-none",
              stopped ? "opacity-100" : "opacity-0 pointer-fine:group-hover/video:opacity-100")}>
            {stopped ? <Play className="size-7 translate-x-0.5 fill-white" /> : <Pause className="size-7 fill-white" />}
          </span>
        )}
        {flash > 0 && !stopped && (
          <span key={flash} aria-hidden onAnimationEnd={() => setFlash(0)} data-cycle-flash
            className="clip-flash pointer-events-none absolute left-1/2 top-1/2 z-10 grid size-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50 text-white backdrop-blur-sm pointer-fine:hidden">
            <Play className="size-7 translate-x-0.5 fill-white" />
          </span>
        )}
        {burst && (
          <Heart key={burst.n} aria-hidden onAnimationEnd={() => setBurst(null)}
            className={cn("cycle-burst pointer-events-none absolute z-20 size-24 -translate-x-1/2 -translate-y-1/2 drop-shadow-lg", LIKED)} style={{ left: burst.x, top: burst.y }} />
        )}
        <Details item={item} kind={kind} place="over" />
        {/* How far it is. */}
        <div className="absolute inset-x-0 bottom-0 z-20 h-0.5 bg-white/15" aria-hidden>
          <div className="h-full bg-white/80" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* The buttons: a slim column over the video's right edge on a phone; beside it on a wide screen, level with its foot. */}
      <div className="absolute bottom-6 right-1.5 z-30 flex flex-col items-center gap-3 md:static md:justify-self-start md:gap-4" data-cycle-rail>
        <RailButton label={eng.mine?.liked ? "Unlike" : "Like"} pressed={!!eng.mine?.liked} count={eng.likes ? shortCount(eng.likes) : "Like"} onClick={() => void like(!eng.mine?.liked)} data-cycle-action="like">
          <Heart className={cn(RAIL_ICON, "transition-transform duration-200", EASE, eng.mine?.liked && cn(LIKED, "scale-110"))} aria-hidden />
        </RailButton>
        <Popover open={picker} onOpenChange={(o) => { if (o && !signedIn) { onSignIn("react to videos"); return; } setPicker(o); }}>
          <PopoverTrigger asChild>
            <button type="button" aria-label={reacted ? `Your reaction: ${reacted}. Change it` : "React"} data-cycle-action="react" className={RAIL_BUTTON}>
              <span className={cn(RAIL_FACE, "text-xl")}>
                {reacted ?? <SmilePlus className={RAIL_ICON} aria-hidden />}
              </span>
              <span className={cn(RAIL_COUNT, "flex items-center")}>
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
          <Bookmark className={cn(RAIL_ICON, saved && "fill-current")} aria-hidden />
        </RailButton>
        <RailButton label="Share" count={eng.shares ? shortCount(eng.shares) : "Share"} onClick={() => void share()} data-cycle-action="share">
          <Send className={RAIL_ICON} aria-hidden />
        </RailButton>
        <RailButton label={muted ? "Turn sound on" : "Mute"} onClick={onMute} data-cycle-action="mute">
          {muted ? <VolumeX className={RAIL_ICON} aria-hidden /> : <Volume2 className={RAIL_ICON} aria-hidden />}
        </RailButton>
      </div>
    </section>
  );
}

/** Who made it, what it is, the teams in it, and why it's here. `over`: white over the video's foot (a phone, and a wide
 *  screen narrower than lg); `side`: in the page's own colours, left of the video (lg up). */
function Details({ item, kind, place }: { item: CycleItem; kind: string | null; place: "over" | "side" }) {
  const over = place === "over";
  return (
    <div data-cycle-details={place} className={over
      ? "pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pb-5 pt-24 text-white max-md:pr-16 lg:hidden"
      : "hidden w-full max-w-sm pb-1 text-text-base lg:block"}>
      <p className={cn("flex min-w-0 items-center gap-2 font-semibold", over ? "text-sm" : "text-[0.9375rem]")}>
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs", over ? "bg-white/15" : "bg-ink/[0.08]")} aria-hidden>{(item.creator.name ?? "?").slice(0, 1)}</span>
        <span className="truncate">{item.creator.name ?? "Creator"}</span>
        {kind && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium", over ? "bg-white/15" : "bg-accent/15 text-accent")}>{kind}</span>}
      </p>
      <h2 className={over ? "mt-2 line-clamp-2 text-[0.9375rem] font-medium leading-snug" : "mt-3 line-clamp-4 text-balance font-display text-xl font-semibold leading-snug tracking-tight"}>{item.title}</h2>
      {item.teams.length > 0 && (
        <ul className={cn("pointer-events-auto flex flex-wrap gap-1.5", over ? "mt-2" : "mt-3")}>
          {item.teams.slice(0, 4).map((t) => (
            <li key={t.number}>
              <Link to={`/teams/${t.number}`} className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2",
                over ? "bg-white/15 backdrop-blur-sm hover:bg-white/25 focus-visible:ring-white/70" : "bg-ink/[0.07] text-text-base hover:bg-ink/[0.12] focus-visible:ring-ring/60")}>
                {t.number}{t.name ? ` ${t.name}` : ""}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* Why it's here, unless it only says what's above ("From FUN Robotics Network" under that very name). */}
      {item.reason !== kind && item.reason !== `From ${item.creator.name}` && <p className={over ? "mt-2 text-xs text-white/70" : "mt-3 text-sm text-text-muted"} data-cycle-reason>{item.reason}</p>}
    </div>
  );
}
