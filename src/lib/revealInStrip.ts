/**
 * Bring `item` fully into view inside a sideways-scrolling `strip` (a row of tabs or chips), by scrolling the
 * strip alone: never the page, so a restored scroll position (src/lib/pageScroll.ts) is left alone. Does
 * nothing when the item is already fully visible. `margin` keeps a little of the strip's edge beside it.
 */
export function revealInStrip(strip: HTMLElement, item: HTMLElement, margin = 8) {
  const s = strip.getBoundingClientRect(), r = item.getBoundingClientRect();
  if (r.left >= s.left && r.right <= s.right) return;
  const delta = r.left < s.left ? r.left - s.left - margin : r.right - s.right + margin;
  strip.scrollLeft = Math.max(0, strip.scrollLeft + delta);
}
