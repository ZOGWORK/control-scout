// "Slow connection? Open the light version": offered when this page's data is crawling or requests keep failing
// while the browser is online (src/lib/liteSuggest.ts says when), and only on a page with a light twin
// (src/shared/lite.ts). The light page itself always links back to the full one, so taking the offer is never a
// trap. With no signal at all the offline pack takes over instead, and this stays away.
import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { Check, WifiLow, X, Zap } from "lucide-react";
import { m } from "../motion";
import { Button } from "../ui/button";
import { liteHref } from "../../shared/lite";
import { dismissLite, useLiteReason, useLiteSuggested, watchPage, type LiteReason } from "../../lib/liteSuggest";
import { useFlag } from "../../lib/flags";

export function LiteSuggest() {
  const loc = useLocation();
  const suggested = useLiteSuggested();
  const reason = useLiteReason();
  // Never while the owner has the light version switched off (venueLightMode).
  const on = useFlag("venueLightMode");
  const href = on ? liteHref(loc.pathname, loc.search) : null;
  // Each page with a twin is timed from when the visitor gets there (another season or workspace is another page).
  const watched = href != null;
  useEffect(() => (watched ? watchPage(loc.pathname, loc.search) : undefined), [watched, loc.pathname, loc.search]);
  const [demo, setDemo] = useState(liteDemo);
  const show = (suggested || demo != null) && href;
  const dismiss = () => { setDemo(null); dismissLite(); };
  return <AnimatePresence>{show && <LiteCard href={href} onDismiss={dismiss} reason={demo ?? reason} />}</AnimatePresence>;
}

/** The screenshot opt-in (`cs-lite-demo` = "1", `npm run shots -- --storage` with it): the card shows at once, as if
 *  the page had waited 9 s. A browser driven for screenshots never waits that long on its own. */
export const LITE_DEMO_KEY = "cs-lite-demo";
function liteDemo(): LiteReason | null {
  try { return localStorage.getItem(LITE_DEMO_KEY) === "1" ? { kind: "waiting", since: Date.now() - 9000 } : null; } catch { return null; }
}

/** Seconds since `since`, ticking once a second while shown. */
function useWaited(since: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  return since == null ? null : Math.max(0, Math.round((now - since) / 1000));
}

/** What the app saw, in plain words: the evidence behind the offer, never a guess at the connection's speed. */
export function reasonText(reason: LiteReason | null, waited: number | null): string {
  if (reason?.kind === "failing") return `${reason.count} requests couldn't reach the server in the last minute.`;
  if (waited != null) return `This page has been loading for ${waited} s.`;
  return "This page is taking a while to load.";
}

const POINTS = ["Text only: no images, charts or animations", "Same numbers and predictions as this page", "One tap back to the full version, any time"];

export function LiteCard({ href, onDismiss, reason = null }: { href: string; onDismiss: () => void; reason?: LiteReason | null }) {
  const titleId = useId();
  const bodyId = useId();
  const waited = useWaited(reason?.kind === "waiting" ? reason.since : null);
  return (
    <m.section
      role="region" aria-labelledby={titleId} aria-describedby={bodyId} data-lite-suggest=""
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.2, ease: "easeOut" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onDismiss(); } }}
      className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[46] max-h-[calc(100dvh-var(--tabbar-h)-6rem)] overflow-y-auto rounded-2xl border border-accent/35 bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] max-md:[[data-sticky-actions]_&]:bottom-[calc(var(--tabbar-h)+4rem+env(safe-area-inset-bottom)+0.75rem)] md:inset-x-auto md:bottom-28 md:left-4 md:w-[24rem] md:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent"><WifiLow className="size-5" aria-hidden /></span>
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 id={titleId} className="font-display text-base font-semibold leading-tight text-foreground">Slow connection</h2>
          <p className="mt-1 text-sm text-muted-foreground" data-lite-reason>{reasonText(reason, waited)}</p>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-2 size-11 shrink-0" aria-label="Dismiss" onClick={onDismiss}><X /></Button>
      </div>
      <div id={bodyId} className="mt-4">
        <p className="text-sm leading-relaxed text-foreground">Switch this page to <strong className="font-semibold">Control Scout Lite</strong>. It loads a fraction of the data.</p>
        <ul className="mt-3 space-y-2">
          {POINTS.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-5 grid grid-cols-[1fr_1.35fr] gap-3">
        <Button variant="secondary" className="h-11 text-sm" onClick={onDismiss}>Keep waiting</Button>
        {/* A full page load: the Lite page is the server's own HTML, not a route of this app. */}
        <Button className="h-11 text-sm font-semibold" asChild><a href={href}><Zap aria-hidden /> Switch to Lite</a></Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground">Keep waiting hides this until you close the tab.</p>
    </m.section>
  );
}
