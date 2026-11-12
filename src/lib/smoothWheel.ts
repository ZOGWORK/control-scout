// Eased wheel and trackpad scrolling on desktop (src/lib/smoothWheelEngine.ts, Lenis). Only on a screen that
// matches SMOOTH_SCROLL_QUERY (at least 1024 px wide, a mouse or trackpad that hovers, no reduced motion), the
// same screens whose jumps glide (index.css). Phones, tablets and reduced motion keep the browser's own scrolling
// and never download the engine: it's its own chunk, fetched once the page is idle. A window resized below the
// desktop layout, or a reader turning on reduced motion, hands scrolling straight back to the browser.
import { useEffect } from "react";
import { setSmoothWheel, SMOOTH_SCROLL_QUERY } from "./pageScroll";

type Engine = { halt(): void; destroy(): void };
type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

/** Loads the engine (its own chunk, with Lenis) and starts it. Swappable in tests. */
export const loader = { load: async (): Promise<Engine> => (await import("./smoothWheelEngine")).startSmoothWheel() };

/** Runs eased wheel scrolling on the page while the screen is a desktop's. Mounted once, by the shell. */
export function useSmoothWheel() {
  useEffect(() => {
    let mq: MediaQueryList | undefined;
    try { mq = window.matchMedia?.(SMOOTH_SCROLL_QUERY); } catch { mq = undefined; }
    if (!mq || typeof mq.addEventListener !== "function") return;
    const query = mq;
    let engine: Engine | null = null;
    // Bumped on every change, so an engine that finishes loading after the screen stopped matching is dropped.
    let wanted = 0;
    let idle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const w = window as IdleWindow;
    const stop = () => {
      if (!engine) return;
      setSmoothWheel(null);
      engine.destroy();
      engine = null;
    };
    const load = (ticket: number) => {
      loader.load().then((e) => {
        if (ticket !== wanted || !query.matches || engine) { e.destroy(); return; }
        engine = e;
        setSmoothWheel(e);
      }).catch(() => { /* offline or blocked: the browser's own scrolling stays */ });
    };
    const sync = () => {
      const ticket = ++wanted;
      if (!query.matches) { stop(); return; }
      if (engine) return;
      // After the page has painted and settled: smooth wheel never competes with the first paint.
      if (w.requestIdleCallback) idle = w.requestIdleCallback(() => load(ticket), { timeout: 2000 });
      else timer = setTimeout(() => load(ticket), 300);
    };
    sync();
    query.addEventListener("change", sync);
    return () => {
      wanted++;
      query.removeEventListener("change", sync);
      if (idle !== undefined) w.cancelIdleCallback?.(idle);
      clearTimeout(timer);
      stop();
    };
  }, []);
}
