// Long lists (perf brief 2026-11-01, S2): an event's matches, a team's season and an event's standings
// rendered every row into the DOM, which janks scrolling on mid-range phones. This is Control Point's
// windowing (src/modern/ui/windowing.tsx there, on @tanstack/react-virtual) on Scout's scroller: the page
// scrolls the document (src/lib/pageScroll.ts), so the window is the viewport.
//
// useVirtualRows renders the rows on screen (plus a few either side) with spacers standing in for the
// rest, so the page keeps its full height and the scrollbar its size. Lists at or under WINDOW_THRESHOLD
// render as before. Every row renders:
// - on the server (the first-paint render of team and event pages, src/prerender/page.tsx), so the
//   static page is whole;
// - while printing, so paper gets the whole list;
// - once the reader opens find in page (Ctrl/⌘+F, F3, Ctrl/⌘+G), so it searches the whole list.
// The row holding keyboard focus stays rendered when it scrolls away, so focus is never dropped.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { flushSync } from "react-dom";
import { defaultRangeExtractor, useWindowVirtualizer, type Range, type VirtualItem } from "@tanstack/react-virtual";
import { jumpPageTo, pageTop } from "../../lib/pageScroll";

/** Lists at or below this many rows render without windowing (Control Point's threshold). */
export const WINDOW_THRESHOLD = 60;

/** The browser's find-in-page keys: find (Ctrl/⌘+F), and next / previous match (F3, Ctrl/⌘+G, with Shift backward). */
export const isFindKey = (e: KeyboardEvent) => {
  if (e.key === "F3") return true;
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
  const k = e.key.toLowerCase();
  return k === "g" || (k === "f" && !e.shiftKey);
};

/** True while the browser is printing, and from the moment the reader opens find in page (for the rest of the
 *  list's life: the find bar's closing can't be heard). Set synchronously, so the print snapshot and the find
 *  bar's first search already have every row. */
export function useEveryRow(): boolean {
  const [printing, setPrinting] = useState(false);
  const [finding, setFinding] = useState(false);
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    const key = (e: KeyboardEvent) => { if (isFindKey(e)) flushSync(() => setFinding(true)); };
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    window.addEventListener("keydown", key, { capture: true });
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
      window.removeEventListener("keydown", key, { capture: true });
    };
  }, []);
  return printing || finding;
}

const noSubscribe = () => () => {};
/** False in a server render (the static first-paint page: every row), true in the browser from the first render. */
const useInBrowser = () => useSyncExternalStore(noSubscribe, () => true, () => false);

export interface VirtualRow<T> {
  item: T;
  index: number;
  /** Props for the row's element (measures it while windowed). */
  rowProps: Record<string, unknown>;
  /** Space before this row standing in for rows left out between it and the one before (only next to a
   *  focused row kept from far away; 0 otherwise). */
  gapBefore: number;
}

export interface VirtualRows<E extends HTMLElement = HTMLElement> {
  /** Attach to the list/table body container (used to find where it starts on the page). */
  ref: RefObject<E | null>;
  /** The rows to render now (all of them when windowing is off). */
  rows<T>(items: T[]): VirtualRow<T>[];
  /** Space standing in for the rows above / below the window (0 when off). */
  paddingTop: number;
  paddingBottom: number;
  windowed: boolean;
  /** Puts row `index` at the top of the page area at once, so it renders; the caller then finds its element
   *  (a frame or two later) to place it exactly. Nothing when windowing is off (every row is there). */
  jumpTo(index: number): void;
}

// Measured row heights by list (`cache`), kept for this page load: a list mounting again (Back to it) places
// its rows where they were, so the restored scroll position lands on the same row, not on estimates.
const MAX_CACHED_LISTS = 20;
const sizes = new Map<string, VirtualItem[]>();

/**
 * Windows a single-column list of `count` rows (variable heights are measured; `estimate` is a row's height in
 * px, for rows not measured yet). `key` names row `index` (keeps measured heights with their rows across a sort
 * or filter). `cache` names the list on its page, so its measured heights outlive it (see `sizes`).
 */
export function useVirtualRows<E extends HTMLElement = HTMLElement>(count: number, estimate: number | ((index: number) => number), opts: { threshold?: number; key?: (index: number) => string | number; cache?: string } = {}): VirtualRows<E> {
  const { threshold = WINDOW_THRESHOLD, key, cache } = opts;
  const ref = useRef<E | null>(null);
  const every = useEveryRow();
  const browser = useInBrowser();
  const enabled = count > threshold && !every && browser;
  // Where the list starts on the page (document coordinates), kept up to date as content above it changes.
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const read = () => setMargin(Math.round(el.getBoundingClientRect().top + window.scrollY));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(document.documentElement);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);
  // The row holding focus (a row's button, a link in it), kept rendered with its neighbours while it is off screen. Known by its key,
  // so a re-sort that moves it (live standings refreshing) still keeps that row.
  const keyOf = (i: number) => (key ? key(i) : i);
  const keyRef = useRef(keyOf);
  keyRef.current = keyOf;
  const [focused, setFocused] = useState<string | number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const rowOf = (t: EventTarget | null) => {
      const row = (t as Element | null)?.closest?.("[data-index]");
      return row && el.contains(row) ? keyRef.current(Number(row.getAttribute("data-index"))) : null;
    };
    const on = (e: FocusEvent) => setFocused(rowOf(e.target));
    const off = (e: FocusEvent) => { if (!el.contains(e.relatedTarget as Node | null)) setFocused(null); };
    el.addEventListener("focusin", on);
    el.addEventListener("focusout", off);
    return () => { el.removeEventListener("focusin", on); el.removeEventListener("focusout", off); setFocused(null); };
  }, [enabled]);
  const rangeExtractor = useCallback((r: Range) => {
    const out = defaultRangeExtractor(r);
    if (focused == null) return out;
    // Where the focused row is now (only looked for while a row has focus).
    let at = -1;
    for (let i = 0; i < r.count; i++) if (keyRef.current(i) === focused) { at = i; break; }
    if (at < 0) return out;
    // With a row either side, so Tab and Shift+Tab from it reach the next and previous rows (and the browser
    // scrolls them into view, bringing the window along), not whatever is rendered beyond the gap.
    for (const i of [at - 1, at, at + 1]) if (i >= 0 && i < r.count && !out.includes(i)) out.push(i);
    return out.sort((a, b) => a - b);
    // The rows' order is read through keyRef: while a row has focus, a re-sort (a new key function) looks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, focused == null ? null : key]);
  const v = useWindowVirtualizer<HTMLElement>({
    count: enabled ? count : 0,
    estimateSize: typeof estimate === "number" ? () => estimate : estimate,
    ...(cache && sizes.has(cache) ? { initialMeasurementsCache: sizes.get(cache) } : {}),
    overscan: 8,
    scrollMargin: margin,
    rangeExtractor,
    ...(key ? { getItemKey: key } : {}),
    // Before the first measurement, assume the window's height.
    initialRect: { width: 0, height: typeof window === "undefined" ? 800 : window.innerHeight },
  });
  // The list's measured heights are kept as it goes (a re-mount reads them back).
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  useEffect(() => {
    if (!enabled) return;
    return () => {
      const name = cacheRef.current;
      const snap = v.takeSnapshot();
      if (!name || !snap.length) return;
      sizes.delete(name);
      sizes.set(name, snap);
      while (sizes.size > MAX_CACHED_LISTS) sizes.delete(sizes.keys().next().value as string);
    };
  }, [enabled, v]);
  if (!enabled) {
    return {
      ref, windowed: false, paddingTop: 0, paddingBottom: 0, jumpTo: () => {},
      rows: (items) => items.map((item, index) => ({ item, index, rowProps: {}, gapBefore: 0 })),
    };
  }
  const vis = v.getVirtualItems();
  const total = v.getTotalSize();
  const first = vis[0];
  const last = vis[vis.length - 1];
  return {
    ref,
    windowed: true,
    paddingTop: first ? first.start - margin : 0,
    paddingBottom: last ? Math.max(0, total - (last.end - margin)) : 0,
    jumpTo: (index) => {
      const at = v.getOffsetForIndex(index, "start");
      if (at) jumpPageTo(Math.max(0, at[0] - pageTop()));
    },
    rows: (items) => {
      let end = first?.start ?? 0;
      return vis.filter((vi) => vi.index < items.length).map((vi) => {
        const gapBefore = Math.max(0, vi.start - end);
        end = vi.end;
        return { item: items[vi.index], index: vi.index, rowProps: { ref: v.measureElement, "data-index": vi.index }, gapBefore };
      });
    },
  };
}

/**
 * While a table is windowed its columns keep the widest width they have had, so rows coming and going never
 * make them jump sideways (an auto-layout table sizes columns by the rows it has). Starts over when the
 * window's width changes or `resetKey` (the column set) does.
 */
export function useSteadyColumns(table: RefObject<HTMLTableElement | null>, on: boolean, resetKey?: unknown) {
  useLayoutEffect(() => {
    const t = table.current;
    if (!on || !t || typeof ResizeObserver === "undefined") return;
    const cells = () => [...(t.tHead?.rows[0]?.cells ?? [])];
    const widest: number[] = [];
    let width = window.innerWidth;
    const lock = () => {
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        widest.length = 0;
        for (const c of cells()) c.style.minWidth = "";
      }
      cells().forEach((c, i) => {
        const w = c.getBoundingClientRect().width;
        if (w > (widest[i] ?? 0) + 0.5) { widest[i] = w; c.style.minWidth = `${w}px`; }
      });
    };
    lock();
    const ro = new ResizeObserver(lock);
    ro.observe(t);
    for (const c of cells()) ro.observe(c);
    // A narrower window may change neither the table nor a cell (their min-widths hold them), so it's heard directly.
    window.addEventListener("resize", lock);
    return () => { ro.disconnect(); window.removeEventListener("resize", lock); for (const c of cells()) c.style.minWidth = ""; };
  }, [table, on, resetKey]);
}

/** A placeholder keeping the scroll height of rows outside the window. */
export function Spacer({ height, as: Tag = "tr", colSpan }: { height: number; as?: "tr" | "div"; colSpan?: number }) {
  if (height <= 0) return null;
  return Tag === "tr"
    ? <tr aria-hidden="true" style={{ height }} data-spacer><td colSpan={colSpan} style={{ padding: 0, border: 0 }} /></tr>
    : <div aria-hidden="true" style={{ height }} data-spacer />;
}
