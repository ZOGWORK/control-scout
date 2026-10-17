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
// hold the ambient background still meanwhile (index.css).
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
/** How long after the last scroll event the area counts as still scrolling. */
export const SCROLL_IDLE_MS = 140;

/**
 * Runs `step` now and again whenever the content resizes (the page's data rendering in), until the
 * window runs out or the reader takes over (wheel, touch, keys, a click). Returns a cancel function.
 */
export function chase(scroller: HTMLElement, content: Element | null, step: () => void, windowMs = RESTORE_WINDOW_MS): () => void {
  const INPUTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  let over = false;
  const ro = typeof ResizeObserver === "undefined" || !content ? null : new ResizeObserver(() => { if (!over) step(); });
  const stop = () => {
    if (over) return;
    over = true;
    ro?.disconnect();
    clearTimeout(timer);
    for (const t of INPUTS) scroller.removeEventListener(t, stop);
  };
  for (const t of INPUTS) scroller.addEventListener(t, stop, { passive: true });
  if (content) ro?.observe(content);
  const timer = setTimeout(stop, windowMs);
  step();
  return stop;
}

/** Scroll restoration for the shell's scroller; its first child is the content that grows as the page renders. */
export function useMainScroll(main: RefObject<HTMLElement | null>) {
  const loc = useLocation();
  const action = useNavigationType();
  const store = useRef<ScrollPositions | null>(null);
  store.current ??= new ScrollPositions(sessionStore());
  const keyRef = useRef(loc.key);
  const prevPath = useRef<string | null>(null);

  // Remember where each entry is, as the reader scrolls. Also flags "scrolling" for CSS.
  useEffect(() => {
    const el = main.current;
    if (!el) return;
    const flagOn = el.parentElement ?? el;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      store.current!.set(keyRef.current, el.scrollTop);
      if (!flagOn.hasAttribute("data-scrolling")) flagOn.setAttribute("data-scrolling", "");
      clearTimeout(idle);
      idle = setTimeout(() => flagOn.removeAttribute("data-scrolling"), SCROLL_IDLE_MS);
    };
    const persist = () => store.current!.save();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
      clearTimeout(idle);
      flagOn.removeAttribute("data-scrolling");
    };
  }, [main]);

  // Before paint, so a new page never flashes at the old position.
  useLayoutEffect(() => {
    const el = main.current;
    if (!el) return;
    keyRef.current = loc.key;
    // A fresh page load has no entry key yet ("default"): whatever was stored under it belongs to an earlier load.
    const fresh = prevPath.current === null && loc.key === "default";
    if (fresh) store.current!.set(loc.key, 0);
    const saved = fresh ? undefined : store.current!.get(loc.key);
    const plan = planScroll({ action, prevPath: prevPath.current, path: loc.pathname, hash: loc.hash, saved });
    prevPath.current = loc.pathname;
    store.current!.save();
    if (plan.kind === "keep") return;
    if (plan.kind === "top") { el.scrollTop = 0; return; }
    // Re-applied as the page's content loads in: until then the page is shorter than the position.
    if (plan.kind === "restore") return chase(el, el.firstElementChild, () => { el.scrollTop = plan.y; });
    return chase(el, el.firstElementChild, () => {
      const target = document.getElementById(plan.id);
      if (target && el.contains(target)) target.scrollIntoView({ block: "start" });
    });
  }, [loc.key, loc.pathname, loc.hash, action, main]);
}
