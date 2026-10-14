// SEO plumbing for the web app's HTML (docs: the Google SEO brief).
//
// One canonical origin: APP_URL (https://controlscout.org). Any other host
// that reaches the app (www., scout.tryctrlpoint.org, a backup host) is 301'd
// there with the full path and query, so Google sees one copy of the site.
// One URL per page: no trailing slash (except "/"), and the singular aliases
// people type (/team/4215, /event/2025/X) 301 to the real routes.
//
// The HTML itself carries <link rel="canonical"> in the first response, so
// crawlers and link-preview bots (which don't run JS) see it.
import type { NextFunction, Request, Response } from "express";
import { readFileSync } from "node:fs";
import { env } from "./env.js";

/** The canonical origin, e.g. "https://controlscout.org" (no trailing slash). */
export const canonicalOrigin = () => new URL(env.appUrl).origin;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** 301 to the canonical host, path policy and route aliases. Never for /api (clients keep their origin). */
export function canonicalRedirects(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/.well-known/")) return next();
  const home = new URL(env.appUrl);
  const host = req.hostname;
  const qs = req.originalUrl.slice(req.path.length); // "?…" or ""
  let path = req.path;
  // Singular aliases → the real routes.
  path = path.replace(/^\/team\/(\d{1,6})(?=\/|$)/, "/teams/$1").replace(/^\/event\/(\d{4})\/([^/]+)(?=\/|$)/, "/events/$1/$2");
  // No trailing slash (one URL per page).
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "") || "/";
  const otherHost = env.production && host && !LOOPBACK.has(host) && host !== home.hostname;
  if (otherHost || path !== req.path) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.redirect(301, `${otherHost ? home.origin : ""}${path}${qs}`);
  }
  next();
}

/** The canonical URL for a page path: canonical origin + path, no query, no trailing slash. */
export function canonicalUrl(path: string): string {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  return `${canonicalOrigin()}${p}`;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

let template: { file: string; html: string } | null = null;
function indexHtml(file: string): string {
  if (!template || template.file !== file) template = { file, html: readFileSync(file, "utf8") };
  return template.html;
}

/** index.html for this path, with the page's head tags in the initial HTML. */
export function renderIndex(file: string, path: string): string {
  const head = `<link rel="canonical" href="${esc(canonicalUrl(path))}" />`;
  return indexHtml(file).replace("</head>", `    ${head}\n  </head>`);
}
