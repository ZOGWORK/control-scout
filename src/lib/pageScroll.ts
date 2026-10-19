// The page scrolls the document (window scrolling), so phone browsers collapse their toolbars as the
// reader scrolls. The top bar is sticky over it (Shell.tsx; its height is --header-h in index.css, and
// html's scroll-padding-top keeps anchors and scrollIntoView clear of it).
//
// The browser's own scroll restoration can't serve a client-rendered page (it restores before the
// page's data has rendered), so it is switched off (history.scrollRestoration = "manual") and this
// module does the job:
//
// - A new page (a link, a redirect) starts at the top.
// - Back and forward return to where that history entry was left, waiting for the page's data to
//   render (and the Events list to load enough batches) before giving up.
// - A change of query or hash on the same page (a tab, a filter, a sort) leaves the scroll alone.
// - A #hash scrolls to its element once it exists.
//
// It also marks the page area while it is scrolling (`data-scrolling` on the content's parent), so CSS
// can hold the ambient background still meanwhile, and the page while it is not (`data-scroll-idle` on
// <html>), so rows sliding under a resting pointer don't light up one after another (index.css).
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

export type ScrollPlan = { kind: "top" } | { kind: "restore"; y: number } | { kind: "hash"; id: string } | { kind: "keep" };

/**
 * What a navigation should do to the page's scroll position.
 * `prevPath` is null on the first render (a page load or reload). `fragment`: a plain #link on this page
 * (the skip link, a table of contents) that the browser followed itself, which the router reports as a
 * back/forward ("POP") to an entry of its own.
 */
export function planScroll(o: { action: "POP" | "PUSH" | "REPLACE"; prevPath: string | null; path: string; hash: string; saved: number | undefined; fragment?: boolean }): ScrollPlan {
  const id = hashId(o.hash);
  // Followed, not returned to: go to the target, not to where an earlier visit to this address was left.
  if (o.fragment && id) return { kind: "hash", id };
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

/** The element that scrolls the page: the document's own scroller. */
export function pageScroller(): HTMLElement {
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** The id of the shell's sticky top bar (Shell.tsx). */
export const HEADER_ID = "cs-header";

/** Where the visible page area starts, in viewport pixels: the bottom edge of the sticky top bar. */
export function pageTop(): number {
  const bar = typeof document === "undefined" ? null : document.getElementById(HEADER_ID);
  return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
}

/**
 * Scrolls the page so `el` sits under the sticky top bar, by its scroll-margin-top (the bar's height by
 * default, more with scroll-mt-bar-N: index.css). Unlike el.scrollIntoView, a clipping box around it
 * (overflow: hidden, as on a rounded card) can't cut that margin off and leave it under the bar.
 */
export function scrollToElement(el: Element, behavior: ScrollBehavior = "auto") {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const page = pageScroller();
  const y = Math.max(0, Math.round(el.getBoundingClientRect().top + page.scrollTop - margin));
  if (behavior === "smooth") window.scrollTo({ top: y, behavior });
  else page.scrollTop = y;
}

/** How long a restore keeps chasing its position while the page's content loads in. */
export const RESTORE_WINDOW_MS = 2500;
/** On <html> while the page is not scrolling (the still-hover variant in index.css keys off it). */
export const SCROLL_IDLE_ATTR = "data-scroll-idle";
/** How long after the last scroll event the page counts as still scrolling. */
export const SCROLL_IDLE_MS = 140;

/**
 * Runs `step` now and again whenever the content resizes (the page's data rendering in), until the
 * window runs out or the reader takes over (wheel, touch, keys or a click, heard on `inputs`).
 * `onEnd` runs once when it stops, however it stops. Returns a cancel function.
 */
export function chase(inputs: EventTarget, content: Element | null, step: () => void, windowMs = RESTORE_WINDOW_MS, onEnd?: () => void): () => void {
  const INPUTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  let over = false;
  const ro = typeof ResizeObserver === "undefined" || !content ? null : new ResizeObserver(() => { if (!over) step(); });
  const stop = () => {
    if (over) return;
    over = true;
    ro?.disconnect();
    clearTimeout(timer);
    for (const t of INPUTS) inputs.removeEventListener(t, stop);
    onEnd?.();
  };
  for (const t of INPUTS) inputs.addEventListener(t, stop, { passive: true });
  if (content) ro?.observe(content);
  const timer = setTimeout(stop, windowMs);
  step();
  return stop;
}

/**
 * The key a history entry's position is kept under. The router gives no key of its own ("default") to
 * the entry a page load opened, nor to one a plain #link added, so those are told apart by their
 * address, hash included: another address (or another #section of the page) must not share it.
 */
export function entryKey(loc: { key: string; pathname: string; search: string; hash?: string }): string {
  return loc.key === "default" ? `default:${loc.pathname}${loc.search}${loc.hash ?? ""}` : loc.key;
}

/** How long after a click on a plain #link its navigation still counts as that click's. */
const FOLLOW_MS = 1000;

/**
 * The #hash a click on this link is about to follow on the current page (the browser does it itself,
 * and the router hears it as a back/forward), or null: another page, another window, a modified click.
 */
export function followedHash(e: MouseEvent, here: { pathname: string; search: string }): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return null;
  let url: URL;
  try { url = new URL(a.href, location.href); } catch { return null; }
  if (url.origin !== location.origin || !url.hash || url.hash === "#" || url.search !== here.search || !samePath(url.pathname, here.pathname)) return null;
  return url.hash;
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
export function restoredSavedPosition(loc: { key: string; pathname: string; search: string; hash?: string }): boolean {
  return restoredKey === entryKey(loc);
}

/**
 * Scroll restoration for the page (the document's scroller). `content` is the page's content
 * (<main>): it grows as the page renders, and its parent is marked while the page scrolls.
 */
export function usePageScroll(content: RefObject<HTMLElement | null>) {
  const loc = useLocation();
  const action = useNavigationType();
  const store = useRef<ScrollPositions | null>(null);
  store.current ??= new ScrollPositions(sessionStore());
  const keyRef = useRef(entryKey(loc));
  const prevPath = useRef<string | null>(null);
  // A plain #link just clicked on this page, until the router reports its navigation (see followedHash).
  const followed = useRef<{ hash: string; at: number } | null>(null);
  const locRef = useRef(loc);
  locRef.current = loc;
  // The key for where the reader is now. An entry without a router key is known by its address, read
  // from the address bar: a page may change its #hash in place (history.replaceState, the How it works
  // contents) without the router hearing, and a reload looks the position up under the address it shows.
  const liveKey = () => {
    const l = locRef.current;
    if (!keyRef.current.startsWith("default:") || !samePath(location.pathname, l.pathname) || location.search !== l.search) return keyRef.current;
    return entryKey({ key: "default", pathname: l.pathname, search: l.search, hash: location.hash });
  };
  // The plan made for the current location, reused if the effect runs again for the same location
  // (React's StrictMode replays effects in development).
  const last = useRef<{ sig: string; plan: ScrollPlan } | null>(null);
  // While a saved position is being restored, the clamped positions a still-short page passes through
  // are not the reader's: the saved one stays until the restore ends.
  const restoring = useRef(false);

  // This module restores positions itself (see the top of the file): the browser's own restoring would
  // jump the page before its content is back, and again when this one runs.
  useEffect(() => {
    if (typeof history === "undefined" || !("scrollRestoration" in history)) return;
    const was = history.scrollRestoration;
    history.scrollRestoration = "manual";
    return () => { history.scrollRestoration = was; };
  }, []);

  // Tell a followed #link from a back/forward: both reach the router as "POP". Heard after the page's
  // own handlers (bubbling to the document), so a link they took over (preventDefault) doesn't count.
  // The place the reader leaves is kept now, before the browser jumps to the section.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const hash = followedHash(e, locRef.current);
      if (hash === null || hash === locRef.current.hash) return;
      store.current!.set(keyRef.current, pageScroller().scrollTop);
      followed.current = { hash, at: performance.now() };
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Remember where each entry is, as the reader scrolls. Also flags "scrolling" for CSS.
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    const flagOn = el.parentElement ?? el;
    // The opposite flag, on <html>: CSS lets rows light up under the pointer only while it is there (the
    // still-hover variant, index.css). Written as a present attribute on an ancestor, flipping it restyles
    // just the elements that use it; keyed off [data-scrolling] with :not(), it restyled the whole page.
    const root = document.documentElement;
    root.setAttribute(SCROLL_IDLE_ATTR, "");
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      // Not while a followed #link's jump is on its way: that position is the next entry's, not this one's.
      if (followed.current && performance.now() - followed.current.at >= FOLLOW_MS) followed.current = null;
      if (!restoring.current && !followed.current) store.current!.set(liveKey(), pageScroller().scrollTop);
      if (!flagOn.hasAttribute("data-scrolling")) { flagOn.setAttribute("data-scrolling", ""); root.removeAttribute(SCROLL_IDLE_ATTR); }
      clearTimeout(idle);
      idle = setTimeout(() => { flagOn.removeAttribute("data-scrolling"); root.setAttribute(SCROLL_IDLE_ATTR, ""); }, SCROLL_IDLE_MS);
    };
    const persist = () => store.current!.save();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      clearTimeout(idle);
      flagOn.removeAttribute("data-scrolling");
      root.removeAttribute(SCROLL_IDLE_ATTR);
    };
  }, [content]);

  // Before paint, so a new page never flashes at the old position.
  useLayoutEffect(() => {
    const main = content.current;
    if (!main) return;
    const el = pageScroller();
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
      // The #link just clicked on this page, arriving (not a back/forward to an entry with that hash).
      const f = followed.current;
      const fragment = action === "POP" && !!f && f.hash === loc.hash && performance.now() - f.at < FOLLOW_MS;
      followed.current = null;
      plan = planScroll({ action, prevPath: prevPath.current, path: loc.pathname, hash: loc.hash, saved, fragment });
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
      const stop = chase(window, main, () => { el.scrollTop = y; }, RESTORE_WINDOW_MS, () => {
        restoring.current = false;
        // Ended here (the window ran out, or the reader took over): where it stands is now the entry's.
        // Left for another entry mid-restore: the saved place stays, for the next time back.
        if (!leaving) store.current!.set(key, el.scrollTop);
      });
      return () => { leaving = true; stop(); };
    }
    const id = plan.id;
    return chase(window, main, () => {
      const target = document.getElementById(id);
      if (target && main.contains(target)) scrollToElement(target);
    });
  }, [loc.key, loc.pathname, loc.search, loc.hash, action, content]);
}
