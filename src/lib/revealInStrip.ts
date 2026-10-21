// Sideways strips (rows of tabs, chips, a contents nav) bring their selected item into view by scrolling the
// strip alone. A glide started for one selection must not outlive it: when the selection changes again mid-glide
// (Back straight after picking a view) and the new item already shows, the strip would otherwise keep sliding
// on towards the item just left, and the selected one would slide out of view. So a glide this module starts is
// tracked while, and only while, it is provably ours and still on its way, and the next reveal either replaces
// it (a new glide) or stops it where it is.
//
// The one rule that keeps that state from going stale: a tracked glide is forgotten the moment it can no
// longer be ours and in flight, whichever comes first:
//   · it finished: scrollend, or (where scrollend isn't supported) a scroll event at its destination;
//   · GLIDE_MAX_MS passed (a backstop: browsers end a programmatic glide well within it);
//   · it was replaced (another glide, or an instant scroll of the strip, through this module);
//   · the reader took over the strip (pointer, wheel, touch or a key on it): the glide is stopped where it is,
//     as a touch stops a sliding list, and the strip is the reader's from there.
// Every path goes through one `end`, which also removes the listeners and the timer.

/** The longest a glide of ours is tracked, in ms, if nothing else ends it first. */
export const GLIDE_MAX_MS = 1200;

const READER_INPUT = ["pointerdown", "wheel", "touchstart", "keydown"] as const;

type Glide = { to: number; end: () => void };
/** The glide of ours each strip has in flight, if any. */
const glides = new WeakMap<HTMLElement, Glide>();

/** Stops the strip where it is now (an instant scroll to the current position ends a glide in Chromium and WebKit). */
function halt(strip: HTMLElement) {
  if (typeof strip.scrollTo === "function") strip.scrollTo({ left: strip.scrollLeft, behavior: "auto" });
}

/** Starts tracking a glide of `strip` towards `to`, replacing any tracked before. */
function track(strip: HTMLElement, to: number) {
  glides.get(strip)?.end();
  let over = false;
  const end = () => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    strip.removeEventListener("scrollend", end);
    strip.removeEventListener("scroll", onScroll);
    for (const t of READER_INPUT) strip.removeEventListener(t, onInput, { capture: true });
    if (glides.get(strip) === glide) glides.delete(strip);
  };
  const onScroll = () => { if (Math.abs(strip.scrollLeft - to) < 1) end(); };
  const onInput = () => { end(); halt(strip); };
  const glide: Glide = { to, end };
  glides.set(strip, glide);
  strip.addEventListener("scrollend", end, { passive: true });
  strip.addEventListener("scroll", onScroll, { passive: true });
  for (const t of READER_INPUT) strip.addEventListener(t, onInput, { capture: true, passive: true });
  const timer = setTimeout(end, GLIDE_MAX_MS);
}

/**
 * Scrolls `strip` sideways to `left`: a glide for "smooth" (tracked while in flight, so a later reveal can replace
 * or stop it), else at once (which also ends any glide still on its way).
 */
export function scrollStripTo(strip: HTMLElement, left: number, behavior: ScrollBehavior = "auto") {
  // Clamped to where the strip can actually scroll, so a glide's destination is one it can reach (and the
  // arrived check in track can see it arrive).
  const max = strip.scrollWidth - strip.clientWidth;
  const to = Math.max(0, max > 0 ? Math.min(left, max) : left);
  if (behavior === "smooth" && typeof strip.scrollTo === "function") {
    track(strip, to);
    strip.scrollTo({ left: to, behavior });
    return;
  }
  glides.get(strip)?.end();
  strip.scrollLeft = to;
}

/**
 * Stops a glide of ours on `strip` that is still in flight, leaving the strip where it is now. Call it when the
 * selected item already shows and nothing else needs scrolling. Anything else (no glide of ours, one that has
 * finished, a strip the reader has taken over) is left alone, so a reader's own swipe is never cut short.
 */
export function stopStripGlide(strip: HTMLElement) {
  const glide = glides.get(strip);
  if (!glide) return;
  glide.end();
  if (Math.abs(strip.scrollLeft - glide.to) >= 1) halt(strip);
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
