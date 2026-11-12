// The desktop's eased wheel and trackpad scrolling: Lenis (npm `lenis`) eases the page toward where the wheel
// sends it, instead of the stepped notches Windows scrolls in. Loaded on its own, only on a desktop
// (src/lib/smoothWheel.ts): phones, tablets and reduced motion never download it.
//
// Lenis still scrolls the document itself (window scrolling, scrollTo with behavior "instant"), so everything
// that listens for scroll (the long lists' windowing, the scrolling flag, scroll restoration) works as before.
// What it changes:
// - Its animation loop runs only while a glide is on its way, then stops (no requestAnimationFrame at rest).
// - Anything that scrolls by itself keeps the browser's own scrolling: a box with its own scrollbar that can
//   still move that way, or that keeps its scroll to itself at its end (overscroll-behavior contain: pickers,
//   menus, the search palette) (both Lenis's allowNestedScroll), dialogs and popovers, and anything marked
//   data-lenis-prevent.
// - While a dialog or sheet locks the page (Radix's data-scroll-locked on <body>), it stands aside.
// - A click or a key ends a glide at once, so the browser's own scrolling (a button that scrolls the page,
//   Space, Page Down, the arrows, dragging the scrollbar) never fights it.
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import type { SmoothWheel } from "./pageScroll";

/**
 * How far the page moves toward the wheel's target each 60th of a second (Lenis's lerp, frame-rate independent).
 * 0.14 covers 13% of a notch in the first frame and 90% within about 270 ms: smooth, but it keeps up with the
 * wheel (Lenis's own default, 0.1, takes about 380 ms and trails a fast wheel). Higher follows more tightly.
 */
export const WHEEL_LERP = 0.14;

/** Boxes that keep the browser's own wheel scrolling, whatever their size: dialogs, popovers, pickers. */
const NATIVE_BOXES = "[data-lenis-prevent],[role=dialog],[role=alertdialog],[role=listbox],[role=menu],[data-radix-popper-content-wrapper],[data-radix-scroll-area-viewport]";

/**
 * Whether the wheel over `node` stays the browser's own. Lenis asks this of every element on the wheel event's
 * path, from its target up to the page (event.composedPath()), so a child deep inside a dialog or popover is
 * covered by the dialog's own answer: no need for closest() here, which would walk the same path again per element. Boxes that
 * scroll by themselves are Lenis's own check (allowNestedScroll): one that can still move the wheel's way keeps
 * it, and so does one at its end that keeps its scroll to itself (overscroll-behavior contain or none).
 */
export function keepNativeWheel(node: HTMLElement): boolean {
  return node.matches(NATIVE_BOXES);
}

/** Whether a dialog or sheet has locked the page's scroll (react-remove-scroll-bar's mark on <body>). */
export function pageScrollLocked(): boolean {
  return document.body.hasAttribute("data-scroll-locked");
}

/** Starts eased wheel scrolling on the page. `halt` ends a glide on its way; `destroy` hands scrolling back. */
export function startSmoothWheel(): SmoothWheel & { destroy(): void } {
  const lenis = new Lenis({
    lerp: WHEEL_LERP,
    smoothWheel: true,
    // Touch (a touchscreen laptop) stays the browser's own.
    syncTouch: false,
    allowNestedScroll: true,
    prevent: keepNativeWheel,
    virtualScroll: () => !pageScrollLocked(),
    autoRaf: false,
  });

  // The animation loop, only while a glide is on its way.
  let frame = 0;
  let fresh = true;
  const tick = (time: number) => {
    frame = 0;
    // Lenis measures each step from the last frame it saw; after a rest that was long ago, so the first frame
    // counts as one 60th of a second (not the whole rest, which would finish the glide in a single jump).
    if (fresh) { lenis.time = time - 1000 / 60; fresh = false; }
    lenis.raf(time);
    if (lenis.isScrolling === "smooth") frame = requestAnimationFrame(tick);
    else fresh = true;
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(tick); };
  const offWheel = lenis.on("virtual-scroll", wake);

  // Lenis's reset (typed private, stable across 1.x): stops the glide and takes the page's current position as its
  // own, touching nothing else. The public ways round are worse here: stop() then start() puts overflow: clip on
  // <html> in between (lenis-stopped), and start() reads scrollY under it; scrollTo(current, { immediate }) clamps
  // to Lenis's page height, which lags a growing page by its 250 ms resize debounce and would pull a restore back.
  const reset = () => (lenis as unknown as { reset(): void }).reset();
  const halt = () => {
    if (frame) { cancelAnimationFrame(frame); frame = 0; fresh = true; }
    reset();
  };
  const haltIfGliding = () => { if (lenis.isScrolling === "smooth") halt(); };
  // A key that scrolls or acts ends the glide; a modifier pressed on its own (Shift, Ctrl, Alt, Meta) scrolls nothing.
  const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);
  const onKey = (e: KeyboardEvent) => { if (!MODIFIERS.has(e.key)) haltIfGliding(); };
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", haltIfGliding, opts);
  window.addEventListener("keydown", onKey, opts);

  return {
    halt,
    destroy() {
      halt();
      offWheel();
      window.removeEventListener("pointerdown", haltIfGliding, opts);
      window.removeEventListener("keydown", onKey, opts);
      lenis.destroy();
    },
  };
}
