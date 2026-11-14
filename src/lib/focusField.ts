// Focusing a search field from a shortcut or a button. A mouse or keyboard user gets the whole query selected, so
// typing replaces it. A touch screen gets the caret at the end instead: on an iPhone a tap inside a selected range
// opens Cut/Copy/Paste rather than placing the caret, so a field that arrives fully selected can't be edited by
// tapping into it (the owner tapped three times and still couldn't change his search).

/** A touch screen with no fine pointer (a phone or tablet): tapping, not clicking. */
export function touchFirst(win: Pick<Window, "matchMedia"> | undefined = typeof window !== "undefined" ? window : undefined): boolean {
  return !!win?.matchMedia?.("(pointer: coarse)").matches && !win.matchMedia("(any-pointer: fine)").matches;
}

/** Focus a text field ready for editing: everything selected for a mouse or keyboard, the caret at the end for touch. */
export function focusForEditing(el: HTMLInputElement | null | undefined, opts: { touch?: boolean; preventScroll?: boolean } = {}): void {
  if (!el) return;
  el.focus({ preventScroll: opts.preventScroll });
  if (opts.touch ?? touchFirst()) {
    const end = el.value.length;
    try { el.setSelectionRange(end, end); } catch { /* a field type without a selection */ }
  } else el.select();
}
