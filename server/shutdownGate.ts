// The shutdown message (docs/settings.md, "Shutdown message"): while the owner has the publicAccess kill switch off,
// a visitor who isn't signed in gets only "under construction" (503, Retry-After two days, never cached), with a
// small sign-in form for people who already have an account. Signed-in accounts use the site as usual, on the same
// addresses, with every answer kept private (a shared cache such as Cloudflare's must never hand their page to an
// outsider). No data is touched; with the switch on this does nothing at all.
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { get } from "./db.js";
import { env } from "./env.js";
import { publicAccessOpen } from "./flags.js";
import { CSP_REPORT_PATH, cspHeaderName } from "./securityHeaders.js";
import { gateSessions as sessions, readCookie, SESSION_COOKIE, sha256 } from "./auth/session.js";
import { authProviders } from "./auth/routes.js";
import { SHUTDOWN_BACK_SOON, SHUTDOWN_HEADLINE, SIGNUPS_CLOSED_MESSAGE } from "../src/shared/shutdown.js";

export { SIGNUPS_CLOSED_MESSAGE };

/** Two days: search engines keep the index and come back later. */
export const RETRY_AFTER_S = 172800;

/** Always answered as usual: signing in, the flags the app reads, the digest's unsubscribe and bounce webhook, CSP
 *  reports, and the files the browser asks for on its own (scripts, fonts, icons, manifest, service worker, robots,
 *  the IndexNow key). Matched on the exact path, never one with "..", "%" or a backslash in it. */
const ALWAYS = [
  /^\/api\/(auth\/.+|flags|health|digest\/(unsubscribe|webhook))\/?$/,
  new RegExp(`^${CSP_REPORT_PATH}/?$`),
  /^\/(assets|fonts)\/[A-Za-z0-9._/-]+$/,
  /^\/(mark\.webp|mark-white\.webp|logo-56\.webp|favicon\.ico|favicon-48\.png|apple-touch-icon\.png|icon-(192|512)\.png|manifest\.webmanifest|sw\.js|robots\.txt)$/,
  /^\/[A-Za-z0-9-]{8,128}\.txt$/,
];
const alwaysThrough = (path: string) => !/\.\.|%|\\/.test(path) && ALWAYS.some((re) => re.test(path));

const SESSION_TTL_MS = 30_000;
/** Is this request's session cookie a live session? Read only (unlike currentUser, which also stamps last_seen), and
 *  kept for 30 s per token so a signed-in page load doesn't ask the database once per file. */
async function signedIn(req: Request): Promise<boolean> {
  const t = readCookie(req, SESSION_COOKIE);
  if (!t) return false;
  const id = sha256(t), now = Date.now();
  const hit = sessions.get(id);
  if (hit && now - hit.at < SESSION_TTL_MS) return hit.ok;
  const s = await get<{ expires_at: string }>("SELECT s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?", [id]);
  const ok = !!s && Date.parse(s.expires_at) >= now;
  if (sessions.size > 20_000) sessions.clear();
  sessions.set(id, { ok, at: now });
  return ok;
}
/** Tests: forget the kept session answers. */
export const resetGateSessions = () => sessions.clear();

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
/** The uptime monitor (deploy/uptime-worker) with the right x-uptime-key. Nothing gets through when UPTIME_GATE_KEY isn't set. */
function isUptimeMonitor(req: Request): boolean {
  const key = env.uptimeGateKey, sent = req.get("x-uptime-key");
  return !!key && !!sent && timingSafeEqual(digest(key), digest(sent));
}

/** The answer is for this visitor only: whatever a route sets, it leaves as private, no-store, varying by cookie. */
function keepPrivate(res: Response): void {
  const setHeader = res.setHeader;
  res.setHeader = function (this: Response, name: string, value: Parameters<typeof setHeader>[1]) {
    return setHeader.call(this, name, /^cache-control$/i.test(name) ? "private, no-store" : value);
  } as typeof setHeader;
  const writeHead = res.writeHead;
  res.writeHead = function (this: Response, ...a: Parameters<typeof writeHead>) {
    this.setHeader("Cache-Control", "private, no-store");
    this.vary("Cookie");
    return writeHead.apply(this, a);
  } as typeof writeHead;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The email sign-in: a code by email, then the code; signed in, the page reloads into the site. */
export const GATE_SCRIPT = `(function(){var e=document.getElementById("email-form"),c=document.getElementById("code-form"),m=document.getElementById("msg"),addr="";
function post(u,b){return fetch(u,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json().catch(function(){return{};}).then(function(j){return{ok:r.ok,j:j};});});}
function fail(r){m.textContent=(r&&r.j&&(r.j.message||r.j.error))||"Something went wrong. Try again.";}
if(e)e.addEventListener("submit",function(ev){ev.preventDefault();addr=e.elements.email.value.trim();m.textContent="Sending a code...";post("/api/auth/email/start",{email:addr}).then(function(r){if(!r.ok)return fail(r);e.hidden=true;c.hidden=false;m.textContent="We sent a 6-digit code to "+addr+".";c.elements.code.focus();},fail);});
if(c)c.addEventListener("submit",function(ev){ev.preventDefault();m.textContent="Signing in...";post("/api/auth/email/verify",{email:addr,code:c.elements.code.value.trim()}).then(function(r){if(!r.ok)return fail(r);location.reload();},fail);});})();`;
const hash = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
export const GATE_CSP = `default-src 'none'; script-src ${hash(GATE_SCRIPT)}; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`;

/** Always dark: white for the words, grey for what's secondary, nothing else. */
export const GATE_STYLE = `@font-face{font-family:Inter;src:url(/fonts/Inter.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Space Grotesk";src:url(/fonts/SpaceGrotesk.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#0a0a0b;--fg:#f4f4f5;--muted:#a1a1aa;--card:#121214;--line:#ffffff14;--field:#ffffff1f;--fill:#1c1c1f;--fill-hover:#242428;color-scheme:dark}
*{box-sizing:border-box}html,body{min-height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.wash{position:absolute;left:0;right:0;top:0;height:38vh;min-height:240px;pointer-events:none;z-index:0;
-webkit-mask-image:linear-gradient(to bottom,#000 0%,rgb(0 0 0/.55) 40%,transparent 100%);mask-image:linear-gradient(to bottom,#000 0%,rgb(0 0 0/.55) 40%,transparent 100%)}
.wash .tone{position:absolute;inset:0;background:linear-gradient(90deg,#3a5379 0%,#304e52 30%,#274d41 50%,#3a4062 72%,#4c406e 100%)}
.wash svg{position:absolute;inset:0;width:100%;height:100%;opacity:.3;mix-blend-mode:screen}
main{position:relative;z-index:1;width:100%;max-width:26rem;margin:0 auto;padding:18vh 20px 64px;display:flex;flex-direction:column;align-items:center;text-align:center}
.mark{width:56px;height:56px;display:block}
h1{margin:36px 0 0;font:600 clamp(1.6rem,4.6vw,2rem)/1.2 "Space Grotesk",Inter,sans-serif;letter-spacing:-.02em;text-wrap:balance}
.lead{margin:10px 0 0;color:var(--muted);font-size:1rem}
.note{margin:12px 0 0;color:var(--muted);font-size:.875rem}
.card{width:100%;margin-top:48px;padding:24px;border:1px solid var(--line);border-radius:20px;background:var(--card);text-align:left}
.card h2{margin:0;font:600 1rem/1.3 Inter,sans-serif}.card .sub{margin:4px 0 20px;color:var(--muted);font-size:.875rem}
.sr{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;height:44px;padding:0 14px;border:1px solid var(--field);border-radius:12px;background:transparent;color:var(--fg);font:inherit;outline:none;transition:border-color .15s}
input::placeholder{color:#71717a}input:focus{border-color:#ffffff59}
button,.btn{height:44px;padding:0 18px;border:1px solid var(--field);border-radius:12px;color:var(--fg);font:500 .9375rem/1 Inter,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;transition:background .15s,border-color .15s}
button{background:var(--fill)}button:hover{background:var(--fill-hover);border-color:#ffffff33}
.btn{width:100%;background:transparent}.btn:hover{background:#ffffff0a;border-color:#ffffff33}
.or{display:flex;align-items:center;gap:12px;margin:20px 0;color:var(--muted);font-size:.75rem;letter-spacing:.12em}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--line)}
.links{display:grid;gap:8px}
#msg{margin:12px 0 0;color:var(--muted);font-size:.85rem}#msg:empty{display:none}
:focus-visible{outline:2px solid var(--fg);outline-offset:2px}
@media (max-width:360px){.row{flex-direction:column}}`;

/** The grain on the wash: coarse, stepped noise (a matte, chalky speckle rather than a smooth haze), drawn in the page (no image request, nothing the page's CSP has to allow). */
const GRAIN = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="discrete" tableValues="0 0 .35 .7 1"/><feFuncG type="discrete" tableValues="0 0 .35 .7 1"/><feFuncB type="discrete" tableValues="0 0 .35 .7 1"/></feComponentTransfer></filter><rect width="100%" height="100%" filter="url(#grain)"/></svg>`;

/** The page an outsider sees: the mark in white, the two lines, and a way in for people who already have an account.
 *  Always dark: near-black, a soft grainy wash across the top, white and grey type; no yellow, glow, tape or grid. */
export function gatePage(closed: boolean): string {
  const p = authProviders();
  const links = [
    p.controlPoint ? `<a class="btn" href="/api/auth/control-point/start?back=%2F">Sign in with Control Point</a>` : "",
    p.google ? `<a class="btn" href="/api/auth/google/start">Sign in with Google</a>` : "",
  ].filter(Boolean).join("");
  const email = p.email ? `<form id="email-form" method="post"><label class="sr" for="email">Email</label><div class="row"><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><button type="submit">Send code</button></div></form>
<form id="code-form" method="post" hidden><label class="sr" for="code">6-digit code</label><div class="row"><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" required><button type="submit">Sign in</button></div></form>
<p id="msg" role="status"></p>` : "";
  const signIn = email || links ? `<section class="card" aria-labelledby="signin"><h2 id="signin">Have an account?</h2><p class="sub">Sign in to keep using Control Scout.</p>${email}${email && links ? `<div class="or">OR</div>` : ""}${links ? `<div class="links">${links}</div>` : ""}</section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<meta name="theme-color" content="#0a0a0b"><title>${esc(SHUTDOWN_HEADLINE)}</title><link rel="icon" href="/favicon.ico">
<link rel="preload" href="/fonts/SpaceGrotesk.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/Inter.woff2" as="font" type="font/woff2" crossorigin>
<style>${GATE_STYLE}</style></head>
<body><div class="wash" aria-hidden="true"><div class="tone"></div>${GRAIN}</div>
<main><img class="mark" src="/mark-white.webp" alt="Control Scout" width="56" height="56">
<h1>${esc(SHUTDOWN_HEADLINE)}</h1><p class="lead">${esc(SHUTDOWN_BACK_SOON)}</p>${closed ? `<p class="note">${esc(SIGNUPS_CLOSED_MESSAGE)}</p>` : ""}
${signIn}</main>${email ? `<script>${GATE_SCRIPT}</script>` : ""}</body></html>`;
}

function shut(req: Request, res: Response): void {
  res.setHeader("Retry-After", String(RETRY_AFTER_S));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  res.status(503);
  if (/^\/api(\/|$)/i.test(req.path)) { res.json({ error: "unavailable", message: `${SHUTDOWN_HEADLINE} ${SHUTDOWN_BACK_SOON}` }); return; }
  res.setHeader(cspHeaderName(), GATE_CSP);
  res.type("html").send(gatePage(req.query.signin === "closed"));
}

/** Middleware (createApp, right after the JSON parser): with publicAccess on, straight through. Flags that can't be read
 *  yet: the switch's last value kept on disk, so a restart neither opens a closed site nor closes an open one. */
export function shutdownGate(req: Request, res: Response, next: NextFunction): void {
  publicAccessOpen().then(async (open) => {
    if (open || alwaysThrough(req.path)) return next();
    if (isUptimeMonitor(req) || (await signedIn(req))) { keepPrivate(res); return next(); }
    shut(req, res);
  }).catch(next);
}
