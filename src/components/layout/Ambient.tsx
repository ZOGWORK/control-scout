// Ambient background — Control Point's grid, always on: faint volt lines that
// drift very slowly, a gentle breathing glow, and a soft light that follows
// the pointer. Everything is transform/opacity on its own layers behind the
// content (cheap to composite), never over it.
//
// Off (still grid only) under prefers-reduced-motion, or when the visitor
// turns "Animated background" off in Settings → Appearance (html.ambient-off).
import { useEffect, useRef, type RefObject } from "react";

/**
 * How strongly the layer shows at (x, y) in a w × h box: full in the upper middle, fading out towards the
 * bottom and the lower corners. The same ellipse as the grid's fade (index.css, .ambient-grid): centred at
 * the top edge, 130% × 95% of the box, solid to 35% of the way out.
 */
export function ambientFade(x: number, y: number, w: number, h: number): number {
  if (w <= 0 || h <= 0) return 1;
  const d = Math.hypot((x - w / 2) / (1.3 * w), y / (0.95 * h));
  return d <= 0.35 ? 1 : d >= 1 ? 0 : Math.round((1 - (d - 0.35) / 0.65) * 100) / 100;
}

/** `target`: where the pointer is followed (the page's content, drawn over this layer). */
export function Ambient({ target }: { target: RefObject<HTMLElement | null> }) {
  const box = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = target.current, g = glow.current, area = box.current;
    if (!el || !g || !area) return;
    let frame = 0;
    let x = 0, y = 0, fade = 1;
    const paint = () => { frame = 0; g.style.transform = `translate3d(${x}px, ${y}px, 0)`; g.style.setProperty("--amb-fade", String(fade)); };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // no hover light on phones
      // Relative to this layer (it stays on screen while the page scrolls), not to the content scrolling over it.
      const r = area.getBoundingClientRect();
      x = e.clientX - r.left; y = e.clientY - r.top;
      fade = ambientFade(x, y, r.width, r.height);
      g.dataset.on = "1";
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const leave = () => { delete g.dataset.on; };
    // Listen only while the glow can show: not under reduced motion, not with
    // "Animated background" off. Re-checked whenever either preference changes.
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    let listening = false;
    const sync = () => {
      const on = !reduced.matches && !root.classList.contains("ambient-off");
      if (on === listening) return;
      listening = on;
      if (on) {
        el.addEventListener("pointermove", move, { passive: true });
        el.addEventListener("pointerleave", leave);
      } else {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
        leave();
        if (frame) { cancelAnimationFrame(frame); frame = 0; }
      }
    };
    sync();
    reduced.addEventListener("change", sync);
    const watch = new MutationObserver(sync);
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      reduced.removeEventListener("change", sync);
      watch.disconnect();
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", leave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [target]);
  return (
    <div ref={box} className="ambient" aria-hidden>
      <div className="ambient-grid" />
      <div className="ambient-breath" />
      <div ref={glow} className="ambient-glow" />
    </div>
  );
}
