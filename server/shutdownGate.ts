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
import { SHUTDOWN_BACK_SOON, SHUTDOWN_EYEBROW, SHUTDOWN_HEADLINE, SIGNUPS_CLOSED_MESSAGE } from "../src/shared/shutdown.js";

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
  /^\/(mark\.webp|logo-56\.webp|favicon\.ico|favicon-48\.png|apple-touch-icon\.png|icon-(192|512)\.png|manifest\.webmanifest|sw\.js|robots\.txt)$/,
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
/** Before anything paints, the visitor's saved theme (the same keys as index.html): light, dim or midnight. */
export const THEME_SCRIPT = `try{var s=JSON.parse(localStorage.getItem("cs-personal:settings")||"null"),t=s&&s.value&&s.value.theme,d=document.documentElement;if(t==="light"||(t==="system"&&matchMedia("(prefers-color-scheme: light)").matches))d.classList.add("light");if(t==="dim"||t==="midnight")d.classList.add(t);}catch(e){}`;
const hash = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
export const GATE_CSP = `default-src 'none'; script-src ${hash(THEME_SCRIPT)} ${hash(GATE_SCRIPT)}; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`;

/** The app's own look (src/index.css): graphite by default, the saved theme's colours, Space Grotesk and Inter, the
 *  brand yellow, and the drifting grid with its breathing glow behind everything. */
const GATE_STYLE = `@font-face{font-family:Inter;src:url(/fonts/Inter.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Space Grotesk";src:url(/fonts/SpaceGrotesk.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#0a0a0b;--fg:#f4f4f5;--muted:#a1a1aa;--card:#111113;--border:#ffffff14;--input:#ffffff1c;--accent:#ffc700;--accent-hover:#ffd633;--accent-ink:#231a00;--accent-text:#ffc700;--tint:255 199 0;--line:.05;--breath:.06;color-scheme:dark}
html.light{--bg:#fff;--fg:#09090b;--muted:#52525b;--card:#fff;--border:#e4e4e7;--input:#e4e4e7;--accent:#eab308;--accent-hover:#ca8a04;--accent-ink:#231a00;--accent-text:#875200;--tint:234 179 8;--line:.045;--breath:.08;color-scheme:light}
html.dim{--bg:#1e1f23;--fg:#e4e4e7;--muted:#b4b4bd;--card:#232428;--border:#ffffff1a;--input:#ffffff26}
html.midnight{--bg:#000;--card:#08080a;--border:#ffffff12;--input:#ffffff1a}
*{box-sizing:border-box}html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.amb{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.grid{position:absolute;inset:-32px;background-image:radial-gradient(130% 95% at 50% 32px,transparent 35%,var(--bg) 100%),linear-gradient(rgb(var(--tint)/var(--line)) 1px,transparent 1px),linear-gradient(90deg,rgb(var(--tint)/var(--line)) 1px,transparent 1px);background-size:100% 100%,32px 32px,32px 32px;animation:drift 48s linear infinite}
.breath{position:absolute;inset:0;background:radial-gradient(45vw 35vh at 0% 0%,rgb(var(--tint)/var(--breath)),transparent 70%),radial-gradient(45vw 35vh at 100% 0%,rgb(var(--tint)/var(--breath)),transparent 70%);animation:breathe 9s ease-in-out infinite}
@keyframes drift{to{transform:translate3d(32px,32px,0)}}@keyframes breathe{0%,100%{opacity:.35}50%{opacity:1}}
.page{position:relative;z-index:1;min-height:100%;display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:.6rem;padding:18px 20px;font:600 1.0625rem/1 "Space Grotesk",sans-serif;letter-spacing:-.01em}
header img{width:28px;height:28px}
main{flex:1;width:100%;max-width:34rem;margin:0 auto;padding:6vh 16px 48px;display:flex;flex-direction:column;align-items:center;text-align:center}
.hero{position:relative;width:132px;height:132px;display:grid;place-items:center;margin-bottom:28px}
.hero:before{content:"";position:absolute;inset:-24px;border-radius:50%;background:radial-gradient(circle,rgb(var(--tint)/.22),transparent 68%)}
.hero img{position:relative;width:112px;height:112px;filter:drop-shadow(0 10px 30px rgb(var(--tint)/.25))}
.tape{position:absolute;left:-46px;right:-46px;bottom:6px;height:22px;transform:rotate(-8deg);border-radius:3px;box-shadow:0 6px 18px -6px rgb(0 0 0/.5);background:repeating-linear-gradient(-45deg,var(--accent) 0 14px,#111 14px 28px);background-size:39.6px 100%;animation:tape 1.6s linear infinite}
@keyframes tape{to{background-position:39.6px 0}}
.eyebrow{display:inline-flex;align-items:center;gap:.5rem;padding:.3rem .7rem;border:1px solid rgb(var(--tint)/.35);border-radius:999px;background:rgb(var(--tint)/.08);color:var(--accent-text);font-size:.72rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 rgb(var(--tint)/.6);animation:pulse 2s ease-out infinite}
@keyframes pulse{70%{box-shadow:0 0 0 8px rgb(var(--tint)/0)}100%{box-shadow:0 0 0 0 rgb(var(--tint)/0)}}
h1{margin:16px 0 0;font:700 clamp(1.9rem,6vw,2.6rem)/1.1 "Space Grotesk",sans-serif;letter-spacing:-.025em;text-wrap:balance}
.lead{margin:12px 0 0;color:var(--muted);font-size:1.0625rem}
.note{margin:14px 0 0;color:var(--accent-text);font-size:.9rem}
.card{width:100%;margin-top:40px;padding:22px;border:1px solid var(--border);border-radius:16px;background:color-mix(in srgb,var(--card) 80%,transparent);backdrop-filter:blur(8px);text-align:left;box-shadow:0 12px 40px -16px rgb(var(--tint)/.18)}
.card h2{margin:0 0 4px;font:600 1.05rem/1.3 "Space Grotesk",sans-serif}.card .sub{margin:0 0 16px;color:var(--muted);font-size:.875rem}
label{display:block;margin-bottom:6px;color:var(--muted);font-size:.8125rem;font-weight:500}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;height:44px;padding:0 14px;border:1px solid var(--input);border-radius:10px;background:transparent;color:var(--fg);font:inherit;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgb(var(--tint)/.2)}
button,.btn{height:44px;padding:0 16px;border-radius:10px;font:600 .9375rem/1 Inter,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;transition:background .15s,border-color .15s,transform .1s}
button{border:0;background:var(--accent);color:var(--accent-ink)}button:hover{background:var(--accent-hover)}button:active,.btn:active{transform:translateY(1px)}
.or{display:flex;align-items:center;gap:12px;margin:18px 0;color:var(--muted);font-size:.75rem;text-transform:uppercase;letter-spacing:.12em}.or:before,.or:after{content:"";flex:1;height:1px;background:var(--border)}
.links{display:grid;gap:8px}.btn{width:100%;border:1px solid var(--input);background:transparent;color:var(--fg)}.btn:hover{border-color:var(--accent)}
#msg{margin:10px 0 0;color:var(--muted);font-size:.85rem}#msg:empty{display:none}
footer{position:relative;z-index:1;padding:20px;text-align:center;color:var(--muted);font-size:.8rem}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.grid,.breath,.tape,.dot{animation:none}}`;

/** The page an outsider sees: Control Scout's own look, the two lines, and a way in for people who already have an
 *  account. */
export function gatePage(closed: boolean): string {
  const p = authProviders();
  const links = [
    p.controlPoint ? `<a class="btn" href="/api/auth/control-point/start?back=%2F">Sign in with Control Point</a>` : "",
    p.google ? `<a class="btn" href="/api/auth/google/start">Sign in with Google</a>` : "",
  ].filter(Boolean).join("");
  const email = p.email ? `<form id="email-form" method="post"><label for="email">Email</label><div class="row"><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><button type="submit">Send code</button></div></form>
<form id="code-form" method="post" hidden><label for="code">6-digit code</label><div class="row"><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><button type="submit">Sign in</button></div></form>
<p id="msg" role="status"></p>` : "";
  const signIn = email || links ? `<section class="card" aria-labelledby="signin"><h2 id="signin">Have an account?</h2><p class="sub">Sign in to keep using Control Scout.</p>${email}${email && links ? `<div class="or">or</div>` : ""}${links ? `<div class="links">${links}</div>` : ""}</section>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<meta name="theme-color" content="#0a0a0b"><title>${esc(SHUTDOWN_HEADLINE)}</title><link rel="icon" href="/favicon.ico">
<link rel="preload" href="/fonts/SpaceGrotesk.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/Inter.woff2" as="font" type="font/woff2" crossorigin>
<script>${THEME_SCRIPT}</script><style>${GATE_STYLE}</style></head>
<body><div class="amb" aria-hidden="true"><div class="grid"></div><div class="breath"></div></div>
<div class="page"><header><img src="/logo-56.webp" alt="" width="28" height="28">Control Scout</header>
<main><div class="hero" aria-hidden="true"><img src="/mark.webp" alt="" width="112" height="112"><div class="tape"></div></div>
<span class="eyebrow"><span class="dot"></span>${esc(SHUTDOWN_EYEBROW)}</span>
<h1>${esc(SHUTDOWN_HEADLINE)}</h1><p class="lead">${esc(SHUTDOWN_BACK_SOON)}</p>${closed ? `<p class="note">${esc(SIGNUPS_CLOSED_MESSAGE)}</p>` : ""}
${signIn}</main><footer>controlscout.org</footer></div>${email ? `<script>${GATE_SCRIPT}</script>` : ""}</body></html>`;
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
