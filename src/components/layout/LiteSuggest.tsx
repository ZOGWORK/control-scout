// "Slow connection? Open the light version": offered when this page's data is crawling or requests keep failing
// while the browser is online (src/lib/liteSuggest.ts says when), and only on a page with a light twin
// (src/shared/lite.ts). The light page itself always links back to the full one, so taking the offer is never a
// trap. With no signal at all the offline pack takes over instead, and this stays away.
import { useEffect, useId } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { SignalLow, X } from "lucide-react";
import { m } from "../motion";
import { Button } from "../ui/button";
import { liteHref } from "../../shared/lite";
import { dismissLite, useLiteSuggested, watchPage } from "../../lib/liteSuggest";
import { useFlag } from "../../lib/flags";

export function LiteSuggest() {
  const loc = useLocation();
  const suggested = useLiteSuggested();
  // Never while the owner has the light version switched off (venueLightMode).
  const on = useFlag("venueLightMode");
  const href = on ? liteHref(loc.pathname, loc.search) : null;
  // Each page with a twin is timed from when the visitor gets there (another season or workspace is another page).
  const watched = href != null;
  useEffect(() => (watched ? watchPage(loc.pathname, loc.search) : undefined), [watched, loc.pathname, loc.search]);
  return <AnimatePresence>{suggested && href && <LiteCard href={href} onDismiss={dismissLite} />}</AnimatePresence>;
}

export function LiteCard({ href, onDismiss }: { href: string; onDismiss: () => void }) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <m.section
      role="region" aria-labelledby={titleId} aria-describedby={bodyId} data-lite-suggest=""
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: "easeOut" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onDismiss(); } }}
      className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[46] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] max-md:[[data-sticky-actions]_&]:bottom-[calc(var(--tabbar-h)+4rem+env(safe-area-inset-bottom)+0.75rem)] md:inset-x-auto md:bottom-28 md:left-4 md:w-[22rem]"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent"><SignalLow className="size-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-sm font-semibold text-foreground">Slow connection?</h2>
          <p id={bodyId} className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            This page is taking a while. The light version is text only and loads a fraction of the data. It always links back here.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0 max-sm:size-10" aria-label="Dismiss" onClick={onDismiss}><X /></Button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={onDismiss}>Not now</Button>
        {/* A full page load: the light page is the server's own HTML, not a route of this app. */}
        <Button size="sm" className="max-sm:h-10" asChild><a href={href}>Open light version</a></Button>
      </div>
    </m.section>
  );
}
