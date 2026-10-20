// The pit display's data poll and its QR code (pages/EventDisplayPage.tsx), kept apart from the page so they're tested alone.
import { useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import { load } from "./api";
import { pollInterval } from "./liveMode";
import type { EventDetail } from "../shared/api";

/** The poll behind the display: the live cadence (20–30 s) while the event is live, else every 5 minutes;
 *  after a failure, sooner (5, 10, 20, 30 s) until a fetch works again. True while it's failing. */
export function useDisplayPoll(d: Pick<EventDetail, "event" | "live"> | undefined, path: string): boolean {
  const [failing, setFailing] = useState(false);
  const every = (d ? pollInterval(d) : 0) || 5 * 60_000;
  const fails = useRef(0);
  useEffect(() => {
    let stop = false;
    let id: ReturnType<typeof setTimeout>;
    const next = (ms: number) => { id = setTimeout(tick, ms); };
    async function tick() {
      try {
        await load(path, true);
        fails.current = 0;
        if (!stop) setFailing(false);
      } catch {
        fails.current++;
        if (!stop) setFailing(true);
      }
      if (!stop) next(fails.current ? Math.min(30_000, 5000 * 2 ** (fails.current - 1)) : every);
    }
    next(every);
    return () => { stop = true; clearTimeout(id); };
  }, [path, every]);
  return failing;
}

/** The QR code's dark modules as one SVG path (no quiet zone: the white padding around it is one). */
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { border: 0 });
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y][x]) d += `M${x} ${y}h1v1h-1z`;
  return { size, d };
}

