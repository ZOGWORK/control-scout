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
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "./env.js";
import { BOOT_STYLE, bootConsent, bootShell } from "./bootShell.js";
import { criticalCss } from "./criticalCss.js";
import { liveHeroLines } from "./heroLines.js";
import { isBareRoute, pageModule } from "../src/shared/routes.js";
import { APP_CSS_ID } from "../src/shared/boot.js";
import { COIN_FLIPS_META, hasFlips } from "../src/shared/coinFlips.js";
import { liteHref } from "../src/shared/lite.js";
import { isEnabled } from "./flags.js";

/** The request's query as "?a=b" (repeated or nested values left out). */
const queryString = (query: Record<string, unknown>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (typeof v === "string") q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
};

/** The canonical origin, e.g. "https://controlscout.org" (no trailing slash). */
export const canonicalOrigin = () => new URL(env.canonicalUrl).origin;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Pages that moved for good: [old path (matched without case), new path, fragment]. The app's own routes
 *  redirect the same way (src/main.tsx), for in-app links and offline use. */
export const MOVED_PAGES: [RegExp, string, string][] = [
  [/^\/predict\/how-it-works$/i, "/methodology", ""],
  [/^\/predict\/accuracy$/i, "/methodology", "#accuracy"],
];

/** 301 to the canonical host, path policy and route aliases. Never for /api (clients keep their origin). */
export function canonicalRedirects(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/.well-known/")) return next();
  const home = new URL(env.appUrl);
  const host = req.hostname;
  const qs = req.originalUrl.slice(req.path.length); // "?…" or ""
  // Repeated slashes collapse (//evil.example/x must never become a protocol-relative redirect).
  let path = req.path.replace(/\/{2,}/g, "/");
  // The app's HTML has one URL: /index.html is the home page.
  if (path === "/index.html") path = "/";
  // Singular aliases → the real routes.
  path = path.replace(/^\/team\/(\d{1,6})(?=\/|$)/, "/teams/$1").replace(/^\/event\/(\d{4})\/([^/]+)(?=\/|$)/, "/events/$1/$2");
  // The retired stream overlay page (an OBS browser source; the predictions now sit on the event page's own player): its event.
  path = path.replace(/^(\/events\/[^/]+\/[^/]+)\/overlay\/?$/i, "$1");
  // No trailing slash (one URL per page).
  if (path.length > 1 && path.endsWith("/")) path = path.replace(/\/+$/, "") || "/";
  // How it works has one URL: its old addresses (the Predict section's) 301 there, the track record to its section.
  // The fragment goes last, after any query; crawlers drop it, browsers scroll to it.
  const moved = MOVED_PAGES.find(([re]) => re.test(path));
  const hash = moved?.[2] ?? "";
  if (moved) path = moved[1];
  const otherHost = env.production && host && !LOOPBACK.has(host) && host !== home.hostname;
  if (otherHost || path !== req.path || moved) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    // Always absolute, on the canonical origin: a redirect can never leave the site.
    return res.redirect(301, `${home.origin}${path}${qs}${hash}`);
  }
  // A backup host serving the app under its own name (Render): usable, but never indexed as a second copy.
  if (env.production && host && !LOOPBACK.has(host) && host !== new URL(env.canonicalUrl).hostname) res.setHeader("X-Robots-Tag", "noindex");
  next();
}

/** A path that names a file (any extension, e.g. .png, .xml, .webmanifest): missing ones are a 404, never the app. */
export const MISSING_FILE = /\.[A-Za-z0-9]+$/;

/** The canonical URL for a page path: canonical origin + path, no trailing slash (a query only where the page passes one: /rankings). */
export function canonicalUrl(path: string): string {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  return `${canonicalOrigin()}${p}`;
}

let template: { file: string; html: string } | null = null;
/** index.html without its generic head tags (the page's own go in their place). */
function indexHtml(file: string): string {
  if (!template || template.file !== file) {
    const html = readFileSync(file, "utf8")
      .replace(/\s*<title>[\s\S]*?<\/title>/i, "")
      .replace(/\s*<meta\s+name="description"[^>]*>/i, "")
      .replace(/\s*<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[^>]*>/gi, "")
      .replace(/\s*<link\s+rel="canonical"[^>]*>/i, "");
    template = { file, html };
  }
  return template.html;
}

/** Vite's build manifest (build.manifest: dist/.vite/manifest.json), read once per index.html. */
interface ManifestChunk { file: string; imports?: string[]; css?: string[]; isEntry?: boolean }
let manifest: { file: string; chunks: Record<string, ManifestChunk> | null } | null = null;
function viteManifest(indexFile: string): Record<string, ManifestChunk> | null {
  if (!manifest || manifest.file !== indexFile) {
    let chunks: Record<string, ManifestChunk> | null = null;
    try { chunks = JSON.parse(readFileSync(join(dirname(indexFile), ".vite", "manifest.json"), "utf8")); } catch { /* dev, tests: no manifest */ }
    manifest = { file: indexFile, chunks };
  }
  return manifest.chunks;
}

/** A shared dependency this big (bytes) is left for the app to fetch once it runs: on a slow phone
 *  connection it would otherwise share the bandwidth the first paint needs (the charts library). */
export const PRELOAD_MAX_DEP = 150_000;
const sizes = new Map<string, number>();
const fileSize = (f: string) => {
  let n = sizes.get(f);
  if (n === undefined) { try { n = statSync(f).size; } catch { n = 0; } sizes.set(f, n); }
  return n;
};

/** The page chunk's manifest entry and what the entry already loads (its files and CSS), or null (dev, tests, no chunk). */
function routeChunks(indexFile: string, path: string) {
  const chunks = viteManifest(indexFile);
  const mod = pageModule(path);
  const page = mod && chunks?.[`src/pages/${mod}.tsx`];
  if (!chunks || !page) return null;
  const entry = Object.values(chunks).find((c) => c.isEntry);
  const walk = (c: ManifestChunk, into: Set<string>, css: Set<string>) => {
    if (into.has(c.file)) return;
    into.add(c.file);
    for (const f of c.css ?? []) css.add(f);
    for (const k of c.imports ?? []) if (chunks[k]) walk(chunks[k], into, css);
  };
  const have = new Set<string>();
  const entryCss = new Set<string>();
  if (entry) walk(entry, have, entryCss);
  const js = new Set<string>();
  const css = new Set<string>();
  walk(page, js, css);
  return { page, have, js, css: [...css].filter((f) => !entryCss.has(f)) };
}

/** <link>s that start loading this page's code chunk with the HTML, rather than after the main
 *  bundle has run and asked for it. Files the entry already loads are left out, and so is a large
 *  shared dependency (PRELOAD_MAX_DEP). Page CSS is fetched early but never blocks the first paint. */
export function routePreloads(indexFile: string, path: string): string {
  const r = routeChunks(indexFile, path);
  if (!r) return "";
  const dist = dirname(indexFile);
  const tags = [
    ...r.css.map((f) => `<link rel="preload" as="style" crossorigin href="/${f}" />`),
    ...[...r.js].filter((f) => !r.have.has(f) && (f === r.page.file || fileSize(join(dist, f)) <= PRELOAD_MAX_DEP))
      .map((f) => `<link rel="modulepreload" crossorigin href="/${f}" />`),
  ];
  return tags.join("\n    ");
}

/** The page chunk's own stylesheets, as files: with the app's, what a drawn page's first paint draws on (inlineCriticalCss). */
function pageStylesheets(indexFile: string, path: string): string[] {
  return (routeChunks(indexFile, path)?.css ?? []).map((f) => join(dirname(indexFile), f));
}

/**
 * index.html for this path and query (the page's own head tags, its code chunk preloaded, and the static first
 * paint: server/bootShell.ts) and its HTTP status: 404 for a path that isn't an app page (an unknown
 * route, team or event). A 404 still carries the app's HTML, so the browser shows the app's own
 * not-found page.
 */
export async function renderPage(file: string, path: string, query: Record<string, unknown> = {}): Promise<{ status: 200 | 404; html: string }> {
  const { pageMeta, headTags } = await import("./seoMeta.js");
  // The home page's hero lines too (the owner's, or the built-in ones): every page carries them (server/bootShell.ts).
  // And on /events, whether today has coin flips (coinFlipsHint).
  // And whether the light version is on (the first paint offers it on a slow load: server/bootShell.ts).
  const [meta, hero, flips, lite] = await Promise.all([pageMeta(path, query), liveHeroLines(), coinFlipsHint(path), isEnabled("venueLightMode").catch(() => false)]);
  // A page the server drew whole (meta.firstPaint) is the app's own markup: its first paint carries the part of the app's
  // stylesheet that markup uses, inline (server/criticalCss.ts), and waits for its text fonts (FIRST_PAINT_FONTS), so it
  // paints once, styled, never as unstyled text that then changes. Nothing else downloads until those fonts are here
  // (afterFirstPaint): on venue Wi-Fi the whole stylesheet and the app's code shared the line with them and held the
  // page back for seconds (2026-11-02: 400 kbps, team page first paint 8.5 s live).
  const drawn = !!meta.firstPaint && !meta.notFound;
  const head = [headTags(path, meta), flips, routePreloads(file, path), BOOT_STYLE, drawn ? FIRST_PAINT_FONTS : ""].filter(Boolean).join("\n    ");
  const shell = indexHtml(file).replace("</head>", () => `    ${head}\n  </head>`);
  const deferred = drawn ? deferCss(shell) : null;
  // Callbacks, so $', $`, $& in a team or event name are inserted literally (a replacement string would expand them).
  let html = (deferred ? afterFirstPaint(deferred.html, { css: deferred.href, fonts: FIRST_PAINT_FONT_LOADS }) : afterFirstPaint(nonBlockingCss(shell)))
    // The privacy banner goes after #root, not in it: React's first render replaces #root, and the app's banner takes over from this one.
    // Not on a bare page (the pit display): nobody answers it on a pit TV, and the app shows no banner there to take it over.
    .replace(/<div id="root">(?:<!--cs-boot-->)?<\/div>/, () => `<div id="root">${bootShell(path, meta, hero, meta.notFound || !lite ? null : liteHref(path, queryString(query)))}</div>${isBareRoute(path) ? "" : bootConsent()}`);
  if (deferred) html = inlineCriticalCss(html, [join(dirname(file), deferred.href), ...pageStylesheets(file, path)]);
  return { status: meta.notFound ? 404 : 200, html };
}

/** The id of a drawn page's inline critical CSS (inlineCriticalCss). */
export const CRITICAL_CSS_ID = "cs-critical";

/** The faces FIRST_PAINT_FONTS declares, as document.fonts.load() asks for them: a drawn page waits on these. */
export const FIRST_PAINT_FONT_LOADS = ["400 1em Inter", '700 1em "Space Grotesk"', '400 1em "JetBrains Mono"'];

/** How long a drawn page waits on its fonts at most: the font-display: block window, after which text shows anyway. */
export const FONT_WAIT_MS = 3000;

/** The class on <html> while a drawn page waits on its fonts (FIRST_PAINT_FONTS). */
export const FONT_WAIT_CLASS = "cs-fw";

/**
 * The app's fonts for a page the server drew whole, with font-display: block: its text paints once the fonts are here
 * (preloaded with the HTML: the two text fonts in index.html, the mono one, for team numbers, here), never in a
 * stand-in font that then reflows. The same faces as the stylesheet's (src/index.css), declared after it, so these
 * win; a font still on its way after 3 s gives way to the stand-in, as usual.
 *
 * The page itself (<body>) stays hidden until then too (FONT_WAIT_CLASS, set and cleared by the script here; a CSS
 * animation shows it after FONT_WAIT_MS even if that script stalls). Laid out in the stand-in font's metrics while
 * its text was invisible, the page's button rows rewrapped once the fonts arrived (a layout shift); now it paints once,
 * in its own fonts. Without JavaScript nothing is hidden.
 */
export const FIRST_PAINT_FONTS = `<link rel="preload" href="/fonts/JetBrainsMono-400.woff2" as="font" type="font/woff2" crossorigin />`
  + `<style>@font-face{font-family:"Inter";font-weight:400 800;font-style:normal;font-display:block;src:url("/fonts/Inter.woff2") format("woff2")}`
  + `@font-face{font-family:"Space Grotesk";font-weight:500 700;font-style:normal;font-display:block;src:url("/fonts/SpaceGrotesk.woff2") format("woff2")}`
  + `@font-face{font-family:"JetBrains Mono";font-weight:400;font-style:normal;font-display:block;src:url("/fonts/JetBrainsMono-400.woff2") format("woff2")}</style>`
  + `<style>html.${FONT_WAIT_CLASS} body{visibility:hidden;animation:${FONT_WAIT_CLASS} 0s ${FONT_WAIT_MS}ms forwards}@keyframes ${FONT_WAIT_CLASS}{to{visibility:visible}}</style>`
  + `<script>(function(){var d=document,F=d.fonts,r=d.documentElement;if(!F||!F.load||!window.Promise)return;r.classList.add('${FONT_WAIT_CLASS}');`
  + `function show(){r.classList.remove('${FONT_WAIT_CLASS}')}Promise.all(${JSON.stringify(FIRST_PAINT_FONT_LOADS)}.map(function(f){return F.load(f)})).then(show,show);setTimeout(show,${FONT_WAIT_MS})})()</script>`;

/** How long the first HTML waits on today's coin flips before going without the hint. */
export const FLIPS_HINT_MS = 150;

/**
 * Whether today has coin flips, for /events' first paint (COIN_FLIPS_META): the radar sits above the list there,
 * and on a day with none, a placeholder held while it loads would vanish and pull the whole list up (most of the
 * page's layout shift). Answered from the stored radar only (server/api/coinFlips.ts storedCoinFlips: a page load
 * never starts gathering one); none fresh, or a slow or failed read, leaves the tag out, and the page keeps the placeholder.
 */
export async function coinFlipsHint(path: string): Promise<string> {
  if (path !== "/events") return "";
  try {
    const { storedCoinFlips } = await import("./api/coinFlips.js");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((ok) => { timer = setTimeout(ok, FLIPS_HINT_MS, null); });
    const r = await Promise.race([storedCoinFlips(), late]).finally(() => clearTimeout(timer));
    return r ? `<meta name="${COIN_FLIPS_META}" content="${hasFlips(r) ? 1 : 0}" />` : "";
  } catch {
    return "";
  }
}

/**
 * The app's code, requested once the static first paint is on screen. A module script in the HTML
 * that arrives quickly (a fast connection, the HTTP cache) runs before the browser's first paint, so
 * the shell waited on the whole bundle being parsed; now a tiny loader at the end of <body> adds the
 * entry script and its modulepreloads in the task after the first frame (one frame later than the
 * HTML would have asked, on any connection). A tab opened in the background, where frames don't run,
 * still loads it within a moment (the timer fallback). The page's own preloads (routePreloads) go
 * through the loader too, in the same order.
 *
 * A page the server drew whole (`drawn`) waits longer: until its text fonts (`fonts`, FIRST_PAINT_FONT_LOADS) have
 * loaded, or FONT_WAIT_MS. Its text paints only once they're here, so on a thin connection everything else waits for
 * them rather than sharing the line. Its app stylesheet (`css`, deferCss) is added then too, as a non-blocking
 * stylesheet with the id main.tsx waits on, just after the page's inline critical CSS (inlineCriticalCss).
 */
export function afterFirstPaint(html: string, drawn?: { css: string; fonts: string[] }): string {
  const entry = /\s*<script type="module"(?:\s+crossorigin)?\s+src="([^"]+)"><\/script>/.exec(html);
  if (!entry) return html;
  const preloads: string[] = [];
  const rest = html.replace(entry[0], "").replace(/\s*<link rel="modulepreload"(?:\s+crossorigin)?\s+href="([^"]+)"\s*\/?>/g, (_m, href: string) => { preloads.push(href); return ""; });
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");
  const list = json(preloads);
  const src = json(entry[1]);
  const css = drawn
    ? `var c=d.createElement('link');c.rel='stylesheet';c.crossOrigin='anonymous';c.href=${json(drawn.css)};c.media='print';c.id='${APP_CSS_ID}';`
      + `c.onload=c.onerror=function(){c.media='all'};var k=d.getElementById('${CRITICAL_CSS_ID}');h.insertBefore(c,k?k.nextSibling:null);`
    : "";
  const after = "function after(){if(window.requestAnimationFrame)requestAnimationFrame(function(){setTimeout(go,0)});setTimeout(go,100)}";
  const start = drawn
    ? `var F=d.fonts;if(F&&F.load&&window.Promise)Promise.all(${json(drawn.fonts)}.map(function(f){return F.load(f)})).then(after,after);else after();setTimeout(go,${FONT_WAIT_MS})`
    : "after()";
  const loader = `<script>(function(){var d=document,s=0;function go(){if(s)return;s=1;var h=d.head;${css}${list}.forEach(function(u){var l=d.createElement('link');l.rel='modulepreload';l.crossOrigin='anonymous';l.href=u;h.appendChild(l)});`
    + `var e=d.createElement('script');e.type='module';e.crossOrigin='anonymous';e.src=${src};h.appendChild(e)}`
    + `${after}${start}})()</script>`;
  return rest.replace("</body>", () => `${loader}\n  </body>`);
}

/**
 * The app's global stylesheet, loaded without blocking the first paint. The static first paint
 * (bootShell, BOOT_STYLE) carries its own inline styles, so it needn't wait for the app's CSS; the
 * app itself doesn't render until that CSS has loaded (src/main.tsx), so nothing shows unstyled.
 * media="print" fetches it without blocking rendering, and its onload switches it on (onerror too, so
 * the app never waits on a stylesheet that already failed); <noscript>
 * keeps it a normal stylesheet without JavaScript. Only the entry's own stylesheet (the first one)
 * is changed.
 */
export function nonBlockingCss(html: string): string {
  return html.replace(/<link rel="stylesheet"((?:\s+crossorigin)?)\s+href="(\/assets\/[^"]+\.css)"\s*\/?>/, (_m, co: string, href: string) =>
    `<link rel="stylesheet"${co} href="${href}" media="print" onload="this.media='all'" onerror="this.media='all'" id="${APP_CSS_ID}" />`
    + `<noscript><link rel="stylesheet"${co} href="${href}" /></noscript>`);
}

/** Where a drawn page's critical CSS goes (deferCss leaves it, inlineCriticalCss fills it). */
const CRITICAL_MARK = "<!--cs-critical-->";

/**
 * A drawn page's app stylesheet, taken out of its HTML: the page's loader adds it once the first paint's fonts are here
 * (afterFirstPaint), and its critical CSS stands in until then (inlineCriticalCss, at the stylesheet's place). Without
 * JavaScript, a <noscript> copy is a normal stylesheet. Null when there's no stylesheet link (dev, tests).
 */
export function deferCss(html: string): { html: string; href: string } | null {
  let href = "";
  const out = html.replace(/<link rel="stylesheet"((?:\s+crossorigin)?)\s+href="(\/assets\/[^"]+\.css)"\s*\/?>/, (_m, co: string, h: string) => {
    href = h;
    return `${CRITICAL_MARK}<noscript><link rel="stylesheet"${co} href="${h}" /></noscript>`;
  });
  return href ? { html: out, href } : null;
}

/**
 * A drawn page's critical CSS (server/criticalCss.ts: the rules of these stylesheets its markup uses) inline, where
 * deferCss took the app's stylesheet out. Inline styles are allowed by the CSP (server/securityHeaders.ts), and the
 * page's own <style> blocks (BOOT_STYLE, FIRST_PAINT_FONTS) still come after it.
 */
export function inlineCriticalCss(html: string, sheets: string[]): string {
  const css = criticalCss(sheets, html).replace(/<\/(style)/gi, "<\\/$1");
  return html.replace(CRITICAL_MARK, () => (css ? `<style id="${CRITICAL_CSS_ID}">${css}</style>` : ""));
}

/** index.html for this path (renderPage without the status). */
export async function renderIndex(file: string, path: string, query: Record<string, unknown> = {}): Promise<string> {
  return (await renderPage(file, path, query)).html;
}
