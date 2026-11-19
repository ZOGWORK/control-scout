import { useEffect, useRef } from "react";

const PALETTE = ["110,158,208", "138,169,207", "168,179,207", "183,172,195", "198,166,164", "214,171,138"];
const FRAME_MS = 1000 / 30;

function particleGroups(count: number) {
  // Repeatable across renders and sizes, without the regular spacing of a grid.
  let seed = 51091;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const groups = PALETTE.flatMap((color) => [0.15, 0.28, 0.47, 0.70].map((alpha) => ({
    color: `rgba(${color},${alpha})`,
    dots: [] as { x: number; depth: number; phase: number; speed: number; size: number; strand: number }[],
  })));
  for (let i = 0; i < count; i++) {
    const x = random() * 1.24 - 0.12;
    const depth = (random() + random() + random() - 1.5) / 1.5;
    const color = Math.min(PALETTE.length - 1, Math.max(0, Math.floor(x * PALETTE.length + random() - 0.5)));
    const tone = Math.min(3, Math.floor(random() ** 2 * (4 - Math.abs(depth))));
    groups[color * 4 + tone].dots.push({
      x, depth, phase: random() * Math.PI * 2, speed: 0.004 + random() * 0.007,
      size: 0.52 + random() ** 2 * 1.13, strand: random() < 0.24 ? 1 : 0,
    });
  }
  return groups;
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
    let width = 0;
    let height = 0;
    let visible = false;
    let groups = particleGroups(0);

    function paint(time: number) {
      ctx.clearRect(0, 0, width, height);
      for (const group of groups) {
        ctx.fillStyle = group.color;
        for (const dot of group.dots) {
          // Wrap off both sides. Vary the speed and phase so the ribbon ripples as particles flow through it.
          const x = ((dot.x + 0.12 + time * dot.speed) % 1.24) - 0.12;
          const phase = x * 7.5 - time * 0.18;
          const rise = 0.58 / (1 + Math.exp(-12 * (x - 0.49)));
          const center = 0.83 - rise + Math.sin(phase) * 0.029;
          const spread = 0.25 + Math.cos(x * 6.5) * 0.035;
          const strand = dot.strand * Math.sin(phase - 0.7) * 0.054;
          const flutter = Math.sin(time * 0.29 + dot.phase) * 0.008;
          const y = (center + dot.depth * spread + strand + flutter) * height;
          ctx.fillRect(x * width, y, dot.size, dot.size * 0.82);
        }
      }
    }

    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      if (now - last < FRAME_MS - 2) return;
      last = now;
      paint(now / 1000);
    }

    function sync() {
      cancelAnimationFrame(frame);
      if (visible && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
      else if (reduced.matches) paint(0);
    }

    const resize = new ResizeObserver(([entry]) => {
      ({ width, height } = entry.contentRect);
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      groups = particleGroups(Math.min(66_000, Math.round(width * 48)));
      paint(reduced.matches ? 0 : performance.now() / 1000);
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

  return <canvas ref={ref} data-dot-wave aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[13vh] h-[87vh] w-full [mask-image:linear-gradient(transparent,#000_13%,#000_85%,transparent)]" />;
}
