// The welcome card: one small "Welcome to Control Scout" card for a first-time visitor that shows search off with
// real example searches (each one answers live with a card) rather than explaining it. Tapping one runs it. It
// closes on X, on Esc, on any search, and is shown once per visitor (src/lib/welcome.ts). While the owner has the
// step-by-step tour on (onboardingTour), it also offers a quiet "Take the tour"; otherwise it's the only welcome.
//
// When: after the privacy choice is made, once the account has answered, on a page a first-timer lands on, to
// someone who doesn't already use the app, and only while no other first-run surface is up (src/lib/firstRun.ts).
// Never to crawlers or automated browsers (screenshots set cs-tour-demo). It sits fixed at the bottom (above the
// phone tab bar), never over the search box, and moves nothing on the page.
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Compass, Search, X } from "lucide-react";
import { m } from "../motion";
import { Button } from "../ui/button";
import { useConsent } from "../../lib/consent";
import { usePersonal } from "../../lib/personal";
import { useFlag } from "../../lib/flags";
import { useFirstRunSlot } from "../../lib/firstRun";
import { isAutomated, isTourPage, knowsTheApp, rememberTourPage, replayTour, searchHref, tourDemo } from "../../lib/tour";
import { dismissWelcome, welcomeSeen, WELCOME_EXAMPLES } from "../../lib/welcome";

const SLOT = "welcome";
/** After the page has loaded, wait this long before showing it (the page settles first; no flash on a bounce). */
export const WELCOME_DELAY_MS = 900;

/** Typing in a field: its own Esc (clearing the search) isn't the card's. */
const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable=true]");

export function WelcomeCard() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { decided } = useConsent();
  const { state, user, providers } = usePersonal();
  const tourOn = useFlag("onboardingTour");
  const [closed, setClosed] = useState(() => welcomeSeen());
  const [due, setDue] = useState(false);
  const titleId = useId();

  const wanted = !closed && decided && providers !== null && !(isAutomated() && !tourDemo()) && !knowsTheApp(state, user);
  // Wait for the page it lands on to settle, on a page a first-timer lands on (not settings or the owner console).
  const landing = isTourPage(loc.pathname);
  useEffect(() => {
    if (!wanted || !landing || due) return;
    const t = window.setTimeout(() => setDue(true), WELCOME_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [wanted, landing, due]);
  const shown = useFirstRunSlot(SLOT, wanted && due);

  const close = () => { dismissWelcome(); setClosed(true); };

  // Any search closes it: the visitor has found what it was pointing at.
  const searched = loc.pathname.replace(/\/+$/, "") === "/search" && !!new URLSearchParams(loc.search).get("q");
  useEffect(() => { if (shown && searched) close(); }, [shown, searched]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || editable(e.target)) return;
      e.preventDefault();
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!shown) return null;
  const run = (q: string) => { close(); navigate(searchHref(q)); };
  // The tour starts here, on the page the visitor is on.
  const tour = () => { close(); rememberTourPage(loc.pathname + loc.search); navigate(replayTour()); };

  return createPortal(
    <m.section
      role="dialog" aria-labelledby={titleId} data-welcome=""
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
      className="fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[65] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[360px]"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-base font-semibold text-foreground">Welcome to Control Scout</h2>
          <p className="mt-1 text-sm text-muted-foreground">Search any team, event or match.</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0 max-sm:size-[44px]" aria-label="Close" onClick={close}><X /></Button>
      </div>
      <ul className="mt-3 flex flex-col gap-2" aria-label="Try a search">
        {WELCOME_EXAMPLES.map((q) => (
          <li key={q}>
            <Button variant="outline" size="sm" className="w-full justify-start max-sm:h-[44px]" onClick={() => run(q)} data-welcome-example="">
              <Search className="text-muted-foreground" /> {q}
            </Button>
          </li>
        ))}
      </ul>
      {tourOn && (
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" className="max-sm:h-[44px]" onClick={tour} data-take-tour=""><Compass /> Take the tour</Button>
        </div>
      )}
    </m.section>,
    document.body,
  );
}
