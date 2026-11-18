// The new look for the shutdown message (server/shutdownGate.ts), as a preview for review: /preview/shutdown, which
// only signed-in accounts reach while publicAccess is off (the gate answers everyone else first). Outsiders still get
// gatePage until the owner approves this one. Same copy, same sign-in flow (GATE_SCRIPT, the same providers), only the
// look changes: near-black, a soft grainy wash across the top (slate blue into a very dark green into muted purple, close
// in tone so it reads as one wash), the mark in
// white, and no yellow, glow, tape or grid.
import { authProviders } from "./auth/routes.js";
import { GATE_SCRIPT } from "./shutdownGate.js";
import { SHUTDOWN_BACK_SOON, SHUTDOWN_HEADLINE, SIGNUPS_CLOSED_MESSAGE } from "../src/shared/shutdown.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Always dark: white for the words, grey for what's secondary, nothing else. */
export const GATE_NEXT_STYLE = `@font-face{font-family:Inter;src:url(/fonts/Inter.woff2) format("woff2");font-weight:100 900;font-display:swap}
@font-face{font-family:"Space Grotesk";src:url(/fonts/SpaceGrotesk.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#0a0a0b;--fg:#f4f4f5;--muted:#a1a1aa;--card:#121214;--line:#ffffff14;--field:#ffffff1f;--fill:#1c1c1f;--fill-hover:#242428;color-scheme:dark}
*{box-sizing:border-box}html,body{min-height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.wash{position:absolute;left:0;right:0;top:0;height:38vh;min-height:240px;pointer-events:none;z-index:0;
-webkit-mask-image:linear-gradient(to bottom,#000 0%,rgb(0 0 0/.55) 40%,transparent 100%);mask-image:linear-gradient(to bottom,#000 0%,rgb(0 0 0/.55) 40%,transparent 100%)}
.wash .tone{position:absolute;inset:0;opacity:.7;background:linear-gradient(90deg,#26354e 0%,#1f3134 30%,#18302a 50%,#25283e 72%,#322a46 100%)}
.wash svg{position:absolute;inset:0;width:100%;height:100%;opacity:.16;mix-blend-mode:screen}
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

/** The grain on the wash: fine noise, drawn in the page (no image request, nothing the page's CSP has to allow). */
const GRAIN = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#grain)"/></svg>`;

/** The page an outsider will see once approved: the mark, the two lines, and a way in for people with an account. */
export function gatePageNext(closed: boolean): string {
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
<style>${GATE_NEXT_STYLE}</style></head>
<body data-gate-next><div class="wash" aria-hidden="true"><div class="tone"></div>${GRAIN}</div>
<main><img class="mark" src="/mark-white.webp" alt="Control Scout" width="56" height="56">
<h1>${esc(SHUTDOWN_HEADLINE)}</h1><p class="lead">${esc(SHUTDOWN_BACK_SOON)}</p>${closed ? `<p class="note">${esc(SIGNUPS_CLOSED_MESSAGE)}</p>` : ""}
${signIn}</main>${email ? `<script>${GATE_SCRIPT}</script>` : ""}</body></html>`;
}
