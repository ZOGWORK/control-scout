// A still, grainy pool of colour at the page's end. The shell anchors it to
// the content's bottom, so long pages reveal it only as the footer approaches.
import { useId } from "react";

export function PageEndGlow() {
  const grain = `page-end-${useId().replace(/:/g, "")}`;
  return (
    <div aria-hidden="true" data-page-end-glow>
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
