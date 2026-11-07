// Pull down from the top to reload, in the installed app on a phone (src/lib/pullToRefresh.ts says when and
// why). A round reload icon slides down under the top bar as the finger pulls, turning with the pull and
// filling yellow once a release would reload; on release it spins until the page reloads. Under reduced
// motion it doesn't turn or spin: it just appears, fills, and says "Reloading".
//
// The reload is a full page reload: the page's data, the app's code (a new deploy) and the service worker's
// copy all come fresh, which is what reloading means in a browser tab too.
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "../cn";
import { IDLE, PULL_MAX, PULL_THRESHOLD, pageAtTop, pullBlocked, pullEnd, pullMove, pullStart, pullToRefreshEnabled, type PullState } from "../../lib/pullToRefresh";

const reducedMotion = () => { try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { return false; } };

export function PullToRefresh({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [enabled] = useState(() => pullToRefreshEnabled());
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const state = useRef<PullState>(IDLE);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const set = (s: PullState) => { state.current = s; setDistance(s.distance); };
    const onStart = (e: TouchEvent) => {
      if (busy) return;
      const t = e.touches[0];
      const eligible = e.touches.length === 1 && pageAtTop() && !pullBlocked(e.target instanceof Element ? e.target : null);
      set(pullStart(eligible, t.clientX, t.clientY));
    };
    const onMove = (e: TouchEvent) => {
      if (busy || state.current.phase === "idle" || state.current.phase === "ignored") return;
      if (e.touches.length !== 1) { set(IDLE); return; }
      const t = e.touches[0];
      const { state: next, prevent } = pullMove(state.current, t.clientX, t.clientY, pageAtTop());
      if (prevent && e.cancelable) e.preventDefault();
      set(next);
    };
    const onEnd = (e: TouchEvent) => {
      if (busy) return;
      const go = pullEnd(state.current, e.type === "touchcancel");
      set(IDLE);
      if (!go) return;
      busy = true;
      setRefreshing(true);
      // A frame for the spinner to show before the page goes.
      requestAnimationFrame(() => setTimeout(() => reloadRef.current(), 60));
    };
    // touchmove can't be passive: a pull has to stop the page bouncing under it. It only cancels moves that
    // belong to a pull (from the top, downward), so ordinary scrolling is untouched.
    // And no rubber-band bounce at the top (iOS 16+, Android's stretch): the icon is the pull's feedback.
    const root = document.documentElement;
    const overscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "none";
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      root.style.overscrollBehaviorY = overscroll;
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  if (!enabled || (distance === 0 && !refreshing)) return null;
  const still = reducedMotion();
  const shown = refreshing ? PULL_THRESHOLD : distance;
  const armed = refreshing || distance >= PULL_THRESHOLD;
  const progress = Math.min(1, shown / PULL_THRESHOLD);
  return (
    <div data-pull-refresh className="pointer-events-none fixed inset-x-0 top-(--header-h) z-40 flex justify-center"
      style={{ transform: `translateY(${shown - 44}px)`, opacity: refreshing ? 1 : Math.min(1, progress * 1.4) }}>
      <div role="status" aria-live="polite"
        className={cn("grid size-10 place-items-center rounded-full border shadow-[0_8px_24px_-8px_rgba(0,0,0,.6)] transition-colors",
          armed ? "border-accent bg-accent text-accent-ink" : "border-line bg-card text-text-base")}>
        <RotateCw aria-hidden className={cn("size-5", refreshing && !still && "animate-spin")}
          style={refreshing || still ? undefined : { transform: `rotate(${(shown / PULL_MAX) * 300}deg)` }} />
        <span className="sr-only">{refreshing ? "Reloading" : armed ? "Release to reload" : "Pull to reload"}</span>
      </div>
    </div>
  );
}
