// Security headers on every response (launch audit NEW-8), set here in the app rather than at Cloudflare or nginx
// so every host the app runs on sends the same ones.
//
//   - Strict-Transport-Security on HTTPS requests (a year, subdomains too; no preload: that list is hard to leave).
//   - X-Frame-Options SAMEORIGIN and CSP frame-ancestors 'self': nothing embeds Control Scout's pages (Control
//     Point links to them, the retired stream overlay was an OBS browser source, not a frame).
//   - Permissions-Policy: camera and microphone for this site only (recording a match, MatchVideo.tsx); every
//     powerful feature the app never uses is off. Fullscreen, picture-in-picture and the rest stay at the browser's
//     default, so the YouTube player's own `allow` list still works.
//   - Content-Security-Policy on the app's HTML: report-only until the reports (POST /api/csp-report, logged once
//     per kind) are clean, then CSP_ENFORCE=1 enforces it. Inline scripts are pinned by hash, from each page as sent.
import { createHash } from "node:crypto";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { env } from "./env.js";

export const HSTS = "max-age=31536000; includeSubDomains";

export const PERMISSIONS_POLICY = [
  "camera=(self)", "microphone=(self)",
  "geolocation=()", "payment=()", "usb=()", "serial=()", "bluetooth=()", "hid=()", "midi=()",
  "display-capture=()", "browsing-topics=()",
].join(", ");

/** The one inline event handler the HTML carries: the app stylesheet's switch from print to all (server/seo.ts nonBlockingCss). */
export const CSS_SWITCH_HANDLER = "this.media='all'";

const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

/** sha256 sources for every inline <script> (no src) in the HTML. JSON-LD blocks never run, but hashing them is harmless. */
export function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>();
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/i.test(m[1] ?? "")) continue;
    // Browsers hash the text after HTML newline normalisation (CRLF and CR become LF).
    out.add(sha256(m[2].replace(/\r\n?/g, "\n")));
  }
  return [...out];
}

const origin = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
};

/** Where entry photos go up to and come back from (server/scout/r2.ts): the S3 endpoint and the public bucket URL. */
function photoOrigins(): string[] {
  if (env.r2Fake) return []; // same origin (/__fake-r2)
  const endpoint = env.r2Endpoint ?? (env.r2AccountId ? `https://${env.r2AccountId}.r2.cloudflarestorage.com` : null);
  return [origin(endpoint), origin(env.r2PublicUrl)].filter((o): o is string => !!o);
}

export const CSP_REPORT_PATH = "/api/csp-report";

/**
 * The policy for one HTML page. Everything the app loads, by where it comes from:
 *   scripts   our bundle; the page's inline scripts (hashes); WebAssembly for saved seasons (sql.js);
 *             Cloudflare's analytics beacon, should it be switched on at Cloudflare
 *   styles    our CSS plus inline styles (the static first paint, React and motion style props)
 *   images    our own, data:/blob: (share cards, photo previews), YouTube thumbnails, entry photos (R2)
 *   fonts     self-hosted (public/fonts)
 *   media     recordings played from IndexedDB (blob:)
 *   connect   our API and packs, photo uploads to R2, Cloudflare's beacon endpoint
 *   frames    the YouTube player (youtube-nocookie.com)
 *   workers   the service worker and the local projection worker
 */
export function buildCsp(scriptHashes: string[], reportUri: string | null = CSP_REPORT_PATH): string {
  const photos = photoOrigins();
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'wasm-unsafe-eval'", "https://static.cloudflareinsights.com", ...scriptHashes]],
    ["script-src-attr", ["'unsafe-hashes'", sha256(CSS_SWITCH_HANDLER)]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https://i.ytimg.com", ...photos]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", ["'self'", "blob:"]],
    ["connect-src", ["'self'", "https://cloudflareinsights.com", ...photos]],
    ["frame-src", ["https://www.youtube-nocookie.com"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["frame-ancestors", ["'self'"]],
  ];
  if (reportUri) directives.push(["report-uri", [reportUri]]);
  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

/** Report-only unless CSP_ENFORCE=1. */
export const cspHeaderName = () => (env.cspEnforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only");

/** Sets the page's CSP for this HTML (call just before sending it). */
export function setPageCsp(res: Response, html: string): void {
  res.setHeader(cspHeaderName(), buildCsp(inlineScriptHashes(html)));
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;

/**
 * HTTPS as the visitor sees it: TLS here or at the trusted proxy (X-Forwarded-Proto, `trust proxy`), or at
 * Cloudflare when Cloudflare reaches the origin over plain HTTP (CF-Visitor). In production every request that
 * isn't on a loopback host counts too: Cloudflare only serves the site over HTTPS, and a browser ignores HSTS
 * on a plain-HTTP response anyway (RFC 6797 §8.1). Local development (http://localhost) never gets it.
 */
function overHttps(req: Request): boolean {
  if (req.secure) return true;
  if (/"scheme"\s*:\s*"https"/.test(String(req.headers["cf-visitor"] ?? ""))) return true;
  return env.production && !LOOPBACK.test(String(req.headers.host ?? ""));
}

/** Every response: the headers above (the CSP itself only on HTML, setPageCsp). */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  if (overHttps(req)) res.setHeader("Strict-Transport-Security", HSTS);
  next();
}

// --- Violation reports ---------------------------------------------------------------------------------------

const seen = new Map<string, number>();
const SEEN_CAP = 500;
/** Tests: forget the reports counted so far. */
export const resetCspReports = () => seen.clear();
/** The owner's view of what the policy would block, by directive and blocked origin (in memory, since the server started). */
export const cspReportCounts = () => new Map(seen);

/** One browser violation report (the legacy `csp-report` body or the Reporting API's), as "directive blocked-origin". */
export function summarizeCspReport(body: unknown): string | null {
  const b = body as Record<string, any> | null;
  const r = b?.["csp-report"] ?? (Array.isArray(b) ? b[0]?.body : b?.body) ?? null;
  if (!r || typeof r !== "object") return null;
  const directive = String(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? r.violatedDirective ?? "").split(" ")[0].slice(0, 40);
  if (!/^[a-z-]+$/.test(directive)) return null;
  const blocked = String(r["blocked-uri"] ?? r.blockedURL ?? "");
  // Origin only: never a path or query, which might carry someone's data.
  let what = /^[a-z-]+$/i.test(blocked) ? blocked : "(other)";
  try { if (/^https?:/i.test(blocked)) what = new URL(blocked).origin; } catch { /* keep the keyword */ }
  if (/^(data|blob|wss?):/i.test(blocked)) what = blocked.split(":")[0] + ":";
  return `${directive} ${what || "(none)"}`;
}

/**
 * POST /api/csp-report: counted in memory and logged once per kind (directive + blocked origin), so the server's
 * log shows what an enforcing policy would block before CSP_ENFORCE is switched on. Always 204, never an error.
 */
export function cspReportRouter(log: (m: string) => void = (m) => console.log(m)): Router {
  const r = express.Router();
  r.post("/", express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "16kb" }), (req, res) => {
    const kind = summarizeCspReport(req.body);
    if (kind) {
      const n = seen.get(kind);
      if (n !== undefined) seen.set(kind, n + 1);
      else if (seen.size < SEEN_CAP) { seen.set(kind, 1); log(`[csp] would block: ${kind}`); }
    }
    res.status(204).end();
  });
  // A malformed body (or one over the cap) is still just a 204.
  r.use((_err: unknown, _req: Request, res: Response, _next: NextFunction) => { res.status(204).end(); });
  return r;
}
