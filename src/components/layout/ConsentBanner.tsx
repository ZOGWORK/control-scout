// First-visit privacy banner: small, non-blocking, bottom-left on desktop and
// just above the tab bar on phones. It explains the essential storage (always
// on) and asks about the one optional thing, anonymous usage statistics, with
// two equally weighted buttons. It never shows again once a choice is stored,
// and never shows at all when the browser sends GPC / Do Not Track (that
// counts as "no"). It mounts after the page has painted (idle time), fixed in
// place, so it can't delay the first paint or shift the layout. Esc inside it
// means "No thanks".
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { useConsent } from "../../lib/consent";

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
  const [ready, setReady] = useState(false);
  useEffect(() => afterFirstPaint(() => setReady(true)), []);
  const show = ready && !decided;
  return (
    <AnimatePresence>
      {show && (
        <motion.section
          role="region"
          aria-label="Privacy choices"
          aria-describedby="cs-consent-text"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: "easeOut" }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAnalytics(false); } }}
          className="fixed inset-x-3 bottom-[calc(60px+env(safe-area-inset-bottom)+0.75rem)] z-[60] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] md:inset-x-auto md:bottom-4 md:left-4 md:w-[22rem]"
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
        </motion.section>
      )}
    </AnimatePresence>
  );
}
