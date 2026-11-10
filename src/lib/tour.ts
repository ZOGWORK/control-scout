// The first-run tour (src/components/layout/FirstRunTour.tsx): what it says,
// what it points at, and who sees it. One short tour, at most four steps,
// picked by the page it starts on: a team page gets all four, an event page
// or any other page two. Its record, `cs-tour` (Tier 3, device-only;
// docs/settings.md), is "paused" while it runs (leaving the page, closing the
// tab or a reload all keep it there, at the same step) and only an explicit
// Skip or the last step's action ends it for good. Not synced: someone signed
// in on a second device who has used the app has tracked teams, a team of
// their own or a workspace, and `knowsTheApp` already keeps the tour away.
import type { PersonalState } from "../shared/personal";
import type { AccountUser } from "./personal";

export const TOUR_KEY = "cs-tour";
/**
 * Automation opt-in: browsers driven by tools (Playwright, Lighthouse) never get the tour,
 * so screenshots and audits stay clean. Setting this key to "1" lets one see it anyway
 * (`npm run shots -- --tour`). It doesn't bring back a tour that was finished or skipped.
 */
export const TOUR_DEMO_KEY = "cs-tour-demo";
/** Fired on window when this tab changes the record (resetTour), so an open app can follow. */
export const TOUR_CHANGE = "cs-tour-change";

export type TourStatus = "paused" | "finished" | "skipped";
export type TourStepId = "search" | "rating" | "save" | "highlights" | "watch";
export interface TourRecord {
  v: 2;
  status: TourStatus;
  at: string;
  /** The step (0-based, into `steps`) it's on, or ended on. */
  step: number;
  /** The page it started on, with its query: steps that point at that page's own parts are shown there. */
  origin: string;
  /** Its steps, chosen when it started (empty: not started yet, e.g. a replay waiting for a page). */
  steps: TourStepId[];
}

const STEP_IDS = new Set<string>(["search", "rating", "save", "highlights", "watch"]);
// The record when saving failed (storage blocked or full): it holds for this page's lifetime.
let memory: TourRecord | null = null;

function parse(raw: string | null): TourRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    if (!r || typeof r !== "object") return null;
    if (r.v === 1) {
      // The old build wrote "skipped" at step 0 whenever someone just navigated away: not a real skip, so
      // those people get the new tour once. A real Skip or Done (step 1+) still counts.
      if (r.outcome === "skipped" && !Number(r.step)) return null;
      if (r.outcome !== "done" && r.outcome !== "skipped") return null;
      return { v: 2, status: r.outcome === "done" ? "finished" : "skipped", at: String(r.at ?? ""), step: Math.max(0, Number(r.step) - 1), origin: "/", steps: [] };
    }
    if (r.v !== 2 || (r.status !== "paused" && r.status !== "finished" && r.status !== "skipped")) return null;
    const steps = Array.isArray(r.steps) ? r.steps.filter((s): s is TourStepId => typeof s === "string" && STEP_IDS.has(s)) : [];
    const step = Math.max(0, Math.min(Math.floor(Number(r.step) || 0), Math.max(0, steps.length - 1)));
    return { v: 2, status: r.status, at: String(r.at ?? ""), step, origin: typeof r.origin === "string" && r.origin.startsWith("/") ? r.origin : "/", steps };
  } catch { return null; }
}

/** The tour's record on this device: null when it has never started. */
export function readTour(): TourRecord | null {
  if (memory) return memory;
  try { return parse(localStorage.getItem(TOUR_KEY)); } catch { return null; }
}

/** Another tab wrote it (a storage event): read what's stored, not this tab's copy. */
export function rereadTour(): TourRecord | null {
  memory = null;
  return readTour();
}

/** Finished or skipped: it never shows on its own again here. */
export const tourOver = (r: TourRecord | null) => r?.status === "finished" || r?.status === "skipped";

/** Write the record (kept in memory too, so blocked storage still holds for this page's lifetime). */
export function saveTour(r: Omit<TourRecord, "v" | "at">): TourRecord {
  const rec: TourRecord = { v: 2, at: new Date().toISOString(), ...r };
  memory = rec;
  try { localStorage.setItem(TOUR_KEY, JSON.stringify(rec)); } catch { /* storage blocked: holds for this page view */ }
  return rec;
}

/** End it for good: the last step's action ("finished") or an explicit Skip. */
export function endTour(status: "finished" | "skipped", step: number): TourRecord {
  const r = readTour();
  return saveTour({ status, step, origin: r?.origin ?? "/", steps: r?.steps ?? [] });
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
 * a shortlist, or (signed in) a Control Point workspace. Keeps a tour from starting, never
 * stops one that's running (tracking a team is one of its steps).
 */
export function knowsTheApp(state: Pick<PersonalState, "myTeam" | "tracked" | "bookmarks">, user: AccountUser | null): boolean {
  if (state.myTeam != null || state.tracked.teams.length > 0 || state.tracked.events.length > 0 || state.bookmarks.length > 0) return true;
  return (user?.controlPoint?.workspaces?.length ?? 0) > 0;
}

const trim = (p: string) => p.replace(/\/+$/, "") || "/";

/**
 * Pages a first-timer lands on from a search engine or a shared link: the tour may start there.
 * Not on settings, scouting, the owner portal or the legal pages.
 */
export function isTourPage(pathname: string): boolean {
  const p = trim(pathname);
  return p === "/" || /^\/(teams|events|matches|compare|predict)$/i.test(p) || /^\/teams\/\d+$/i.test(p) || /^\/events\/\d{4}\/[^/]+$/i.test(p);
}

/** Pages a running tour carries on over: its start pages and search's results. Elsewhere it waits, paused. */
export const coversTour = (pathname: string) => isTourPage(pathname) || trim(pathname) === "/search";

/** The same page, whatever its query (a start page is kept with its query: `/teams/4215?season=2024`). */
const pathOf = (p: string) => trim(p.replace(/[?#].*$/, ""));
export const samePage = (a: string, b: string) => pathOf(a).toLowerCase() === pathOf(b).toLowerCase();

export type TourKind = "team" | "event" | "other";
/** Which tour a page gets: a team page's (four steps), an event page's, or everyone else's. */
export function tourKind(pathname: string): TourKind {
  const p = trim(pathname);
  if (/^\/teams\/\d+$/i.test(p)) return "team";
  if (/^\/events\/\d{4}\/[^/]+$/i.test(p)) return "event";
  return "other";
}

export interface TourStep {
  id: TourStepId;
  /** 2–5 words. */
  title: string;
  /** One sentence, at most 25 words. */
  body: string;
  /** Where it points: the first of these selectors with a visible element wins. */
  targets: string[];
  /** Points at the start page's own parts: shown only there (elsewhere the tour waits, paused). */
  home: boolean;
}

/** Every step. A tour is some of them, in this order (stepsFor). */
export const TOUR_STEPS: Record<TourStepId, TourStep> = {
  search: {
    id: "search",
    title: "Ask it a question",
    body: "Type a question in plain words, like who won a season or a team's awards, and search answers it.",
    targets: ['[data-tour="search"]'],
    home: false,
  },
  rating: {
    id: "rating",
    title: "OPR and Rating",
    body: "OPR is what this robot has scored; Rating is what it should add to an alliance now, and Rating drives the win odds.",
    targets: ['[data-tour="rating"]'],
    home: true,
  },
  save: {
    id: "save",
    title: "Save this team",
    body: "Track follows this team on My team and puts it first in search; My team marks your own, Shortlist builds a pick list.",
    targets: ['[data-tour="save"]'],
    home: true,
  },
  highlights: {
    id: "highlights",
    title: "Highlights, then predict",
    body: "Search for highlights to see a team's best matches; most events have no recording yet, so many show stats only.",
    targets: ['[data-tour="search"]'],
    home: false,
  },
  watch: {
    id: "watch",
    title: "Watch, then predict",
    body: "A recorded event has one full video, and each match's Watch button jumps to it; most events have no recording yet.",
    targets: ["[data-watch-live]", '[data-tour="event-matches"]'],
    home: true,
  },
};

const BY_KIND: Record<TourKind, TourStepId[]> = {
  team: ["search", "rating", "save", "highlights"],
  event: ["search", "watch"],
  other: ["search", "highlights"],
};

/** Shown on screen: laid out, not hidden, not inert. */
export function isShown(el: Element): boolean {
  if (!el.isConnected || el.closest("[inert], [aria-hidden=true]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

/** The element a step points at right now (null: none on this page). */
export function findTarget(step: TourStep, root: ParentNode = document): HTMLElement | null {
  for (const sel of step.targets) {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) if (isShown(el)) return el;
  }
  return null;
}

/**
 * The tour a page gets: its kind's steps whose target is on screen. Empty (wait for another page)
 * without search to start on or with fewer than two steps.
 */
export function resolveSteps(pathname: string, root: ParentNode = document): TourStepId[] {
  const ids = BY_KIND[tourKind(pathname)].filter((id) => findTarget(TOUR_STEPS[id], root) !== null);
  return ids[0] === "search" && ids.length >= 2 ? ids : [];
}
