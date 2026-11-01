// Lets a page paint its hero before it renders everything under it.
// The first render shows the above-the-fold part only; the rest mounts in the
// task after the browser's next paint. On a slow phone the full team page is
// one ~1 s render task, and the hero (the page's Largest Contentful Paint)
// can't paint until that task ends.
import { useEffect, useState } from "react";

/** False on the first render, true once the browser has painted it. `already`: the page is on screen already (the
 *  server drew it: src/lib/pageData.ts), so there's no first paint to wait for: true from the start. */
export function useAfterFirstPaint(already = false): boolean {
  const [ready, setReady] = useState(already);
  useEffect(() => {
    if (ready) return;
    let timer = 0;
    const done = () => setReady(true);
    // A callback queued from rAF runs after that frame's paint. Background tabs
    // don't run rAF, so a plain timer is the fallback.
    const frame = requestAnimationFrame(() => { clearTimeout(timer); timer = window.setTimeout(done, 0); });
    timer = window.setTimeout(done, 250);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [ready]);
  return ready;
}
