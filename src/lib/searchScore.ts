// Search's time to answer and how each search ends, measured on the results page (src/pages/SearchPage.tsx) and sent
// as one anonymous beacon per search (src/shared/searchScore.ts, server/searchScore.ts). Sent only when the visitor
// allowed usage statistics (./consent, the same rule as page views and web vitals), only from a sample of page loads
// (SEARCH_SAMPLE, decided once here), never from a browser driven by automation (navigator.webdriver), and never with
// the query: the words, the last search and the last follow-up tap stay in this page's memory, to tell a re-search
// and a tapped follow-up apart, and are gone when the tab closes.
//
// Time to answer runs from the search starting (the page opened on /search: the page load's start; a search inside
// the app: the results page first drawing the new words, right after Enter or a tap) to the first frame painted with
// its answer, results or Sorry. A tab hidden while waiting gives no time (the search still counts). Every timed search
// is also left on the page as a `search:answer` performance measure, which is never sent anywhere: local checks
// (Playwright, the devtools Performance panel) read it.
import { useEffect, useRef } from "react";
import { useNavigationType } from "react-router-dom";
import { hasAnalyticsConsent } from "./consent";
import { screenBucket } from "../shared/analytics";
import { RE_SEARCH_MS, SEARCH_SAMPLE, type SearchBeacon, type SearchEntry, type SearchOutcome, type SearchVia } from "../shared/searchScore";

const browser = typeof window !== "undefined" && typeof document !== "undefined";
/** This page load's searches are counted (when consent allows): decided once, so a visit is in the sample or not. */
let sampled = browser && Math.random() < SEARCH_SAMPLE;
/**
 * The words the page was opened with on /search, still unclaimed: the first search for exactly those words started
 * with the page load itself. Read from the page load's own navigation entry, never the address when this module
 * loads (it loads lazily, after an in-app navigation has already changed the address). undefined: not read yet;
 * null: the page wasn't opened on a search (or its first search was already counted).
 */
let coldQuery: string | null | undefined;
function landedQuery(): string | null {
  try {
    const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
    const u = new URL(nav?.name || location.href, location.href);
    return u.pathname === "/search" ? norm(u.searchParams.get("q") ?? "") || null : null;
  } catch { return null; }
}
/** When this tab was hidden (performance.now(), the latest few): a search whose wait spans one gets no time. */
let hides: number[] = browser && document.visibilityState === "hidden" ? [0] : [];
const hiddenBetween = (from: number, to: number) => hides.some((t) => t >= from && t <= to);
/** The last answer drawn: when, and for which words (memory only). */
let lastAnswer: { at: number; q: string } | null = null;
/** The last tap on a follow-up link: when, which kind and its words (memory only). */
let lastTap: { at: number; via: Exclude<SearchVia, "typed">; q: string } | null = null;

/** A follow-up tap only starts the search for its own words, if that search starts this soon after it. */
const TAP_MS = 5000;
const norm = (q: string) => q.trim().replace(/\s+/g, " ").toLowerCase();

/** Which follow-up an element is in: People also ask, or Related searches (its chips, list and highlights link). */
export function followUpOf(el: Element | null): Exclude<SearchVia, "typed"> | null {
  if (!el?.closest) return null;
  if (el.closest('[data-block="people-also-ask"]')) return "ask";
  if (el.closest('[data-follow-chip], [data-follow-chips], [data-block="related-searches"], [data-block="team-highlights"], [data-related-lead]')) return "related";
  return null;
}

if (browser) {
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") hides = [...hides.slice(-19), performance.now()]; });
  // One listener for every follow-up link on the page (capture: before the router navigates).
  document.addEventListener("click", (e) => {
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    const via = followUpOf(a);
    if (!a || !via) return;
    try {
      const u = new URL(a.href, location.href);
      if (u.pathname === "/search") lastTap = { at: performance.now(), via, q: norm(u.searchParams.get("q") ?? "") };
    } catch { /* not a URL */ }
  }, true);
}

function send(b: SearchBeacon): void {
  if (!sampled || !hasAnalyticsConsent() || (typeof navigator !== "undefined" && navigator.webdriver)) return;
  const body = JSON.stringify(b);
  try {
    if (navigator.sendBeacon?.("/api/collect/search", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through to fetch */ }
  fetch("/api/collect/search", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit" }).catch(() => { /* best effort */ });
}

type Run = {
  q: string; start: number; entry: SearchEntry; via: SearchVia; re: boolean;
  /** Back/Forward to words already shown: not a new search. */
  skip: boolean;
  drawnAt: number | null; outcome: SearchOutcome | null; sent: boolean;
};

/** What the results page shows for its words right now. */
export type SearchShown = {
  /** Its answer, results, Sorry or error is on screen (not the loading screen). */
  drawn: boolean;
  /** Nothing more is on its way for these words. */
  settled: boolean;
  /** It is going straight on to the one page the words name. */
  leaving: boolean;
  outcome: SearchOutcome;
};

function finish(r: Run, outcome: SearchOutcome | null): void {
  if (r.sent || r.skip || !outcome) return;
  r.sent = true;
  // Hidden while waiting (between the start and the drawn answer): no time. A hide after it was drawn changes nothing.
  const ms = r.drawnAt != null && !hiddenBetween(r.start, r.drawnAt) ? r.drawnAt - r.start : undefined;
  if (outcome !== "page") lastAnswer = { at: r.drawnAt ?? performance.now(), q: r.q };
  send({ screen: screenBucket(window.innerWidth), entry: r.entry, outcome, via: r.via, re: r.re, ...(ms != null && outcome !== "page" ? { ms } : {}) });
}

/** Measures each search the results page shows; one beacon per search (see the top of this file). */
export function useSearchScore(query: string, shown: SearchShown): void {
  const nav = useNavigationType();
  const run = useRef<Run | null>(null);
  const q = norm(query);
  // No words (a bare /search): the last search is over, so the same words searched again later are a new search.
  if (browser && !q && run.current) {
    finish(run.current, run.current.drawnAt != null ? run.current.outcome : null);
    run.current = null;
  }
  // Started while rendering the new words, so the time includes this render.
  if (browser && q && run.current?.q !== q) {
    if (run.current) finish(run.current, run.current.drawnAt != null ? run.current.outcome : null);
    if (coldQuery === undefined) coldQuery = landedQuery();
    // Only the page load's own words, and only its first search: any later one started inside the app.
    const cold = coldQuery === q;
    coldQuery = null;
    const start = cold ? 0 : performance.now();
    const tap = lastTap && lastTap.q === q && start - lastTap.at <= TAP_MS ? lastTap : null;
    lastTap = null;
    const via: SearchVia = tap ? tap.via : "typed";
    const re = via === "typed" && !!lastAnswer && lastAnswer.q !== q && start - lastAnswer.at <= RE_SEARCH_MS;
    run.current = { q, start, entry: cold ? "load" : "app", via, re, skip: !cold && nav === "POP", drawnAt: null, outcome: null, sent: false };
  }
  const r = run.current;
  if (r && r.q === q) r.outcome = shown.leaving ? "page" : shown.outcome;

  const { drawn, settled, leaving } = shown;
  // The first frame painted with the answer: two animation frames after the commit that drew it.
  useEffect(() => {
    const cur = run.current;
    if (!cur || cur.q !== q || !drawn || cur.drawnAt != null) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (cur.drawnAt != null) return;
        cur.drawnAt = performance.now();
        try { if (!hiddenBetween(cur.start, cur.drawnAt)) performance.measure("search:answer", { start: cur.start, end: cur.drawnAt }); } catch { /* old browser */ }
        if (settled) finish(cur, cur.outcome);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [q, drawn, settled]);
  // Settled after it was drawn (a handed-over answer, then the page's own): counted with what it ended as.
  useEffect(() => {
    const cur = run.current;
    if (!cur || cur.q !== q) return;
    if (leaving) finish(cur, "page");
    else if (settled && cur.drawnAt != null) finish(cur, cur.outcome);
  }, [q, settled, leaving]);
  // Left (another page, the tab closed) after the answer showed but before it settled: counted as it was.
  useEffect(() => {
    const out = () => { const cur = run.current; if (cur && cur.drawnAt != null) finish(cur, cur.outcome); };
    window.addEventListener("pagehide", out);
    return () => { window.removeEventListener("pagehide", out); out(); };
  }, []);
}

/** Tests: start this page load over (sampled or not; `landed`: the words the page was opened with on /search). */
export function resetSearchScore(o: { sampled?: boolean; landed?: string | null } = {}): void {
  sampled = o.sampled ?? true;
  coldQuery = o.landed ? norm(o.landed) : null;
  hides = [];
  lastAnswer = null;
  lastTap = null;
}
