// v8's only texture (docs/design/v8-revamp-brief.md §3.1): a dusky slate-blue → mauve wash across the top of the page
// under a fine grain, fading to the page colour. `tall` on the top-level pages (as on the sample home), `short` on a
// page inside one (a team, an event, a match), so the content starts high. Decorative, still, and behind everything.
import { useId } from "react";
import { cn } from "../cn";

const FADE = "linear-gradient(to bottom,#000 0%,rgb(0 0 0/.75) 45%,transparent 100%)";
const GLOWS = "bg-[radial-gradient(55%_95%_at_12%_0%,#44587f_0%,transparent_72%),radial-gradient(50%_90%_at_52%_0%,#4a4462_0%,transparent_72%),radial-gradient(55%_95%_at_90%_0%,#6e5076_0%,transparent_72%)]";

export function Wash({ size = "tall", className }: { size?: "tall" | "short"; className?: string }) {
  const grain = `grain-${useId().replace(/:/g, "")}`;
  return (
    <div aria-hidden data-wash={size} style={{ maskImage: FADE, WebkitMaskImage: FADE }}
      className={cn("pointer-events-none absolute inset-x-0 top-0 overflow-hidden",
        size === "tall" ? "h-[34vh] min-h-[13.75rem] max-h-[23.75rem]" : "h-[18vh] min-h-[8rem] max-h-[12rem] opacity-70", className)}>
      <div className={cn("absolute -inset-x-[10%] -top-1/2 bottom-0 blur-2xl", GLOWS)} />
      <svg data-grain className="absolute inset-0 size-full opacity-[0.12] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
        <filter id={grain}><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
        <rect width="100%" height="100%" filter={`url(#${grain})`} />
      </svg>
    </div>
  );
}

/** A top-level page (one path segment: /, /events, /teams…) gets the tall wash; anything inside one the short one. */
export const washSize = (path: string): "tall" | "short" => (path.replace(/\/+$/, "").split("/").filter(Boolean).length <= 1 ? "tall" : "short");
