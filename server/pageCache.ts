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
import { brotliCompress, brotliDecompress, constants as zlibConstants, gunzip, gzip } from "node:zlib";
import { promisify } from "node:util";
import { renderPage } from "./seo.js";
import { buildCsp, inlineScriptHashes } from "./securityHeaders.js";
import { isLegacy } from "./data/seasons.js";
import type { SearchIntentNote } from "../src/shared/api.js";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const brotliAsync = promisify(brotliCompress);
const unbrotliAsync = promisify(brotliDecompress);
/** Brotli's quality for a page: 5 is close to gzip's time for text this size and about a fifth smaller. */
const BROTLI_OPTIONS = { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 } };

/** Addresses whose drawn page is kept: team pages, event pages, search results and home (query included in the key). */
export const CACHED_PAGE = /^\/(?:teams\/\d+|events\/\d+\/[^/]+|search)?$/i;

/** A frozen season (2019–2022: held for history only) cannot change between syncs, so its pages are kept longer
 *  than a live one's: the same bytes are drawn twice as often as they need to be otherwise (0.4–1 s of this
 *  process's one thread each time, server/api/searchReads.ts). */
export const FROZEN_PAGE_TTL_MS = 5 * 60_000;

/** How long the page at `path` is kept: a frozen season's for `FROZEN_PAGE_TTL_MS`, anything else's for `liveMs`
 *  (a live event's page must never lag its API by more than that). */
export function pageTtlMs(path: string, query: Record<string, unknown>, liveMs: number): number {
  const event = /^\/events\/(\d{4})\//i.exec(path);
  if (event) return isLegacy(Number(event[1])) ? FROZEN_PAGE_TTL_MS : liveMs;
  const team = /^\/teams\/\d+$/i.test(path) ? Number(query.season) : NaN;
  return Number.isInteger(team) && isLegacy(team) ? FROZEN_PAGE_TTL_MS : liveMs;
}

export interface KeptPage {
  status: 200 | 404;
  /** The page's CSP header value (server/securityHeaders.ts buildCsp over its inline scripts). */
  csp: string;
  /** The HTML gzipped (compression's default level): all that's kept of it. pageBody gives a visitor what it takes. */
  gz: Buffer;
  /** The same HTML as Brotli (quality 5): about a fifth smaller, sent to the visitors and caches that take it. */
  br: Buffer;
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
  const [gz, br] = await Promise.all([gzipAsync(page.html), brotliAsync(page.html, BROTLI_OPTIONS)]);
  return { status: page.status, csp, gz, br, ...(page.intent ? { intent: page.intent } : {}) };
}

/** A kept page's body for a visitor: Brotli when it takes Brotli, else the gzip when it takes gzip, else the HTML
 *  unzipped from the gzip. A client that takes neither gets plain HTML (compression leaves it alone: it's already
 *  encoded or unencoded, never re-encoded). */
export async function pageBody(page: KeptPage, encoding: "br" | "gzip" | null): Promise<{ body: Buffer; encoding: "br" | "gzip" | null }> {
  if (encoding === "br") return { body: page.br, encoding };
  if (encoding === "gzip") return { body: page.gz, encoding };
  return { body: await gunzipAsync(page.gz), encoding: null };
}
