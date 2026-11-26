// The v8 background combines a softly moving wash near the top with a moving particle wave lower down.
// The wash is taller on top-level pages. Both layers sit behind the content.
import { useEffect, useId, useRef, useState } from "react";
import { DotWave } from "./DotWave";
import { cn } from "../cn";
import { useServerFlag } from "../../lib/flags";
import { loadWashOnce } from "../../lib/wash";
import { WASH_FADE as FADE, softStops } from "../../shared/wash";

// The colours, strength and reach are CSS variables (index.css, html[data-v8]); the owner console can change them.
// Each colour is mixed into the page by --wash-mix (all of it on Dark and Light, most of it on Dim: WASH_MIX).
const tint = (v: string) => `color-mix(in srgb,var(${v}) var(--wash-mix,100%),var(--color-background))`;
/** The three glows, left, middle and right. Each is its own layer so each can drift on its own (index.css,
 *  `.wash-glow`): a slow wave of a few percent and a soft swell, at different lengths so they never line up. Each
 *  fades out on an eased curve (softStops) and wide enough to run into its neighbours, so the three read as one blend,
 *  not three circles. */
const GLOWS = [
  `radial-gradient(48% 84% at 12% 0%,${softStops(tint("--wash-a"))})`,
  `radial-gradient(44% 80% at 52% 0%,${softStops(tint("--wash-b"))})`,
  `radial-gradient(48% 84% at 90% 0%,${softStops(tint("--wash-c"))})`,
] as const;
/** One solid colour for the wash's top edge, for the phone's top patch (TopPatch): its middle colour about half
 *  mixed into the page, the strength the owner set (dark: ~rgb 57 54 77). */
const edge = (v: string) => `color-mix(in srgb,${tint(v)} calc(55% * var(--wash-strength,1)),var(--color-background))`;
/** `c` turned toward the page's own colour as the page scrolls (--top-cover, 0% at the top, 100% once scrolled: TopPatch). */
const covered = (c: string) => `color-mix(in srgb,var(--color-background) var(--top-cover,0%),${c})`;
export const TOP_PATCH = edge("--wash-b");
/** The same edge left to right (the wash's left, middle and right colours), drawn over TOP_PATCH so the patch runs on
 *  into the wash on screen; Safari still reads the solid TOP_PATCH under it. */
export const TOP_PATCH_IMAGE = `linear-gradient(to right,${edge("--wash-a")} 5%,${edge("--wash-b")} 50%,${edge("--wash-c")} 95%)`;
const COVER_IMAGE = `linear-gradient(to right,${covered(edge("--wash-a"))} 5%,${covered(edge("--wash-b"))} 50%,${covered(edge("--wash-c"))} 95%)`;
/** How far the page scrolls before the top patch has turned fully into the page's colour. */
export const COVER_PX = 160;
/** --top-cover for a scroll position: 0% at the top, 100% from COVER_PX down. */
export const topCover = (y: number) => `${Math.round(Math.min(1, Math.max(0, y / COVER_PX)) * 1000) / 10}%`;

/** The top of the screen on a phone (#2147, #2144). Safari 26 on an iPhone paints the strip behind the clock from the
 *  page (a black band with the page blurred under it as you scroll) unless a fixed bar touches the top: then it fills
 *  the strip with that bar's colour. v8 has no such bar, so this thin patch stands in. Not pointer-events-none: Safari
 *  finds it by a hit test.
 *  - At the top of the page it is the wash's own edge colour, and the wash's first few pixels are drawn the same
 *    (data-top-fade, easing into the glows below), so the patch can't be told apart from the wash: no band.
 *  - As the page scrolls it turns into the page's own colour (--top-cover), so no strip of wash stays pinned over the
 *    content once the wash has scrolled away.
 *  - Installed on the home screen (display-mode: standalone, index.css) the page runs under the clock
 *    (black-translucent, index.html): the wash itself shows there, so the patch is see-through at the top and only
 *    turns into the page's colour, the height of the clock's strip, once the page scrolls. */
export function TopPatch() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const set = () => { frame = 0; el.style.setProperty("--top-cover", topCover(window.scrollY)); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(set); };
    set();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, []);
  return (
    <>
      <div aria-hidden data-top-fade className="pointer-events-none absolute inset-x-0 top-0 h-[48px] md:hidden"
        style={{ backgroundColor: TOP_PATCH, backgroundImage: TOP_PATCH_IMAGE, maskImage: TOP_FADE, WebkitMaskImage: TOP_FADE }} />
      <div ref={ref} aria-hidden data-top-patch className="fixed inset-x-0 top-0 z-50 h-[6px] before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-24 before:bg-inherit md:hidden"
        style={{ backgroundColor: covered(TOP_PATCH), backgroundImage: COVER_IMAGE }} />
    </>
  );
}
/** The wash's top edge (data-top-fade): solid for the patch's 6px, then easing out (1 - smoothstep) into the glows by
 *  48px, so neither edge shows as a line. */
const TOP_FADE = "linear-gradient(to bottom,#000 6px,rgb(0 0 0/.97) 10px,rgb(0 0 0/.9) 14px,rgb(0 0 0/.78) 18px,rgb(0 0 0/.65) 23px,rgb(0 0 0/.5) 27px,rgb(0 0 0/.35) 31px,rgb(0 0 0/.22) 35px,rgb(0 0 0/.1) 40px,rgb(0 0 0/.03) 44px,transparent 48px)";
/** How long the wash's rise takes (index.css `.wash-rise`, and the first paint's copy in server/bootShell.ts). */
export const WASH_RISE_MS = 1400;

/** Where the wash's rise is now, as a (negative) animation-delay that carries on from the first paint's rise, which
 *  started when the page first painted; null once it has finished (nothing left to show). */
export function riseDelay(now = performance.now(), firstPaint = firstPaintAt()): string | null {
  const elapsed = Math.max(0, now - firstPaint);
  return elapsed >= WASH_RISE_MS ? null : `${-Math.round(elapsed)}ms`;
}
function firstPaintAt(): number {
  try {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0] ?? performance.getEntriesByType("paint")[0];
    return fcp ? fcp.startTime : 0;
  } catch { return 0; }
}

const HEIGHT = { tall: "clamp(16rem, calc(42vh * var(--wash-spread, 1)), calc(30rem * var(--wash-spread, 1)))", short: "clamp(13rem, calc(34vh * var(--wash-spread, 1)), calc(23rem * var(--wash-spread, 1)))" } as const;

/** `rise`: the wash pours in from the top once, as the page loads (only the shell's wash, which stays for the visit). */
export function Wash({ size = "tall", className, includeParticleWave = true, rise = false }: { size?: "tall" | "short"; className?: string; includeParticleWave?: boolean; rise?: boolean }) {
  // Taken once, when the wash first draws: later renders (a page change) never restart it. The server's first paint
  // (server/bootShell.ts, .csb-col) is still in #root while the app's first render runs: when it is there, its wash has
  // been rising since the page first painted, so carry on from there; without it (no server HTML), rise from the start.
  const [delay] = useState(() => {
    if (!rise || typeof performance === "undefined") return null;
    return document.querySelector(".csb-col") ? riseDelay() : "0ms";
  });
  const grain = `grain-${useId().replace(/:/g, "")}`;
  const waveOn = useServerFlag("particleWave");
  // The owner's wash is in the page's head already (server/seo.ts); only a page without the server's HTML asks for it.
  useEffect(() => { loadWashOnce(); }, []);
  return (
    <>
      <div aria-hidden data-wash={size}
        style={{ maskImage: FADE, WebkitMaskImage: FADE, height: HEIGHT[size], opacity: "var(--wash-strength, 1)" }}
        className={cn("pointer-events-none absolute inset-x-0 top-0 overflow-hidden", className)}>
        {/* No blur here: the glows are already soft (each fades out on an eased curve), and a blur over moving layers is redrawn
            every frame (measured: a frame every ~67 ms with it, every 16.7 ms without, same look). */}
        <div className={cn("absolute -inset-x-[10%] -top-1/2 bottom-0", delay !== null && "wash-rise")}
          style={delay !== null ? { animationDelay: delay } : undefined}>
          {/* Painted right, middle, left: the left glow on top where they overlap, as the single background list
              (whose first image painted on top) always drew them. */}
          {[2, 1, 0].map((i) => <div key={i} data-wash-glow={i} className="wash-glow absolute inset-0" style={{ backgroundImage: GLOWS[i] }} />)}
        </div>
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
