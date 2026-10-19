// Building blocks for the "How it works" page: reveal-on-scroll, figure
// panels, segmented controls, sliders, count-up numbers and a chart tooltip
// that works by hover, tap and keyboard focus.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent, type FocusEvent as RFocusEvent, type MouseEvent as RMouseEvent } from "react";
import { createPortal } from "react-dom";
import { motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "../cn";

const ease = [0.2, 0.8, 0.2, 1] as const;

/** True when the visitor asked for reduced motion. */
export function useReduced(): boolean {
  return !!useReducedMotion();
}

/** Fades, rises and un-blurs in when scrolled into view (plain under reduced motion). */
export function Reveal({ children, className, delay = 0, as = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "li" }) {
  const reduced = useReduced();
  if (reduced) { const C = as; return <C className={className}>{children}</C>; }
  const C = as === "li" ? motion.li : motion.div;
  return (
    <C
      className={className}
      initial={{ opacity: 0, y: 16, filter: "blur(6px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.08, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.7, ease, delay }}
    >
      {children}
    </C>
  );
}

/** Once-only "has this been seen" flag; always true under reduced motion. */
export function useSeen<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const inView = useInView(ref, { once: true, amount: 0.15 });
  const reduced = useReduced();
  return [ref, reduced || inView];
}

// ---------- typography ----------

export function Eyebrow({ num, children }: { num?: string; children: ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {num && <span className="rounded-[4px] bg-accent px-1.5 py-0.5 tabular-nums text-accent-ink">{num}</span>}
      <span>{children}</span>
    </p>
  );
}

export function SectionHead({ num, eyebrow, title }: { num?: string; eyebrow: string; title: ReactNode }) {
  return (
    <Reveal className="mx-auto mb-5 grid max-w-2xl gap-3">
      <Eyebrow num={num}>{eyebrow}</Eyebrow>
      <h2 className="text-balance font-display text-[1.75rem] font-bold leading-[1.08] tracking-tight text-foreground sm:text-4xl">{title}</h2>
    </Reveal>
  );
}

/** One reading column (~42rem), centred; figures break out wider. */
export function Prose({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <Reveal className={cn("mx-auto max-w-2xl", className)}>
      <div id={id} className="hiw-prose scroll-mt-bar-24 space-y-4 text-[15px] leading-[1.75] text-foreground/85 sm:text-base [&_a]:text-foreground [&_a]:underline [&_a]:decoration-accent [&_a]:underline-offset-2 [&_code]:rounded [&_code]:border [&_code]:border-border [&_code]:bg-card [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.86em] [&_h3]:mt-8 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-foreground [&_strong]:font-semibold [&_strong]:text-foreground">
        {children}
      </div>
    </Reveal>
  );
}

export function CleanList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="grid gap-2.5">
      {items.map((it, i) => (
        <li key={i} className="relative pl-6">
          <span aria-hidden className="absolute left-0 top-[0.62em] size-2 rounded-[2px] bg-accent" />
          {it}
        </li>
      ))}
    </ul>
  );
}

// ---------- figures ----------

export function Figure({ label, title, note, actions, caption, narrow, children, id, className }: {
  label: string;
  title: ReactNode;
  note?: string;
  actions?: ReactNode;
  caption?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const glow = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <Reveal className={cn("mx-auto my-8", narrow ? "max-w-3xl" : "max-w-5xl", className)}>
      <figure id={id} className="m-0 scroll-mt-bar-24">
        <div ref={ref} data-seen={seen ? "" : undefined} onPointerMove={glow} className="hiw-panel overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="hiw-gold text-[11px] font-bold uppercase tracking-[0.14em]">{label}</p>
              <p className="mt-0.5 font-display text-base font-semibold text-foreground sm:text-lg">
                {title}{note && <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">· {note}</span>}
              </p>
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {children}
        </div>
        {caption && <figcaption className="mx-auto mt-3 max-w-2xl px-1 text-sm leading-relaxed text-muted-foreground">{caption}</figcaption>}
      </figure>
    </Reveal>
  );
}

/** Horizontal scroll wrapper for charts on narrow screens. */
export function ScrollX({ children, min = 520, label }: { children: ReactNode; min?: number; label: string }) {
  return (
    <div data-scroll-x className="custom-scrollbar -mx-1 overflow-x-auto px-1 pb-1" role="region" aria-label={label} tabIndex={0}>
      <div style={{ minWidth: min }}>{children}</div>
    </div>
  );
}

/** A responsive SVG chart. Interactive charts are groups; static ones are images. */
export function Chart({ viewBox, label, interactive, children, className }: { viewBox: string; label: string; interactive?: boolean; children: ReactNode; className?: string }) {
  return (
    <svg viewBox={viewBox} role={interactive ? "group" : "img"} aria-label={label} className={cn("hiw-chart", className)} xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
  );
}

// ---------- controls ----------

export function Seg<T extends string>({ value, options, onChange, label, className }: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  return (
    <div role="group" aria-label={label} className={cn("inline-flex w-fit max-w-full flex-wrap justify-self-start rounded-lg border border-border bg-muted/60 p-0.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative min-h-9 rounded-md px-3 py-1.5 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              on ? "font-semibold text-accent-ink" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on && <motion.span layoutId={`seg-${id}`} aria-hidden className="absolute inset-0 rounded-md bg-accent" transition={{ type: "spring", stiffness: 420, damping: 32 }} />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Slider({ id, label, value, display, min, max, step, onChange }: {
  id: string; label: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label htmlFor={id} className="grid gap-1 font-mono text-xs text-muted-foreground">
      <span className="flex justify-between gap-2"><span>{label}</span><b className="tabular-nums text-foreground">{display}</b></span>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Kpi({ value, label, tone }: { value: ReactNode; label: string; tone?: "red" | "blue" | "gold" }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-muted/50 px-3 py-2.5">
      <b className={cn("block font-display text-2xl font-bold leading-none tabular-nums sm:text-[1.7rem]", tone === "red" && "text-red-alliance", tone === "blue" && "text-blue-alliance", tone === "gold" && "hiw-gold")}>{value}</b>
      <span className="mt-1 block font-mono text-[11px] leading-tight text-muted-foreground">{label}</span>
    </div>
  );
}

export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-xs leading-relaxed text-muted-foreground", className)}>{children}</p>;
}

// ---------- count-up numbers ----------

export function CountUp({ value, decimals = 0, suffix = "", className }: { value: number; decimals?: number; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduced = useReduced();
  const fmt = useCallback((v: number) => (decimals === 0 ? Math.round(v).toLocaleString("en-US") : v.toFixed(decimals)) + suffix, [decimals, suffix]);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (reduced || !inView) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 1100);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(step); else setShown(null);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, value]);
  // Before it's seen (motion on) show 0 so the count-up has somewhere to start.
  const v = reduced ? value : shown ?? (inView ? value : 0);
  // The final number for screen readers as text (a plain span can't carry an aria-label), the counting one hidden.
  return <span ref={ref} className={className}><span className="sr-only">{fmt(value)}</span><span aria-hidden>{fmt(v)}</span></span>;
}

// ---------- chart tooltip: hover, tap or focus ----------

interface TipState { text: string; x: number; y: number }
const TipCtx = createContext<(t: TipState | null) => void>(() => {});

export function TipLayer({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<TipState | null>(null);
  useEffect(() => {
    if (!tip) return;
    // Tap or click anywhere else, scroll, or Escape: hide.
    const down = (e: PointerEvent) => { if (!(e.target as Element)?.closest?.("[data-tip]")) setTip(null); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setTip(null); };
    const scroll = () => setTip(null);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, { passive: true });
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); window.removeEventListener("scroll", scroll); };
  }, [tip]);
  const w = typeof window !== "undefined" ? window.innerWidth : 1000;
  return (
    <TipCtx.Provider value={setTip}>
      {children}
      {typeof document !== "undefined" && createPortal(
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "pointer-events-none fixed z-[90] max-w-[240px] rounded-lg bg-foreground px-2.5 py-1.5 font-mono text-[11.5px] leading-snug text-background shadow-lg transition-opacity duration-150",
            tip ? "opacity-100" : "opacity-0",
          )}
          style={tip ? { left: Math.max(8, Math.min(w - 248, tip.x + 14)), top: Math.max(8, tip.y - 44) } : { left: -9999, top: -9999 }}
        >
          {tip?.text}
        </div>,
        document.body,
      )}
    </TipCtx.Provider>
  );
}

/** Props that give a chart mark a tooltip: hover, tap and keyboard focus all show it. */
export function useTip() {
  const set = useContext(TipCtx);
  return useCallback((text: string) => {
    const fromRect = (el: Element) => { const r = el.getBoundingClientRect(); set({ text, x: r.left + r.width / 2 - 14, y: r.top }); };
    return {
      "data-tip": "",
      tabIndex: 0,
      role: "img",
      "aria-label": text,
      onPointerEnter: (e: RPointerEvent<SVGElement>) => { if (e.pointerType === "mouse") set({ text, x: e.clientX, y: e.clientY }); },
      onPointerMove: (e: RPointerEvent<SVGElement>) => { if (e.pointerType === "mouse") set({ text, x: e.clientX, y: e.clientY }); },
      onPointerLeave: (e: RPointerEvent<SVGElement>) => { if (e.pointerType === "mouse") set(null); },
      onClick: (e: RMouseEvent<SVGElement>) => fromRect(e.currentTarget),
      onFocus: (e: RFocusEvent<SVGElement>) => fromRect(e.currentTarget),
      onBlur: () => set(null),
    } as const;
  }, [set]);
}
