// A chart's code (recharts) is a chunk of its own, fetched after the page has painted: the page's text, table and
// figures never wait for it. Until it arrives its box keeps the chart's height, so nothing below it moves.
import { useEffect, useState, type ComponentType } from "react";

/** `load` must be stable (a module-level function): the module is fetched once, after the first paint. */
export function useDeferredPart<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> | null {
  const [Part, setPart] = useState<ComponentType<P> | null>(null);
  useEffect(() => {
    let live = true;
    load().then((part) => { if (live) setPart(() => part); }, () => { /* a page works without its chart */ });
    return () => { live = false; };
  }, [load]);
  return Part;
}
