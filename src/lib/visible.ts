// Whether an element is really on screen right now. Pull-to-refresh uses it to stand down while a modal is open,
// and the add-to-home-screen nudge to wait while a dialog or menu is up.

/** On screen: laid out, not hidden, not inert. */
export function isShown(el: Element): boolean {
  if (!el.isConnected || el.closest("[inert], [aria-hidden=true]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}
