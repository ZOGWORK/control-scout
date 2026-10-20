// Hero: the headline (word-by-word reveal) and the cycling example match card.
import { useCallback, useEffect, useRef, useState } from "react";
import { m, useInView } from "motion/react";
import { Pause, Play } from "lucide-react";
import { ENGINE_VERSION } from "@control-scout/predict-engine";
import { cn } from "../cn";
import { CERTAINTY, MODEL, heroFoot, range80, sigma, winProb } from "./math";
import { Eyebrow, useReduced } from "./ui";

const ease = [0.2, 0.8, 0.2, 1] as const;

/** Worked examples (not real matches): expected scores and per-alliance rating uncertainty. */
const EXAMPLES = [
  { label: "Q-27 · example qualifier", r: 145, b: 120, unc: 2 * CERTAINTY.well, tier: "confident" },
  { label: "Q-41 · two evenly matched alliances", r: 132, b: 129, unc: 2 * CERTAINTY.well, tier: "confident" },
  { label: "SF-1 · a strong favourite", r: 210, b: 128, unc: 2 * CERTAINTY.well, tier: "confident" },
  { label: "Q-3 · first match, rookies on blue", r: 118, b: 104, unc: 2 * CERTAINTY.new, tier: "provisional" },
] as const;

const WORDS: { w: string; gold?: boolean }[] = [{ w: "How" }, { w: "Control" }, { w: "Scout" }, { w: "predictions", gold: true }, { w: "work" }];

export function Hero() {
  const reduced = useReduced();
  const tested = (MODEL.accuracy as { matches: { count: number } }).matches.count;
  return (
    <header className="grid items-end gap-8 pb-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:gap-10">
      <div className="grid min-w-0 gap-5">
        <Eyebrow>Control Scout · Predictions, explained</Eyebrow>
        <h1 className="text-balance font-display text-[2.4rem] font-bold leading-[0.98] tracking-tight text-foreground sm:text-6xl xl:text-7xl">
          {WORDS.map(({ w, gold }, i) => (
            <span key={w}>
              {reduced ? <span className={cn("inline-block", gold && "hiw-gold")}>{w}</span> : (
                <m.span
                  className={cn("inline-block", gold && "hiw-gold")}
                  initial={{ opacity: 0, y: "0.35em", rotate: 2, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, rotate: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.8, ease, delay: 0.12 + i * 0.08 }}
                >{w}</m.span>
              )}
              {i < WORDS.length - 1 && " "}
            </span>
          ))}
        </h1>
        <m.p
          className="max-w-xl text-lg leading-relaxed text-foreground/85 sm:text-xl"
          initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.45 }}
        >
          Before a qualifier starts, Control Scout can tell your team who's likely to win each match, where you'll probably rank, who might pick you, and your odds of advancing. Here's what's going on under the hood, in plain language, with the real numbers.
        </m.p>
        <m.p
          className="font-mono text-xs leading-relaxed text-muted-foreground"
          initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.6 }}
        >
          Predicts FTC seasons 2023–24 to 2026–27 (results back to 2019–20) · engine v{ENGINE_VERSION}, shared with Control Point · tested on {tested.toLocaleString("en-US")} matches it never saw while tuning
        </m.p>
      </div>
      <m.div initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.3 }} className="min-w-0">
        <MatchCard />
      </m.div>
    </header>
  );
}

function MatchCard() {
  const reduced = useReduced();
  const [idx, setIdx] = useState(0);
  const e = EXAMPLES[idx];
  const sR = sigma(e.r, e.unc), sB = sigma(e.b, e.unc);
  const p = winProb(e.r, e.b, e.unc);
  const [rR, rB] = [range80(e.r, sR), range80(e.b, sB)];

  // Tween the big percentages toward the new probability.
  const [shown, setShown] = useState(p);
  const from = useRef(p);
  useEffect(() => {
    if (reduced) { setShown(p); from.current = p; return; }
    const start = from.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      const v = start + (p - start) * (1 - Math.pow(1 - k, 3));
      setShown(v); from.current = v;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [p, reduced]);

  // Cycle examples every 5.2 s (never under reduced motion); a tap restarts the timer. Only while the card
  // is on screen: off it, each change still re-rendered the card every frame of its tween, mid-scroll.
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const onScreen = useInView(card);
  useEffect(() => {
    if (reduced || paused || !onScreen) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % EXAMPLES.length), 5200);
    return () => clearInterval(t);
  }, [reduced, paused, cycle, onScreen]);
  const pick = useCallback((i: number) => { setIdx(i); setCycle((c) => c + 1); }, []);

  const redPct = Math.round(shown * 100);
  return (
    <div ref={card} aria-label="Example match predictions (worked examples, not real matches)" role="group" className="lift overflow-hidden rounded-2xl border border-border bg-card shadow-[0_18px_40px_-24px_rgba(0,0,0,.6)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5 font-mono text-xs text-muted-foreground">
        <span>{e.label}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-border px-2 py-0.5 text-[10.5px] uppercase tracking-wider">{e.tier}</span>
          {/* The dot pulses only on screen: off it, the animation can't run on the compositor and ticked the page every frame. */}
          <span className="font-semibold text-success"><span aria-hidden className={cn("hiw-live", onScreen && "hiw-live-on")} />Example</span>
        </span>
      </div>
      <div className="grid grid-cols-2">
        {([["Red alliance", redPct, e.r, rR, "red"], ["Blue alliance", 100 - redPct, e.b, rB, "blue"]] as const).map(([name, pc, exp, rg, c]) => (
          <div key={c} className={cn("grid gap-1 border-t-[5px] px-4 pb-4 pt-3", c === "red" ? "border-t-red-alliance" : "border-l border-l-border border-t-blue-alliance")}>
            <span className="font-mono text-xs text-muted-foreground">{name}</span>
            <span className={cn("font-display text-5xl font-bold leading-none tabular-nums sm:text-6xl", c === "red" ? "text-red-alliance" : "text-blue-alliance")}>{pc}%</span>
            <span className="font-mono text-xs leading-relaxed text-foreground/85">expected {exp} pts<br />80% range {rg[0]}–{rg[1]}</span>
          </div>
        ))}
      </div>
      <div aria-hidden className="flex h-2.5">
        <span className="bg-red-alliance transition-[flex-grow] duration-700 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none" style={{ flex: `${(p * 100).toFixed(1)} 1 0` }} />
        <span className="bg-blue-alliance transition-[flex-grow] duration-700 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none" style={{ flex: `${((1 - p) * 100).toFixed(1)} 1 0` }} />
      </div>
      <p aria-live="polite" className="min-h-[3.6em] border-t border-border px-4 py-2.5 text-sm italic text-muted-foreground">{heroFoot(p)}</p>
      {/* The dots stay 8px; each button around one is a full target: 44px square on a phone, 24px on a desktop
          (WCAG 2.5.8 wants 24), side by side so no two overlap. The padding keeps the first dot under the text. */}
      <div role="group" aria-label="Example matches" className="flex items-center pl-1 pr-4 md:gap-1 md:pb-3 md:pl-4">
        {EXAMPLES.map((x, i) => (
          <button
            key={x.label} type="button" aria-label={x.label} aria-pressed={i === idx} onClick={() => pick(i)}
            className="group grid size-11 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-6"
          >
            <span className={cn("block h-2 rounded-full transition-all duration-500", i === idx ? "w-6 bg-accent" : "w-2 bg-border group-hover:bg-muted-foreground")} />
          </button>
        ))}
        {!reduced && (
          <button type="button" onClick={() => setPaused((v) => !v)} aria-pressed={paused} aria-label={paused ? "Resume cycling examples" : "Pause cycling examples"}
            className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 font-mono text-[11px] text-muted-foreground hover:text-foreground">
            {paused ? <Play className="size-3" /> : <Pause className="size-3" />}{paused ? "Play" : "Pause"}
          </button>
        )}
      </div>
    </div>
  );
}
