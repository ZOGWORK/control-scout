// A still, grainy pool of colour at the page's end. The shell anchors it to
// the content's bottom, so long pages reveal it only as the footer approaches.
// One gradient at a time: while any of the top wash (Wash.tsx, [data-wash]) is on screen the glow stays hidden, so a
// page short enough to show both shows only the wash, and a long one shows the glow once the wash has scrolled away.
import { useEffect, useId, useState } from "react";

export function PageEndGlow() {
  const grain = `page-end-${useId().replace(/:/g, "")}`;
  // Hidden until we know the wash is gone: a short page never flashes both on first paint.
  const [washInView, setWashInView] = useState(true);
  useEffect(() => {
    const wash = document.querySelector("[data-wash]");
    if (!wash || typeof IntersectionObserver === "undefined") { setWashInView(false); return; }
    const io = new IntersectionObserver(([e]) => setWashInView(e.isIntersecting));
    io.observe(wash);
    return () => io.disconnect();
  }, []);
  return (
    <div aria-hidden="true" data-page-end-glow data-hidden={washInView || undefined}>
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
