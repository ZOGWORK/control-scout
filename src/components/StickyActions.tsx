// A page's main action, kept in reach on phones: a bar pinned just above the
// bottom tab bar once the page header (and its own buttons) has scrolled away.
// Hidden from md up, where the header's buttons and the sidebar are enough.
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";
import { useConsent } from "../lib/consent";
import { pageTop } from "../lib/pageScroll";

/**
 * True once `el` has scrolled up out of view (above the viewport, or under the
 * shell's sticky top bar), false while it's visible. StickyActions watches a
 * marker at the end of the page header this way: the bar shows only after the
 * header's buttons are gone, so it never repeats what's on screen.
 */
export function useScrolledPast(el: Element | null): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      // Out of view AND above the middle of the screen = scrolled past (not "not reached yet").
      setPast(!e.isIntersecting && e.boundingClientRect.top < window.innerHeight / 2);
    }, { rootMargin: `-${Math.round(pageTop())}px 0px 0px 0px` });
    io.observe(el);
    return () => { io.disconnect(); setPast(false); };
  }, [el]);
  return past;
}

let mounted = 0;

/**
 * The bar itself, rendered into <body> so no transformed ancestor can move
 * it. While one is mounted, <html data-sticky-actions> gives the shell's
 * content extra bottom padding on phones (Shell.tsx), so the page's last
 * content still scrolls clear of it. Tab bar = 60 px + 1 px border + the
 * safe-area inset; the bar sits right on top of it.
 */
export function StickyActions({ after, label, children }: { after: Element | null; label: string; children: ReactNode }) {
  // Watched here, not by the page: the flag flips mid-scroll, and as page state each flip re-rendered the
  // whole page (on a big event, every match row) in the middle of the scroll.
  const show = useScrolledPast(after);
  useEffect(() => {
    mounted++;
    document.documentElement.dataset.stickyActions = "";
    return () => { if (--mounted === 0) delete document.documentElement.dataset.stickyActions; };
  }, []);
  // The first-visit privacy banner (ConsentBanner) sits in this same strip above the tab bar:
  // the bar waits until that choice is made, so the two never overlap.
  const { decided } = useConsent();
  const visible = show && decided;
  return createPortal(
    <div
      role="region" aria-label={label} inert={!visible}
      className={cn(
        "fixed inset-x-0 bottom-[calc(61px+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-line bg-secondary px-4 py-2 transition-[translate,opacity] duration-200 motion-reduce:transition-none md:hidden",
        "[&>*]:min-w-0 [&>*]:flex-1",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0",
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
