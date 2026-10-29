// The static first paint: the app shell's outline (sidebar, top bar, phone tab
// bar) in the app's colours, plus the page's own title and description, put
// inside #root by the server so something real shows before the JavaScript has
// loaded and run. React's first render (createRoot, no hydration) replaces all
// of it in one step. Self-contained: inline styles, no icons, plain links that
// work without JS. The theme comes from the class the inline <head> script sets
// on <html> (index.html): dark by default, html.light for light.
//
// Offline, the service worker answers every page with the cached "/" HTML, so
// the page block carries the path it was made for and hides itself on another.
import type { PageMeta } from "./seoMeta.js";
import { pageTitle } from "../src/shared/routes.js";
import { BOOT_CHOICE_GLOBAL, BOOT_CONSENT_ID, HOME_ABOUT, HOME_LEAD, homeHeadlineAt } from "../src/shared/boot.js";
import { DEFAULT_HERO_LINES, HERO_LINES_ID, type HeroLinesResponse } from "../src/shared/heroLines.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Mirrors the Shell (src/components/layout/Shell.tsx): sizes, spacing, colours. It paints before the app's
// stylesheet has loaded (server/seo.ts nonBlockingCss), so the few page-wide rules it relies on from that
// stylesheet's reset (no body margin, border-box sizing, 1.5 line height, the page colour) are here too.
// Like the app, the page scrolls the document under a sticky top bar and sidebar, with the scrollbar's gutter
// kept and the same thin scrollbar (src/index.css), so nothing moves sideways when the app takes over.
// The icon rail: below 1280 px wide always, and when folded by hand (html.cs-sb-min, set from cs-sidebar in index.html).
// A row's name stays for screen readers (visually hidden, like the app's sr-only); the brand link has its aria-label.
const rail = (on: string) => `${on}.csb-side{width:60px}${on}.csb-brand{justify-content:center;padding:0}${on}.csb-brand span{display:none}`
  + `${on}.csb-nav a span,${on}.csb-more>summary span{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}`
  + `${on}.csb-nav a,${on}.csb-more>summary{justify-content:center;padding:0}`;
export const BOOT_STYLE = `<style>
      html{background:#0a0a0b;scrollbar-gutter:stable}html.light{background:#fff}body{margin:0}
      html::-webkit-scrollbar{width:6px;height:6px}html::-webkit-scrollbar-thumb{background:#2e2e35;border-radius:999px}html.light::-webkit-scrollbar-thumb{background:#d4d4d8}
      .csb,.csb *{box-sizing:border-box}
      .csb{line-height:1.5}
      .csb{--b-bg:#0a0a0b;--b-side:#0c0c0e;--b-fg:#f4f4f5;--b-mut:#a1a1aa;--b-line:#ffffff14;--b-acc:#ffc700;--b-tab:#0e0e10f2;display:flex;min-height:100vh;min-height:100dvh;overflow-x:clip;background:var(--b-bg);color:var(--b-fg);font-family:Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
      html.light .csb{--b-bg:#fff;--b-side:#fcfcfc;--b-fg:#09090b;--b-mut:#52525b;--b-line:#e4e4e7;--b-acc:#eab308;--b-tab:#fafafaf2}
      .csb a{color:inherit;text-decoration:none}
      .csb-side{display:none;position:sticky;top:0;align-self:flex-start;height:100vh;height:100dvh;flex-direction:column;flex-shrink:0;width:232px;border-right:1px solid var(--b-line);background:var(--b-side)}
      .csb-brand{display:flex;align-items:center;gap:10px;height:48px;padding:0 14px;font:700 16px/1 "Space Grotesk",sans-serif;letter-spacing:-.025em}
      .csb-brand img{width:28px;height:28px}
      .csb-nav{padding:6px 8px}
      .csb-grp{margin-bottom:12px}
      .csb-nav a,.csb-more>summary{display:flex;align-items:center;gap:10px;height:34px;margin:0 0 2px;padding:0 10px;border-radius:8px;font-size:14px;font-weight:500;color:var(--b-mut)}
      @media (min-height:900px){.csb-nav{padding-top:12px}.csb-grp{margin-bottom:16px}.csb-nav a,.csb-more>summary{height:40px;margin-bottom:4px}}
      @media (min-height:1000px){.csb-nav{padding-top:16px}.csb-grp{margin-bottom:20px}.csb-nav a,.csb-more>summary{height:44px;margin-bottom:6px;font-size:15px}}
      @media (min-height:1100px){.csb-nav{padding-top:20px}.csb-grp{margin-bottom:24px}.csb-nav a,.csb-more>summary{height:48px}}
      .csb-more>summary{list-style:none;cursor:pointer}.csb-more>summary::-webkit-details-marker{display:none}
      .csb-nav a[aria-current]{color:var(--b-fg);background:color-mix(in srgb,var(--b-fg) 8%,transparent)}
      .csb-ico{width:18px;height:18px;flex-shrink:0;border-radius:6px;background:currentColor;opacity:.22}
      .csb-nav a[aria-current] .csb-ico{background:var(--b-acc);opacity:.9}
      .csb-col{display:flex;flex:1;min-width:0;flex-direction:column}
      .csb-top{position:sticky;top:0;z-index:30;display:flex;flex-shrink:0;align-items:center;gap:4px;height:42px;padding:0 12px;border-bottom:1px solid var(--b-line);background:var(--b-bg)}
      .csb-top>a{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
      .csb-top>a img{display:block;width:24px;height:24px}
      .csb-menu{width:18px;height:18px;margin:0 5px 0 -1px;border:2px solid var(--b-mut);border-radius:4px;box-sizing:border-box;opacity:.8}
      .csb-crumb{display:none;margin:0;font-size:14px;color:var(--b-mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .csb-crumb b{font-weight:400;color:var(--b-fg)}
      .csb-crumb i{display:none;font-style:normal}
      .csb-search{display:flex}
      .csb-search span{display:block;width:16px;height:16px;margin:0 6px;border:2px solid var(--b-mut);border-radius:50%;box-sizing:border-box;font-size:0;overflow:hidden;opacity:.8}
      .csb-main{flex:1;background-image:radial-gradient(1200px 320px at 50% -120px,color-mix(in srgb,var(--b-acc) 5%,transparent),transparent 70%)}
      .csb-page{max-width:1200px;margin:0 auto;padding:32px 16px 0}
      .csb-page h1{margin:0;font:600 24px/1.25 "Space Grotesk",sans-serif;letter-spacing:-.025em;overflow-wrap:anywhere}
      .csb-page>p{margin:6px 0 0;max-width:42rem;font-size:14px;line-height:1.45;color:var(--b-mut)}
      .csb-main.csb-scroll{padding-bottom:96px}
      .csb-body{max-width:48rem;margin-top:8px;font-size:14px;line-height:1.55;color:var(--b-mut)}
      .csb-body a{color:var(--b-fg);text-decoration:underline;text-underline-offset:2px}
      .csb-body h2{margin:20px 0 4px;font:600 16px/1.3 "Space Grotesk",sans-serif;color:var(--b-fg)}
      .csb-body h2 span{color:var(--b-acc)}
      .csb-body h2 small{margin-left:6px;font:500 12px Inter,sans-serif;color:var(--b-mut)}
      .csb-pr,.csb-pr-arch{margin:0;padding:0;list-style:none}
      .csb-pr li{padding:4px 0 12px;border-bottom:1px solid var(--b-line)}
      .csb-pr li p,.csb-pr-when{margin:4px 0}
      .csb-home{padding-top:8px}
      .csb .csb-home h1{margin:0;font:600 40px/1.05 "Space Grotesk",sans-serif;letter-spacing:-.02em;color:var(--b-fg)}
      .csb-home h1 span{display:block;color:var(--b-acc)}
      .csb-hl{display:grid;font:600 40px/1.05 "Space Grotesk",sans-serif;letter-spacing:-.02em}.csb-hl>*{grid-area:1/1}.csb-hl>i{visibility:hidden;font-style:normal}.csb-hl b{display:block;font-weight:inherit}
      .csb-home>p{margin:16px 0 0;max-width:30rem;font-size:16px;line-height:1.5}
      .csb-home>div:not(.csb-hl){max-width:36rem;height:52px;margin:24px 0 0;border:1px solid var(--b-line);border-radius:12px}
      .csb .csb-home>p.csb-about{margin:72px 0 0;font-size:14px;line-height:20px}
      .csb-tabs{position:fixed;left:0;right:0;bottom:0;display:flex;padding-bottom:env(safe-area-inset-bottom);border-top:1px solid var(--b-line);background:var(--b-tab)}
      .csb .csb-tabs>*{display:flex;flex:1;min-height:52px;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:10.5px;font-weight:500;color:var(--b-mut)}
      .csb-tabs a[aria-current]{color:var(--b-acc)}
      .csb-tabs a[aria-current] .csb-ico{background:var(--b-acc);opacity:.9}
      @media (min-width:640px){.csb-top{padding:0 24px}.csb-crumb i{display:inline}.csb-page{padding:32px 24px 0}.csb-page h1{font-size:32px}.csb-home{padding-top:24px}.csb .csb-home h1,.csb-hl{font-size:56px}}
      @media (min-width:768px){.csb-side{display:flex}.csb-top{gap:12px;height:48px;padding:0 24px}.csb-top>a,.csb-menu,.csb-tabs{display:none}.csb-crumb{display:block}.csb-search{flex:1;justify-content:center}.csb-search span{display:flex;align-items:center;width:100%;max-width:20rem;height:36px;margin:0;padding:0 12px;border:1px solid var(--b-line);border-radius:8px;font-size:14px;color:var(--b-mut);opacity:1}}
      @media (min-width:1024px){.csb-top{padding:0 32px}.csb-page{padding:32px 32px 0}.csb-search span{max-width:24rem}}
      @media (max-width:1279px){${rail("")}}
      ${rail("html.cs-sb-min ")}
      @media (min-width:1700px){.csb-page{max-width:1600px}}
      .csbc{--b-pop:#141416;--b-fg:#f4f4f5;--b-mut:#a1a1aa;--b-line:#ffffff14;--b-acc:#ffc700;--b-soft:#ffc7001f;position:fixed;left:12px;right:12px;bottom:calc(53px + env(safe-area-inset-bottom) + .75rem);z-index:60;box-sizing:border-box;padding:16px;border:1px solid var(--b-line);border-radius:12px;background:var(--b-pop);color:var(--b-fg);box-shadow:0 18px 40px -16px rgba(0,0,0,.55);font-family:Inter,ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
      html.light .csbc{--b-pop:#fff;--b-fg:#09090b;--b-mut:#52525b;--b-line:#e4e4e7;--b-acc:#a16207;--b-soft:#eab3081f}
      .csbc *{box-sizing:border-box}
      .csbc-row{display:flex;align-items:flex-start;gap:12px}
      .csbc-ico{display:grid;place-items:center;flex-shrink:0;width:28px;height:28px;margin-top:2px;border-radius:8px;background:var(--b-soft);color:var(--b-acc)}
      .csbc-ico svg{width:16px;height:16px}
      .csbc-txt{min-width:0}
      .csbc-txt>p{margin:0}
      .csbc-txt>p+p{margin-top:4px}
      .csbc-h{font:600 14px/20px "Space Grotesk",sans-serif}
      .csbc-txt>p.csbc-b{font-size:12px;line-height:1.625;color:var(--b-mut)}
      .csbc-b span{color:var(--b-fg)}
      .csbc-b a{color:inherit;text-decoration:underline;text-underline-offset:2px}
      .csbc-btns{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
      .csbc-btns button{height:32px;padding:0 12px;border:1px solid var(--b-line);border-radius:8px;background:var(--b-pop);color:var(--b-fg);font:600 12px/1 Inter,ui-sans-serif,system-ui,sans-serif;cursor:pointer}
      @media (min-width:768px){.csbc{left:16px;right:auto;bottom:7rem;width:22rem}}
    </style>`;

// The app's ConsentBanner (src/components/layout/ConsentBanner.tsx) takes over from the static banner by
// this id: keep the two banners' words and sizes in step.
const CONSENT_ID = BOOT_CONSENT_ID;

/**
 * The first-visit privacy banner as static HTML, painted with the shell (it used to wait for the
 * JavaScript, so on a phone it was the page's largest paint, seconds in). It sits outside #root, so
 * React's first render leaves it alone; the app's ConsentBanner takes over from it in place.
 * The inline script runs before the first paint: a stored choice or a browser privacy signal (GPC,
 * Do Not Track) removes it at once, so a returning visitor never sees it flash. Until the app has
 * loaded, its buttons store the choice the same way the app does (src/lib/consent.ts), and Esc means
 * "No thanks". data-nosnippet keeps it out of search results.
 */
export function bootConsent(): string {
  const shield = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`;
  const script = `<script>(function(){var b=document.getElementById('${CONSENT_ID}');if(!b)return;var n=navigator,w=window;`
    + `function chosen(){try{var c=JSON.parse(localStorage.getItem('cs-consent')||'null');return !!(c&&c.v===1&&typeof c.analytics==='boolean')}catch(e){return false}}`
    + `if(n.globalPrivacyControl===true||n.doNotTrack==='1'||n.msDoNotTrack==='1'||w.doNotTrack==='1'||chosen()){b.parentNode.removeChild(b);return}`
    + `function set(a){var c=JSON.stringify({analytics:a,at:new Date().toISOString(),v:1});try{localStorage.setItem('cs-consent',c)}catch(e){w.${BOOT_CHOICE_GLOBAL}=c}if(b.parentNode)b.parentNode.removeChild(b);try{w.dispatchEvent(new Event('cs-consent-change'))}catch(e){}}`
    + `b.addEventListener('click',function(e){var t=e.target&&e.target.closest&&e.target.closest('button[data-a]');if(t)set(t.getAttribute('data-a')==='1')});`
    + `b.addEventListener('keydown',function(e){if(e.key==='Escape')set(false)})})()</script>`;
  return `<section id="${CONSENT_ID}" class="csbc" role="region" aria-label="Privacy choices" aria-describedby="${CONSENT_ID}-text" data-nosnippet>`
    + `<div class="csbc-row"><span class="csbc-ico">${shield}</span><div class="csbc-txt"><p class="csbc-h">Your privacy</p>`
    + `<p id="${CONSENT_ID}-text" class="csbc-b">Sign-in, preferences and offline data are stored on this device so the app works. That's always on. `
    + `May we also count <span>anonymous page views</span>? No cookies, no IDs, no third parties. <a href="/privacy">Privacy policy</a></p></div></div>`
    + `<div class="csbc-btns"><button type="button" data-a="0">No thanks</button><button type="button" data-a="1">Allow</button></div></section>${script}`;
}

interface Item { to: string; label: string; end?: boolean }
// The sidebar's everyday pages, then its "More" group: a <details>, so it opens without the app too. Open on one of
// its own pages, or when this device left it open (html.cs-nav-more, set in index.html from cs-nav-more).
const PRIMARY: Item[] = [{ to: "/", label: "Home", end: true }, { to: "/events", label: "Events" }, { to: "/teams", label: "Teams" }, { to: "/rankings", label: "Rankings" }, { to: "/predict", label: "Predict", end: true }, { to: "/my-team", label: "My team" }, { to: "/scout", label: "Scout" }];
const MORE: Item[] = [{ to: "/power-rankings", label: "Power rankings" }, { to: "/compare", label: "Compare" }, { to: "/shortlist", label: "Shortlist" }, { to: "/download", label: "Download" }, { to: "/methodology", label: "How it works" }, { to: "/settings", label: "Settings" }];
// The phone tab bar's default (src/lib/tabBar.ts DEFAULT_TABS); a device with its own choice gets it once the app loads.
const TABS: Item[] = [{ to: "/", label: "Home", end: true }, { to: "/events", label: "Events" }, { to: "/predict", label: "Predict", end: true }, { to: "/my-team", label: "My team" }, { to: "/scout", label: "Scout" }];

// Like react-router's NavLink: case-insensitive, a prefix at a segment boundary unless `end`.
const active = (path: string, it: Item) => {
  const p = path.toLowerCase();
  return p === it.to || (!it.end && p.startsWith(`${it.to}/`));
};
const link = (path: string, it: Item) =>
  `<a href="${it.to}"${active(path, it) ? ' aria-current="page"' : ""}><i class="csb-ico"></i><span>${esc(it.label)}</span></a>`;

/** The static first paint for a page path (see the top of this file). `path` is the request path; `hero`: the
 *  home page's lines in use (server/heroLines.ts liveHeroLines), the built-in ones by default. */
export function bootShell(path: string, meta: PageMeta, hero: HeroLinesResponse = { lines: [...DEFAULT_HERO_LINES], custom: false }): string {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : "/";
  const home = p === "/";
  const nav = `<div class="csb-grp">${PRIMARY.map((it) => link(p, it)).join("")}</div>`
    + `<details class="csb-more"${MORE.some((it) => active(p, it)) ? " open" : ""}><summary><i class="csb-ico"></i><span>More</span></summary><div>${MORE.map((it) => link(p, it)).join("")}</div></details>`
    + `<script>if(document.documentElement.classList.contains('cs-nav-more'))document.querySelector('.csb-more').open=true</script>`;
  // Home's headline for this hour; the app reads data-line and keeps it, so its copy matches this paint. Every
  // line sits invisibly in the same cell (as in the app), so the hero is the app's height from the first frame.
  const lines = hero.lines.length ? hero.lines : DEFAULT_HERO_LINES;
  const line = homeHeadlineAt(Date.now(), lines.length);
  // A page with no title of its own (not found) gets the shell alone.
  const page = home
    ? `<div class="csb-page csb-home" id="cs-boot-page" data-path="/"><div class="csb-hl">${lines.map(([a, b]) => `<i aria-hidden="true">${esc(a)} <b>${esc(b)}</b></i>`).join("")}<h1 data-line="${line}">${esc(lines[line][0])} <span>${esc(lines[line][1])}</span></h1></div><p>${esc(HOME_LEAD)}</p><div></div><p class="csb-about">${esc(HOME_ABOUT)}</p></div>`
    : meta.title && !meta.notFound
      // A content page (power rankings) puts its words here in full, as already-safe HTML (PageMeta.bodyHtml).
      // A page whose own markup has its H1 (How it works, prerendered) keeps that one: one H1 per page.
      ? `<div class="csb-page" id="cs-boot-page" data-path="${esc(p)}">${meta.bodyHtml && /<h1[\s>]/.test(meta.bodyHtml) ? "" : `<h1>${esc(meta.heading ?? meta.title)}</h1>`}${meta.bodyHtml ? `<div class="csb-body">${meta.bodyHtml}</div>` : `<p>${esc(meta.description)}</p>`}</div>` : "";
  // The owner's own hero lines (not the built-in ones the app already has), on every page: the app reads them
  // before its first render (src/lib/heroLines.ts), so Home draws the same lines whichever page it opens from.
  const heroJson = hero.custom ? `<script type="application/json" id="${HERO_LINES_ID}">${JSON.stringify(lines).replace(/</g, "\\u003c")}</script>` : "";
  // The page block is hidden when the service worker served this HTML (made for "/") for another page offline.
  const guard = `<script>(function(){var b=document.getElementById('cs-boot-page'),p=location.pathname.replace(/\\/+$/,'')||'/';if(b&&b.getAttribute('data-path').toLowerCase()!==p.toLowerCase())b.hidden=true})()</script>`;
  return [
    `<div class="csb">`,
    `<aside class="csb-side"><a class="csb-brand" href="/" aria-label="Control Scout home"><img src="/logo.png" alt="" /><span>Control Scout</span></a><nav class="csb-nav" aria-label="Main">${nav}</nav></aside>`,
    `<div class="csb-col"><header class="csb-top"><span class="csb-menu" aria-hidden="true"></span><a href="/" aria-label="Control Scout home"><img src="/logo.png" alt="" /></a><p class="csb-crumb"><i>Control Scout / </i><b>${esc(pageTitle(p))}</b></p>${home ? "" : `<div class="csb-search"><span>Search teams, events, matches…</span></div>`}</header>`,
    // A page with content in full scrolls with the document (before the app loads, or with no JavaScript at all).
    `<main class="csb-main${meta.bodyHtml && page ? " csb-scroll" : ""}">${page}${guard}${heroJson}</main></div>`,
    `<nav class="csb-tabs" aria-label="Main">${TABS.map((it) => link(p, it)).join("")}</nav>`,
    `</div>`,
  ].join("");
}
