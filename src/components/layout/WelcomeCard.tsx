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
import { Clapperboard, Compass, Swords, Trophy, X, type LucideIcon } from "lucide-react";
import { m } from "../motion";
import { Button } from "../ui/button";
import { cn } from "../cn";
import { BrandMark } from "./Shell";
import { useConsent } from "../../lib/consent";
import { usePersonal } from "../../lib/personal";
import { useFlag } from "../../lib/flags";
import { useFirstRunSlot } from "../../lib/firstRun";
import { isAutomated, isTourPage, knowsTheApp, rememberTourPage, replayTour, searchHref, tourDemo } from "../../lib/tour";
import { dismissWelcome, useWelcomeSeen, WELCOME_EXAMPLES } from "../../lib/welcome";

const SLOT = "welcome";

/** Each example in its own colour, with an icon for what it answers: a match video, a prediction, a record. */
const LOOK: { icon: LucideIcon; chip: string; icon_: string }[] = [
  { icon: Clapperboard, chip: "border-rose-500/45 bg-rose-500/10 hover:bg-rose-500/20", icon_: "text-rose-500 dark:text-rose-300" },
  { icon: Swords, chip: "border-info/45 bg-info/10 hover:bg-info/20", icon_: "text-info" },
  { icon: Trophy, chip: "border-success/45 bg-success/10 hover:bg-success/20", icon_: "text-success" },
];
/** After the page has loaded, wait this long before showing it (the page settles first; no flash on a bounce). */
export const WELCOME_DELAY_MS = 900;

/** Typing in a field: its own Esc (clearing the search) isn't the card's. */
const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable=true]");

export function WelcomeCard() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { decided } = useConsent();
  const { state, user, providers, sync, syncReady } = usePersonal();
  const tourOn = useFlag("onboardingTour");
  // Follows a reset ("Clear all local data") and other tabs, not only this card's own close.
  const closed = useWelcomeSeen();
  const [due, setDue] = useState(false);
  const titleId = useId();

  // Signed in, this device knows the account's teams only once its first sync has worked: until then an empty
  // state isn't proof of a new visitor (no flash for someone who uses the app on another device).
  const settled = providers !== null && sync !== "syncing" && (!user || syncReady);
  const wanted = !closed && decided && settled && !(isAutomated() && !tourDemo()) && !knowsTheApp(state, user);
  // Wait for the page it lands on to settle, on a page a first-timer lands on (not settings or the owner console).
  const landing = isTourPage(loc.pathname);
  useEffect(() => {
    if (!wanted || !landing || due) return;
    const t = window.setTimeout(() => setDue(true), WELCOME_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [wanted, landing, due]);
  // Only on a landing page: opening Settings or the owner console puts it away (back on a landing page, it returns).
  const shown = useFirstRunSlot(SLOT, wanted && landing && due);

  const close = () => dismissWelcome();

  // Any search closes it for good (shown yet or not): the visitor has found what it was pointing at.
  const searched = loc.pathname.replace(/\/+$/, "") === "/search" && !!new URLSearchParams(loc.search).get("q");
  useEffect(() => { if (searched && !closed) close(); }, [searched, closed]);

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
      className="fixed inset-x-4 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] max-md:[[data-sticky-actions]_&]:bottom-[calc(var(--tabbar-h)+4rem+env(safe-area-inset-bottom)+0.75rem)] z-[65] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] md:inset-x-auto md:bottom-6 md:right-6 md:w-[380px]"
    >
      <div className="flex items-start gap-3">
        <BrandMark className="size-9" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-base font-semibold text-foreground">Welcome to <span className="text-accent-text">Control Scout</span></h2>
          <p className="mt-0.5 text-sm text-muted-foreground">Search any team, event or match.</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0 max-sm:size-[44px]" aria-label="Close" onClick={close}><X /></Button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2" aria-label="Try a search">
        {WELCOME_EXAMPLES.map((q, i) => {
          const look = LOOK[i % LOOK.length]!;
          return (
            <li key={q} className="min-w-0">
              <Button variant="outline" size="sm" className={cn("max-w-full rounded-full text-foreground max-sm:h-[44px]", look.chip)} onClick={() => run(q)} data-welcome-example="">
                <look.icon className={look.icon_} /> <span className="truncate">{q}</span>
              </Button>
            </li>
          );
        })}
        {tourOn && (
          <li>
            <Button variant="ghost" size="sm" className="max-sm:h-[44px]" onClick={tour} data-take-tour=""><Compass /> Take the tour</Button>
          </li>
        )}
      </ul>
    </m.section>,
    document.body,
  );
}
