// In-page section nav: sticky just under the shell's top bar, with a sliding
// active-section indicator and a reading-progress line. The page scrolls the
// document (src/lib/pageScroll.ts), so that's what we observe.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { m } from "motion/react";
import { cn } from "../cn";
import { useReduced } from "./ui";
import { pageScroller, pageTop, scrollToElement } from "../../lib/pageScroll";

export const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "ratings", label: "Ratings" },
  { id: "matches", label: "Matches" },
  { id: "events", label: "Events" },
  { id: "accuracy", label: "Accuracy" },
  { id: "lab", label: "Lab notes" },
  { id: "limits", label: "Limits" },
  { id: "settings", label: "Settings" },
] as const;

export interface SectionTop { id: string; top: number }

/**
 * The section being read: the last one starting above the reading line (`line` px from the top of the
 * window, at scroll position `y`), or the last section once the page is scrolled to the very bottom (it is
 * too short to reach the line). "" above the first section.
 */
export function activeSection(tops: readonly SectionTop[], y: number, line: number, max: number): string {
  let cur = "";
  for (const s of tops) if (s.top - y < line) cur = s.id;
  if (max > 0 && y >= max - 2) cur = SECTIONS[SECTIONS.length - 1].id;
  return cur;
}

export function scrollToId(id: string, reduced: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  scrollToElement(el, reduced ? "auto" : "smooth");
  history.replaceState(history.state, "", `#${id}`);
}

export function SectionNav() {
  const reduced = useReduced();
  const [active, setActive] = useState<string>("");
  // The progress line is written straight to its style: as state, every scrolled frame re-rendered the nav
  // (and its shared-layout pill re-measured itself), which made this page stutter while scrolling.
  const bar = useRef<HTMLSpanElement>(null);
  const toc = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = pageScroller();
    // Where each section starts (in page coordinates), the scroll range and the reading line, measured only
    // when the page's size changes. A scrolled frame then reads just the scroll position: measuring all eight
    // sections every frame (after writing the progress line) forced a style and layout pass per frame.
    let tops: SectionTop[] = [], max = 0, line = 0, raf = 0;
    const measure = () => {
      const y = page.scrollTop;
      tops = SECTIONS.flatMap((s) => { const el = document.getElementById(s.id); return el ? [{ id: s.id, top: el.getBoundingClientRect().top + y }] : []; });
      max = page.scrollHeight - page.clientHeight;
      // The reading line: a third of the way down the visible page, under the top bar.
      const top = pageTop();
      line = top + Math.max(0, window.innerHeight - top) * 0.35;
    };
    const update = () => {
      raf = 0;
      const y = page.scrollTop;
      if (bar.current) bar.current.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
      setActive(activeSection(tops, y, line, max));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const onResize = () => { measure(); onScroll(); };
    measure(); update();
    // The page grows as figures and data render in, and sections move with it.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onResize);
    ro?.observe(document.body);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => { ro?.disconnect(); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); cancelAnimationFrame(raf); };
  }, []);

  // Keep the active link visible in the (horizontally scrolling) nav on phones.
  useEffect(() => {
    const box = toc.current;
    const a = box?.querySelector<HTMLElement>(`[data-id="${active}"]`);
    if (!box || !a) return;
    const l = a.offsetLeft, r = l + a.offsetWidth;
    if (l < box.scrollLeft || r > box.scrollLeft + box.clientWidth) box.scrollTo({ left: l - 12, behavior: reduced ? "auto" : "smooth" });
  }, [active, reduced]);

  const go = (e: MouseEvent<HTMLAnchorElement>, id: string) => { e.preventDefault(); scrollToId(id, reduced); };

  return (
    <nav aria-label="On this page" className="sticky top-[calc(var(--header-h)+0.5rem)] z-30 mb-10 mt-2">
      <div className="relative overflow-hidden rounded-xl border border-border bg-background p-1 shadow-[0_18px_40px_-24px_rgba(0,0,0,.55)]">
        <div ref={toc} className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => {
            const on = s.id === active;
            return (
              <a
                key={s.id} href={`#${s.id}`} data-id={s.id} onClick={(e) => go(e, s.id)} aria-current={on ? "location" : undefined}
                className={cn("relative shrink-0 rounded-lg px-3 py-2 font-display text-[13px] font-semibold transition-colors", on ? "text-accent-ink" : "text-muted-foreground hover:text-foreground")}
              >
                {on && <m.span layoutId="hiw-toc" aria-hidden className="absolute inset-0 rounded-lg bg-accent" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
                <span className="relative">{s.label}</span>
              </a>
            );
          })}
        </div>
        <span ref={bar} aria-hidden className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-accent" style={{ transform: "scaleX(0)" }} />
      </div>
    </nav>
  );
}
