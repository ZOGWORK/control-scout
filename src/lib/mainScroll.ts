// The shell's page scroller (<main id="main">, Shell.tsx) is an element, not the window, so the
// browser's own scroll restoration never touches it. This module does that job:
//
// - A new page (a link, a redirect) starts at the top.
// - Back and forward return to where that history entry was left, waiting for the page's data to
//   render (and the Events list to load enough batches) before giving up.
// - A change of query or hash on the same page (a tab, a filter, a sort) leaves the scroll alone.
// - A #hash scrolls to its element once it exists.
//
// It also marks the scroll area while it is scrolling (`data-scrolling` on its parent), so CSS can
// hold the ambient background still meanwhile, and the page while it is not (`data-scroll-idle` on
// <html>), so rows sliding under a resting pointer don't light up one after another (index.css).
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export type ScrollPlan = { kind: "top" } | { kind: "restore"; y: number } | { kind: "hash"; id: string } | { kind: "keep" };

/**
 * What a navigation should do to the page's scroll position.
 * `prevPath` is null on the first render (a page load or reload).
 */
export function planScroll(o: { action: "POP" | "PUSH" | "REPLACE"; prevPath: string | null; path: string; hash: string; saved: number | undefined }): ScrollPlan {
  const id = hashId(o.hash);
  if (o.action === "POP") {
    if (o.saved !== undefined) return { kind: "restore", y: o.saved };
    return id ? { kind: "hash", id } : { kind: "keep" };
  }
  if (id) return { kind: "hash", id };
  // Same page, different query (tabs, filters, sorting): stay where the reader is.
  if (o.prevPath !== null && samePath(o.prevPath, o.path)) return { kind: "keep" };
  return { kind: "top" };
}

const samePath = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

function hashId(hash: string): string {
  const raw = hash.replace(/^#/, "");
  if (!raw) return "";
  try { return decodeURIComponent(raw); } catch { return raw; }
}

// Positions by history entry (React Router's location.key), kept for the tab's session so a reload
// (or coming back from another site) also returns to the same place.
const STORE_KEY = "cs-scroll";
const MAX_ENTRIES = 60;

export class ScrollPositions {
  private map = new Map<string, number>();
  constructor(private storage: Pick<Storage, "getItem" | "setItem"> | null) {
    try {
      const raw = storage?.getItem(STORE_KEY);
      const arr = raw ? (JSON.parse(raw) as [string, number][]) : [];
      if (Array.isArray(arr)) for (const [k, v] of arr) if (typeof k === "string" && Number.isFinite(v)) this.map.set(k, v);
    } catch { /* unreadable: start empty */ }
  }
  get(key: string): number | undefined { return this.map.get(key); }
  set(key: string, y: number) {
    // Re-inserted so the newest entries survive the trim.
    this.map.delete(key);
    this.map.set(key, Math.max(0, Math.round(y)));
    while (this.map.size > MAX_ENTRIES) this.map.delete(this.map.keys().next().value as string);
  }
  save() {
    try { this.storage?.setItem(STORE_KEY, JSON.stringify([...this.map])); } catch { /* full or blocked: positions last for this page load only */ }
  }
}

function sessionStore(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

/** How long a restore keeps chasing its position while the page's content loads in. */
export const RESTORE_WINDOW_MS = 2500;
/** On <html> while the page is not scrolling (the still-hover variant in index.css keys off it). */
export const SCROLL_IDLE_ATTR = "data-scroll-idle";
/** How long after the last scroll event the area counts as still scrolling. */
export const SCROLL_IDLE_MS = 140;

/**
 * Runs `step` now and again whenever the content resizes (the page's data rendering in), until the
 * window runs out or the reader takes over (wheel, touch, keys, a click). `onEnd` runs once when it
 * stops, however it stops. Returns a cancel function.
 */
export function chase(scroller: HTMLElement, content: Element | null, step: () => void, windowMs = RESTORE_WINDOW_MS, onEnd?: () => void): () => void {
  const INPUTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  let over = false;
  const ro = typeof ResizeObserver === "undefined" || !content ? null : new ResizeObserver(() => { if (!over) step(); });
  const stop = () => {
    if (over) return;
    over = true;
    ro?.disconnect();
    clearTimeout(timer);
    for (const t of INPUTS) scroller.removeEventListener(t, stop);
    onEnd?.();
  };
  for (const t of INPUTS) scroller.addEventListener(t, stop, { passive: true });
  if (content) ro?.observe(content);
  const timer = setTimeout(stop, windowMs);
  step();
  return stop;
}

/**
 * The key a history entry's position is kept under. The router gives the entry a page load opened on
 * no key of its own ("default"), so that one is told apart by its address: another address opened
 * later in the same tab must not share it.
 */
export function entryKey(loc: { key: string; pathname: string; search: string }): string {
  return loc.key === "default" ? `default:${loc.pathname}${loc.search}` : loc.key;
}

/** How this document was opened: "navigate" (a link, the address bar), "reload" or "back_forward". */
function documentNavigation(): string {
  try {
    const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return nav?.type ?? "navigate";
  } catch { return "navigate"; }
}

// The history entry whose saved position was last restored (back/forward, a reload). A page that
// scrolls itself to something on arrival (a linked match) leaves that entry alone: the reader had
// already scrolled on from there.
let restoredKey: string | null = null;
/** Whether arriving at this entry restored a saved position (so the page should not scroll itself). */
export function restoredSavedPosition(loc: { key: string; pathname: string; search: string }): boolean {
  return restoredKey === entryKey(loc);
}

/** Scroll restoration for the shell's scroller; its first child is the content that grows as the page renders. */
export function useMainScroll(main: RefObject<HTMLElement | null>) {
  const loc = useLocation();
  const action = useNavigationType();
  const store = useRef<ScrollPositions | null>(null);
  store.current ??= new ScrollPositions(sessionStore());
  const keyRef = useRef(entryKey(loc));
  const prevPath = useRef<string | null>(null);
  // The plan made for the current location, reused if the effect runs again for the same location
  // (React's StrictMode replays effects in development).
  const last = useRef<{ sig: string; plan: ScrollPlan } | null>(null);
  // While a saved position is being restored, the clamped positions a still-short page passes through
  // are not the reader's: the saved one stays until the restore ends.
  const restoring = useRef(false);

  // Remember where each entry is, as the reader scrolls. Also flags "scrolling" for CSS.
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const flagOn = el.parentElement ?? el;
    // The opposite flag, on <html>: CSS lets rows light up under the pointer only while it is there (the
    // still-hover variant, index.css). Written as a present attribute on an ancestor, flipping it restyles
    // just the elements that use it; keyed off [data-scrolling] with :not(), it restyled the whole page.
    const root = document.documentElement;
    root.setAttribute(SCROLL_IDLE_ATTR, "");
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (!restoring.current) store.current!.set(keyRef.current, el.scrollTop);
      if (!flagOn.hasAttribute("data-scrolling")) { flagOn.setAttribute("data-scrolling", ""); root.removeAttribute(SCROLL_IDLE_ATTR); }
      clearTimeout(idle);
      idle = setTimeout(() => { flagOn.removeAttribute("data-scrolling"); root.setAttribute(SCROLL_IDLE_ATTR, ""); }, SCROLL_IDLE_MS);
    };
    const persist = () => store.current!.save();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      clearTimeout(idle);
      flagOn.removeAttribute("data-scrolling");
      root.removeAttribute(SCROLL_IDLE_ATTR);
    };
  }, [main]);

  // Before paint, so a new page never flashes at the old position.
  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    const key = entryKey(loc);
    keyRef.current = key;
    const sig = `${action} ${key} ${loc.pathname}${loc.search}${loc.hash}`;
    let plan: ScrollPlan;
    if (last.current?.sig === sig) plan = last.current.plan;
    else {
      // A newly opened page (not a reload, not back/forward into this tab) starts afresh, whatever an
      // earlier visit to the same address left under its key.
      const fresh = prevPath.current === null && loc.key === "default" && documentNavigation() === "navigate";
      if (fresh) store.current!.set(key, 0);
      const saved = fresh ? undefined : store.current!.get(key);
      plan = planScroll({ action, prevPath: prevPath.current, path: loc.pathname, hash: loc.hash, saved });
      last.current = { sig, plan };
      prevPath.current = loc.pathname;
    }
    restoredKey = plan.kind === "restore" ? key : null;
    if (plan.kind === "top") el.scrollTop = 0;
    // The entry has a position from the start (a tab switch replaces the entry, and the reader may
    // never scroll on it): coming back to it must not keep whatever the page left behind.
    if (plan.kind === "keep" || plan.kind === "top") store.current!.set(key, el.scrollTop);
    store.current!.save();
    if (plan.kind === "keep" || plan.kind === "top") return;
    // Re-applied as the page's content loads in: until then the page is shorter than the position.
    if (plan.kind === "restore") {
      const y = plan.y;
      let leaving = false;
      restoring.current = true;
      const stop = chase(el, el.firstElementChild, () => { el.scrollTop = y; }, RESTORE_WINDOW_MS, () => {
        restoring.current = false;
        // Ended here (the window ran out, or the reader took over): where it stands is now the entry's.
        // Left for another entry mid-restore: the saved place stays, for the next time back.
        if (!leaving) store.current!.set(key, el.scrollTop);
      });
      return () => { leaving = true; stop(); };
    }
    const id = plan.id;
    return chase(el, el.firstElementChild, () => {
      const target = document.getElementById(id);
      if (target && el.contains(target)) target.scrollIntoView({ block: "start" });
    });
  }, [loc.key, loc.pathname, loc.search, loc.hash, action, main]);
}
