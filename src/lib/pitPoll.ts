// The pit display's data poll and its QR code (pages/EventDisplayPage.tsx), kept apart from the page so they're tested alone.
import { useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import { load } from "./api";
import { offlineSource } from "./offline/saved";
import { pollInterval } from "./liveMode";
import type { EventDetail } from "../shared/api";

/** The poll behind the display: the live cadence (20–30 s) while the event is live, else every 5 minutes;
 *  after a failure, sooner (5, 10, 20, 30 s) until a fetch works again. "reconnecting" while fetches fail,
 *  "saved" while the only answer is this device's saved season (offline: those aren't fresh scores). */
export type PollState = "ok" | "reconnecting" | "saved";
export function useDisplayPoll(d: Pick<EventDetail, "event" | "live"> | undefined, path: string | null): PollState {
  const [state, setState] = useState<PollState>("ok");
  // Nothing loaded yet (the first request failed): try again soon, on the failure schedule, not in 5 minutes.
  const every = !d ? 5000 : pollInterval(d) || 5 * 60_000;
  const fails = useRef(0);
  useEffect(() => {
    if (!path) return;
    const url = path;
    let stop = false;
    let id: ReturnType<typeof setTimeout>;
    const next = (ms: number) => { id = setTimeout(tick, ms); };
    async function tick() {
      try {
        // Offline, the request can answer with the saved season instead of failing: still not live, so keep retrying soon.
        const saved = !!offlineSource(await load(url, true));
        fails.current = saved ? fails.current + 1 : 0;
        if (!stop) setState(saved ? "saved" : "ok");
      } catch (e) {
        // No such event (404) or an address that can't be one (400): that's the answer, not a dropped connection. Stop.
        const status = (e as { status?: number })?.status;
        if (status === 404 || status === 400) return;
        fails.current++;
        if (!stop) setState("reconnecting");
      }
      if (!stop) next(fails.current ? Math.min(30_000, 5000 * 2 ** (fails.current - 1)) : every);
    }
    next(every);
    return () => { stop = true; clearTimeout(id); };
  }, [path, every]);
  return state;
}

/** The QR code's dark modules as one SVG path (no quiet zone: the white padding around it is one). */
export function qrPath(text: string): { size: number; d: string } {
  const { size, data } = encode(text, { border: 0 });
  let d = "";
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y][x]) d += `M${x} ${y}h1v1h-1z`;
  return { size, d };
}

