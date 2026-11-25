// Anonymous usage statistics: the page-view payload and its normalisation,
// shared by the web app (which sends it) and the server (which re-checks it).
// Paths are reduced to route patterns ("/teams/:number"), so what's stored says
// which kind of page was viewed, never which team someone looked at.

/** Usage statistics count days in US Eastern time (the owner's day, DST included), on the server and in the browser. */
export const STATS_TIME_ZONE = "America/New_York";
const statsDayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: STATS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/** The Eastern-time day (YYYY-MM-DD) an instant falls on. */
export const statsDay = (d: Date) => statsDayFormat.format(d);

/** The first day unique visitors were counted (migration 107): days before it have views and sessions, no visitors. */
export const VISITORS_SINCE = "2026-11-25";

export type Screen = "phone" | "tablet" | "desktop";
export const SCREENS: readonly Screen[] = ["phone", "tablet", "desktop"];

/** What the browser sends to POST /api/collect. No IDs, nothing per-person: three yes/no bits say whether this view
 *  starts a tab's session, the browser's day, or the browser's first visit. */
export type PageView = {
  /** Route pattern, e.g. "/events/:season/:code". */
  path: string;
  /** Host of an external referrer, on a session's first page view only ("" otherwise). */
  ref: string;
  screen: Screen;
  /** Primary language subtag, e.g. "en" ("" if unknown). */
  lang: string;
  /** True on the first page view of a browser session (sessionStorage flag). */
  session: boolean;
  /** True on this browser's first page view of the Eastern day (a localStorage date, never an ID): summed per day it is
   *  that day's unique visitors. */
  visitor: boolean;
  /** True on this browser's first page view ever (a localStorage flag): summed over a period it is the new visitors. A
   *  browser whose storage was cleared counts as new again. */
  newVisitor: boolean;
};

const STATIC_ROUTES = new Set([
  "/", "/teams", "/matches", "/events", "/predict", "/predict/how-it-works", "/compare", "/my-team", "/my-teams", "/shortlist",
  "/scout", "/download", "/settings", "/methodology", "/privacy", "/terms", "/donate", "/faq", "/rules",
]);
const DYNAMIC_ROUTES: [RegExp, string][] = [
  [/^\/teams\/[^/]+$/, "/teams/:number"],
  [/^\/events\/[^/]+\/[^/]+$/, "/events/:season/:code"],
];
export const OTHER_PATH = "(other)";

/** A pathname (query and hash dropped) as its route pattern; anything unknown is "(other)". */
export function routePattern(pathname: unknown): string {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.length > 300) return OTHER_PATH;
  const p = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (STATIC_ROUTES.has(p)) return p;
  for (const [re, name] of DYNAMIC_ROUTES) if (re.test(p)) return name;
  return OTHER_PATH;
}

/** Valid patterns only: what routePattern can return. */
export function isRoutePattern(v: unknown): v is string {
  return typeof v === "string" && (v === OTHER_PATH || STATIC_ROUTES.has(v) || DYNAMIC_ROUTES.some(([, n]) => n === v));
}

/** A referrer host, lowercased, without "www." — or "" when it isn't a plain host name. */
export function cleanHost(v: unknown): string {
  if (typeof v !== "string") return "";
  const h = v.trim().toLowerCase().replace(/^www\./, "");
  return /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*(:\d{1,5})?$/.test(h) ? h : "";
}

/** "en-US" → "en"; anything else → "". */
export function cleanLang(v: unknown): string {
  if (typeof v !== "string") return "";
  const m = /^([a-z]{2,3})(?:[-_]|$)/i.exec(v.trim());
  return m ? m[1].toLowerCase() : "";
}

export function screenBucket(width: number): Screen {
  return width < 768 ? "phone" : width < 1024 ? "tablet" : "desktop";
}

/** Server side: a validated PageView, or null when the body isn't one. */
export function parsePageView(body: unknown): PageView | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!isRoutePattern(b.path)) return null;
  if (!SCREENS.includes(b.screen as Screen)) return null;
  if (typeof b.session !== "boolean") return null;
  if (b.ref != null && typeof b.ref !== "string") return null;
  if (b.lang != null && typeof b.lang !== "string") return null;
  // Optional: a page loaded before these were sent leaves them out (counted as not a new visitor).
  if (b.visitor != null && typeof b.visitor !== "boolean") return null;
  if (b.newVisitor != null && typeof b.newVisitor !== "boolean") return null;
  return { path: b.path, ref: cleanHost(b.ref), screen: b.screen as Screen, lang: cleanLang(b.lang), session: b.session, visitor: b.visitor === true, newVisitor: b.newVisitor === true };
}
