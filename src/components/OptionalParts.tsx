// The app's optional background parts (syncs, prompts): each loads its own chunk after the page. If one of
// those downloads fails (a dropped connection before the service worker has it), that part is skipped and the page,
// navigation and every other part keep working; React would otherwise unmount the whole app. Each child gets its own
// boundary, so one failure doesn't take the others with it.
// "After the page" means once it has loaded and the browser is idle (whenPageIdle): mounted with the app's first
// render, their nine chunks and their own requests shared a phone's connection with the page's code and its search,
// and a slow phone waited for both.
import { Children, Component, Suspense, useEffect, useState, type ReactNode } from "react";

class Skip extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.warn("An optional part of the app didn't load:", error); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** At most this long after the page's load event before the parts mount, idle or not. */
export const OPTIONAL_PARTS_IDLE_MS = 2000;

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
/** `cb` once the page has loaded and the browser is idle (at most OPTIONAL_PARTS_IDLE_MS after load); returns a cancel. */
export function whenPageIdle(cb: () => void): () => void {
  const w = window as IdleWindow;
  let cancel = () => {};
  const idle = () => {
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(cb, { timeout: OPTIONAL_PARTS_IDLE_MS }); cancel = () => w.cancelIdleCallback?.(id); }
    else { const id = window.setTimeout(cb, 200); cancel = () => window.clearTimeout(id); }
  };
  if (document.readyState === "complete") idle();
  else { window.addEventListener("load", idle, { once: true }); cancel = () => window.removeEventListener("load", idle); }
  return () => cancel();
}

export function OptionalParts({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => whenPageIdle(() => setReady(true)), []);
  if (!ready) return null;
  return <>{Children.map(children, (child) => <Skip><Suspense fallback={null}>{child}</Suspense></Skip>)}</>;
}
