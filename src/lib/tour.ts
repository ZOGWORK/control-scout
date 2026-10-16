// The first-run tour (src/components/layout/FirstRunTour.tsx): what it says,
// what it points at, and who sees it. It's shown once per device: finishing
// or skipping it writes `cs-tour` (Tier 3, device-only; docs/settings.md) and
// it never shows again. Not synced: someone signed in on a second device who
// has used the app has tracked teams, a team of their own or a workspace,
// and `knowsTheApp` already keeps the tour away from them.
import type { PersonalState } from "../shared/personal";
import type { AccountUser } from "./personal";

export const TOUR_KEY = "cs-tour";
/**
 * Automation opt-in: browsers driven by tools (Playwright, Lighthouse) never get the tour,
 * so screenshots and audits stay clean. Setting this key to "1" lets one see it anyway
 * (`npm run shots -- --tour`). It doesn't bring back a tour that was finished or skipped.
 */
export const TOUR_DEMO_KEY = "cs-tour-demo";
/** Fired on window when this tab resets the record (resetTour), so an open app can offer the tour again. */
export const TOUR_CHANGE = "cs-tour-change";

export type TourOutcome = "done" | "skipped";
export interface TourRecord { v: 1; outcome: TourOutcome; at: string; /** The step it ended on (1-based). */ step: number }

// The outcome when saving failed (storage blocked or full): the tour still stays closed for this page's lifetime.
let memory: TourRecord | null = null;

function parse(raw: string | null): TourRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Partial<TourRecord>;
    return r && r.v === 1 && (r.outcome === "done" || r.outcome === "skipped") ? { v: 1, outcome: r.outcome, at: String(r.at ?? ""), step: Number(r.step) || 0 } : null;
  } catch { return null; }
}

/** How the tour ended on this device, or null when it hasn't yet. */
export function readTour(): TourRecord | null {
  if (memory) return memory;
  try { return parse(localStorage.getItem(TOUR_KEY)); } catch { return null; }
}

/** Remember that the tour was finished or skipped: it never shows on this device again. */
export function endTour(outcome: TourOutcome, step: number): TourRecord {
  const r: TourRecord = { v: 1, outcome, at: new Date().toISOString(), step };
  memory = r;
  try { localStorage.setItem(TOUR_KEY, JSON.stringify(r)); } catch { /* storage blocked: closed for this page view */ }
  return r;
}

/** Forget it (Settings' "Clear all local data", tests): the tour may show again. */
export function resetTour(): void {
  memory = null;
  try { localStorage.removeItem(TOUR_KEY); } catch { /* storage blocked */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TOUR_CHANGE));
}

// Crawlers, link previews, Lighthouse/PageSpeed and headless browsers.
const BOT_UA = /bot\b|bot\/|crawl|spider|slurp|lighthouse|pagespeed|headlesschrome|phantomjs|prerender|facebookexternalhit|embedly|whatsapp|preview|google-inspectiontool|chrome-lighthouse/i;

/** A browser that isn't a person: a crawler, a link preview, or one driven by automation (navigator.webdriver). */
export function isAutomated(nav: Pick<Navigator, "userAgent"> & { webdriver?: boolean } = navigator): boolean {
  return nav.webdriver === true || BOT_UA.test(nav.userAgent ?? "");
}

/** The automation opt-in (`cs-tour-demo` = "1"). */
export function tourDemo(): boolean {
  try { return localStorage.getItem(TOUR_DEMO_KEY) === "1"; } catch { return false; }
}

/**
 * Someone who clearly knows the app already: a team of their own, tracked teams or events,
 * a shortlist, or (signed in) a Control Point workspace.
 */
export function knowsTheApp(state: Pick<PersonalState, "myTeam" | "tracked" | "bookmarks">, user: AccountUser | null): boolean {
  if (state.myTeam != null || state.tracked.teams.length > 0 || state.tracked.events.length > 0 || state.bookmarks.length > 0) return true;
  return (user?.controlPoint?.workspaces?.length ?? 0) > 0;
}

/**
 * Pages a first-timer lands on from a search engine or a shared link: the tour may start there.
 * Not on settings, scouting, the owner portal or the legal pages.
 */
export function isTourPage(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/" || /^\/(teams|events|matches|compare|predict)$/i.test(p) || /^\/teams\/\d+$/i.test(p) || /^\/events\/\d{4}\/[^/]+$/i.test(p);
}

export type TourStepId = "welcome" | "search" | "track" | "predict";
export interface TourStep {
  id: TourStepId;
  title: string;
  body: string;
  /** Where it points: the first of these selectors with a visible element wins. None: a centred card. */
  targets: string[];
}

/** Every step, in order. A step whose target isn't on the page is left out (resolveSteps). */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to Control Scout",
    body: "Stats and match predictions for every FTC team. It's free and you don't need an account. Here's a quick look around.",
    targets: [],
  },
  {
    id: "search",
    title: "Find any team",
    body: "Search by team number or name, an event, or a match. Typos are fine.",
    targets: ['[data-tour="search"]'],
  },
  {
    id: "track",
    title: "Follow a team",
    body: "Tap Track to follow this team. It goes on your My team page and comes first when you search. No sign-up needed.",
    targets: ['[data-tour="track"]'],
  },
  {
    id: "predict",
    title: "See who's likely to win",
    body: "Pick any teams to get the odds for a match, and how sure we are. Every prediction is checked after the match is played.",
    // The page's own button (a team page's "Predict a match with …", Home's "Predict a match"), else Predict in the nav.
    targets: ['[data-tour="predict"]', 'nav[aria-label="Main"] a[href="/predict"]'],
  },
];

/** Shown on screen: laid out, not hidden, not inert. */
export function isShown(el: Element): boolean {
  if (!el.isConnected || el.closest("[inert], [aria-hidden=true]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

/** The element a step points at right now (null: none on this page, or a step with no target). */
export function findTarget(step: TourStep, root: ParentNode = document): HTMLElement | null {
  for (const sel of step.targets) {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) if (isShown(el)) return el;
  }
  return null;
}

/** The steps this page can show: the welcome, then each step whose target is on screen. */
export function resolveSteps(root: ParentNode = document, steps: TourStep[] = TOUR_STEPS): TourStep[] {
  return steps.filter((s) => s.targets.length === 0 || findTarget(s, root) !== null);
}

/** At least this many pointing steps, or the tour waits for a page that has them. */
export const MIN_POINTING_STEPS = 2;
