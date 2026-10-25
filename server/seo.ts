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
import { isBareRoute, pageModule } from "../src/shared/routes.js";
import { APP_CSS_ID } from "../src/shared/boot.js";

/** The canonical origin, e.g. "https://controlscout.org" (no trailing slash). */
export const canonicalOrigin = () => new URL(env.canonicalUrl).origin;

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

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
  const otherHost = env.production && host && !LOOPBACK.has(host) && host !== home.hostname;
  if (otherHost || path !== req.path) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    // Always absolute, on the canonical origin: a redirect can never leave the site.
    return res.redirect(301, `${home.origin}${path}${qs}`);
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

/** <link>s that start loading this page's code chunk with the HTML, rather than after the main
 *  bundle has run and asked for it. Files the entry already loads are left out, and so is a large
 *  shared dependency (PRELOAD_MAX_DEP). Page CSS is fetched early but never blocks the first paint. */
export function routePreloads(indexFile: string, path: string): string {
  const chunks = viteManifest(indexFile);
  const mod = pageModule(path);
  const page = mod && chunks?.[`src/pages/${mod}.tsx`];
  if (!chunks || !page) return "";
  const entry = Object.values(chunks).find((c) => c.isEntry);
  const have = new Set<string>();
  const walk = (c: ManifestChunk, into: Set<string>, css: Set<string>) => {
    if (into.has(c.file)) return;
    into.add(c.file);
    for (const f of c.css ?? []) css.add(f);
    for (const k of c.imports ?? []) if (chunks[k]) walk(chunks[k], into, css);
  };
  const entryCss = new Set<string>();
  if (entry) walk(entry, have, entryCss);
  const js = new Set<string>();
  const css = new Set<string>();
  walk(page, js, css);
  const dist = dirname(indexFile);
  const tags = [
    ...[...css].filter((f) => !entryCss.has(f)).map((f) => `<link rel="preload" as="style" crossorigin href="/${f}" />`),
    ...[...js].filter((f) => !have.has(f) && (f === page.file || fileSize(join(dist, f)) <= PRELOAD_MAX_DEP))
      .map((f) => `<link rel="modulepreload" crossorigin href="/${f}" />`),
  ];
  return tags.join("\n    ");
}

/**
 * index.html for this path and query (the page's own head tags, its code chunk preloaded, and the static first
 * paint: server/bootShell.ts) and its HTTP status: 404 for a path that isn't an app page (an unknown
 * route, team or event). A 404 still carries the app's HTML, so the browser shows the app's own
 * not-found page.
 */
export async function renderPage(file: string, path: string, query: Record<string, unknown> = {}): Promise<{ status: 200 | 404; html: string }> {
  const { pageMeta, headTags } = await import("./seoMeta.js");
  const meta = await pageMeta(path, query);
  const head = [headTags(path, meta), routePreloads(file, path), BOOT_STYLE].filter(Boolean).join("\n    ");
  // Callbacks, so $', $`, $& in a team or event name are inserted literally (a replacement string would expand them).
  const html = afterFirstPaint(nonBlockingCss(indexHtml(file).replace("</head>", () => `    ${head}\n  </head>`)))
    // The privacy banner goes after #root, not in it: React's first render replaces #root, and the app's banner takes over from this one.
    // Not on a bare page (the pit display): nobody answers it on a pit TV, and the app shows no banner there to take it over.
    .replace(/<div id="root">(?:<!--cs-boot-->)?<\/div>/, () => `<div id="root">${bootShell(path, meta)}</div>${isBareRoute(path) ? "" : bootConsent()}`);
  return { status: meta.notFound ? 404 : 200, html };
}

/**
 * The app's code, requested once the static first paint is on screen. A module script in the HTML
 * that arrives quickly (a fast connection, the HTTP cache) runs before the browser's first paint, so
 * the shell waited on the whole bundle being parsed; now a tiny loader at the end of <body> adds the
 * entry script and its modulepreloads in the task after the first frame (one frame later than the
 * HTML would have asked, on any connection). A tab opened in the background, where frames don't run,
 * still loads it within a moment (the timer fallback). The page's own preloads (routePreloads) go
 * through the loader too, in the same order.
 */
export function afterFirstPaint(html: string): string {
  const entry = /\s*<script type="module"(?:\s+crossorigin)?\s+src="([^"]+)"><\/script>/.exec(html);
  if (!entry) return html;
  const preloads: string[] = [];
  const rest = html.replace(entry[0], "").replace(/\s*<link rel="modulepreload"(?:\s+crossorigin)?\s+href="([^"]+)"\s*\/?>/g, (_m, href: string) => { preloads.push(href); return ""; });
  const list = JSON.stringify(preloads).replace(/</g, "\\u003c");
  const src = JSON.stringify(entry[1]).replace(/</g, "\\u003c");
  const loader = `<script>(function(){var d=document,s=0;function go(){if(s)return;s=1;var h=d.head;${list}.forEach(function(u){var l=d.createElement('link');l.rel='modulepreload';l.crossOrigin='anonymous';l.href=u;h.appendChild(l)});`
    + `var e=d.createElement('script');e.type='module';e.crossOrigin='anonymous';e.src=${src};h.appendChild(e)}`
    + `if(window.requestAnimationFrame)requestAnimationFrame(function(){setTimeout(go,0)});setTimeout(go,100)})()</script>`;
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

/** index.html for this path (renderPage without the status). */
export async function renderIndex(file: string, path: string, query: Record<string, unknown> = {}): Promise<string> {
  return (await renderPage(file, path, query)).html;
}
