// How the stated score ranges have really held (GET /api/predict/ranges): one small request per page, shared by every
// range on it (useApi caches by path), so no range is ever read as holding exactly its stated level.
// It's a footnote to the numbers, never part of the first paint: the request waits until the browser is idle after
// the page is drawn (a server-drawn page's first render makes no request); a later page shows the last one read meanwhile.
import { useEffect, useState } from "react";
import { useApi } from "./api";
import type { RangeCoverageNow } from "../shared/api";

const waiting = new Set<() => void>();
/** Runs `cb` once the browser is idle after the current render (one idle wait shared by every range on the page). */
function whenIdle(cb: () => void) {
  waiting.add(cb);
  if (waiting.size > 1) return;
  const fire = () => { const all = [...waiting]; waiting.clear(); for (const f of all) f(); };
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(fire, { timeout: 3000 });
  else setTimeout(fire, 1500);
}

/** The last coverage read this visit: shown at once on the next page while its own read waits for idle. */
let last: RangeCoverageNow | null = null;

const isCoverage = (d: unknown): d is RangeCoverageNow | null =>
  d === null || (typeof d === "object" && typeof (d as RangeCoverageNow).label === "string" && typeof (d as RangeCoverageNow).live?.coverage === "number" && typeof (d as RangeCoverageNow).live?.n === "number");

export function useRangeCoverage(): RangeCoverageNow | null {
  const [go, setGo] = useState(false);
  useEffect(() => {
    let live = true;
    whenIdle(() => { if (live) setGo(true); });
    return () => { live = false; };
  }, []);
  const data = useApi<RangeCoverageNow | null>(go ? "/api/predict/ranges" : null, isCoverage).data;
  if (data && isCoverage(data)) last = data;
  return data && isCoverage(data) ? data : last;
}
