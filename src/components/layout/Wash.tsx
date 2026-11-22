// The v8 background combines a still wash near the top with a moving particle wave lower down.
// The wash is taller on top-level pages. Both layers sit behind the content.
import { useEffect, useId } from "react";
import { DotWave } from "./DotWave";
import { cn } from "../cn";
import { useServerFlag } from "../../lib/flags";
import { loadWashOnce } from "../../lib/wash";

const FADE = "linear-gradient(to bottom,#000 0%,rgb(0 0 0/.85) 50%,transparent 100%)";
// The colours, strength and reach are CSS variables (index.css, html[data-v8]); the owner console can change them.
// Each colour is mixed into the page by --wash-mix (all of it on Dark; Light takes a pale dawn tint of the same ones).
const tint = (v: string) => `color-mix(in srgb,var(${v}) var(--wash-mix,100%),var(--color-background))`;
const GLOWS = `radial-gradient(55% 95% at 12% 0%,${tint("--wash-a")} 0%,transparent 72%),radial-gradient(50% 90% at 52% 0%,${tint("--wash-b")} 0%,transparent 72%),radial-gradient(55% 95% at 90% 0%,${tint("--wash-c")} 0%,transparent 72%)`;
/** One solid colour for the wash's top edge, for the phone's top patch (Shell.tsx): its middle colour about half
 *  mixed into the page, the strength the owner set, which is where the drawn wash starts (dark: ~rgb 57 54 77). */
const edge = (v: string) => `color-mix(in srgb,${tint(v)} calc(55% * var(--wash-strength,1)),var(--color-background))`;
export const TOP_PATCH = edge("--wash-b");
/** The same edge left to right (the wash's left, middle and right colours), drawn over TOP_PATCH so the patch runs on
 *  into the wash on screen; Safari still reads the solid TOP_PATCH under it. */
export const TOP_PATCH_IMAGE = `linear-gradient(to right,${edge("--wash-a")} 5%,${edge("--wash-b")} 50%,${edge("--wash-c")} 95%)`;
const HEIGHT = { tall: "clamp(16rem, calc(42vh * var(--wash-spread, 1)), calc(30rem * var(--wash-spread, 1)))", short: "clamp(13rem, calc(34vh * var(--wash-spread, 1)), calc(23rem * var(--wash-spread, 1)))" } as const;

export function Wash({ size = "tall", className, includeParticleWave = true }: { size?: "tall" | "short"; className?: string; includeParticleWave?: boolean }) {
  const grain = `grain-${useId().replace(/:/g, "")}`;
  const waveOn = useServerFlag("particleWave");
  // The owner's wash is in the page's head already (server/seo.ts); only a page without the server's HTML asks for it.
  useEffect(() => { loadWashOnce(); }, []);
  return (
    <>
      <div aria-hidden data-wash={size}
        style={{ maskImage: FADE, WebkitMaskImage: FADE, height: HEIGHT[size], opacity: "var(--wash-strength, 1)" }}
        className={cn("pointer-events-none absolute inset-x-0 top-0 overflow-hidden", className)}>
        <div className="absolute -inset-x-[10%] -top-1/2 bottom-0 blur-2xl" style={{ backgroundImage: GLOWS }} />
        <svg data-grain className="absolute inset-0 size-full opacity-[var(--wash-grain,0.12)] mix-blend-overlay" xmlns="http://www.w3.org/2000/svg">
          <filter id={grain}><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves={2} stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
          <rect width="100%" height="100%" filter={`url(#${grain})`} />
        </svg>
      </div>
      {includeParticleWave && waveOn && <DotWave />}
    </>
  );
}

/** A top-level page (one path segment: /, /events, /teams…) gets the tall wash; anything inside one the short one. */
export const washSize = (path: string): "tall" | "short" => (path.replace(/\/+$/, "").split("/").filter(Boolean).length <= 1 ? "tall" : "short");
