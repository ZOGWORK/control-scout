// The app's HTML pages, kept whole (server/api/searchReads.ts keptPage): a team page, an event page, a search or the
// home page, as the server drew it (server/seo.ts renderPage), with its CSP header and its gzip, so the next visitor
// to the same address within PAGE_TTL_MS gets the bytes already made. Drawing one is the dearest thing a request
// does (measured 2026-11-10: 0.4–1 s of the one thread for a team or event page), and compressing 300–470 KB of
// HTML again for every visitor was the next.
//
// Only addresses whose page is the same for everyone: these pages carry public data and the app's shell, nothing
// about who asked (personal data arrives through the API, which stays no-store). The key is the path and query as
// asked, query keys sorted, so ?season=2025&x=1 and ?x=1&season=2025 are one page.
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { renderPage } from "./seo.js";
import { buildCsp, inlineScriptHashes } from "./securityHeaders.js";
import type { SearchIntentNote } from "../src/shared/api.js";

const gzipAsync = promisify(gzip);

/** Addresses whose drawn page is kept: team pages, event pages, search results and home (query included in the key). */
export const CACHED_PAGE = /^\/(?:teams\/\d+|events\/\d+\/[^/]+|search)?$/i;

export interface KeptPage {
  status: 200 | 404;
  html: string;
  /** The page's CSP header value (server/securityHeaders.ts buildCsp over its inline scripts). */
  csp: string;
  /** The HTML gzipped, for a visitor who accepts gzip (compression's default level). */
  gz: Promise<Buffer>;
  /** A search page's intent, counted by the route on every visit to the kept page (server/seoMeta.ts PageMeta.intent). */
  intent?: SearchIntentNote;
}

/** The key a drawn page is kept under: its path (trailing slash dropped) and query, keys sorted, repeats in order. */
export function pageKey(path: string, query: Record<string, unknown>): string {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  const parts: string[] = [];
  for (const k of Object.keys(query).sort()) {
    const v = query[k];
    for (const x of Array.isArray(v) ? v : [v]) parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(typeof x === "string" ? x : JSON.stringify(x ?? ""))}`);
  }
  return parts.length ? `${p}?${parts.join("&")}` : p;
}

/** Draw the page at `path` (server/seo.ts renderPage) with everything a response needs, ready to keep. */
export async function drawPage(file: string, path: string, query: Record<string, unknown>): Promise<KeptPage> {
  const page = await renderPage(file, path, query);
  // A failed gzip is a failed page: not kept (keep() drops a rejected value), and the plain HTML is sent instead.
  const gz = gzipAsync(page.html);
  gz.catch(() => undefined);
  return { status: page.status, html: page.html, csp: buildCsp(inlineScriptHashes(page.html)), gz, ...(page.intent ? { intent: page.intent } : {}) };
}
