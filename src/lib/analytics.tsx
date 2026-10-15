// Anonymous page views, sent only with consent (src/lib/consent.ts): on each
// route change, one beacon to our own server with the route pattern, the
// external referrer's host (a session's first view only), a screen-size bucket
// and the language. No cookies, no IDs; the "new session" bit is a
// sessionStorage flag that ends with the tab, never a cross-day identifier.
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { hasAnalyticsConsent, useConsent } from "./consent";
import { routePattern, screenBucket, cleanLang, type PageView } from "../shared/analytics";

const SESSION_KEY = "cs-stats-session";

/** First call in a browser session → true (and remembers it for the session). */
function startsSession(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_KEY)) return false;
    sessionStorage.setItem(SESSION_KEY, "1");
    return true;
  } catch { return false; } // storage blocked: count the view, not a session
}

/** The external site this visit came from ("" for none or our own host). */
function referrerHost(): string {
  try {
    if (!document.referrer) return "";
    const h = new URL(document.referrer).host;
    return h === location.host ? "" : h;
  } catch { return ""; }
}

export function pageView(pathname: string): PageView {
  const session = startsSession();
  return { path: routePattern(pathname), ref: session ? referrerHost() : "", screen: screenBucket(window.innerWidth), lang: cleanLang(navigator.language), session };
}

/** Send one page view if (and only if) the visitor said yes. Returns whether it was sent. */
export function sendPageView(pathname: string): boolean {
  if (!hasAnalyticsConsent()) return false;
  const body = JSON.stringify(pageView(pathname));
  try {
    if (navigator.sendBeacon?.("/api/collect", new Blob([body], { type: "application/json" }))) return true;
  } catch { /* fall through to fetch */ }
  fetch("/api/collect", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit" }).catch(() => { /* stats are best effort */ });
  return true;
}

/** Mounted once inside the router. Counts the current page when consent is (or becomes) yes. */
export function PageViews() {
  const { pathname } = useLocation();
  const { analytics } = useConsent();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!analytics) { last.current = null; return; }
    if (last.current === pathname) return; // the same view again (StrictMode's second effect run)
    if (sendPageView(pathname)) last.current = pathname;
  }, [pathname, analytics]);
  return null;
}
