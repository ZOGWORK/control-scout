// First-run tour: one short tour, picked by the page it starts on (src/lib/tour.ts):
// search, then on a team page OPR vs Rating and saving the team, then
// highlights; an event page gets search and its recordings. It follows the
// visitor: a step that works anywhere (search) carries on on the next page; a
// step on the start page's own parts waits, visibly ("Tour paused"), until
// they go back. Leaving, closing the tab or a reload keep it paused at the same
// step; only Skip (×, Esc) or the last step's action end it for good.
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
import { useLocation, useNavigate } from "react-router-dom";
import { m } from "../motion";
import { X } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../cn";
import { useConsent } from "../../lib/consent";
import { usePersonal } from "../../lib/personal";
import { claimFirstRun, releaseFirstRun, useFirstRunHolder } from "../../lib/firstRun";
import { coversTour, endTour, findTarget, highlightsQuery, isAutomated, isShown, isTourPage, knowsTheApp, predictAction, readTour, rereadTour, resolveSteps, samePage, saveTour, searchHref, stepMode, tourDemo, tourKind, tourOver, tourTeam, TOUR_ASK, TOUR_CHANGE, TOUR_KEY, TOUR_STEPS, type TourRecord, type TourStep } from "../../lib/tour";

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

/** Decides whether and when the tour opens, follows it across pages, and keeps its record. */
export function FirstRunTour() {
  const loc = useLocation();
  const navigate = useNavigate();
  const { decided } = useConsent();
  const { state, user, providers, sync, syncReady } = usePersonal();
  const holder = useFirstRunHolder();
  const [rec, setRec] = useState<TourRecord | null>(() => readTour());
  const [view, setView] = useState<"card" | "pill" | null>(null);
  /** Bumped to look at the page again (Resume on the page it's already on). */
  const [nonce, setNonce] = useState(0);
  /** The page and step the card was opened for: a change looks again (the new page's data has to load). */
  const shownFor = useRef<string | null>(null);
  /** It has been on screen in this page's lifetime: a later page needs no long settle. */
  const seen = useRef(false);

  // Changed in another tab (finished, skipped, a step on): follow it here.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === TOUR_KEY) setRec(rereadTour()); };
    // Reset here ("Clear all local data"): it may show again, without a reload.
    const onChange = () => setRec(readTour());
    window.addEventListener("storage", onStorage);
    window.addEventListener(TOUR_CHANGE, onChange);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(TOUR_CHANGE, onChange); };
  }, []);

  const path = loc.pathname;
  // The page with its query: a different tab or season (Back/Forward, a shared link) is looked at again.
  const page = path + loc.search;
  const pathRef = useRef(path);
  pathRef.current = path;
  const pageRef = useRef(page);
  pageRef.current = page;
  const queryRef = useRef("");
  queryRef.current = new URLSearchParams(loc.search).get("q") ?? "";
  const automated = isAutomated() && !tourDemo();
  // Signed-in data (tracked teams, workspaces) arrives with /api/auth/me and the first sync: wait for both.
  // Signed in, only a sync that worked counts (a failed one leaves this device without the account's data).
  const settled = providers !== null && sync !== "syncing" && (!user || syncReady);
  const ready = !automated && decided && settled;
  const free = holder === null || holder === SLOT;
  const over = tourOver(rec);
  const running = !over && rec?.status === "paused" && rec.steps.length > 0;
  const stepId = running ? rec.steps[rec.step]! : null;
  const step = stepId ? TOUR_STEPS[stepId] : null;
  // Not started: a fresh visitor (or a replay waiting for a page) on a page it can start on.
  const startable = ready && !over && !running && (rec !== null || !knowsTheApp(state, user)) && isTourPage(path);
  // Running: this page can show the step (the start page's own parts are shown only there).
  const here = !!step && coversTour(path) && (!step.home || samePage(path, rec!.origin));
  const query = new URLSearchParams(loc.search).get("q") ?? "";
  const mode = stepId ? stepMode(stepId, path, query) : "point";

  // Ended (here or in another tab): close and give the slot back.
  useEffect(() => { if (!running && view) { setView(null); releaseFirstRun(SLOT); } }, [running, view]);

  // Start: once the page has loaded and settled, pick its steps. Its parts may render late (slow data): look
  // again a few times before waiting for the next page.
  const [retry, setRetry] = useState(0);
  useEffect(() => setRetry(0), [path]);
  useEffect(() => {
    if (!startable || !free) return;
    let again = 0;
    const stop = lookWhenSettled(retry ? START_RETRY_MS : seen.current ? FOLLOW_DELAY_MS : TOUR_DELAY_MS, true, () => {
      const ids = resolveSteps(path);
      // Nothing to point at yet (no search box), or a team page's own parts while it's still loading: look again.
      // A part the page will never have (no rating this season) doesn't hold the tour up.
      const partial = tourKind(path) === "team" && ids.length < 4 && !!document.querySelector(".skeleton, [aria-busy=true]");
      if ((!ids.length || partial) && retry < START_RETRIES) { again = window.setTimeout(() => setRetry((n) => n + 1), 0); return; }
      if (!ids.length) return;
      if (!claimFirstRun(SLOT)) return; // another first-run surface got there first: try again when it's gone
      // The page as it is now (its query may have changed while it waited), kept with its query (a season, a
      // tab) so going back for a step lands on the same view.
      shownFor.current = `${pageRef.current}|${stepMode(ids[0]!, pathRef.current, queryRef.current)}#0`;
      seen.current = true;
      setRec(saveTour({ status: "paused", step: 0, origin: pageRef.current, steps: ids }));
      setView("card");
    });
    return () => { stop(); window.clearTimeout(again); };
  }, [startable, free, path, retry]); // the query is read when it starts (pageRef), not watched

  // Running: show the step on this page, or wait visibly ("Tour paused") until a page that has it.
  useEffect(() => {
    if (!running || !step) return;
    // Not now (the owner console, another first-run surface up, consent pending): out of the way, slot given back.
    if (!ready || !free || samePage(path, "/owner")) { setView(null); shownFor.current = null; releaseFirstRun(SLOT); return; }
    const key = `${page}|${mode}#${rec!.step}`;
    if (!here) { shownFor.current = null; if (claimFirstRun(SLOT)) setView("pill"); return; }
    if (shownFor.current === key) return;
    setView(null);
    return lookWhenSettled(seen.current ? FOLLOW_DELAY_MS : TOUR_DELAY_MS, !seen.current, () => {
      if (!claimFirstRun(SLOT)) return;
      seen.current = true;
      shownFor.current = key;
      // The step's part isn't on this page after all: wait, paused, rather than point at nothing (a step that
      // runs a search shows docked instead: its button works from anywhere).
      setView(mode !== "point" || findTarget(step) ? "card" : "pill");
    });
  }, [running, step, here, path, page, mode, rec?.step, ready, free, nonce]);

  const finish = useCallback((status: "finished" | "skipped") => {
    setRec(endTour(status, readTour()?.step ?? 0));
    setView(null);
    shownFor.current = null;
    releaseFirstRun(SLOT);
  }, []);

  /** Came to the current step with Back: it doesn't move on by itself (Track already on). */
  const cameBack = useRef(false);
  const goTo = useCallback((n: number) => {
    const r = readTour();
    if (!r || r.status !== "paused" || n < 0 || n >= r.steps.length) return;
    cameBack.current = n < r.step;
    const there = !TOUR_STEPS[r.steps[n]!].home || samePage(pathRef.current, r.origin);
    // Moving on in place: the card stays up (no settle); else the next page is looked at once it loads.
    if (there) shownFor.current = `${pageRef.current}|${stepMode(r.steps[n]!, pathRef.current, queryRef.current)}#${n}`;
    setRec(saveTour({ ...r, step: n }));
    // A step on the start page's own parts, from elsewhere: go back there for it.
    if (!there) navigate(r.origin);
  }, [navigate]);

  // Save: the real Track tap is the step. Once the team is tracked (now, or already), move on; it stays tracked.
  const team = running ? tourTeam(rec!.origin) : null;
  const tracked = team != null && state.tracked.teams.includes(team);
  const onCard = view === "card";
  useEffect(() => {
    if (stepId !== "save" || !onCard || !tracked || cameBack.current) return;
    const t = window.setTimeout(() => goTo((readTour()?.step ?? 0) + 1), TRACKED_PAUSE_MS);
    return () => window.clearTimeout(t);
  }, [stepId, onCard, tracked, goTo]);

  useEffect(() => () => releaseFirstRun(SLOT), []);

  if (!running || !step || !view) return null;
  if (view === "pill") {
    return <TourPaused onResume={() => { shownFor.current = null; if (here) setNonce((x) => x + 1); else navigate(rec!.origin); }} onSkip={() => finish("skipped")} />;
  }
  const n = rec!.step;
  const count = rec!.steps.length;
  const origin = rec!.origin;
  const run = (q: string) => () => navigate(searchHref(q));
  const end = () => { const p = predictAction(origin); return { label: p.label, run: () => { finish("finished"); navigate(p.href); } }; };
  let primary: TourPrimary | null | undefined;
  let body: string | undefined;
  if (step.id === "search") primary = mode === "ask" ? { label: `Ask “${TOUR_ASK}”`, run: run(TOUR_ASK) } : undefined, body = mode === "answer" ? step.after : undefined;
  else if (step.id === "highlights") primary = mode === "ask" ? { label: "Show highlights", run: run(highlightsQuery(origin)) } : end();
  else if (step.id === "save") primary = tracked ? undefined : null;
  else if (step.id === "watch") { primary = end(); if (!document.querySelector("[data-watch-live]")) body = step.after; }
  return (
    <TourOverlay
      step={step} index={n} count={count} body={body} docked={mode === "answer" || (mode === "ask" && !findTarget(step))} primary={primary}
      onNext={() => (n === count - 1 ? finish("finished") : goTo(n + 1))}
      onBack={() => goTo(n - 1)}
      onSkip={() => finish("skipped")}
      onLost={() => { shownFor.current = null; setNonce((x) => x + 1); }}
    />
  );
}

/** Looking again for a page's parts while it's still loading: this often, this many times (about 10 s). */
const START_RETRY_MS = 1000;
const START_RETRIES = 8;

/** Track tapped: long enough to see it switch to "Tracking" before the tour moves on. */
export const TRACKED_PAUSE_MS = 900;

/** A later page in a running tour: a short settle, then look (its data has to load first). */
const FOLLOW_DELAY_MS = 300;

/**
 * Once the page has loaded and the browser is idle, wait `delay`, then call `cb` when nothing is loading
 * (skeletons, aria-busy; at most LOADING_CAP_MS) and, when `polite`, the visitor isn't typing or in a dialog.
 */
function lookWhenSettled(delay: number, polite: boolean, cb: () => void): () => void {
  let cancelled = false;
  let timer = 0;
  const t0 = Date.now();
  const look = () => {
    if (cancelled) return;
    const loading = document.querySelector(".skeleton, [aria-busy=true]") && Date.now() - t0 < LOADING_CAP_MS;
    if (loading || (polite && busyElsewhere())) { timer = window.setTimeout(look, 300); return; }
    cb();
  };
  const cancelIdle = whenIdle(() => { timer = window.setTimeout(look, delay); });
  return () => { cancelled = true; cancelIdle(); window.clearTimeout(timer); };
}

/** The tour waiting on a page without its step: small, out of the way, one tap to pick it up again. */
function TourPaused({ onResume, onSkip }: { onResume: () => void; onSkip: () => void }) {
  return createPortal(
    <div role="status" data-tour-paused=""
      className="fixed left-3 right-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[45] flex items-center gap-1 rounded-xl border border-border bg-popover py-1 pl-3 pr-1 text-sm text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] max-md:[[data-sticky-actions]_&]:bottom-[calc(var(--tabbar-h)+4rem+env(safe-area-inset-bottom)+0.75rem)] md:right-auto md:bottom-6 md:left-4">
      <span className="min-w-0 flex-1 font-medium">Tour paused</span>
      <Button size="sm" variant="ghost" className="text-accent-text max-sm:h-11" onClick={onResume}>Pick up where you left off</Button>
      <Button variant="ghost" size="icon-sm" className="max-sm:size-11" aria-label="Skip the tour" onClick={onSkip}><X /></Button>
    </div>,
    document.body,
  );
}

/** What the card's main button does on this step (null: the step's action is on the page itself, e.g. Track). */
export interface TourPrimary { label: string; run: () => void }

/**
 * The step card. Pointing ("point", "ask"): the page is dimmed around a spotlight on the step's part, and
 * only that part (and search, while typing a question) takes clicks. Docked ("answer"): no dimming, the card
 * sits at the bottom out of the way, and the page is free to use (scroll the answer, tap a follow-up).
 */
export function TourOverlay({ step, index: i, count, body, docked = false, primary, onNext, onBack, onSkip, onLost }: {
  step: TourStep; index: number; count: number; body?: string; docked?: boolean;
  /** Undefined: Next (Done on the last step). Null: no main button, only a quiet Next. */
  primary?: TourPrimary | null;
  onNext: () => void; onBack: () => void; onSkip: () => void;
  /** Its part left the page (a tab changed under it): the tour looks again (paused when it's gone). */
  onLost?: () => void;
}) {
  const last = i === count - 1;
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [view, setView] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  /** Typing in search (the step's own box): the card and dimming step aside so the suggestions show. */
  const [typing, setTyping] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const reduced = reducedMotion();
  const lost = useRef(onLost);
  lost.current = onLost;
  const main: TourPrimary | null = primary === undefined ? { label: last ? "Done" : "Next", run: onNext } : primary;
  // The step's action is on the page itself (Track): a quiet Next lets the visitor move on without it.
  const quietNext = primary === null;

  const go = useCallback(() => { if (main) main.run(); else onNext(); }, [main, onNext]);
  // ←/→ still move between steps when the step's main button is an action (keyboard users aren't held to it);
  // the last step ends only with its action (or Skip).
  const next = useCallback(() => { if (!last || primary === undefined) onNext(); }, [last, primary, onNext]);
  const back = useCallback(() => { if (i > 0) onBack(); }, [i, onBack]);
  const skip = onSkip;

  // Focus: into the card on open, back to where it was on close.
  useEffect(() => {
    restoreTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { const el = restoreTo.current; if (el?.isConnected) el.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { (primaryRef.current ?? cardRef.current)?.focus({ preventScroll: true }); }, [i, docked]);

  // Bring the target into view, then follow it (scrolling, resizing, layout shifts) until it settles.
  useLayoutEffect(() => {
    if (docked) { setBox(null); return; }
    let el = findTarget(step);
    if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    let raf = 0;
    let until = performance.now() + 900;
    let had = !!el;
    const measure = () => {
      if (!el || !el.isConnected) el = findTarget(step);
      // A resize can swap which copy is shown (the phone search button for the desktop field).
      else if (el.getBoundingClientRect().width === 0) el = findTarget(step);
      if (had && !el) { had = false; lost.current?.(); }
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
  }, [step, reduced, docked]);

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
  }, [i, docked]);

  // Pointing: clicks reach only the spotlit part, search (its suggestions included) and the card itself; the
  // rest of the page waits until the tour moves on. Docked: the page is free.
  useEffect(() => {
    if (docked) return;
    const allowed = (t: EventTarget | null) => {
      if (!(t instanceof Element)) return false;
      if (t.closest("[data-tour-card], [data-search-box], [data-tour-paused]")) return true;
      const el = findTarget(step);
      return !!el && el.contains(t);
    };
    const stop = (e: Event) => { if (!allowed(e.target)) { e.preventDefault(); e.stopPropagation(); } };
    const opts = { capture: true };
    for (const type of ["pointerdown", "mousedown", "click"]) document.addEventListener(type, stop, opts);
    return () => { for (const type of ["pointerdown", "mousedown", "click"]) document.removeEventListener(type, stop, opts); };
  }, [docked, step]);

  // Typing a question into the spotlit search: step aside until focus leaves it.
  useEffect(() => {
    if (docked || (step.id !== "search" && step.id !== "highlights")) { setTyping(false); return; }
    const check = () => setTyping(!!(document.activeElement as Element | null)?.closest("[data-search-box]"));
    let t = 0;
    const later = () => { window.clearTimeout(t); t = window.setTimeout(check, 0); };
    check();
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => { window.clearTimeout(t); document.removeEventListener("focusin", check); document.removeEventListener("focusout", later); };
  }, [docked, step.id]);

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
    if (e.key === "Enter" && e.target === e.currentTarget) { e.preventDefault(); go(); return; }
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")];
    if (!items.length) return;
    const first = items[0]!, end = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); end.focus(); }
    else if (!e.shiftKey && document.activeElement === end) { e.preventDefault(); first.focus(); }
  };

  // Where the card goes: beside the target (below if it fits, else whichever side has more room), kept on screen.
  const width = Math.min(360, view.w - GUTTER * 2);
  let top = 0, left = 0;
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

  const cardEl = (
    <m.div
      ref={cardRef}
      key={`${step.id}:${docked ? "d" : "p"}`}
      role="dialog" aria-modal={docked ? undefined : "true"} aria-labelledby={titleId} aria-describedby={bodyId}
      tabIndex={-1} onKeyDown={onCardKey}
      data-tour-card="" data-tour-step={step.id} data-tour-docked={docked ? "" : undefined}
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}
      className={cn(
        "rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-[0_18px_40px_-16px_rgba(0,0,0,.55)] outline-none",
        docked
          ? "fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[65] md:inset-x-auto md:bottom-6 md:right-6 md:w-[360px]"
          : cn("absolute", slide && "transition-[top,left] duration-300 ease-out"),
      )}
      style={docked ? undefined : { top, left, width }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground" aria-hidden>Step {i + 1} of {count}</p>
          <h2 id={titleId} className="mt-0.5 font-display text-base font-semibold text-foreground">
            <span className="sr-only">Step {i + 1} of {count}:</span> {step.title}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" className="-mr-1 -mt-1 shrink-0 max-sm:size-11" aria-label="Skip the tour" title="Skip tour" onClick={skip}><X /></Button>
      </div>
      <p id={bodyId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body ?? step.body}</p>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <div className="mr-auto flex gap-1.5" aria-hidden>
          {Array.from({ length: count }, (_, n) => <span key={n} className={cn("h-1.5 rounded-full", n === i ? "w-4 bg-accent" : "w-1.5 bg-text-base/20")} />)}
        </div>
        {i === 0
          ? <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={skip}>Skip tour</Button>
          : <Button variant="secondary" size="sm" className="max-sm:h-11" onClick={back}>Back</Button>}
        {quietNext && <Button ref={main ? undefined : primaryRef} variant="ghost" size="sm" className="max-sm:h-11" onClick={onNext}>Next</Button>}
        {main && <Button ref={primaryRef} size="sm" className="max-sm:h-11" onClick={main.run}>{main.label}</Button>}
      </div>
    </m.div>
  );

  if (docked) return createPortal(<div data-tour-overlay="">{cardEl}</div>, document.body);
  return createPortal(
    <div data-tour-overlay="" className={cn("pointer-events-none fixed inset-0 z-[65]", typing && "invisible")}>
      {box ? (
        <div aria-hidden data-tour-spotlight="" className={cn("absolute rounded-xl", slide)}
          style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2, boxShadow: SCRIM_SHADOW }} />
      ) : <div aria-hidden className="absolute inset-0 bg-black/55" />}
      <div className="pointer-events-auto">{cardEl}</div>
    </div>,
    document.body,
  );
}
