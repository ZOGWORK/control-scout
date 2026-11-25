// Anonymous page views, sent only with consent (src/lib/consent.ts): on each
// route change, one beacon to our own server with the route pattern, the
// external referrer's host (a session's first view only), a screen-size bucket
// and the language. No cookies, no IDs; the "new session" bit is a
// sessionStorage flag that ends with the tab, never a cross-day identifier.
// Unique visitors are two more yes/no bits from localStorage, never an ID: the
// browser's first view of the Eastern day (a stored date), and its first view
// ever (a stored flag). The owner's devices send nothing: any browser the owner
// has signed in on is marked, and stays left out after signing out.
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { hasAnalyticsConsent, useConsent } from "./consent";
import { usePersonal } from "./personal";
import { routePattern, screenBucket, cleanLang, statsDay, type PageView } from "../shared/analytics";

const SESSION_KEY = "cs-stats-session";
/** The Eastern day this browser was last counted as a visitor (YYYY-MM-DD). */
const VISITOR_DAY_KEY = "cs-stats-day";
/** Set once this browser has been counted as a new visitor. */
const SEEN_KEY = "cs-stats-seen";
/** Set on a browser the owner has signed in on: it sends no page views. */
export const OWNER_DEVICE_KEY = "cs-stats-owner";

/** Whether this browser belongs to the owner (never counted). */
export function isOwnerDevice(): boolean {
  try { return localStorage.getItem(OWNER_DEVICE_KEY) === "1"; } catch { return false; }
}

/** Leave this browser out of usage statistics from now on, signed in or not. */
export function markOwnerDevice(): void {
  try { localStorage.setItem(OWNER_DEVICE_KEY, "1"); } catch { /* storage blocked: the signed-in check still skips */ }
}

/** First view of the Eastern day, and first view ever, in this browser (and remembers both). Storage blocked: neither,
 *  so a browser that can't remember is never counted twice. */
function visitorFlags(now = new Date()): { visitor: boolean; newVisitor: boolean } {
  try {
    const today = statsDay(now);
    const visitor = localStorage.getItem(VISITOR_DAY_KEY) !== today;
    const newVisitor = localStorage.getItem(SEEN_KEY) !== "1";
    if (visitor) localStorage.setItem(VISITOR_DAY_KEY, today);
    if (newVisitor) localStorage.setItem(SEEN_KEY, "1");
    return { visitor, newVisitor };
  } catch { return { visitor: false, newVisitor: false }; }
}

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
  return { path: routePattern(pathname), ref: session ? referrerHost() : "", screen: screenBucket(window.innerWidth), lang: cleanLang(navigator.language), session, ...visitorFlags() };
}

/** Send one page view if (and only if) the visitor said yes and this isn't the owner's browser. Returns whether it was sent. */
export function sendPageView(pathname: string): boolean {
  if (!hasAnalyticsConsent() || isOwnerDevice()) return false;
  const body = JSON.stringify(pageView(pathname));
  try {
    if (navigator.sendBeacon?.("/api/collect", new Blob([body], { type: "application/json" }))) return true;
  } catch { /* fall through to fetch */ }
  fetch("/api/collect", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit" }).catch(() => { /* stats are best effort */ });
  return true;
}

/** Mounted once inside the router and PersonalProvider. Counts the current page when consent is (or becomes) yes, and
 *  marks the browser as the owner's (counted no more) once the server says the owner is signed in. It doesn't wait for
 *  that answer (it never comes when /api/auth/me fails, and a visitor's views would be lost): the owner's very first page
 *  on a new browser can be counted, none after it. */
export function PageViews() {
  const { pathname } = useLocation();
  const { analytics } = useConsent();
  const { user } = usePersonal();
  const owner = !!user?.isOwner;
  const last = useRef<string | null>(null);
  useEffect(() => { if (owner) markOwnerDevice(); }, [owner]);
  useEffect(() => {
    if (!analytics || owner) { last.current = null; return; }
    if (last.current === pathname) return; // the same view again (StrictMode's second effect run)
    if (sendPageView(pathname)) last.current = pathname;
  }, [pathname, analytics, owner]);
  return null;
}
