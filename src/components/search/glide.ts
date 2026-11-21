// v8: Home's big search → /search. The one navigation on the site that moves: the search box glides from the middle of
// Home up to its place at the top, Home's cards fade out under it, and the results (their loading shapes first) fade
// and rise in beneath. Everything else still changes pages instantly (the v8 brief, §4 and Q5).
// The browser does the morph (View Transitions): the boxes get their shared name only while this runs (glide.css), so
// no other navigation is ever animated. No API (or v8 off): the plain, instant navigation, exactly as before.
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { isV8 } from "../../lib/v8";
import "./glide.css";

type ViewTransitionLike = { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void> };
type DocWithVT = Document & { startViewTransition?: (cb: () => Promise<void> | void) => ViewTransitionLike };

/** The longest the new page may keep the screen frozen before it's shown as it is (its code still loading, say). */
export const GLIDE_WAIT_MS = 500;

/** The search box drawn on screen now (Home's, the top bar's, or a phone's results bar: one at a time). */
function shownBox(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-glide-box]")) if (el.getClientRects().length) return el;
  return null;
}
const shownResults = () => [...document.querySelectorAll<HTMLElement>("[data-search-loading], [data-results-column]")].some((el) => el.getClientRects().length > 0);

/** Polls on timers, never animation frames: the browser holds rendering (and so requestAnimationFrame) while a view
 *  transition's update runs, so a frame-based wait would never return and the transition would time out. */
function until(ok: () => boolean, ms: number): Promise<void> {
  return new Promise((done) => {
    const end = performance.now() + ms;
    const tick = () => (ok() || performance.now() > end ? done() : setTimeout(tick, 16));
    tick();
  });
}

/** True when `href` is the full results page and this browser can glide to it in the v8 look. */
export function canGlide(href: string): boolean {
  if (typeof document === "undefined" || !isV8()) return false;
  if (typeof (document as DocWithVT).startViewTransition !== "function") return false;
  return /^\/search\?/.test(href);
}

/** Goes to `href` (by calling `go`), gliding the search box there when it can. Returns true when it glides. */
export function glideTo(href: string, go: () => void): boolean {
  if (!canGlide(href)) { go(); return false; }
  const root = document.documentElement;
  root.setAttribute("data-search-glide", "");
  const t = (document as DocWithVT).startViewTransition!(async () => {
    flushSync(go);
    // The results page's code may still be on its way: hold the frame until its box and its first shapes are drawn.
    await until(() => location.pathname === "/search" && !!shownBox() && shownResults(), GLIDE_WAIT_MS);
    // Focus stays in the search box (a keyboard's Enter); a touch screen lets go, so its keyboard closes over the results.
    const input = shownBox()?.querySelector("input");
    if (input && window.matchMedia?.("(pointer: fine)").matches && document.activeElement !== input) {
      // The flag is for this one focus only: cleared right after, so it can never swallow a later, real focus (an
      // element that already has focus gets no focus event, and a blocked focus gets none either).
      input.dataset.quietFocus = "";
      input.focus({ preventScroll: true });
      delete input.dataset.quietFocus;
    }
  });
  const end = () => root.removeAttribute("data-search-glide");
  t.finished.then(end, end);
  t.ready.catch(() => {}); // skipped (another transition, a hidden tab): the page has still changed
  return true;
}

/** Fetches the results page's code ahead of an Enter, so the glide never waits on it. */
export function preloadSearchPage() {
  void import("../../pages/SearchPage").catch(() => {});
}

const gliding = () => typeof document !== "undefined" && document.documentElement.hasAttribute("data-search-glide");
function onGlide(change: () => void) {
  const mo = new MutationObserver(change);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-search-glide"] });
  return () => mo.disconnect();
}
/** True while Home's glide is running. The results page keeps its loading shapes up until it ends, so the answer is
 *  drawn after the box has landed (drawing it mid-glide would hold the page's thread and stall the box), then fades in. */
export function useGliding(): boolean {
  return useSyncExternalStore(onGlide, gliding, () => false);
}
