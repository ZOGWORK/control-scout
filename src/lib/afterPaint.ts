// Lets a page paint its hero before it renders everything under it.
// The first render shows the above-the-fold part only; the rest mounts in the
// task after the browser's next paint. On a slow phone the full team page is
// one ~1 s render task, and the hero (the page's Largest Contentful Paint)
// can't paint until that task ends.
import { useEffect, useState } from "react";

/** False on the first render, true once the browser has painted it. */
export function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let timer = 0;
    const done = () => setReady(true);
    // A callback queued from rAF runs after that frame's paint. Background tabs
    // don't run rAF, so a plain timer is the fallback.
    const frame = requestAnimationFrame(() => { clearTimeout(timer); timer = window.setTimeout(done, 0); });
    timer = window.setTimeout(done, 250);
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); };
  }, []);
  return ready;
}
