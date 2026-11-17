// The shutdown message (docs/settings.md, "Shutdown message"): while the owner has the publicAccess kill switch off,
// a visitor who isn't signed in gets only "temporarily unavailable" (503, Retry-After two days, never cached), with a
// small sign-in form for people who already have an account. Signed-in accounts use the site as usual, on the same
// addresses, with every answer kept private (a shared cache such as Cloudflare's must never hand their page to an
// outsider). No data is touched; with the switch on this does nothing at all.
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { get } from "./db.js";
import { env } from "./env.js";
import { isEnabled } from "./flags.js";
import { CSP_REPORT_PATH, cspHeaderName } from "./securityHeaders.js";
import { readCookie, SESSION_COOKIE, sha256 } from "./auth/session.js";
import { authProviders } from "./auth/routes.js";

export const UNAVAILABLE = "Control Scout is temporarily unavailable.";
export const BACK_SOON = "We'll be back in a couple of days.";
/** Two days: search engines keep the index and come back later. */
export const RETRY_AFTER_S = 172800;
export const SIGNUPS_CLOSED_MESSAGE = "New accounts can't be made right now.";

/** Always answered as usual: signing in, the flags the app reads, the digest's unsubscribe and bounce webhook, CSP
 *  reports, and the files the browser asks for on its own (scripts, fonts, icons, manifest, service worker, robots,
 *  the IndexNow key). Matched on the exact path, never one with "..", "%" or a backslash in it. */
const ALWAYS = [
  /^\/api\/(auth\/.+|flags|health|digest\/(unsubscribe|webhook))\/?$/,
  new RegExp(`^${CSP_REPORT_PATH}/?$`),
  /^\/(assets|fonts)\/[A-Za-z0-9._/-]+$/,
  /^\/(favicon\.ico|favicon-48\.png|apple-touch-icon\.png|icon-(192|512)\.png|manifest\.webmanifest|sw\.js|robots\.txt)$/,
  /^\/[A-Za-z0-9-]{8,128}\.txt$/,
];
const alwaysThrough = (path: string) => !/\.\.|%|\\/.test(path) && ALWAYS.some((re) => re.test(path));

const SESSION_TTL_MS = 30_000;
const sessions = new Map<string, { ok: boolean; at: number }>();
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
const GATE_SCRIPT_HASH = `'sha256-${createHash("sha256").update(GATE_SCRIPT, "utf8").digest("base64")}'`;
export const GATE_CSP = `default-src 'none'; script-src ${GATE_SCRIPT_HASH}; connect-src 'self'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`;

/** The page an outsider sees: the two lines, and a way in for people who already have an account. */
export function gatePage(closed: boolean): string {
  const p = authProviders();
  const links = [
    p.controlPoint ? `<a class="btn" href="/api/auth/control-point/start?back=%2F">Sign in with Control Point</a>` : "",
    p.google ? `<a class="btn" href="/api/auth/google/start">Sign in with Google</a>` : "",
  ].filter(Boolean).join("");
  const email = p.email ? `<form id="email-form" method="post"><label for="email">Email</label><div class="row"><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Send code</button></div></form>
<form id="code-form" method="post" hidden><label for="code">Code</label><div class="row"><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><button type="submit">Sign in</button></div></form>
<p id="msg" role="status"></p>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(UNAVAILABLE)}</title><link rel="icon" href="/favicon.ico">
<style>body{margin:0;background:#f7f7f8;color:#18181b;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:28rem;margin:0 auto;padding:18vh 16px 48px}h1{font-size:1.5rem;line-height:1.3;margin:0 0 .5rem}p{margin:0 0 1rem}.note{color:#b45309}section{margin-top:3rem;padding-top:1.5rem;border-top:1px solid #e4e4e7}h2{font-size:1rem;margin:0 0 .75rem}label{display:block;font-size:.875rem;color:#52525b;margin-bottom:.25rem}.row{display:flex;gap:.5rem;margin-bottom:1rem}input{flex:1;min-width:0;font:inherit;padding:.5rem .75rem;border:1px solid #d4d4d8;border-radius:.5rem;background:#fff;color:inherit}button,.btn{font:inherit;font-size:.9375rem;padding:.5rem .9rem;border:1px solid #d4d4d8;border-radius:.5rem;background:#fff;color:#18181b;text-decoration:none;cursor:pointer;display:inline-block}.links{display:flex;flex-wrap:wrap;gap:.5rem}#msg{font-size:.875rem;color:#52525b;min-height:1.3em}</style></head>
<body><main><h1>${esc(UNAVAILABLE)}</h1><p>${esc(BACK_SOON)}</p>${closed ? `<p class="note">${esc(SIGNUPS_CLOSED_MESSAGE)}</p>` : ""}
${email || links ? `<section aria-labelledby="signin"><h2 id="signin">Have an account? Sign in</h2>${email}${links ? `<div class="links">${links}</div>` : ""}</section>` : ""}
</main>${email ? `<script>${GATE_SCRIPT}</script>` : ""}</body></html>`;
}

function shut(req: Request, res: Response): void {
  res.setHeader("Retry-After", String(RETRY_AFTER_S));
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Cookie");
  res.status(503);
  if (/^\/api(\/|$)/i.test(req.path)) { res.json({ error: "unavailable", message: `${UNAVAILABLE} ${BACK_SOON}` }); return; }
  res.setHeader(cspHeaderName(), GATE_CSP);
  res.type("html").send(gatePage(req.query.signin === "closed"));
}

/** Middleware (createApp, right after the JSON parser): with publicAccess on, straight through. */
export function shutdownGate(req: Request, res: Response, next: NextFunction): void {
  isEnabled("publicAccess").then(async (open) => {
    if (open || alwaysThrough(req.path)) return next();
    if (isUptimeMonitor(req) || (await signedIn(req))) { keepPrivate(res); return next(); }
    shut(req, res);
  }).catch(next);
}
