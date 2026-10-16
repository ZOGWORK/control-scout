// First-run tour: three or four short steps for someone who has never seen the
// app (most first visits land on a team page from a search engine). A welcome,
// then a spotlight on search, on Track (team pages), and on predictions. Steps
// whose target isn't on the page are left out. Shown once per device: Done,
// Skip, Esc or leaving the page ends it for good (src/lib/tour.ts).
//
// When: after the privacy choice is made (the banner sits where the tour
// would), once the page's data has loaded, and only while no other first-run
// surface is up (src/lib/firstRun.ts). Never to crawlers or automated
// browsers (screenshots, audits), nor to anyone who clearly knows the app.
//
// Keyboard: focus moves into the card (the primary button); Tab cycles inside
// it while focus is there; ←/→ step back and forth, Enter on the card goes on,
// Esc skips. Focus goes back where it was when the tour ends. Reduced motion:
// no smooth scrolling and no sliding spotlight.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../cn";
import { useConsent } from "../../lib/consent";
import { usePersonal } from "../../lib/personal";
import { claimFirstRun, releaseFirstRun, useFirstRunHolder } from "../../lib/firstRun";
import { MIN_POINTING_STEPS, endTour, findTarget, isAutomated, isShown, isTourPage, knowsTheApp, readTour, resolveSteps, tourDemo, TOUR_CHANGE, TOUR_KEY, type TourOutcome, type TourStep } from "../../lib/tour";

/** After the page is idle, wait this long before opening (the page settles; no flash on a bounce). */
export const TOUR_DELAY_MS = 900;
/** Give up waiting for skeletons after this long and look at what's there. */
const LOADING_CAP_MS = 6000;
const SLOT = "tour";

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;
const GUTTER = 16;
const GAP = 12;
/** The dimmed page around the spotlight: one shadow far wider than any screen (after a 2 px accent ring). */
const SCRIM_SHADOW = "0 0 0 2px var(--color-accent), 0 0 0 200vmax rgb(0 0 0 / 0.55)";

const sameBox = (a: Box | null, b: Box | null) => a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

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

/** Something else has the visitor's attention right now: typing, or a dialog/menu/sheet open. */
function busyElsewhere(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (a?.closest("input, textarea, select, [contenteditable=true]")) return true;
  // Any dialog, menu or sheet on screen (Radix ones and the app's own panels alike), other than the tour's.
  for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]')) {
    if (!el.closest("[data-tour-overlay]") && isShown(el)) return true;
  }
  return false;
}

/** Typing in a field: its own keys (arrows move the cursor, Esc clears) aren't the tour's. */
const editable = (t: EventTarget | null) => t instanceof Element && !!t.closest("input, textarea, select, [contenteditable=true]");

/** Decides whether and when the tour opens, and records how it ended. */
export function FirstRunTour() {
  const loc = useLocation();
  const { decided } = useConsent();
  const { state, user, providers, sync, syncReady } = usePersonal();
  const holder = useFirstRunHolder();
  const [ended, setEnded] = useState(() => readTour() !== null);
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const startedOn = useRef<string | null>(null);

  // Finished or skipped in another tab: close here too.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if ((e.key === null || e.key === TOUR_KEY) && readTour()) { setEnded(true); setSteps(null); releaseFirstRun(SLOT); } };
    // Reset here ("Clear all local data"): it may show again, without a reload.
    const onChange = () => setEnded(readTour() !== null);
    window.addEventListener("storage", onStorage);
    window.addEventListener(TOUR_CHANGE, onChange);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(TOUR_CHANGE, onChange); };
  }, []);

  const automated = isAutomated() && !tourDemo();
  // Signed-in data (tracked teams, workspaces) arrives with /api/auth/me and the first sync: wait for both.
  // Signed in, only a sync that worked counts (a failed one leaves this device without the account's data).
  const settled = providers !== null && sync !== "syncing" && (!user || syncReady);
  const eligible = !ended && !steps && !automated && decided && settled && !knowsTheApp(state, user)
    && isTourPage(loc.pathname) && (holder === null || holder === SLOT);

  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    let timer = 0;
    const t0 = Date.now();
    const look = () => {
      if (cancelled) return;
      const loading = document.querySelector(".skeleton, [aria-busy=true]") && Date.now() - t0 < LOADING_CAP_MS;
      if (loading || busyElsewhere()) { timer = window.setTimeout(look, 300); return; }
      const found = resolveSteps(document);
      // Not enough to point at on this page: wait for the next one.
      if (found.filter((s) => s.targets.length > 0).length < MIN_POINTING_STEPS) return;
      if (!claimFirstRun(SLOT)) return; // another first-run surface got there first: try again when it's gone
      startedOn.current = loc.pathname;
      setSteps(found);
    };
    const cancelIdle = whenIdle(() => { timer = window.setTimeout(look, TOUR_DELAY_MS); });
    return () => { cancelled = true; cancelIdle(); window.clearTimeout(timer); };
  }, [eligible, loc.pathname]);

  const finish = useCallback((outcome: TourOutcome, step: number) => {
    endTour(outcome, step);
    setEnded(true);
    setSteps(null);
    releaseFirstRun(SLOT);
  }, []);

  // Leaving the page it opened on ends it (it points at that page's buttons).
  useEffect(() => {
    if (steps && startedOn.current !== null && loc.pathname !== startedOn.current) finish("skipped", 0);
  }, [loc.pathname, steps, finish]);

  useEffect(() => () => releaseFirstRun(SLOT), []);

  if (!steps) return null;
  return <TourOverlay steps={steps} onEnd={finish} />;
}

/** The overlay itself: dimmed page, a spotlight on the step's target, and the step card. */
export function TourOverlay({ steps, onEnd }: { steps: TourStep[]; onEnd: (outcome: TourOutcome, step: number) => void }) {
  const [i, setI] = useState(0);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const reduced = reducedMotion();

  const next = useCallback(() => { if (last) onEnd("done", steps.length); else setI((n) => Math.min(n + 1, steps.length - 1)); }, [last, onEnd, steps.length]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);
  const skip = useCallback(() => onEnd("skipped", i + 1), [onEnd, i]);

  // Focus: into the card on open, back to where it was on close.
  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { const el = restoreTo.current; if (el?.isConnected) el.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { primaryRef.current?.focus({ preventScroll: true }); }, [i]);

  // Bring the target into view, then follow it (scrolling, resizing, layout shifts) until it settles.
  useLayoutEffect(() => {
    let el = findTarget(step);
    if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    let raf = 0;
    let until = performance.now() + 900;
    const measure = () => {
      if (!el || !el.isConnected) el = findTarget(step);
      // A resize can swap which copy is shown (the phone search button for the desktop field).
      else if (el.getBoundingClientRect().width === 0) el = findTarget(step);
      const r = el?.getBoundingClientRect();
      const b = r ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } : null;
      setBox((prev) => (sameBox(prev, b) ? prev : b));
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }));
    };
    const loop = () => { measure(); if (performance.now() < until) raf = requestAnimationFrame(loop); };
    loop();
    const follow = () => { until = performance.now() + 250; cancelAnimationFrame(raf); loop(); };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", follow); window.removeEventListener("scroll", follow, true); };
  }, [step, reduced]);

  // The card's own size, for placing it beside the target.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const read = () => setCard((c) => (c.width === el.offsetWidth && c.height === el.offsetHeight ? c : { width: el.offsetWidth, height: el.offsetHeight }));
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [i]);

  // Keys anywhere on the page while the tour is open (a prompt that handles its own Esc stops it first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || editable(e.target)) return;
      if (e.key === "Escape") { e.preventDefault(); skip(); }
      else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); back(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, back, skip]);

  // Tab stays inside the card while focus is in it (polite: focus that moved elsewhere, e.g. an error prompt, isn't pulled back).
  const onCardKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); next(); return; }
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
    if (!items.length) return;
    const first = items[0]!, end = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
  };

  // Where the card goes: beside the target (below if it fits, else whichever side has more room), kept on screen.
  const width = Math.min(360, view.w - GUTTER * 2);
  let top: number, left: number;
  if (!box) {
    top = Math.max(GUTTER, (view.h - card.height) / 2);
    left = (view.w - width) / 2;
  } else {
    const below = view.h - (box.top + box.height + PAD) - GAP;
    const above = box.top - PAD - GAP;
    const under = below >= card.height + GUTTER || below >= above;
    top = under ? box.top + box.height + PAD + GAP : box.top - PAD - GAP - card.height;
    top = Math.min(Math.max(top, 8), Math.max(8, view.h - card.height - 8));
    left = Math.min(Math.max(box.left + box.width / 2 - width / 2, GUTTER), view.w - GUTTER - width);
  }
  const slide = reduced ? "" : "transition-[top,left,width,height] duration-300 ease-out";
  const pointing = step.targets.length > 0;

  return createPortal(
    <div data-tour-overlay="" className="fixed inset-0 z-[65]">
      {/* Clicks on the page wait until the tour is closed. */}
      <div className="absolute inset-0" aria-hidden onPointerDown={(e) => e.preventDefault()} />
      {box ? (
        <div aria-hidden data-tour-spotlight="" className={cn("pointer-events-none absolute rounded-xl", slide)}
          style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2, boxShadow: SCRIM_SHADOW }} />
      ) : <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/55" />}
      <motion.div
        ref={cardRef}
        key={step.id}
        role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}
        tabIndex={-1} onKeyDown={onCardKey}
        data-tour-card="" data-tour-step={step.id}
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
        className={cn("absolute rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] outline-none", slide && "transition-[top,left] duration-300 ease-out")}
        style={{ top, left, width }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground" aria-hidden>Step {i + 1} of {steps.length}</p>
            <h2 id={titleId} className="mt-0.5 font-display text-base font-semibold text-foreground">
              <span className="sr-only">Step {i + 1} of {steps.length}:</span> {step.title}
            </h2>
          </div>
          <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0 max-sm:size-10" aria-label="Skip the tour" onClick={skip}><X /></Button>
        </div>
        <p id={bodyId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <div className="flex flex-1 gap-1.5" aria-hidden>
            {steps.map((s, n) => <span key={s.id} className={cn("h-1.5 rounded-full", n === i ? "w-4 bg-accent" : "w-1.5 bg-text-base/20")} />)}
          </div>
          {i === 0
            ? <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={skip}>Skip</Button>
            : <Button variant="secondary" size="sm" className="max-sm:h-10" onClick={back}>Back</Button>}
          <Button ref={primaryRef} size="sm" className="max-sm:h-10" onClick={next}>{last ? "Got it" : i === 0 ? "Show me" : "Next"}</Button>
        </div>
        {!pointing && <p className="sr-only">Use the arrow keys to move between steps, or Escape to close.</p>}
      </motion.div>
    </div>,
    document.body,
  );
}
