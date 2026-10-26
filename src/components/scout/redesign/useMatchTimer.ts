// The match timer behind "Match started": one clock per match, shared by every team's form, that moves
// the phase tabs along with the field (Auto → TeleOp → Endgame) at FTC's boundaries. It keeps only
// timestamps (started, stopped) and works time out from the wall clock, so a locked phone or a tab in
// the background is still right the moment it's looked at again; the ticking only repaints.
import { useCallback, useEffect, useRef, useState } from "react";
import { phaseLabel } from "../../../shared/scoutTemplate";

/**
 * FTC match timing, as the field runs it (and MATCH_S in src/lib/videoMoment.ts): 30 s autonomous, an 8 s
 * transition while drivers pick up the controllers, then 2:00 driver-controlled whose last 30 s are the endgame.
 */
export const AUTO_S = 30, TRANSITION_S = 8, TELEOP_S = 120, ENDGAME_S = 30;
export const MATCH_S = AUTO_S + TRANSITION_S + TELEOP_S;
export const TELEOP_START_S = AUTO_S + TRANSITION_S, ENDGAME_START_S = MATCH_S - ENDGAME_S;

export type TimerPhase = "auto" | "teleop" | "endgame";

/** The phase to scout `seconds` after the start: auto through the transition, then TeleOp, then the endgame. */
export function phaseAt(seconds: number): TimerPhase {
  if (!(seconds >= TELEOP_START_S)) return "auto";
  return seconds < ENDGAME_START_S ? "teleop" : "endgame";
}

/** What the field's own clock shows `seconds` after the start: the period and the time left in it. */
export function fieldClock(seconds: number): { period: string; left: number } {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  if (s >= MATCH_S) return { period: "Ended", left: 0 };
  if (s < AUTO_S) return { period: "Auto", left: AUTO_S - s };
  if (s < TELEOP_START_S) return { period: "Transition", left: TELEOP_START_S - s };
  return { period: phaseLabel(phaseAt(s)), left: MATCH_S - s };
}

/** m:ss, rounding up like the field's clock (0:29.4 left shows 0:30). */
export const clock = (seconds: number) => {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** How long the "TeleOp now" cue stays up after a boundary. */
export const CUE_MS = 2500;

export interface MatchTimer {
  /** When "Match started" was tapped (ms since epoch), or null when off. */
  startedAt: number | null;
  /** When it was stopped (the clock holds there), or null while it runs. */
  stoppedAt: number | null;
  running: boolean;
  /** Seconds since the start, up to the stop. 0 when off. */
  elapsed: number;
  /** The phase the match is in, or null when the timer is off. */
  phase: TimerPhase | null;
  /** The phase just entered while its cue is up (CUE_MS after the boundary), else null. */
  cue: TimerPhase | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const buzz = () => {
  try { (navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }).vibrate?.(120); } catch { /* not allowed here */ }
};

/**
 * One match's timer. `onPhase` is called once each time the match enters a phase (auto on start, then
 * TeleOp and Endgame), never on a tick in between, so a phase the scout picked by hand holds until the
 * next boundary. A jump over several boundaries (a phone locked for a minute) calls it once, for the
 * phase the match is in now. Each boundary after the start also gives a short vibration where the phone has one.
 */
export function useMatchTimer(onPhase?: (phase: TimerPhase) => void): MatchTimer {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = startedAt != null && stoppedAt == null;

  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 250);
    // Coming back to the page repaints at once rather than on the next tick.
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [running]);

  const elapsed = startedAt == null ? 0 : Math.max(0, ((stoppedAt ?? Math.max(now, startedAt)) - startedAt) / 1000);
  const phase = startedAt == null ? null : phaseAt(elapsed);

  const cb = useRef(onPhase);
  useEffect(() => { cb.current = onPhase; });
  // The phase last entered, and in which run (a restart is a new match: its auto is a first phase, not a boundary).
  const entered = useRef<{ phase: TimerPhase; run: number } | null>(null);
  const [cueAt, setCueAt] = useState<{ phase: TimerPhase; at: number } | null>(null);
  useEffect(() => {
    if (phase == null || startedAt == null) { entered.current = null; setCueAt(null); return; }
    const first = entered.current?.run !== startedAt;
    if (!first && entered.current?.phase === phase) return;
    entered.current = { phase, run: startedAt };
    if (first) setCueAt(null);
    else { buzz(); setCueAt({ phase, at: Date.now() }); }
    cb.current?.(phase);
  }, [phase, startedAt]);
  const cue = running && cueAt && cueAt.phase === phase && now - cueAt.at < CUE_MS ? cueAt.phase : null;

  const start = useCallback(() => { const t = Date.now(); setStartedAt(t); setStoppedAt(null); setNow(t); }, []);
  const stop = useCallback(() => { setStoppedAt((s) => s ?? Date.now()); }, []);
  const reset = useCallback(() => { setStartedAt(null); setStoppedAt(null); }, []);
  return { startedAt, stoppedAt, running, elapsed, phase, cue, start, stop, reset };
}
