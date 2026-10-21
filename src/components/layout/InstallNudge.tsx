// "Put Control Scout on your home screen": a small, non-blocking card that
// turns the browser's install offer (beforeinstallprompt) into one tap, or on
// iOS Safari explains Share → Add to Home Screen. Who sees it and how often is
// in src/lib/installNudge.ts and docs/settings.md; in short: once a day at
// most, never after "No thanks", never once installed.
//
// When: after the privacy choice, once the page is idle, while nothing else
// has the visitor's attention, and only with the first-run slot
// (src/lib/firstRun.ts). The tour goes first: on a page where the tour may
// still open the nudge stays away, and in the page view where the tour (or another
// first-run surface) held the slot it waits for the next page or visit. Never
// to crawlers or automated browsers (`npm run shots -- --install` opts in).
//
// Where: phones, just above the tab bar (and above a page's sticky action bar
// when one is on the page), so neither is covered; from md up, bottom left.
// Leaving the page it opened on hides it (that's ignoring it, not "No thanks").
import { useEffect, useId, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { m } from "../motion";
import { Share, X } from "lucide-react";
import { Button } from "../ui/button";
import { useConsent } from "../../lib/consent";
import { usePersonal } from "../../lib/personal";
import { claimFirstRun, firstRunHolder, releaseFirstRun, useFirstRunHolder } from "../../lib/firstRun";
import { isAutomated, isShown, isTourPage, knowsTheApp, readTour, tourDemo } from "../../lib/tour";
import { claimDailyShow, installDemo, isIosSafari, markDismissed, promptInstall, relatedAppInstalled, ruledOut, runningInstalled, useInstallState } from "../../lib/installNudge";

/** After the page is idle, wait this long before showing (the page settles first). */
export const NUDGE_DELAY_MS = 2500;
const SLOT = "install";

type Kind = "prompt" | "ios";

/** Runs `cb` once the page has loaded and the browser is idle. */
function whenIdle(cb: () => void): () => void {
  let cancel = () => {};
  const idle = () => {
    const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(cb, { timeout: 2000 }); cancel = () => w.cancelIdleCallback?.(id); }
    else { const id = window.setTimeout(cb, 300); cancel = () => window.clearTimeout(id); }
  };
  if (document.readyState === "complete") idle();
  else { window.addEventListener("load", idle, { once: true }); cancel = () => window.removeEventListener("load", idle); }
  return () => cancel();
}

/** Something else has the visitor's attention: typing, or a dialog, menu or sheet open. */
function busyElsewhere(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (a?.closest("input, textarea, select, [contenteditable=true]")) return true;
  for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')) if (isShown(el)) return true;
  return false;
}

export function InstallNudge() {
  const loc = useLocation();
  const { decided } = useConsent();
  const { state, user } = usePersonal();
  const holder = useFirstRunHolder();
  const { offer, record } = useInstallState();
  const [open, setOpen] = useState<Kind | null>(null);
  const [related, setRelated] = useState(false);
  // The page view (location key) in which another first-run surface held the slot: the nudge waits for the next one.
  const [yieldedOn, setYieldedOn] = useState<string | null>(null);
  const openedOn = useRef<string | null>(null);

  // Read the live holder: the tour may have let go in this same commit (it closes when the page changes).
  useEffect(() => {
    const h = firstRunHolder();
    if (h && h !== SLOT) setYieldedOn(loc.key);
  }, [holder, loc.key]);

  const automated = isAutomated() && !installDemo();
  const tourAutomated = isAutomated() && !tourDemo();
  // The tour hasn't happened yet and could open on this page: it goes first.
  const tourFirst = readTour() === null && !tourAutomated && !knowsTheApp(state, user) && isTourPage(loc.pathname);
  const kind: Kind | null = offer ? "prompt" : isIosSafari() ? "ios" : null;
  const eligible = !open && kind !== null && !automated && decided && !runningInstalled() && !related
    && !ruledOut(record) && !tourFirst && yieldedOn !== loc.key && (holder === null || holder === SLOT);

  useEffect(() => {
    if (!eligible || !kind) return;
    let cancelled = false;
    let timer = 0;
    const look = async () => {
      if (cancelled) return;
      if (busyElsewhere()) { timer = window.setTimeout(look, 500); return; }
      // Installed as an app the browser knows about (manifest related_applications): never.
      if (await relatedAppInstalled()) { if (!cancelled) setRelated(true); return; }
      if (cancelled || !claimFirstRun(SLOT)) return; // someone else got there first: re-checked when the slot frees
      // Today's showing, checked against storage again: another tab may have taken it meanwhile.
      // Writing the day can wait on another tab: if this page view is no longer the one, the day stays unused.
      if (!(await claimDailyShow(() => !cancelled))) { releaseFirstRun(SLOT); return; }
      openedOn.current = loc.pathname;
      setOpen(kind);
    };
    const cancelIdle = whenIdle(() => { timer = window.setTimeout(look, NUDGE_DELAY_MS); });
    return () => { cancelled = true; cancelIdle(); window.clearTimeout(timer); };
  }, [eligible, kind, loc.pathname]);

  const hide = () => { setOpen(null); openedOn.current = null; releaseFirstRun(SLOT); };

  // Ignored: gone when the visitor moves on. Answered elsewhere (another tab, an install): gone here too.
  useEffect(() => { if (open && openedOn.current !== null && loc.pathname !== openedOn.current) hide(); }, [loc.pathname, open]);
  useEffect(() => { if (open && (record.dismissed || record.installed || (open === "prompt" && !offer))) hide(); }, [open, record, offer]);
  useEffect(() => () => releaseFirstRun(SLOT), []);

  const dismiss = () => { markDismissed(); hide(); };
  const add = () => { void promptInstall(); hide(); };

  return (
    <AnimatePresence>
      {open && <NudgeCard kind={open} team={state.myTeam} signedIn={!!user} onAdd={add} onDismiss={dismiss} />}
    </AnimatePresence>
  );
}

/** The card itself. */
export function NudgeCard({ kind, team, signedIn, onAdd, onDismiss }: { kind: Kind; team: number | null; signedIn: boolean; onAdd: () => void; onDismiss: () => void }) {
  const titleId = useId();
  const bodyId = useId();
  // What the installed app opens to (start_url "/"): signed in with a team, Home goes straight to My team;
  // signed out, Home leads with the team's next match.
  const body = team == null ? "One tap from the stands to any team's stats and match odds."
    : signedIn ? `One tap from the stands, and it opens straight to team ${team}.`
    : `One tap from the stands to team ${team} and its next match.`;
  return (
    <m.section
      role="region" aria-labelledby={titleId} aria-describedby={bodyId}
      data-install-nudge={kind}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.2, ease: "easeOut" }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onDismiss(); } }}
      className="fixed inset-x-3 bottom-[calc(61px+env(safe-area-inset-bottom)+0.75rem)] z-[45] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] max-md:[[data-sticky-actions]_&]:bottom-[calc(61px+4rem+env(safe-area-inset-bottom)+0.75rem)] md:inset-x-auto md:bottom-4 md:left-4 md:w-[22rem]"
    >
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" width={36} height={36} className="mt-0.5 size-9 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="font-display text-sm font-semibold text-foreground">Put Control Scout on your home screen</h2>
          <p id={bodyId} className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {body}
            {kind === "ios" && <> Tap <Share className="inline size-3.5 -translate-y-px text-foreground" aria-label="Share" /> Share, then <span className="text-foreground">Add to Home Screen</span>.</>}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0 max-sm:size-10" aria-label="Dismiss" onClick={onDismiss}><X /></Button>
      </div>
      {kind === "prompt" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={onDismiss}>No thanks</Button>
          <Button size="sm" className="max-sm:h-10" onClick={onAdd}>Add to home screen</Button>
        </div>
      ) : (
        <div className="mt-3 flex justify-end">
          <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={onDismiss}>Got it</Button>
        </div>
      )}
    </m.section>
  );
}
