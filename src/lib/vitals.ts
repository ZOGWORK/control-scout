// Real-user speed, sent only with the same consent as page views (./analytics,
// ./consent): the page load's web vitals go to our own server when the tab is
// hidden or closed, with the route pattern of the page the visit started on and
// a screen-size bucket. No cookies, no IDs, nothing about what's on the page.
// The measuring code (the web-vitals package, ~2 KB) is its own chunk, loaded
// once the page has finished loading and the browser is idle; the browser keeps
// the entries it needs (buffered), so loading it late loses nothing.
import { useEffect } from "react";
import { hasAnalyticsConsent, useConsent } from "./consent";
import { routePattern, screenBucket } from "../shared/analytics";
import type { VitalName, VitalsBeacon } from "../shared/vitals";

// LCP, FID and TTFB belong to the first page; CLS and INP keep counting across in-app navigation, and all of them
// are put down to the page the visit started on.
const LANDING = typeof location === "undefined" ? "/" : location.pathname;

/** web-vitals gives each metric of each page load an id (a back/forward-cache restore is a new load, with new ids). */
type Report = { name: string; value: number; id: string };

function send(b: VitalsBeacon): void {
  const body = JSON.stringify(b);
  try {
    if (navigator.sendBeacon?.("/api/collect/vitals", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through to fetch */ }
  fetch("/api/collect/vitals", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit" }).catch(() => { /* best effort */ });
}

/** First input delay, which web-vitals no longer reports: the wait before the page began handling the first tap or key. */
function onFID(cb: (r: Report) => void): void {
  try {
    const po = new PerformanceObserver((list) => {
      const e = list.getEntries()[0] as PerformanceEventTiming | undefined;
      if (!e) return;
      po.disconnect();
      cb({ name: "FID", value: e.processingStart - e.startTime, id: "fid" });
    });
    po.observe({ type: "first-input", buffered: true });
  } catch { /* not supported */ }
}

let started = false;

/**
 * Start measuring (once per page). Metrics are held until the tab is hidden, then sent together if consent still holds.
 * Each metric of a page load is sent once: CLS and INP can still grow when the visitor comes back to the tab, but a
 * second sample would count that load twice in the histograms, so later values of an id already sent are dropped.
 */
export function startVitals(load: () => Promise<Pick<typeof import("web-vitals"), "onLCP" | "onINP" | "onCLS" | "onTTFB">> = () => import("web-vitals")): void {
  if (started || typeof window === "undefined" || typeof PerformanceObserver === "undefined") return;
  started = true;
  const path = routePattern(LANDING);
  let pending: VitalsBeacon["m"] = {};
  let pendingIds: string[] = [];
  const sent = new Set<string>();
  let queued = false;
  const flush = () => {
    queued = false;
    const m = pending;
    pending = {};
    for (const id of pendingIds) sent.add(id);
    pendingIds = [];
    if (Object.keys(m).length && hasAnalyticsConsent()) send({ path, screen: screenBucket(window.innerWidth), m });
  };
  const put = (r: Report) => {
    const id = `${r.name}:${r.id}`;
    if (sent.has(id)) return;
    pending[r.name as VitalName] = r.value;
    pendingIds.push(id);
    // web-vitals reports LCP, CLS and INP from its own "hidden" listener, which may run after ours: one send for
    // everything reported in that same moment.
    if (document.visibilityState === "hidden" && !queued) { queued = true; queueMicrotask(flush); }
  };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  onFID(put);
  load().then(({ onLCP, onINP, onCLS, onTTFB }) => { onLCP(put); onINP(put); onCLS(put); onTTFB(put); }).catch(() => { /* chunk failed to load: no vitals this time */ });
}

/** Run `fn` after the load event, when the browser is idle. */
function afterLoad(fn: () => void): () => void {
  let idle: number | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  const go = () => {
    if ("requestIdleCallback" in window) idle = window.requestIdleCallback(fn, { timeout: 5000 });
    else timer = setTimeout(fn, 1000);
  };
  if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true });
  return () => {
    window.removeEventListener("load", go);
    if (idle != null) window.cancelIdleCallback(idle);
    if (timer != null) clearTimeout(timer);
  };
}

/** Mounted once. Starts measuring when consent is (or becomes) yes; nothing is loaded or sent otherwise. */
export function WebVitals() {
  const { analytics } = useConsent();
  useEffect(() => (analytics ? afterLoad(() => startVitals()) : undefined), [analytics]);
  return null;
}
