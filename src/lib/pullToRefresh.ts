// Pull down from the top of the page to reload, for the installed app on a phone.
//
// A phone browser tab has its own pull-to-refresh (Chrome on Android, Safari on iOS 15+), so this stays
// out of it there; the installed app (display-mode standalone, iOS's navigator.standalone) has none and no
// reload button either, so this is the only way to reload in it. Desktop and mouse/trackpad get nothing.
//
// The gesture is a small state machine, kept free of the DOM so it can be tested on its own:
// - It only starts with one finger, on a page scrolled to the very top, outside dialogs, sheets and the
//   page's inner scrollers (see `pullBlocked`).
// - The first few pixels decide the direction: sideways (a strip, a carousel, a table) or up gives the
//   gesture back to the browser for good; only a downward drag becomes a pull.
// - The indicator follows the finger with resistance (half the drag, capped), and a release past the
//   threshold reloads. Letting go short of it, or a second finger, cancels.
import { runningInstalled } from "./installNudge";
import { isShown } from "./visible";

/** Indicator travel (px) a release has to pass to reload. */
export const PULL_THRESHOLD = 72;
/** Most the indicator travels, however far the finger goes. */
export const PULL_MAX = 112;
/** Indicator travel per pixel of drag. */
export const PULL_RESISTANCE = 0.5;
/** Movement (px) before the direction is decided. */
export const PULL_SLOP = 8;

export type PullPhase = "idle" | "pending" | "pulling" | "ignored";

export type PullState = {
  phase: PullPhase;
  startX: number;
  startY: number;
  /** Indicator travel, 0 … PULL_MAX. */
  distance: number;
};

export const IDLE: PullState = { phase: "idle", startX: 0, startY: 0, distance: 0 };

/** A finger comes down. `eligible`: one finger, page at the top, not in a dialog or inner scroller. */
export function pullStart(eligible: boolean, x: number, y: number): PullState {
  return eligible ? { phase: "pending", startX: x, startY: y, distance: 0 } : { ...IDLE, phase: "ignored" };
}

/** Indicator travel for a downward drag of `dy` px. */
export const pullDistance = (dy: number) => Math.max(0, Math.min(PULL_MAX, dy * PULL_RESISTANCE));

/**
 * The finger moves. `atTop`: the page is still scrolled to the top.
 * `prevent` says the move belongs to the pull, so the browser shouldn't also scroll or bounce the page.
 */
export function pullMove(s: PullState, x: number, y: number, atTop: boolean): { state: PullState; prevent: boolean } {
  if (s.phase === "idle" || s.phase === "ignored") return { state: s, prevent: false };
  const dx = x - s.startX;
  const dy = y - s.startY;
  if (s.phase === "pending") {
    if (Math.abs(dx) < PULL_SLOP && Math.abs(dy) < PULL_SLOP) return { state: s, prevent: false };
    // Sideways, or up (an ordinary scroll), or the page has moved off the top: the browser's.
    if (Math.abs(dx) >= Math.abs(dy) || dy <= 0 || !atTop) return { state: { ...IDLE, phase: "ignored" }, prevent: false };
  }
  // Back up past where it started: the reader is scrolling, not pulling. Over for this touch, so a later
  // move down (the page may have scrolled meanwhile) can't bring the reload back.
  if (dy <= 0) return { state: { ...IDLE, phase: "ignored" }, prevent: false };
  return { state: { ...s, phase: "pulling", distance: pullDistance(dy) }, prevent: true };
}

/** The finger lifts (or the touch is cancelled). True when the pull went far enough to reload. */
export function pullEnd(s: PullState, cancelled = false): boolean {
  return !cancelled && s.phase === "pulling" && s.distance >= PULL_THRESHOLD;
}

/** Elements a pull never starts inside: dialogs, sheets, menus and anything marked data-no-pull. */
const BLOCKING = '[role="dialog"],[role="alertdialog"],[aria-modal="true"],[role="menu"],[role="listbox"],[data-no-pull]';

/** A touch-action that leaves vertical panning to the page (auto, manipulation, pan-y …); anything else is a control's own drag. */
const pansVertically = (ta: string) => !ta || ta === "auto" || ta === "manipulation" || /pan-y|pan-down/.test(ta);

/**
 * Why a touch on `target` can't start a pull: it is inside a dialog, an inner vertical scroller (a list
 * with its own scrollbar, which owns its own overscroll) or a control that takes the drag itself (a reorder
 * grip, a slider, the map: touch-action none or pan-x), or a modal is open over the page.
 */
export function pullBlocked(target: Element | null, doc: Document = document): boolean {
  for (const el of doc.querySelectorAll('[aria-modal="true"]')) if (isShown(el)) return true;
  for (let el = target; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
    if (el.matches(BLOCKING)) return true;
    const cs = getComputedStyle(el);
    if (!pansVertically(cs.touchAction || cs.getPropertyValue("touch-action"))) return true;
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = cs.overflowY;
      if (oy === "auto" || oy === "scroll") return true;
    }
  }
  return false;
}

/** The page is scrolled to the very top (iOS can report a small negative while bouncing). */
export const pageAtTop = (win: Window = window) => (win.scrollY || win.document.documentElement.scrollTop || 0) <= 0;

/** The screenshot opt-in (`cs-pull-demo` = "1", `npm run shots -- --pull`): on in a browser tab too, still touch phones only. */
export const PULL_DEMO_KEY = "cs-pull-demo";
function pullDemo(win: Window): boolean {
  try { return win.localStorage.getItem(PULL_DEMO_KEY) === "1"; } catch { return false; }
}

/** The media queries pullToRefreshEnabled reads, to listen for a change (a rotation, a fold, installing). */
export const PULL_MEDIA = ["(pointer: coarse)", "(max-width: 1024px)", "(display-mode: standalone)", "(display-mode: fullscreen)", "(display-mode: minimal-ui)"];

/** Pull-to-refresh is on: the installed app, on a touch phone. Never in a browser tab, never on desktop. */
export function pullToRefreshEnabled(win: Window = window): boolean {
  const mm = (q: string) => win.matchMedia?.(q).matches === true;
  return (runningInstalled() || pullDemo(win)) && mm("(pointer: coarse)") && mm("(max-width: 1024px)");
}
