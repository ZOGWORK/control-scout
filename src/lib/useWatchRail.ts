// The Watch live rail's state across refreshes (lib/watchRail.ts): which match it was calling, and a result it's
// showing for RESULT_MS once that match is scored. A hook over the pure rules, for any surface that follows the
// rail's pick (the broadcast overlay, pages/EventOverlayPage.tsx).
import { useEffect, useRef, useState } from "react";
import type { EventDetail } from "../shared/api";
import { nextFlip, railModel, type Calling, type Flip, type Rail } from "./watchRail";

/** The rail now, the last flip (kept after its minute: the call shown for that match) and the time it was worked out at. */
export function useWatchRail(d: Pick<EventDetail, "event" | "matches">): { rail: Rail; flip: Flip | null; now: number } {
  const [flip, setFlip] = useState<Flip | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const calling = useRef<Calling | null>(null);
  const rail = railModel(d, now, flip);
  // New data: did the match being called just get its result? Then show it before moving on.
  useEffect(() => {
    const t = Date.now();
    // The match the rail was calling, read now: the effect below moves the ref on before a deferred updater would run.
    const key = calling.current;
    setFlip((f) => nextFlip(key, d.matches, t, f));
    setNow(t);
  }, [d.matches]);
  // After every render (and after the effect above, which reads the previous one): the match being called and the call on screen.
  useEffect(() => { calling.current = rail.current ? { key: rail.current.key, prediction: rail.current.prediction } : null; });
  // Wake once when a shown result is due to give way.
  useEffect(() => {
    if (!flip || flip.until <= now) return;
    const id = setTimeout(() => setNow(Date.now()), flip.until - now);
    return () => clearTimeout(id);
  }, [flip, now]);
  return { rail, flip, now };
}
