// v8's only texture (docs/design/v8-revamp-brief.md §3.1): a dusky slate-blue → mauve wash across the top of the page
// under a fine grain, fading to the page colour. `tall` on the top-level pages (as on the sample home), `short` on a
// page inside one (a team, an event, a match), so the content starts high. Decorative, still, and behind everything.
import { useEffect, useId } from "react";
import { cn } from "../cn";
import { loadWashOnce } from "../../lib/wash";

const FADE = "linear-gradient(to bottom,#000 0%,#000 52%,transparent 100%)";
// The colours, strength and reach are CSS variables (index.css, html[data-v8]); the owner console can change them.
const GLOWS = "radial-gradient(55% 95% at 12% 0%,var(--wash-a) 0%,transparent 72%),radial-gradient(50% 90% at 52% 0%,var(--wash-b) 0%,transparent 72%),radial-gradient(55% 95% at 90% 0%,var(--wash-c) 0%,transparent 72%)";
const HEIGHT = { tall: "clamp(28rem, calc(76vh * var(--wash-spread, 1)), calc(46rem * var(--wash-spread, 1)))", short: "clamp(22rem, calc(52vh * var(--wash-spread, 1)), calc(34rem * var(--wash-spread, 1)))" } as const;

export function Wash({ size = "tall", className }: { size?: "tall" | "short"; className?: string }) {
  const grain = `grain-${useId().replace(/:/g, "")}`;
  const dots = `dots-${grain}`;
  // The owner's wash is in the page's head already (server/seo.ts); only a page without the server's HTML asks for it.
  useEffect(() => { loadWashOnce(); }, []);
  return (
    <div aria-hidden data-wash={size}
      style={{ maskImage: FADE, WebkitMaskImage: FADE, height: HEIGHT[size], opacity: "var(--wash-strength, 1)" }}
      className={cn("pointer-events-none absolute inset-x-0 top-0 overflow-hidden", className)}>
      <div className="absolute -inset-x-[10%] -top-1/2 bottom-0 blur-2xl" style={{ backgroundImage: GLOWS }} />
      <svg data-grain className="absolute inset-0 size-full opacity-[0.12] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id={grain}><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
        <rect width="100%" height="100%" filter={`url(#${grain})`} />
      </svg>
      <svg data-dot-wave className="absolute inset-x-0 bottom-0 h-[76%] w-full" viewBox="0 0 1200 480" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <pattern id={dots} width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.2" fill="#c8d6ed" /></pattern>
          <linearGradient id={`${dots}-fade`} x1="0" y1="0" x2="1" y2="0"><stop stopColor="#93b3d3" stopOpacity=".9" /><stop offset=".55" stopColor="#b8b6d6" stopOpacity="1" /><stop offset="1" stopColor="#d4afae" stopOpacity=".72" /></linearGradient>
          <mask id={`${dots}-mask`}><rect width="1200" height="480" fill={`url(#${dots}-fade)`} /></mask>
        </defs>
        <g mask={`url(#${dots}-mask)`}>
          <path data-dot-band="far" d="M-70 368 C 140 430 270 426 440 336 S 740 170 920 232 S 1110 310 1270 250 L1270 390 C1080 456 920 358 760 322 S 450 468 250 480 L-70 480Z" fill={`url(#${dots})`} />
          <path data-dot-band="near" d="M-70 405 C 180 270 330 420 520 388 S 810 250 1010 174 S 1160 202 1270 150 L1270 245 C1110 276 1000 284 860 344 S 580 475 400 450 S 130 378-70 480Z" fill={`url(#${dots})`} opacity=".55" />
        </g>
      </svg>
    </div>
  );
}

/** A top-level page (one path segment: /, /events, /teams…) gets the tall wash; anything inside one the short one. */
export const washSize = (path: string): "tall" | "short" => (path.replace(/\/+$/, "").split("/").filter(Boolean).length <= 1 ? "tall" : "short");
