// Drag-to-reorder with pointer events (mouse, pen and touch alike), no library.
//
// Items carry data-reorder-key; each has a handle that gets `handleProps(key)`.
// While dragging, nothing in the DOM moves and nothing re-renders per frame:
// the dragged item follows the pointer with a transform — kept inside the list
// (rows only move up and down) — and the others slide (transforms with a
// transition) to where they'll be if it's dropped there. Only the target slot
// is state (for the live pick numbers). Dropping commits the new order once;
// the items then settle from where they were drawn into their new places
// (FLIP). Escape (or a cancelled touch) slides everything back. The handle also
// takes the keyboard: arrows move one place, Home/End to the top/bottom.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { jumpPageTo } from "../../lib/pageScroll";
import { moveItem, nearestSlot } from "../../lib/shortlist";

export type Box = { left: number; top: number; width: number; height: number };

interface Drag {
  key: number; pointerId: number; handle: HTMLElement;
  from: number; to: number;
  /** Where the pointer grabbed the item, relative to its top-left. */
  grabX: number; grabY: number;
  /** Pointer position (viewport). */
  x: number; y: number;
  /** Every item's box at pickup, in scroll-content coordinates, in `start` order. */
  boxes: Box[]; start: number[]; els: (HTMLElement | null)[];
  /** The list's own box (content coordinates): the dragged item stays inside it. */
  bounds: Box;
  /** One column (rows) vs a grid of cards. */
  column: boolean; gap: number;
  raf: number; scroller: HTMLElement | null;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const SLIDE = "transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
const scrollOf = (s: HTMLElement | null) => (s ? { x: s.scrollLeft, y: s.scrollTop } : { x: window.scrollX, y: window.scrollY });

/**
 * Where each item sits if the order becomes `order` (by index into `start`'s
 * boxes). Rows: stacked from the first row's top with the original spacing, so
 * rows of different heights (an opened row) stay exact. Cards: laid out the
 * way the grid flows them — row by row, an opened card spanning every column
 * starts a row of its own — so the preview matches where each card lands.
 */
export function targetBoxes(boxes: readonly Box[], start: readonly number[], order: readonly number[], column: boolean, gap: number): Map<number, Box> {
  const out = new Map<number, Box>();
  const at = (k: number) => boxes[start.indexOf(k)];
  if (!boxes.length) return out;
  const top0 = Math.min(...boxes.map((b) => b.top));
  if (column) {
    let top = top0;
    for (const k of order) { const b = at(k); out.set(k, { ...b, top }); top += b.height + gap; }
    return out;
  }
  // The grid's columns, from the cards that span one: their distinct left edges.
  const cell = Math.min(...boxes.map((b) => b.width));
  const lefts = [...new Set(boxes.filter((b) => b.width < cell + 2).map((b) => Math.round(b.left)))].sort((a, b) => a - b);
  const x0 = Math.min(...boxes.map((b) => b.left));
  const colGap = lefts.length > 1 ? lefts[1] - lefts[0] - cell : 0;
  const cols = Math.max(1, Math.round((Math.max(...boxes.map((b) => b.left + b.width)) - x0 + colGap) / (cell + colGap)));
  // Row gap: the space between two rows of the original layout (same as the column gap when there's only one row).
  const tops = [...new Set(boxes.map((b) => Math.round(b.top)))].sort((a, b) => a - b);
  const rowGap = tops.length > 1 ? Math.max(0, tops[1] - tops[0] - Math.min(...boxes.filter((b) => Math.round(b.top) === tops[0]).map((b) => b.height))) : colGap;
  let col = 0, top = top0, rowH = 0;
  for (const k of order) {
    const b = at(k);
    const span = Math.min(cols, Math.max(1, Math.round((b.width + colGap) / (cell + colGap))));
    if (col + span > cols) { top += rowH + rowGap; col = 0; rowH = 0; }
    out.set(k, { ...b, left: x0 + col * (cell + colGap), top });
    rowH = Math.max(rowH, b.height);
    col += span;
  }
  return out;
}

/**
 * The slot the dragged item points at. Rows: it passes a row once its leading
 * edge crosses that row's middle (its bottom edge going down, its top edge going
 * up), so the first and last picks are reachable even with the row held inside
 * the list. Cards: the slot nearest its centre.
 */
export function targetIndex(boxes: readonly Box[], from: number, me: { left: number; top: number; width: number; height: number }, column: boolean): number {
  if (!column) return nearestSlot(boxes as Box[], me.left + me.width / 2, me.top + me.height / 2);
  let to = 0;
  boxes.forEach((b, i) => {
    if (i === from) return;
    const mid = b.top + b.height / 2;
    if (i < from ? me.top >= mid : me.top + me.height > mid) to++;
  });
  return to;
}

/**
 * Where the dragged item's top-left goes for a pointer position: under the
 * pointer where it was grabbed, but inside the list — rows keep their column
 * (no sideways movement) and never leave the list's top or bottom.
 */
export function dragPosition(want: { left: number; top: number }, me: Box, bounds: Box, column: boolean): { left: number; top: number } {
  const top = clamp(want.top, bounds.top, bounds.top + bounds.height - me.height);
  const left = column ? me.left : clamp(want.left, bounds.left, bounds.left + bounds.width - me.width);
  return { left, top };
}

export function useReorder({ items, onCommit, describe }: {
  items: number[];
  /** The new order, the item moved, where it went and where it was: both indexes into the order at pickup
   *  (a list that changed under a drag still gets the move the member made). */
  onCommit: (order: number[], moved: number, to: number, from: number) => void;
  /** The words a screen reader hears for a team (e.g. "18360 Pymble Pyrophosphate"). */
  describe: (key: number) => string;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  /** The order the drag would produce right now (null when not dragging): for the live pick numbers only. */
  const [preview, setPreview] = useState<number[] | null>(null);
  const [message, setMessage] = useState("");
  const container = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  /** After a commit: where each item was drawn, to settle from (FLIP). */
  const settleFrom = useRef<Map<number, DOMRect> | null>(null);
  const refocus = useRef<number | null>(null);

  const el = (k: number) => container.current?.querySelector<HTMLElement>(`[data-reorder-key="${k}"]`) ?? null;

  /** Slide the others to where they'd be with the dragged item at `to`. */
  const layoutOthers = (d: Drag) => {
    const order = moveItem(d.start, d.from, d.to);
    const target = targetBoxes(d.boxes, d.start, order, d.column, d.gap);
    d.start.forEach((k, i) => {
      if (k === d.key) return;
      const e = d.els[i], b = d.boxes[i], t = target.get(k)!;
      if (!e) return;
      e.style.transition = reduced() ? "" : SLIDE;
      e.style.transform = t.left === b.left && t.top === b.top ? "" : `translate3d(${t.left - b.left}px, ${t.top - b.top}px, 0)`;
    });
    // Cards: an opened card can push the preview a row deeper than the grid; make room below it until the drop.
    if (!d.column && container.current) {
      const bottom = Math.max(...[...target.values()].map((t) => t.top + t.height));
      const over = bottom - (d.bounds.top + d.bounds.height);
      // Padding, not min-height: extra height would stretch the grid's rows and move the cards measured at pickup.
      container.current.style.paddingBottom = over > 0 ? `${over}px` : "";
    }
  };

  /** Each frame while dragging: scroll near the edges, follow the pointer (inside the list), retarget. */
  const tick = useCallback(() => {
    const d = drag.current; if (!d) return;
    const edge = 72, h = window.innerHeight;
    const speed = d.y < edge ? -Math.ceil((edge - d.y) / 6) : d.y > h - edge ? Math.ceil((d.y - (h - edge)) / 6) : 0;
    if (speed) { if (d.scroller) d.scroller.scrollTop += speed; else jumpPageTo(speed, true); }
    const s = scrollOf(d.scroller);
    const b = d.boxes[d.from];
    const at = dragPosition({ left: d.x + s.x - d.grabX, top: d.y + s.y - d.grabY }, b, d.bounds, d.column);
    const me = d.els[d.from];
    if (me) me.style.transform = `translate3d(${at.left - b.left}px, ${at.top - b.top}px, 0)`;
    const to = targetIndex(d.boxes, d.from, { ...b, ...at }, d.column);
    if (to >= 0 && to !== d.to) {
      d.to = to;
      layoutOthers(d);
      setPreview(moveItem(d.start, d.from, to)); // only the pick numbers re-render; the DOM order doesn't change
    }
    d.raf = requestAnimationFrame(tick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Drop (commit) or cancel. */
  const end = useCallback((commit: boolean) => {
    const d = drag.current; if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    try { d.handle.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    for (const e of d.els) if (e) e.style.willChange = "";
    if (container.current) container.current.style.paddingBottom = "";
    const final = moveItem(d.start, d.from, d.to);
    setDragging(null);
    setPreview(null);
    if (commit && d.to !== d.from) {
      // Remember where everything is drawn now; once the new order renders, each settles from there.
      settleFrom.current = new Map(d.start.map((k, i) => [k, (d.els[i] ?? el(k))!.getBoundingClientRect()] as const));
      onCommit(final, d.key, d.to, d.from);
      setMessage(`${describe(d.key)} moved to pick ${d.to + 1} of ${final.length}.`);
    } else {
      // Nothing changes: slide everything back home.
      for (const e of d.els) if (e) { e.style.transition = reduced() ? "" : SLIDE; e.style.transform = ""; }
      setMessage(commit ? `${describe(d.key)} dropped at pick ${d.from + 1}, unchanged.` : `Reorder cancelled. ${describe(d.key)} is back at pick ${d.from + 1}.`);
    }
  }, [onCommit, describe]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a new order renders: drop the drag transforms and slide each from where it was drawn (FLIP);
  // keyboard moves keep focus on the handle that moved.
  useLayoutEffect(() => {
    const from = settleFrom.current;
    settleFrom.current = null;
    if (from) for (const k of items) {
      const e = el(k), was = from.get(k); if (!e) continue;
      e.style.transition = "none";
      e.style.transform = "";
      if (!was || reduced()) continue;
      const now = e.getBoundingClientRect();
      const dx = was.left - now.left, dy = was.top - now.top;
      if (!dx && !dy) continue;
      e.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      void e.offsetWidth; // apply the start position before animating home
      e.style.transition = SLIDE;
      e.style.transform = "";
    }
    if (refocus.current != null) {
      container.current?.querySelector<HTMLElement>(`[data-reorder-handle="${refocus.current}"]`)?.focus({ preventScroll: false });
      refocus.current = null;
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dragging == null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      const d = drag.current; if (d) d.to = d.from;
      end(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging, end]);

  // Unmounting mid-drag (navigating away): stop the frame loop.
  useEffect(() => () => { if (drag.current) cancelAnimationFrame(drag.current.raf); }, []);

  const moveBy = useCallback((key: number, delta: number | "top" | "bottom") => {
    const from = items.indexOf(key); if (from < 0) return;
    const to = delta === "top" ? 0 : delta === "bottom" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, from + delta));
    if (to === from) { setMessage(`${describe(key)} is already pick ${from + 1} of ${items.length}.`); return; }
    settleFrom.current = new Map(items.flatMap((k) => { const r = el(k)?.getBoundingClientRect(); return r ? [[k, r] as const] : []; }));
    const next = moveItem(items, from, to);
    onCommit(next, key, to, from);
    setMessage(`${describe(key)} moved to pick ${to + 1} of ${items.length}.`);
  }, [items, onCommit, describe]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProps = (key: number) => ({
    "data-reorder-handle": key,
    style: { touchAction: "none" as const },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || drag.current) return;
      const from = items.indexOf(key);
      const item = el(key); const list = container.current;
      if (!item || !list || from < 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const scroller = scrollParent(item), s = scrollOf(scroller);
      const els = items.map(el);
      // Measure without any leftover transforms (a settle animation still running).
      for (const x of els) if (x) { x.style.transition = "none"; x.style.transform = ""; x.style.willChange = "transform"; }
      const toBox = (r: DOMRect): Box => ({ left: r.left + s.x, top: r.top + s.y, width: r.width, height: r.height });
      const boxes = els.map((x) => (x ? toBox(x.getBoundingClientRect()) : { left: 0, top: 0, width: 0, height: 0 }));
      const column = boxes.every((b) => Math.abs(b.left - boxes[0].left) < 2);
      const gap = column && boxes.length > 1 ? Math.max(0, boxes[1].top - (boxes[0].top + boxes[0].height)) : 0;
      const r = item.getBoundingClientRect();
      drag.current = {
        key, pointerId: e.pointerId, handle: e.currentTarget, from, to: from, grabX: e.clientX - r.left, grabY: e.clientY - r.top,
        x: e.clientX, y: e.clientY, boxes, start: [...items], els, bounds: toBox(list.getBoundingClientRect()), column, gap, raf: 0, scroller,
      };
      setDragging(key);
      setPreview([...items]);
      setMessage(`Picked up ${describe(key)}, pick ${from + 1} of ${items.length}. Drag to move it; Escape cancels.`);
      drag.current.raf = requestAnimationFrame(tick);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => { const d = drag.current; if (d && e.pointerId === d.pointerId) { d.x = e.clientX; d.y = e.clientY; } },
    onPointerUp: (e: PointerEvent<HTMLElement>) => { if (drag.current?.pointerId === e.pointerId) end(true); },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current; if (!d || d.pointerId !== e.pointerId) return;
      d.to = d.from; end(false);
    },
    onLostPointerCapture: (e: PointerEvent<HTMLElement>) => {
      // Capture lost without a pointerup (e.g. the window lost focus): drop where it is.
      const d = drag.current; if (d && e.pointerId === d.pointerId) end(true);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const map: Record<string, number | "top" | "bottom"> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, Home: "top", End: "bottom" };
      const d = map[e.key]; if (d === undefined) return;
      e.preventDefault();
      refocus.current = key;
      moveBy(key, d);
    },
  });

  /** The pick number a team shows: where it would land mid-drag, else its place. */
  const rankOf = (key: number) => (preview ?? items).indexOf(key) + 1;

  return { order: items, rankOf, dragging, message, container, handleProps, moveBy };
}
