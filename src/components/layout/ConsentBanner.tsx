// First-visit privacy banner: small, non-blocking, bottom-left on desktop and
// just above the tab bar on phones. It explains the essential storage (always
// on) and asks about the one optional thing, anonymous usage statistics, with
// two equally weighted buttons. It never shows again once a choice is stored,
// and never shows at all when the browser sends GPC / Do Not Track (that
// counts as "no"). The server paints a static copy of it with the first HTML
// (server/bootShell.ts bootConsent), so it shows at once rather than seconds
// later as the page's largest late paint; this banner takes over from that
// copy in place (no entrance animation, keyboard focus kept). Without the
// static copy (e.g. after "Clear all local data"), it mounts after the page
// has painted (idle time). Fixed in place, so it never shifts the layout. Esc
// inside it means "No thanks".
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { m } from "../motion";
import { ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { useConsent } from "../../lib/consent";
import { BOOT_CONSENT_ID } from "../../shared/boot";

/** Resolves once the page has loaded and the browser is idle. */
function afterFirstPaint(cb: () => void): () => void {
  let cancel = () => {};
  const idle = () => {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(cb, { timeout: 2000 }); cancel = () => w.cancelIdleCallback?.(id); }
    else { const id = window.setTimeout(cb, 600); cancel = () => window.clearTimeout(id); }
  };
  if (document.readyState === "complete") idle();
  else { window.addEventListener("load", idle, { once: true }); cancel = () => window.removeEventListener("load", idle); }
  return () => cancel();
}

export function ConsentBanner() {
  const { decided, setAnalytics } = useConsent();
  // The server's static banner is already on screen: take over from it straight away.
  const [fromBoot] = useState(() => !!document.getElementById(BOOT_CONSENT_ID));
  const [ready, setReady] = useState(fromBoot);
  useEffect(() => (fromBoot ? undefined : afterFirstPaint(() => setReady(true))), [fromBoot]);
  const show = ready && !decided;
  const ref = useRef<HTMLElement>(null);
  // Before the browser paints: drop the static copy, keeping keyboard focus on the same button.
  useLayoutEffect(() => {
    const boot = document.getElementById(BOOT_CONSENT_ID);
    if (!boot) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && boot.contains(active) ? active.getAttribute("data-a") : null;
    boot.remove();
    if (focused != null) ref.current?.querySelectorAll("button")[focused === "1" ? 1 : 0]?.focus();
  }, [show]);
  return (
    <AnimatePresence>
      {show && (
        <m.section
          ref={ref}
          role="region"
          aria-label="Privacy choices"
          aria-describedby="cs-consent-text"
          initial={fromBoot ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: "easeOut" }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAnalytics(false); } }}
          className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[60] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] md:inset-x-auto md:bottom-28 md:left-4 md:w-[22rem]"
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-text" aria-hidden><ShieldCheck className="size-4" /></span>
            <div className="min-w-0 space-y-1">
              <p className="font-display text-sm font-semibold text-foreground">Your privacy</p>
              <p id="cs-consent-text" className="text-xs leading-relaxed text-muted-foreground">
                Sign-in, preferences and offline data are stored on this device so the app works. That's always on.
                {" "}May we also count <span className="text-foreground">anonymous page views</span>? No cookies, no IDs, no third parties.
                {" "}<Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</Link>
              </p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAnalytics(false)}>No thanks</Button>
            <Button variant="secondary" size="sm" onClick={() => setAnalytics(true)}>Allow</Button>
          </div>
        </m.section>
      )}
    </AnimatePresence>
  );
}
