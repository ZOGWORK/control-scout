// Ambient background — Control Point's grid, always on: faint volt lines that
// drift very slowly, a gentle breathing glow, and a soft light that follows
// the pointer. Everything is transform/opacity on its own layers behind the
// content (cheap to composite), never over it.
//
// Off (still grid only) under prefers-reduced-motion, or when the visitor
// turns "Animated background" off in Settings → Appearance (html.ambient-off).
import { useEffect, useRef, type RefObject } from "react";

export function Ambient({ target }: { target: RefObject<HTMLElement | null> }) {
  const glow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = target.current, g = glow.current;
    if (!el || !g) return;
    let frame = 0;
    let x = 0, y = 0;
    const paint = () => { frame = 0; g.style.transform = `translate3d(${x}px, ${y}px, 0)`; };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // no hover light on phones
      const r = el.getBoundingClientRect();
      x = e.clientX - r.left; y = e.clientY - r.top;
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
    <div className="ambient" aria-hidden>
      <div className="ambient-grid" />
      <div className="ambient-breath" />
      <div ref={glow} className="ambient-glow" />
    </div>
  );
}
