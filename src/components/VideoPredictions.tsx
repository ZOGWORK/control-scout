// The model's call over the event page's own player (components/WatchLive.tsx). For a recording it follows the
// video: the match on screen at the player's second (lib/videoMoment.ts), its call before and while it runs, then
// its result. Live, it shows the match being called now and a result for a minute once it's in (the rail's pick,
// lib/watchRail.ts). Small, at the left above YouTube's controls (or at the top, the viewer's choice: broadcasts
// put their own scoreboard at one edge or the other), and never in the way of a tap: taps go through it to the
// player. The viewer turns it off and on, and moves it, under the player (remembered on this device).
import { useState } from "react";
import { Check, X } from "lucide-react";
import type { MatchView } from "../shared/api";
import { oddsPct } from "../shared/share";
import { verdict } from "../lib/watchRail";
import type { Phase } from "../lib/videoMoment";
import { cn } from "./cn";

const KEY = "cs-video-predictions";
const POS_KEY = "cs-video-predictions-pos";
export type OverlayPos = "top" | "bottom";

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: for this visit only */ } };

/** Whether the predictions show over the video (on unless this device turned them off), and where: broadcasts put
 *  their own scoreboard at the top or the bottom, so the viewer moves ours to the other edge. */
export function useVideoPredictions(): { on: boolean; setOn: (on: boolean) => void; pos: OverlayPos; setPos: (p: OverlayPos) => void } {
  const [on, setOnState] = useState(() => read(KEY) !== "0");
  const [pos, setPosState] = useState<OverlayPos>(() => (read(POS_KEY) === "top" ? "top" : "bottom"));
  return {
    on, pos,
    setOn: (v) => { setOnState(v); write(KEY, v ? "1" : "0"); },
    setPos: (p) => { setPosState(p); write(POS_KEY, p); },
  };
}

export interface OverlayCall { match: MatchView; phase: Phase }

const HEADING: Record<Phase, string> = { before: "Up next", playing: "Playing", after: "Result" };

/** The overlay itself: nothing without a match to show. */
export function VideoPredictions({ call, live, pos = "bottom" }: { call: OverlayCall | null; live?: boolean; pos?: OverlayPos }) {
  if (!call) return null;
  const { match: m, phase } = call;
  const p = m.prediction;
  const result = phase === "after" && m.played && m.red.score && m.blue.score;
  const v = result ? verdict(m) : null;
  const side = (c: "red" | "blue") => {
    const on = m.played ? m[c].teams.filter((t) => t.onField) : m[c].teams;
    return (on.length ? on : m[c].teams).map((t) => t.number).join(" · ");
  };
  return (
    <div className={cn("pointer-events-none absolute left-2 z-10 w-[min(19rem,calc(100%-1rem))] rounded-lg border border-white/15 bg-black/75 px-2.5 py-2 text-white shadow-lg backdrop-blur-sm max-sm:px-2 max-sm:py-1.5",
      pos === "top" ? "top-2" : "bottom-14 max-sm:bottom-12")}
      aria-live="polite" data-video-predictions={phase} data-pos={pos}>
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/70 max-sm:text-[10px]">
        <span className="rounded bg-[#ffc700] px-1 font-display text-xs normal-case tracking-normal text-[#0a0a0b] max-sm:text-[11px]">{m.label}</span>
        {live && phase !== "after" ? "Calling now" : HEADING[phase]}
      </p>
      <div className="mt-1 flex items-center gap-2 font-mono text-xs tabular-nums max-sm:text-[11px]">
        <span className="min-w-0 flex-1 truncate text-[#ff6b81]">{side("red")}</span>
        {result ? <span className="font-display text-sm font-bold">{m.red.score!.total}–{m.blue.score!.total}</span> : <span className="text-white/50">vs</span>}
        <span className="min-w-0 flex-1 truncate text-right text-[#5cc8ff]">{side("blue")}</span>
      </div>
      {p && (
        <div className="mt-1.5 flex items-center gap-2 text-[11px] max-sm:text-[10px]">
          <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-white/15" aria-hidden>
            <div className="bg-[#ff4d6d]" style={{ width: `${Math.max(2, Math.min(98, p.pRed * 100))}%` }} />
            <div className="flex-1 bg-[#38bdf8]" />
          </div>
          <span className="shrink-0 whitespace-nowrap text-white/85">
            Model: {p.pRed === 0.5 ? "even" : p.pRed > 0.5 ? `Red ${oddsPct(p.pRed)}` : `Blue ${oddsPct(1 - p.pRed)}`}
          </span>
          {v && (
            <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded px-1 font-semibold", v === "called" ? "bg-emerald-500/25 text-emerald-300" : "bg-amber-500/25 text-amber-300")}>
              {v === "called" ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}{v === "called" ? "Called it" : "Upset"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
