import { useEffect, useRef } from "react";

const PALETTE = ["129,156,194", "145,167,197", "165,177,201", "181,179,195", "198,171,163", "212,170,138"];
const FRAME_MS = 1000 / 24;
const EDGE_PADDING = 0.08;
const TRAVEL_WIDTH = 1 + EDGE_PADDING * 2;
const SAMPLES = 320;

type Particle = { x: number; depth: number; travel: number; size: number; phase: number };

function particleGroups(count: number) {
  // Repeatable across renders and sizes, without the regular spacing of a grid.
  let seed = 51091;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const groups = PALETTE.flatMap((color) => [0.14, 0.23, 0.34, 0.49].map((alpha) => ({
    color: `rgba(${color},${alpha})`,
    dots: [] as Particle[],
  })));
  for (let i = 0; i < count; i++) {
    const x = random() * TRAVEL_WIDTH - EDGE_PADDING;
    // Closer grains form a defined core. The sparse grains at the edges soften it.
    const depth = (random() + random() + random() + random() - 2) / 2;
    const color = Math.min(PALETTE.length - 1, Math.max(0, Math.floor(x * PALETTE.length + random() - 0.5)));
    const tone = Math.min(3, Math.floor(random() ** 2 * (4 - Math.abs(depth))));
    groups[color * 4 + tone].dots.push({
      x, depth, phase: random() * Math.PI * 2, travel: 0.016 + random() * 0.022,
      size: 0.44 + random() ** 1.8 * 0.84,
    });
  }
  return groups;
}

/** Sample the ribbon along its width. Drawing the grains can then reuse the same curve for each column. */
function sampleRibbon(time: number, centers: Float32Array, widths: Float32Array) {
  for (let i = 0; i <= SAMPLES; i++) {
    const x = i / SAMPLES;
    const climb = (1 + Math.tanh((x - 0.5) * 5)) / 2;
    const trough = Math.exp(-(((x - 0.15) / 0.17) ** 2));
    const tip = Math.max(0, (x - 0.73) / 0.27);
    const swell = Math.sin(x * 6 - time * 0.12);
    centers[i] = 0.82 - climb * 0.49 + trough * 0.048 + tip ** 2 * 0.055 + swell * 0.013;
    widths[i] = 0.24 + Math.cos(x * 6.4) * 0.032 + swell * 0.012;
  }
}

/** A decorative ribbon of individually moving particles in the lower part of the first screen. */
export function DotWave() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !window.ResizeObserver || !window.IntersectionObserver || !window.matchMedia) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const ctx = context;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;
    let elapsed = 0;
    let width = 0;
    let height = 0;
    let visible = false;
    let particleCount = 0;
    let groups = particleGroups(0);
    const centers = new Float32Array(SAMPLES + 1);
    const widths = new Float32Array(SAMPLES + 1);

    function paint(time: number) {
      ctx.clearRect(0, 0, width, height);
      sampleRibbon(time, centers, widths);
      // A slow tide moves the grains through the ribbon and keeps its color anchored across the page.
      const tide = Math.sin(time * 0.055);
      for (const group of groups) {
        ctx.fillStyle = group.color;
        for (const dot of group.dots) {
          const x = dot.x + tide * dot.travel;
          if (x < 0 || x >= 1) continue;
          const index = x * SAMPLES;
          const column = Math.floor(index);
          const mix = index - column;
          const center = centers[column] + (centers[column + 1] - centers[column]) * mix;
          const spread = widths[column] + (widths[column + 1] - widths[column]) * mix;
          const drift = Math.sin(time * 0.2 + dot.phase) * 0.0035;
          const y = (center + dot.depth * spread + drift) * height;
          ctx.fillRect(x * width, y, dot.size, dot.size * 0.88);
        }
      }
    }

    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS - 2) return;
      if (last) elapsed += Math.min(now - last, 100) / 1000;
      last = now;
      paint(elapsed);
    }

    function sync() {
      cancelAnimationFrame(frame);
      last = 0;
      if (visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
      else if (reduced.matches) paint(0);
    }

    const resize = new ResizeObserver(([entry]) => {
      ({ width, height } = entry.contentRect);
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const density = Math.min(92, 48 + width / 24);
      const count = Math.min(140_000, Math.round(width * density));
      if (count !== particleCount) {
        groups = particleGroups(count);
        particleCount = count;
      }
      paint(reduced.matches ? 0 : elapsed);
    });
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    resize.observe(canvas);
    intersection.observe(canvas);
    reduced.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      reduced.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  return <canvas ref={ref} data-dot-wave aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-dvh w-full [mask-image:linear-gradient(transparent,#000_18%,#000_89%,transparent)]" />;
}
