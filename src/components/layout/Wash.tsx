// v8's only texture (docs/design/v8-revamp-brief.md §3.1): a dusky slate-blue → mauve wash across the top of the page
// under a fine grain, fading to the page colour. `tall` on the top-level pages (as on the sample home), `short` on a
// page inside one (a team, an event, a match), so the content starts high. Decorative, still, and behind everything.
import { useId } from "react";
import { cn } from "../cn";

const FADE = "linear-gradient(to bottom,#000 0%,rgb(0 0 0/.85) 50%,transparent 100%)";
// The colours, strength and reach are CSS variables (index.css, html[data-v8]); the owner console can change them.
const GLOWS = "radial-gradient(55% 95% at 12% 0%,var(--wash-a) 0%,transparent 72%),radial-gradient(50% 90% at 52% 0%,var(--wash-b) 0%,transparent 72%),radial-gradient(55% 95% at 90% 0%,var(--wash-c) 0%,transparent 72%)";
const HEIGHT = { tall: "clamp(16rem, calc(42vh * var(--wash-spread, 1)), calc(30rem * var(--wash-spread, 1)))", short: "clamp(13rem, calc(34vh * var(--wash-spread, 1)), calc(23rem * var(--wash-spread, 1)))" } as const;

export function Wash({ size = "tall", className }: { size?: "tall" | "short"; className?: string }) {
  const grain = `grain-${useId().replace(/:/g, "")}`;
  return (
    <div aria-hidden data-wash={size}
      style={{ maskImage: FADE, WebkitMaskImage: FADE, height: HEIGHT[size], opacity: "var(--wash-strength, 1)" }}
      className={cn("pointer-events-none absolute inset-x-0 top-0 overflow-hidden", className)}>
      <div className="absolute -inset-x-[10%] -top-1/2 bottom-0 blur-2xl" style={{ backgroundImage: GLOWS }} />
      <svg data-grain className="absolute inset-0 size-full opacity-[0.12] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id={grain}><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
        <rect width="100%" height="100%" filter={`url(#${grain})`} />
      </svg>
    </div>
  );
}

/** A top-level page (one path segment: /, /events, /teams…) gets the tall wash; anything inside one the short one. */
export const washSize = (path: string): "tall" | "short" => (path.replace(/\/+$/, "").split("/").filter(Boolean).length <= 1 ? "tall" : "short");
