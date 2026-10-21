// Sideways strips (rows of tabs, chips, a contents nav) bring their selected item into view by scrolling the
// strip alone. A glide started for one selection must not outlive it: when the selection changes again mid-glide
// (Back straight after picking a view) and the new item already shows, the strip would otherwise keep sliding
// on towards the item just left, and the selected one would slide out of view. So each strip's glide is
// remembered here, and the next reveal either replaces it (a new glide) or stops it where it is.

/** Where each strip's glide is headed, while one may still be on its way. */
const glides = new WeakMap<HTMLElement, number>();

/**
 * Scrolls `strip` sideways to `left`: a glide for "smooth" (remembered, so a later reveal can replace or stop it),
 * else at once (which also ends any glide still on its way).
 */
export function scrollStripTo(strip: HTMLElement, left: number, behavior: ScrollBehavior = "auto") {
  const to = Math.max(0, left);
  if (behavior === "smooth" && typeof strip.scrollTo === "function") {
    glides.set(strip, to);
    strip.scrollTo({ left: to, behavior });
    return;
  }
  glides.delete(strip);
  strip.scrollLeft = to;
}

/**
 * Stops a glide this module started on `strip` that hasn't arrived yet, leaving the strip where it is now. Call
 * it when the selected item already shows and nothing else needs scrolling. (An instant scroll to the current
 * position ends a glide in Chromium and WebKit.) A strip with no glide of ours is left alone, so a reader's
 * own swipe is never stopped.
 */
export function stopStripGlide(strip: HTMLElement) {
  const to = glides.get(strip);
  if (to === undefined) return;
  glides.delete(strip);
  if (Math.abs(strip.scrollLeft - to) < 1 || typeof strip.scrollTo !== "function") return;
  strip.scrollTo({ left: strip.scrollLeft, behavior: "auto" });
}

/**
 * Bring `item` fully into view inside a sideways-scrolling `strip` (a row of tabs or chips), by scrolling the
 * strip alone: never the page, so a restored scroll position (src/lib/pageScroll.ts) is left alone. When the
 * item already shows, nothing moves (and a glide of ours still heading elsewhere stops). `margin` keeps a little
 * of the strip's edge beside it. `behavior`: "smooth" glides there (a change the reader made); the default
 * jumps (arrival, a resize).
 */
export function revealInStrip(strip: HTMLElement, item: HTMLElement, margin = 8, behavior: ScrollBehavior = "auto") {
  const s = strip.getBoundingClientRect(), r = item.getBoundingClientRect();
  if (r.left >= s.left && r.right <= s.right) { stopStripGlide(strip); return; }
  const delta = r.left < s.left ? r.left - s.left - margin : r.right - s.right + margin;
  scrollStripTo(strip, strip.scrollLeft + delta, behavior);
}
