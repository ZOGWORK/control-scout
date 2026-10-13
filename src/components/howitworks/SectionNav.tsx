// In-page section nav: sticky at the top of the app's scrolling <main>, with
// a sliding active-section indicator and a reading-progress line. The shell
// scrolls inside main#main (not the window), so that's what we observe.
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { motion } from "motion/react";
import { cn } from "../cn";
import { useReduced } from "./ui";

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

export function scrollToId(id: string, reduced: boolean) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  history.replaceState(history.state, "", `#${id}`);
}

export function SectionNav() {
  const reduced = useReduced();
  const [active, setActive] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const toc = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const max = main.scrollHeight - main.clientHeight;
      setProgress(max > 0 ? Math.min(1, main.scrollTop / max) : 0);
      // The visible part of main (when a tool unrolls the shell, main is taller than the window).
      const top = Math.max(0, main.getBoundingClientRect().top);
      const line = top + Math.min(main.clientHeight, window.innerHeight - top) * 0.35;
      let cur = "";
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top < line) cur = s.id;
      }
      // At the very bottom, the last (short) section counts as active.
      if (max > 0 && main.scrollTop >= max - 2) cur = SECTIONS[SECTIONS.length - 1].id;
      setActive(cur);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { main.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); cancelAnimationFrame(raf); };
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
    <nav aria-label="On this page" className="sticky top-2 z-30 mb-10 mt-2">
      <div className="relative overflow-hidden rounded-xl border border-border bg-background p-1 shadow-[0_18px_40px_-24px_rgba(0,0,0,.55)]">
        <div ref={toc} className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => {
            const on = s.id === active;
            return (
              <a
                key={s.id} href={`#${s.id}`} data-id={s.id} onClick={(e) => go(e, s.id)} aria-current={on ? "location" : undefined}
                className={cn("relative shrink-0 rounded-lg px-3 py-2 font-display text-[13px] font-semibold transition-colors", on ? "text-accent-ink" : "text-muted-foreground hover:text-foreground")}
              >
                {on && <motion.span layoutId="hiw-toc" aria-hidden className="absolute inset-0 rounded-lg bg-accent" transition={{ type: "spring", stiffness: 380, damping: 30 }} />}
                <span className="relative">{s.label}</span>
              </a>
            );
          })}
        </div>
        <span aria-hidden className="absolute bottom-0 left-0 h-0.5 w-full origin-left bg-accent" style={{ transform: `scaleX(${progress})` }} />
      </div>
    </nav>
  );
}
