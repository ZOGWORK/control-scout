// Clips (/clips, /clips/:videoId; the code calls one a Cycle, its first name): Control Scout's short videos, one at a time,
// swiped up for the next, like a phone's short-video feed. Each page of six is ranked for the person by the recommendation engine (GET /api/cycles,
// server/api/cycles.ts) from what they've done so far, this scroll included: like a team's clip and the next page leans
// that way. A shared link (/clips/<id>) shows that video first.
//
// The stage fills the screen between the top and the tab bar on a phone (it covers the top bar, as short videos do). On a
// wide screen it fills the screen under the top bar: each clip as tall as that allows, the same room above and below.
// It scrolls on its own, a snap per clip; the arrow keys,
// j/k and the buttons step through it; m mutes; l likes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, ChevronLeft, ChevronUp } from "lucide-react";
import { useMediaQuery, useTitle } from "../lib/meta";
import { usePersonal } from "../lib/personal";
import { cyclesPage } from "../lib/cycles";
import { cycleHref } from "../shared/cycles";
import { useOpenSignIn } from "../components/layout/AccountMenu";
import { Cycle } from "../components/cycles/Cycle";
import { ClipsWordmark } from "../components/cycles/ClipsMark";
import { Button } from "../components/ui/button";
import { toast } from "../components/ui/sonner";
import type { CycleItem } from "../shared/cycles";

interface Feed { items: CycleItem[]; next: string | null; loading: boolean; error: unknown; done: boolean }
const START: Feed = { items: [], next: null, loading: true, error: null, done: false };
/** How close to the end the next page is asked for. */
const AHEAD = 3;

export default function CyclesPage() {
  useTitle("Clips");
  const params = useParams();
  // Only the address it was opened at picks the first video; the address then follows the scroll.
  const start = useRef(params.videoId && /^[A-Za-z0-9_-]{11}$/.test(params.videoId) ? params.videoId : null).current;
  const { state: personal, user, accountAnswered, providers } = usePersonal();
  const ready = accountAnswered || providers != null;
  const signedIn = !!user;
  const device = useMemo(() => (signedIn ? null : {
    myTeam: personal.myTeam,
    teams: [...new Set([...personal.tracked.teams, ...personal.bookmarks])].filter((n) => n !== personal.myTeam),
  }), [signedIn, personal.myTeam, personal.tracked.teams, personal.bookmarks]);
  const openSignIn = useOpenSignIn();
  const [feed, setFeed] = useState<Feed>(START);
  const [active, setActive] = useState(0);
  // Sound on when the visitor got here by a tap (the browser lets a page that was tapped play sound); a link opened cold
  // starts muted, or nothing would play at all.
  const [muted, setMuted] = useState(() => typeof navigator !== "undefined" && (navigator as { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive === false);
  const asked = useRef(0);
  const stage = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    const ask = cursor ? asked.current : ++asked.current;
    setFeed((f) => (cursor ? { ...f, loading: true, error: null } : { ...START }));
    try {
      const a = await cyclesPage(cursor, start, device);
      if (ask !== asked.current) return;
      setFeed((f) => {
        // A session built afresh can repeat one: each shown once.
        const have = new Set(cursor ? f.items.map((i) => i.key) : []);
        return { items: [...(cursor ? f.items : []), ...a.items.filter((i) => !have.has(i.key))], next: a.next, loading: false, error: null, done: !a.next };
      });
    } catch (e) {
      if (ask === asked.current) setFeed((f) => ({ ...f, loading: false, error: e }));
    }
    // The device's taste is read once per scroll (what it does mid-scroll goes with each page's history).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);
  useEffect(() => { if (ready) void load(null); }, [ready, load]);

  // Which clip is on screen: the one at least 60% in view.
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.cycleIndex));
    }, { root: el, threshold: 0.6 });
    for (const s of el.querySelectorAll("[data-cycle-index]")) io.observe(s);
    return () => io.disconnect();
  }, [feed.items.length]);

  // The next page as the end nears; the address follows the clip on screen, so a refresh or a copied link keeps it.
  useEffect(() => {
    if (feed.next && !feed.loading && !feed.error && active >= feed.items.length - AHEAD) void load(feed.next);
  }, [active, feed.next, feed.loading, feed.error, feed.items.length, load]);
  useEffect(() => {
    const v = feed.items[active]?.videoId;
    if (v && location.pathname !== cycleHref(v)) history.replaceState(history.state, "", cycleHref(v));
  }, [active, feed.items]);

  const go = useCallback((i: number) => {
    const el = stage.current?.querySelector<HTMLElement>(`[data-cycle-index="${i}"]`);
    // Straight there: the stage snaps; no smooth scrolling in this app (src/lib/pageScroll.test.tsx).
    el?.scrollIntoView({ block: "start" });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); go(Math.min(active + 1, feed.items.length - 1)); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); go(Math.max(active - 1, 0)); }
      else if (e.key === "m") setMuted((m) => !m);
      else if (e.key === "l") stage.current?.querySelector<HTMLButtonElement>(`[data-cycle-index="${active}"] [data-cycle-action="like"]`)?.click();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, feed.items.length, go]);

  const askSignIn = (what: string) => toast(`Sign in to ${what}`, { action: { label: "Sign in", onClick: openSignIn } });
  // On a phone the stage covers the top bar, so it's drawn at the top of the page (the page's own box can't rise above
  // the bar); on a wide screen it stays in the page.
  const phone = useMediaQuery("(max-width: 767px)");

  const view = (
    // Wide screen: pulled up over the page's top padding (PAGE_FRAME pt-8) to fill the screen under the top bar exactly.
    <div data-cycles className="fixed inset-x-0 top-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-[35] bg-black [--clips-pad:1.25rem] md:relative md:inset-auto md:z-auto md:-mt-8 md:h-(--clips-h) md:bg-transparent md:[--clips-h:calc(100dvh-3.5rem-env(safe-area-inset-top))]">
      {/* The top: back to Videos, and the name. Over the video on a phone. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex items-center gap-1 bg-gradient-to-b from-black/60 to-transparent px-2 pb-6 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-white md:hidden">
        <Link to="/videos" aria-label="Back to Videos" className="pointer-events-auto grid size-10 place-items-center rounded-full outline-none transition-transform duration-150 active:scale-[0.92] focus-visible:ring-2 focus-visible:ring-white/70">
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
        <h1><ClipsWordmark className="text-lg" markClassName="size-6" /></h1>
      </div>
      {/* The name, top left, clear of the clip (the words beside it sit at its foot). */}
      <h1 className="absolute left-6 top-(--clips-pad) z-10 hidden md:block"><ClipsWordmark /></h1>

      <div ref={stage} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-cycles-stage>
        {feed.items.map((c, i) => (
          <Cycle key={c.key} item={c} index={i} active={i === active} near={Math.abs(i - active) <= 2} muted={muted} signedIn={signedIn} ready={ready}
            onMute={() => setMuted((m) => !m)} onSignIn={askSignIn} />
        ))}
        {feed.loading && (
          <div className="flex h-full snap-start items-center justify-center md:py-(--clips-pad)" aria-busy data-skeleton>
            <div className="h-full w-full animate-pulse bg-white/[0.06] motion-reduce:animate-none md:aspect-[9/16] md:w-auto md:rounded-2xl md:bg-ink/[0.06]" />
          </div>
        )}
        {!!feed.error && (
          <div className="flex h-full snap-start flex-col items-center justify-center gap-3 px-6 text-center text-white md:text-text-base">
            <p>Couldn't load Clips.</p>
            <Button variant="outline" onClick={() => void load(feed.items.length ? feed.next : null)}>Try again</Button>
          </div>
        )}
        {!feed.loading && !feed.error && feed.done && (
          <div className="flex h-full snap-start flex-col items-center justify-center gap-3 px-6 text-center text-white md:text-text-base">
            <p className="text-lg font-semibold">{feed.items.length ? "You're all caught up" : "No clips yet"}</p>
            <p className="max-w-xs text-sm text-white/70 md:text-text-muted">{feed.items.length ? "New ones come in as FUN Robotics Network posts them." : "Short videos show up here as creators post them."}</p>
            <Button asChild variant="outline"><Link to="/videos">Back to Videos</Link></Button>
          </div>
        )}
      </div>

      {/* Up and down on a wide screen, at the stage's right edge, halfway down. */}
      <div className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 flex-col gap-3 md:flex">
        <Button variant="outline" size="icon" className="rounded-full" aria-label="Previous clip" disabled={active === 0} onClick={() => go(active - 1)}><ChevronUp aria-hidden /></Button>
        <Button variant="outline" size="icon" className="rounded-full" aria-label="Next clip" disabled={active >= feed.items.length - 1} onClick={() => go(active + 1)}><ChevronDown aria-hidden /></Button>
      </div>
    </div>
  );
  return phone && typeof document !== "undefined" ? createPortal(view, document.body) : view;
}
