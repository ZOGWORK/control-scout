// Home's tips line (src/shared/homeTips.ts): one tip at a time, a new one every TIP_MS, starting on a random one.
//   - No layout shift: every tip sits in the same grid cell, so the line is always as tall as its longest tip (one
//     line on a desktop; on a phone the longest wraps and the rest sit in that same space).
//   - A soft crossfade (300 ms, a 4px rise); with reduced motion the tip just swaps.
//   - Still while the pointer is on it or focus is in it (its links are reachable by keyboard), and while the tab is
//     hidden. The change is never announced (aria-live off): a screen reader reads the tip shown when it gets there.
//   - Only the tip shown can be read or focused: the others are visibility: hidden.
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { usePersonal } from "../../lib/personal";
import { TIP_MS, tipsFor, type HomeTip } from "../../shared/homeTips";
import { cn } from "../cn";

const onVisibility = (change: () => void) => { document.addEventListener("visibilitychange", change); return () => document.removeEventListener("visibilitychange", change); };
const tabShown = () => document.visibilityState !== "hidden";

/** Which tip is up: a random one first, then each in turn, moving on every `ms` while `still` is false and the tab is
 *  shown (a hidden tab, or a pause, starts the wait again from the top). */
export function useTipIndex(count: number, still: boolean, ms = TIP_MS, start = () => Math.floor(Math.random() * count)): number {
  const [i, setI] = useState(start);
  const shown = useSyncExternalStore(onVisibility, tabShown, () => true);
  useEffect(() => {
    if (still || !shown || count < 2) return;
    const t = setTimeout(() => setI((n) => (n + 1) % count), ms);
    return () => clearTimeout(t);
  }, [i, still, shown, count, ms]);
  return count ? i % count : 0;
}

function TipText({ tip }: { tip: HomeTip }) {
  if (!tip.link) return <>{tip.text}</>;
  return <>{tip.text}<Link to={tip.link.to} className="font-medium text-text-base underline decoration-ink/30 underline-offset-2 transition-colors hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring">{tip.link.label}</Link>{tip.link.after ?? ""}</>;
}

/** The line. `icon`: drawn before each tip (the classic Home's row). */
export function HomeTips({ className, icon }: { className?: string; icon?: ReactNode }) {
  const { user } = usePersonal();
  const tips = useMemo(() => tipsFor(!!user), [user]);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const at = useTipIndex(tips.length, hover || focus);
  return (
    <div data-home-tips aria-live="off" className={cn("grid", className)}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}>
      {tips.map((tip, i) => (
        <p key={tip.id} data-tip={tip.id} data-shown={i === at ? "" : undefined} aria-hidden={i === at ? undefined : true}
          className={cn("[grid-area:1/1] flex items-start justify-center gap-1.5 transition-[opacity,translate,visibility] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
            i === at ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0")}>
          {icon}<span>{<TipText tip={tip} />}</span>
        </p>
      ))}
    </div>
  );
}
