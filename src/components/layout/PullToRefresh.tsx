// Pull down from the top to reload, in the installed app on a phone (src/lib/pullToRefresh.ts says when and
// why). The app's own mark, in a card-coloured circle, slides down under the top bar as the finger pulls;
// a yellow ring around it fills with the pull, and once a release would reload the circle takes the accent
// glow (the home search's). On release it rests there, the ring spins, and the thin yellow refresh bar sweeps
// under the top bar until the page reloads. Let go early and it springs back up.
//
// Smoothness: the indicator is always in the page while the feature is on, and each finger move only
// writes a transform and the ring's dash offset, once per frame (requestAnimationFrame), straight to the
// DOM: no React render during a pull, so it keeps up with the finger at the display's frame rate.
// Under reduced motion nothing turns, spins, springs or sweeps: it just appears, fills and goes.
//
// The reload is a full page reload: the page's data, the app's code (a new deploy) and the service worker's
// copy all come fresh, which is what reloading means in a browser tab too.
import { useEffect, useRef, useState } from "react";
import { IDLE, PULL_MEDIA, PULL_THRESHOLD, pageAtTop, pullBlocked, pullEnd, pullMove, pullStart, pullToRefreshEnabled, type PullState } from "../../lib/pullToRefresh";

const reducedMotion = () => { try { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true; } catch { return false; } };

/** The circle's size (px); it starts this far above its resting line, hidden under the top bar. */
const SIZE = 44;
/** The ring's radius and length, in the 44×44 viewBox. */
const R = 19;
const RING = 2 * Math.PI * R;

export type PullView = "idle" | "pulling" | "armed" | "returning" | "refreshing";
const LABEL: Record<PullView, string> = { idle: "", pulling: "Pull to reload", armed: "Release to reload", returning: "", refreshing: "Reloading" };

export function PullToRefresh({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const [enabled, setEnabled] = useState(() => pullToRefreshEnabled());
  const box = useRef<HTMLDivElement>(null);
  const ring = useRef<SVGCircleElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  // A rotation or a fold can cross the phone width: follow the media queries, not just the first read.
  useEffect(() => {
    const lists = PULL_MEDIA.map((q) => window.matchMedia?.(q)).filter((l): l is MediaQueryList => !!l?.addEventListener);
    const update = () => setEnabled(pullToRefreshEnabled());
    for (const l of lists) l.addEventListener("change", update);
    return () => { for (const l of lists) l.removeEventListener("change", update); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let state: PullState = IDLE;
    let busy = false;
    let frame = 0;
    let view: PullView = "idle";

    /** Write the indicator for travel `d` in view `v`: transform, opacity and ring only (compositor-cheap). */
    const draw = (d: number, v: PullView) => {
      const el = box.current;
      if (!el) return;
      if (v !== view) {
        view = v;
        el.dataset.state = v;
        if (label.current && LABEL[v] !== label.current.textContent) label.current.textContent = LABEL[v];
      }
      const p = Math.min(1, d / PULL_THRESHOLD);
      el.style.transform = `translate3d(0, ${d - SIZE}px, 0)`;
      el.style.opacity = v === "idle" ? "0" : String(v === "refreshing" ? 1 : Math.min(1, 0.25 + p));
      // Reloading: a 30% arc, which the CSS spins.
      if (ring.current) ring.current.style.strokeDashoffset = String(v === "refreshing" ? RING * 0.7 : RING * (1 - p));
      // The mark turns with the pull (not under reduced motion).
      const mark = el.querySelector<HTMLElement>("[data-pull-mark]");
      if (mark) mark.style.transform = v === "refreshing" || reducedMotion() ? "" : `rotate(${p * 270}deg)`;
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw(state.distance, state.phase === "pulling" && state.distance > 0 ? (state.distance >= PULL_THRESHOLD ? "armed" : "pulling") : view === "returning" ? "returning" : "idle");
      });
    };

    const onStart = (e: TouchEvent) => {
      if (busy) return;
      const t = e.touches[0];
      const eligible = e.touches.length === 1 && pageAtTop() && !pullBlocked(e.target instanceof Element ? e.target : null);
      state = pullStart(eligible, t.clientX, t.clientY);
      if (eligible && view === "returning") draw(0, "idle"); // caught mid-spring: start from the top again
    };
    const onMove = (e: TouchEvent) => {
      if (busy || state.phase === "idle" || state.phase === "ignored") return;
      // Two fingers, or a control on the page already took this move (its own drag): not a pull.
      if (e.touches.length !== 1 || e.defaultPrevented) { state = { ...IDLE, phase: "ignored" }; schedule(); return; }
      const t = e.touches[0];
      const { state: next, prevent } = pullMove(state, t.clientX, t.clientY, pageAtTop());
      if (prevent && e.cancelable) e.preventDefault();
      state = next;
      schedule();
    };
    const onEnd = (e: TouchEvent) => {
      if (busy) return;
      const go = pullEnd(state, e.type === "touchcancel");
      const from = state.distance;
      state = IDLE;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (go) {
        busy = true;
        draw(PULL_THRESHOLD, "refreshing");
        // A frame or two for the spinner and the bar to show before the page goes.
        requestAnimationFrame(() => setTimeout(() => reloadRef.current(), 120));
      } else if (from > 0 && !reducedMotion()) {
        draw(0, "returning"); // springs back up (CSS transition on [data-state=returning])
      } else {
        draw(0, "idle");
      }
    };
    const onSettled = (e: TransitionEvent) => { if (e.target === box.current && view === "returning" && e.propertyName === "transform") draw(0, "idle"); };

    // touchmove can't be passive: a pull has to stop the page bouncing under it. It only cancels moves that
    // belong to a pull (from the top, downward), so ordinary scrolling is untouched.
    // And no rubber-band bounce at the top (iOS 16+, Android's stretch): the indicator is the pull's feedback.
    const root = document.documentElement;
    const overscroll = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = "none";
    const el = box.current;
    draw(0, "idle");
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    el?.addEventListener("transitionend", onSettled);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      root.style.overscrollBehaviorY = overscroll;
      el?.removeEventListener("transitionend", onSettled);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      <div ref={box} data-pull-refresh data-state="idle"
        className="cs-pull pointer-events-none fixed left-1/2 top-(--header-h) z-40 -ml-[22px] size-11"
        style={{ transform: `translate3d(0, ${-SIZE}px, 0)`, opacity: 0 }}>
        <div className="cs-pull-disc relative grid size-11 place-items-center rounded-full border border-line bg-card shadow-[0_10px_28px_-10px_rgba(0,0,0,.65)]">
          <svg viewBox="0 0 44 44" className="cs-pull-ring absolute inset-0 size-11 -rotate-90" aria-hidden>
            <circle cx="22" cy="22" r={R} fill="none" strokeWidth="2.5" className="stroke-text-base/10" />
            <circle ref={ring} cx="22" cy="22" r={R} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-accent"
              style={{ strokeDasharray: RING, strokeDashoffset: RING }} />
          </svg>
          <img data-pull-mark src="/logo-56.webp" alt="" aria-hidden width={56} height={56} className="size-[22px]" />
        </div>
        <span ref={label} role="status" aria-live="polite" className="sr-only" />
      </div>
      {/* The app's refresh bar (the one a table shows while it refreshes), under the top bar while reloading. */}
      <div data-pull-bar className="cs-pull-bar pointer-events-none fixed inset-x-0 top-(--header-h) z-40 h-0.5 overflow-hidden bg-accent/20">
        <div className="h-full w-1/3 cs-progress bg-accent" />
      </div>
    </>
  );
}
