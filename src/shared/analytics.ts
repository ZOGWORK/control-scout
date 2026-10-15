// Anonymous usage statistics: the page-view payload and its normalisation,
// shared by the web app (which sends it) and the server (which re-checks it).
// Paths are reduced to route patterns ("/teams/:number"), so what's stored says
// which kind of page was viewed, never which team someone looked at.

export type Screen = "phone" | "tablet" | "desktop";
export const SCREENS: readonly Screen[] = ["phone", "tablet", "desktop"];

/** What the browser sends to POST /api/collect. No IDs, nothing per-person. */
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
};

const STATIC_ROUTES = new Set([
  "/", "/teams", "/matches", "/events", "/predict", "/predict/how-it-works", "/compare", "/my-team", "/shortlist",
  "/scout", "/download", "/settings", "/methodology", "/privacy", "/terms",
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
  return { path: b.path, ref: cleanHost(b.ref), screen: b.screen as Screen, lang: cleanLang(b.lang), session: b.session };
}
