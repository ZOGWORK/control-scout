// A grainy pool of colour at the page's end. The shell anchors it to the content's bottom, so long pages reveal it
// only as the footer approaches.
// One gradient at a time: while any of the top wash (Wash.tsx, [data-wash]) is on screen the glow stays hidden, so a
// page short enough to show both shows only the wash, and a long one shows the glow once the wash has scrolled away.
// It rises (index.css: a slow swell up from the page's end) when it comes into view, not when the wash leaves: on a
// long page the wash leaves while the glow is still far below, so a rise then happened off screen and was never seen.
import { useEffect, useId, useRef, useState } from "react";

/** How far into the screen the glow's top must come before it rises: past the bottom 12%, so the rise is seen. */
export const GLOW_RISE_MARGIN = "0px 0px -12% 0px";

export function PageEndGlow() {
  const grain = `page-end-${useId().replace(/:/g, "")}`;
  const ref = useRef<HTMLDivElement>(null);
  // Hidden until we know the wash is gone: a short page never flashes both on first paint.
  const [washInView, setWashInView] = useState(true);
  const [glowInView, setGlowInView] = useState(false);
  useEffect(() => {
    const wash = document.querySelector("[data-wash]");
    const glow = ref.current;
    if (typeof IntersectionObserver === "undefined") { setWashInView(false); setGlowInView(true); return; }
    const observers: IntersectionObserver[] = [];
    if (wash) {
      const io = new IntersectionObserver(([e]) => setWashInView(e.isIntersecting));
      io.observe(wash);
      observers.push(io);
    } else setWashInView(false);
    if (glow) {
      const io = new IntersectionObserver(([e]) => setGlowInView(e.isIntersecting), { rootMargin: GLOW_RISE_MARGIN });
      io.observe(glow);
      observers.push(io);
    } else setGlowInView(true);
    return () => observers.forEach((io) => io.disconnect());
  }, []);
  return (
    <div ref={ref} aria-hidden="true" data-page-end-glow data-hidden={washInView || !glowInView || undefined}>
      <svg className="size-full opacity-20 mix-blend-soft-light" xmlns="http://www.w3.org/2000/svg">
        <filter id={grain}>
          <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={3} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${grain})`} />
      </svg>
    </div>
  );
}
