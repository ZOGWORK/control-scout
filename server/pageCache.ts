// The app's HTML pages, kept whole (server/api/searchReads.ts keptPage): a team page, an event page, a search or the
// home page, as the server drew it (server/seo.ts renderPage), with its CSP header and its gzip, so the next visitor
// to the same address within PAGE_TTL_MS gets the bytes already made. Drawing one is the dearest thing a request
// does (measured 2026-11-10: 0.4–1 s of the one thread for a team or event page), and compressing 300–470 KB of
// HTML again for every visitor was the next.
//
// Only addresses whose page is the same for everyone: these pages carry public data and the app's shell, nothing
// about who asked (personal data arrives through the API, which stays no-store). The key is the path and query as
// asked, query keys sorted, so ?season=2025&x=1 and ?x=1&season=2025 are one page.
//
// Only the gzip is kept, not the HTML: up to PAGES_KEPT pages plus as many carried over a data move
// (server/api/searchReads.ts) each held its 300–470 KB of HTML as a string beside the gzip, and those strings were the
// largest thing the web process kept alive (about 260 MB of the heap, measured on the VM 2026-11-22 on a copy of its
// data under its own traffic and a live result a minute). The gzip is about a sixth of the page and is what nearly
// every visitor is sent (Cloudflare asks for it); the rare client that takes no gzip gets it unzipped on the way out.
import { gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { renderPage } from "./seo.js";
import { buildCsp, inlineScriptHashes } from "./securityHeaders.js";
import type { SearchIntentNote } from "../src/shared/api.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Addresses whose drawn page is kept: team pages, event pages, search results and home (query included in the key). */
export const CACHED_PAGE = /^\/(?:teams\/\d+|events\/\d+\/[^/]+|search)?$/i;

export interface KeptPage {
  status: 200 | 404;
  /** The page's CSP header value (server/securityHeaders.ts buildCsp over its inline scripts). */
  csp: string;
  /** The HTML gzipped (compression's default level): all that's kept of it. pageBody gives a visitor what it takes. */
  gz: Buffer;
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

/** Draw the page at `path` (server/seo.ts renderPage) with everything a response needs, ready to keep. A failed gzip
 *  is a failed draw: nothing is kept (keep() drops a rejected value) and the route draws the page as it would uncached. */
export async function drawPage(file: string, path: string, query: Record<string, unknown>): Promise<KeptPage> {
  const page = await renderPage(file, path, query);
  const csp = buildCsp(inlineScriptHashes(page.html));
  const gz = await gzipAsync(page.html);
  return { status: page.status, csp, gz, ...(page.intent ? { intent: page.intent } : {}) };
}

/** A kept page's body for a visitor: the gzip as kept when it takes gzip, else the HTML unzipped from it. */
export async function pageBody(page: KeptPage, takesGzip: boolean): Promise<{ body: Buffer; gzip: boolean }> {
  return takesGzip ? { body: page.gz, gzip: true } : { body: await gunzipAsync(page.gz), gzip: false };
}
