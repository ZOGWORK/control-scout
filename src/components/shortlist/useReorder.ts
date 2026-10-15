// Drag-to-reorder with pointer events (mouse, pen and touch alike), no library.
//
// Items carry data-reorder-key; each has a handle that gets `handleProps(key)`.
// While dragging, the order is a preview: the dragged item follows the pointer
// (a transform on top of its slot), the others slide to their new slots (FLIP),
// and the nearest slot to the pointer is where it lands. Dropping commits once.
// Escape (or a cancelled touch) puts everything back. The handle also takes
// the keyboard: arrows move one place, Home/End to the top/bottom.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { moveItem, nearestSlot } from "../../lib/shortlist";

interface Drag {
  key: number; pointerId: number; handle: HTMLElement;
  /** Pointer offset inside the item when grabbed (so it doesn't jump to the corner). */
  grabX: number; grabY: number;
  x: number; y: number; tx: number; ty: number;
  start: number[]; raf: number; scroller: HTMLElement | null;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function useReorder({ items, onCommit, describe }: {
  items: number[];
  onCommit: (order: number[], moved: number, to: number) => void;
  /** The words a screen reader hears for a team (e.g. "18360 Pymble Pyrophosphate"). */
  describe: (key: number) => string;
}) {
  const [preview, setPreview] = useState<number[] | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const container = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const before = useRef<Map<number, { left: number; top: number }> | null>(null);
  const refocus = useRef<number | null>(null);
  const order = preview ?? items;
  const orderRef = useRef(order);
  orderRef.current = order;

  const el = (k: number) => container.current?.querySelector<HTMLElement>(`[data-reorder-key="${k}"]`) ?? null;
  const snapshot = () => new Map(orderRef.current.map((k) => { const e = el(k); return [k, { left: e?.offsetLeft ?? 0, top: e?.offsetTop ?? 0 }] as const; }));

  /** Keep the dragged item under the pointer: its slot (layout, transform-free) plus a translate. */
  const follow = useCallback(() => {
    const d = drag.current; if (!d) return;
    const e = el(d.key); const parent = e?.offsetParent as HTMLElement | null;
    if (!e || !parent) return;
    const pr = parent.getBoundingClientRect();
    d.tx = d.x - pr.left - d.grabX - e.offsetLeft + parent.scrollLeft;
    d.ty = d.y - pr.top - d.grabY - e.offsetTop + parent.scrollTop;
    e.style.transform = `translate(${d.tx}px, ${d.ty}px)`;
  }, []);

  /** Which slot the pointer is nearest; move the preview there. */
  const hitTest = useCallback(() => {
    const d = drag.current; if (!d) return;
    const keys = orderRef.current;
    const els = keys.map(el);
    const parent = els.find(Boolean)?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const pr = parent.getBoundingClientRect();
    const rects = els.map((e) => ({ left: e?.offsetLeft ?? 0, top: e?.offsetTop ?? 0, width: e?.offsetWidth ?? 0, height: e?.offsetHeight ?? 0 }));
    const to = nearestSlot(rects, d.x - pr.left + parent.scrollLeft, d.y - pr.top + parent.scrollTop);
    const from = keys.indexOf(d.key);
    if (to >= 0 && to !== from) { before.current = snapshot(); setPreview(moveItem(keys, from, to)); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After the preview changes: the others slide from where they were (FLIP); the dragged one re-anchors.
  useLayoutEffect(() => {
    const prev = before.current; before.current = null;
    if (prev && !reduced()) for (const k of order) {
      if (k === drag.current?.key) continue;
      const e = el(k), p = prev.get(k); if (!e || !p) continue;
      const dx = p.left - e.offsetLeft, dy = p.top - e.offsetTop;
      if (!dx && !dy) continue;
      e.style.transition = "none";
      e.style.transform = `translate(${dx}px, ${dy}px)`;
      void e.offsetWidth; // apply the inverted position before animating home
      e.style.transition = "transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      e.style.transform = "";
    }
    follow();
    // Keyboard moves: keep focus on the handle that moved.
    if (refocus.current != null) {
      container.current?.querySelector<HTMLElement>(`[data-reorder-handle="${refocus.current}"]`)?.focus({ preventScroll: false });
      refocus.current = null;
    }
  }, [order, follow]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Each frame while dragging: scroll near the edges, follow, hit-test. */
  const tick = useCallback(() => {
    const d = drag.current; if (!d) return;
    const edge = 72, h = window.innerHeight;
    const speed = d.y < edge ? -Math.ceil((edge - d.y) / 6) : d.y > h - edge ? Math.ceil((d.y - (h - edge)) / 6) : 0;
    if (speed) { if (d.scroller) d.scroller.scrollTop += speed; else window.scrollBy(0, speed); }
    follow();
    hitTest();
    d.raf = requestAnimationFrame(tick);
  }, [follow, hitTest]);

  const end = useCallback((commit: boolean) => {
    const d = drag.current; if (!d) return;
    cancelAnimationFrame(d.raf);
    drag.current = null;
    try { d.handle.releasePointerCapture(d.pointerId); } catch { /* already released */ }
    const e = el(d.key);
    if (e) {
      // Settle into the slot.
      e.style.transition = reduced() ? "" : "transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      e.style.transform = "";
      const clear = () => { e.style.transition = ""; };
      if (reduced()) clear(); else setTimeout(clear, 200);
    }
    const final = orderRef.current;
    const from = d.start.indexOf(d.key), to = final.indexOf(d.key);
    setDragging(null);
    setPreview(null);
    if (commit && from !== to) {
      onCommit(final, d.key, to);
      setMessage(`${describe(d.key)} moved to pick ${to + 1} of ${final.length}.`);
    } else setMessage(commit ? `${describe(d.key)} dropped at pick ${from + 1}, unchanged.` : `Reorder cancelled. ${describe(d.key)} is back at pick ${from + 1}.`);
  }, [onCommit, describe]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dragging == null) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      const d = drag.current;
      if (d) { before.current = snapshot(); setPreview(d.start); }
      end(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging, end]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unmounting mid-drag (navigating away): stop the frame loop.
  useEffect(() => () => { if (drag.current) cancelAnimationFrame(drag.current.raf); }, []);

  const moveBy = useCallback((key: number, delta: number | "top" | "bottom") => {
    const from = items.indexOf(key); if (from < 0) return;
    const to = delta === "top" ? 0 : delta === "bottom" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, from + delta));
    if (to === from) { setMessage(`${describe(key)} is already pick ${from + 1} of ${items.length}.`); return; }
    before.current = snapshot();
    const next = moveItem(items, from, to);
    onCommit(next, key, to);
    setMessage(`${describe(key)} moved to pick ${to + 1} of ${items.length}.`);
  }, [items, onCommit, describe]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProps = (key: number) => ({
    "data-reorder-handle": key,
    style: { touchAction: "none" as const },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || drag.current) return;
      const item = el(key); if (!item) return;
      e.preventDefault();
      const r = item.getBoundingClientRect();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { key, pointerId: e.pointerId, handle: e.currentTarget, grabX: e.clientX - r.left, grabY: e.clientY - r.top, x: e.clientX, y: e.clientY, tx: 0, ty: 0, start: [...items], raf: 0, scroller: scrollParent(item) };
      item.style.transition = "none";
      setDragging(key);
      setPreview([...items]);
      setMessage(`Picked up ${describe(key)}, pick ${items.indexOf(key) + 1} of ${items.length}. Drag to move it; Escape cancels.`);
      drag.current.raf = requestAnimationFrame(tick);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => { const d = drag.current; if (d && e.pointerId === d.pointerId) { d.x = e.clientX; d.y = e.clientY; } },
    onPointerUp: (e: PointerEvent<HTMLElement>) => { if (drag.current?.pointerId === e.pointerId) end(true); },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current; if (!d || d.pointerId !== e.pointerId) return;
      before.current = snapshot(); setPreview(d.start); end(false);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const map: Record<string, number | "top" | "bottom"> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1, Home: "top", End: "bottom" };
      const d = map[e.key]; if (d === undefined) return;
      e.preventDefault();
      refocus.current = key;
      moveBy(key, d);
    },
  });

  return { order, dragging, message, container, handleProps, moveBy };
}
